import { comparisonCanonical, parseComparisonAttempt, validateComparisonResource, inspectComparisonPng, canPairAttempts, COMPARISON_MAX_PNG_BYTES, type ComparisonAttempt } from './handwriting-comparison.ts';

export type ComparisonStatus = 'empty' | 'loading' | 'ready_verified' | 'ready_legacy_unverified' | 'no_saved_image' | 'unlinked_or_unsupported' | 'metadata_missing' | 'image_unavailable' | 'integrity_mismatch' | 'read_unconfirmed' | 'reset_or_owner_changed';
export type ComparisonPane = { id: string | null; status: ComparisonStatus; attempt: ComparisonAttempt | null; url: string; width: number; height: number; pathDate: string | null; token: number; reason: string };
export type ComparisonEntry = ReturnType<typeof parseComparisonAttempt> & { id: string };
export type ComparisonSnapshot = { entries: ComparisonEntry[]; loading: boolean; hasMore: boolean; error: string; blocked: boolean; panes: [ComparisonPane, ComparisonPane]; revision: number };
/** Intentionally exposes no mutation, signing, fallback, draft or migration methods. */
export interface ComparisonTransport {
  active(): boolean;
  epoch(): string;
  authenticate(signal: AbortSignal): Promise<string | null>;
  marker(owner: string, signal: AbortSignal): Promise<string | null>;
  page(owner: string, after: string | null, limit: number, signal: AbortSignal): Promise<unknown[]>;
  session(owner: string, id: string, signal: AbortSignal): Promise<unknown | null>;
  resource(owner: string, id: string, signal: AbortSignal): Promise<unknown | null>;
  links(owner: string, resourceId: string, signal: AbortSignal): Promise<{ id: string }[]>;
  download(path: string, signal: AbortSignal): Promise<Blob>;
  hash(bytes: Uint8Array): Promise<string>;
  decode(blob: Blob, signal: AbortSignal): Promise<{ width: number; height: number }>;
  createUrl(blob: Blob): string;
  revokeUrl(url: string): void;
}
export class ComparisonReadError extends Error {
  status: ComparisonStatus;
  constructor(status: ComparisonStatus) { super(status); this.status = status; }
}
const fail = (status: ComparisonStatus): never => { throw new ComparisonReadError(status); };
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
export const COMPARISON_PAGE_SIZE = 50;
export const comparisonStatusText: Record<ComparisonStatus, string> = {
  empty: '기록을 선택해 주세요.', loading: '기록과 저장한 이미지를 확인 중…',
  ready_verified: '저장 당시 해시와 일치하는 이미지', ready_legacy_unverified: '저장 당시 원본 해시 없음 · 원본 무결성 미확인',
  no_saved_image: '종이·다른 앱 완료 기록에는 저장한 이미지가 없어요.',
  unlinked_or_unsupported: '연습 이미지의 연결 또는 기록 형식을 확인할 수 없어요.',
  metadata_missing: '연결된 기록 또는 이미지 정보가 더 이상 없어요.',
  image_unavailable: '이미지가 없거나 PNG 형식·크기를 확인할 수 없어요.',
  integrity_mismatch: '이미지가 저장 당시 해시와 달라 표시하지 않았어요.',
  read_unconfirmed: '읽기를 확인하지 못했어요. 연결을 확인하고 다시 시도해 주세요.',
  reset_or_owner_changed: '계정 또는 초기화 상태를 다시 확인해야 해요. 새로 불러와 주세요.',
};
const emptyPane = (token = 0): ComparisonPane => ({ id: null, status: 'empty', attempt: null, url: '', width: 0, height: 0, pathDate: null, token, reason: '' });
type Request = { generation: number; epoch: string; controller: AbortController; timer: ReturnType<typeof setTimeout> };

/** In-memory read controller. Every await is fenced; failed reads never imply absence. */
export class SavedHandwritingReader {
  private state: ComparisonSnapshot = { entries: [], loading: false, hasMore: true, error: '', blocked: false, panes: [emptyPane(), emptyPane()], revision: 0 };
  private generation = 0;
  private cursor: string | null = null;
  private markerValue: string | null | undefined;
  private epochValue: string | null = null;
  private requests = new Set<Request>();
  private paneRequests: (Request | null)[] = [null, null];
  private listBusy = false;
  private disposed = false;
  private listeners = new Set<() => void>();
  private owner: string;
  private transport: ComparisonTransport;
  constructor(owner: string, transport: ComparisonTransport) { this.owner = owner; this.transport = transport; }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.state;
  private publish(patch: Partial<ComparisonSnapshot>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch, revision: this.state.revision + 1 };
    this.listeners.forEach(listener => listener());
  }
  private pane(index: 0 | 1, pane: ComparisonPane) { const panes = [...this.state.panes] as ComparisonSnapshot['panes']; panes[index] = pane; this.publish({ panes }); }
  private release(index: 0 | 1) {
    this.paneRequests[index]?.controller.abort('comparison_cancelled'); this.paneRequests[index] = null;
    const previous = this.state.panes[index]; if (previous.url) this.transport.revokeUrl(previous.url);
    return emptyPane(previous.token + 1);
  }
  invalidate(reason = comparisonStatusText.reset_or_owner_changed) {
    this.generation++; this.requests.forEach(request => { request.controller.abort('comparison_cancelled'); clearTimeout(request.timer); }); this.requests.clear();
    const panes: ComparisonSnapshot['panes'] = [this.release(0), this.release(1)];
    this.cursor = null; this.markerValue = undefined; this.epochValue = null; this.listBusy = false;
    this.publish({ entries: [], panes, loading: false, hasMore: true, blocked: true, error: reason });
  }
  activate() { this.disposed = false; }
  dispose() { this.invalidate(''); this.disposed = true; }
  suspend(reason: string) {
    const marker = this.markerValue, epoch = this.epochValue;
    this.invalidate(reason); this.markerValue = marker; this.epochValue = epoch;
  }
  private request(): Request {
    if (this.disposed) fail('reset_or_owner_changed');
    if (!this.transport.active()) { this.invalidate(); fail('reset_or_owner_changed'); }
    let epoch: string; try { epoch = this.transport.epoch(); } catch { this.invalidate(); return fail('reset_or_owner_changed'); }
    if (this.epochValue !== null && epoch !== this.epochValue) { this.invalidate(); return fail('reset_or_owner_changed'); }
    this.epochValue = epoch;
    const controller = new AbortController();
    const request = { generation: this.generation, epoch, controller, timer: setTimeout(() => controller.abort('comparison_timeout'), 25_000) };
    this.requests.add(request); return request;
  }
  private finish(request: Request) { clearTimeout(request.timer); this.requests.delete(request); }
  private current(request: Request) {
    if (this.disposed || request.generation !== this.generation || !this.transport.active()) return false;
    try { return this.transport.epoch() === request.epoch; } catch { return false; }
  }
  private check(request: Request) {
    if (!this.current(request)) {
      if (!this.disposed && request.generation === this.generation) this.invalidate();
      fail('reset_or_owner_changed');
    }
    if (request.controller.signal.aborted) fail('read_unconfirmed');
  }
  private async wait<T>(request: Request, action: () => Promise<T>): Promise<T> {
    this.check(request);
    const signal = request.controller.signal;
    return new Promise<T>((resolve, reject) => {
      const abort = () => reject(new ComparisonReadError('read_unconfirmed'));
      signal.addEventListener('abort', abort, { once: true });
      Promise.resolve().then(() => { this.check(request); return action(); }).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
  }
  private async auth(request: Request) {
    this.check(request);
    let identity: string | null;
    try { identity = await this.wait(request, () => this.transport.authenticate(request.controller.signal)); } catch {
      if (!this.current(request)) this.check(request);
      if (!request.controller.signal.aborted || request.controller.signal.reason === 'comparison_timeout') this.invalidate(comparisonStatusText.read_unconfirmed);
      return fail('read_unconfirmed');
    }
    this.check(request); if (identity !== this.owner) { this.invalidate(); fail('reset_or_owner_changed'); }
  }
  private async boundary(request: Request, establish = false) {
    await this.auth(request);
    let marker: string | null;
    try {
      marker = await this.wait(request, () => this.transport.marker(this.owner, request.controller.signal)); this.check(request);
      if (marker !== null && (typeof marker !== 'string' || !marker.length || marker.length > 200)) fail('read_unconfirmed');
    } catch {
      if (!this.current(request)) this.check(request);
      if (!request.controller.signal.aborted || request.controller.signal.reason === 'comparison_timeout') this.invalidate(comparisonStatusText.read_unconfirmed);
      return fail('read_unconfirmed');
    }
    await this.auth(request);
    if (establish && this.markerValue === undefined) this.markerValue = marker;
    if (this.markerValue === undefined || marker !== this.markerValue) {
      this.invalidate(); fail('reset_or_owner_changed');
    }
  }
  async refresh() { this.invalidate(''); this.publish({ blocked: false }); await this.more(); }
  async more() {
    if (this.disposed || this.listBusy || !this.state.hasMore || this.state.blocked) return;
    this.listBusy = true; this.publish({ loading: true, error: '' }); let request: Request | null = null;
    try {
      request = this.request(); await this.boundary(request, true);
      const rows = await this.wait(request, () => this.transport.page(this.owner, this.cursor, COMPARISON_PAGE_SIZE, request!.controller.signal)); this.check(request);
      if (!Array.isArray(rows) || rows.length > COMPARISON_PAGE_SIZE) fail('read_unconfirmed');
      const entries = [...this.state.entries]; let last = this.cursor;
      for (const row of rows) {
        const rawId = (row as { id?: unknown })?.id;
        if (!uuid(rawId)) fail('read_unconfirmed');
        const id = rawId as string;
        if (!uuid(id) || last !== null && id <= last) fail('read_unconfirmed');
        const entry = { ...parseComparisonAttempt(row, this.owner), id };
        const old = entries.find(item => item.id === id);
        if (old && comparisonCanonical(old) !== comparisonCanonical(entry)) fail('read_unconfirmed');
        if (!old) entries.push(entry); last = id;
      }
      await this.boundary(request);
      // A page is a current bounded read, not a certified immutable full-account snapshot.
      this.cursor = last;
      entries.sort((a, b) => (b.attempt?.date ?? '').localeCompare(a.attempt?.date ?? '') || (b.attempt?.savedAt ?? '').localeCompare(a.attempt?.savedAt ?? '') || a.id.localeCompare(b.id));
      this.publish({ entries, hasMore: rows.length === COMPARISON_PAGE_SIZE });
    } catch (error) {
      if (request && request.generation === this.generation && !this.current(request)) this.invalidate();
      if (!request || this.current(request)) {
        if (error instanceof ComparisonReadError && error.status === 'reset_or_owner_changed') this.invalidate();
        else this.publish({ error: comparisonStatusText.read_unconfirmed });
      }
    } finally { if (request) this.finish(request); if (!request || request.generation === this.generation) { this.listBusy = false; this.publish({ loading: false }); } }
  }
  clear(index: 0 | 1) { this.pane(index, this.release(index)); }
  async select(index: 0 | 1, id: string | null) {
    const blank = this.release(index); this.pane(index, blank);
    if (!id || this.disposed || this.state.blocked) return;
    const entry = this.state.entries.find(item => item.id === id);
    if (!entry) return;
    const other = this.state.panes[index === 0 ? 1 : 0].attempt;
    if (entry.attempt && other && !canPairAttempts(entry.attempt, other)) {
      this.pane(index, { ...blank, status: 'unlinked_or_unsupported', reason: '같은 기록 또는 같은 이미지 연결을 두 번 고를 수 없어요.' }); return;
    }
    if (entry.status !== 'candidate' || !entry.attempt) {
      this.pane(index, { ...blank, id, attempt: entry.attempt, status: entry.status === 'candidate' ? 'unlinked_or_unsupported' : entry.status, reason: entry.reason }); return;
    }
    const chosen = entry.attempt, token = blank.token;
    this.pane(index, { ...blank, id, attempt: chosen, status: 'loading' });
    let request: Request | null = null, allocated = '';
    const current = () => !!request && this.current(request) && this.state.panes[index].token === token && this.state.panes[index].id === id;
    try {
      request = this.request(); this.paneRequests[index] = request;
      const check = () => { this.check(request!); if (!current()) fail('reset_or_owner_changed'); };
      const exact = async () => {
        await this.auth(request!); check();
        const row = await this.wait(request!, () => this.transport.session(this.owner, id, request!.controller.signal)); check();
        if (row === null) fail('metadata_missing');
        const parsed = parseComparisonAttempt(row, this.owner);
        if (parsed.status !== 'candidate' || !parsed.attempt || parsed.attempt.fingerprint !== chosen.fingerprint) fail('unlinked_or_unsupported');
        await this.auth(request!); check();
        const resourceRow = await this.wait(request!, () => this.transport.resource(this.owner, chosen.resourceId!, request!.controller.signal)); check();
        if (resourceRow === null) fail('metadata_missing');
        const resource = validateComparisonResource(resourceRow, chosen); if (!resource) return fail('unlinked_or_unsupported');
        await this.auth(request!); check();
        const links = await this.wait(request!, () => this.transport.links(this.owner, chosen.resourceId!, request!.controller.signal)); check();
        if (!Array.isArray(links) || links.length !== 1 || links[0].id !== chosen.id) fail('unlinked_or_unsupported');
        return resource;
      };
      await this.boundary(request); check(); const resource = await exact();
      await this.auth(request); check();
      const blob = await this.wait(request, () => this.transport.download(resource.path, request!.controller.signal)); check();
      if (!(blob instanceof Blob) || blob.type !== 'image/png' || blob.size !== resource.size || blob.size < 1 || blob.size > COMPARISON_MAX_PNG_BYTES) fail('image_unavailable');
      const bytes = new Uint8Array(await this.wait(request, () => blob.arrayBuffer())); check();
      let dimensions: { width: number; height: number }; try { dimensions = inspectComparisonPng(bytes, chosen.kind); } catch { return fail('image_unavailable'); }
      if (chosen.expectedHash) { const actual = await this.wait(request, () => this.transport.hash(bytes)); check(); if (actual !== chosen.expectedHash) fail('integrity_mismatch'); }
      let decoded: { width: number; height: number }; try { decoded = await this.wait(request, () => this.transport.decode(blob, request!.controller.signal)); } catch { check(); return fail('image_unavailable'); }
      check(); if (decoded.width !== dimensions.width || decoded.height !== dimensions.height) fail('image_unavailable');
      const finalResource = await exact(); if (finalResource.fingerprint !== resource.fingerprint) fail('unlinked_or_unsupported');
      await this.boundary(request); check();
      allocated = this.transport.createUrl(blob); check();
      this.pane(index, { id, attempt: chosen, token, status: chosen.legacy ? 'ready_legacy_unverified' : 'ready_verified', url: allocated, ...dimensions, pathDate: resource.pathDate, reason: '' }); allocated = '';
    } catch (error) {
      if (request && request.generation === this.generation && !this.current(request)) this.invalidate();
      if (current()) {
        const status = error instanceof ComparisonReadError ? error.status : 'read_unconfirmed';
        if (status === 'reset_or_owner_changed') this.invalidate();
        else this.pane(index, { ...blank, id, attempt: chosen, status, reason: comparisonStatusText[status] });
      }
    } finally { if (allocated) this.transport.revokeUrl(allocated); if (request) this.finish(request); if (this.paneRequests[index] === request) this.paneRequests[index] = null; }
  }
  async swap() { const ids = this.state.panes.map(pane => pane.id); this.clear(0); this.clear(1); await Promise.all([this.select(0, ids[1]), this.select(1, ids[0])]); }
  imageError(index: 0 | 1, token: number, url: string) {
    const pane = this.state.panes[index]; if (pane.token !== token || pane.url !== url) return;
    const blank = this.release(index); this.pane(index, { ...blank, id: pane.id, attempt: pane.attempt, status: 'image_unavailable', reason: comparisonStatusText.image_unavailable });
  }
  /** Clear already decoded pixels before any resume request, then re-read the list and exact pair. */
  async resume() {
    const marker = this.markerValue, epoch = this.epochValue;
    this.invalidate('확인하는 동안 이미지를 숨겼어요.'); this.publish({ blocked: false });
    // Preserve the old marker fence, so a remote reset cannot silently resurrect a retained image.
    this.markerValue = marker; this.epochValue = epoch;
    await this.more();
    // A restored page requires explicit selection again, including selections beyond page one.
    // Never partially restore only the ids that happen to fit the first page.
  }
}
