/** Lossless, narrowly addressed edits. Projections are never writable source documents. */
export class LanguageDocumentError extends Error {
  constructor(message = '일부 학습 기록의 형식을 안전하게 읽을 수 없습니다. 원본과 입력을 보존했습니다.') { super(message); this.name = 'LanguageDocumentError'; }
}
export class LanguageSourceConflictError extends Error {
  constructor(message = '다른 창에서 이 기록이 바뀌었습니다. 입력을 보존했어요. 최신 기록을 확인한 뒤 다시 시도해 주세요.') { super(message); this.name = 'LanguageSourceConflictError'; }
}
export type LanguageJsonPath = readonly (string | number)[];
type Member = { key: string; start: number; value: Node };
type Node = { kind: 'object' | 'array' | 'value'; start: number; end: number; members?: Member[]; items?: Node[] };

function parse(raw: string): Node {
  let at = 0;
  const whitespace = () => { while (/\s/.test(raw[at] ?? '') && at < raw.length) { if (!' \r\n\t'.includes(raw[at])) throw new LanguageDocumentError(); at++; } };
  const string = () => {
    const start = at++;
    while (at < raw.length) {
      const char = raw[at++];
      if (char === '"') { const token = raw.slice(start, at); try { return JSON.parse(token) as string; } catch { throw new LanguageDocumentError(); } }
      if (char === '\\') at++;
    }
    throw new LanguageDocumentError();
  };
  const value = (depth: number): Node => {
    if (depth > 256) throw new LanguageDocumentError();
    whitespace(); const start = at;
    if (raw[at] === '{') {
      at++; whitespace(); const members: Member[] = [];
      if (raw[at] !== '}') while (true) {
        whitespace(); const memberStart = at;
        if (raw[at] !== '"') throw new LanguageDocumentError();
        const key = string(); whitespace(); if (raw[at++] !== ':') throw new LanguageDocumentError();
        members.push({ key, start: memberStart, value: value(depth + 1) }); whitespace();
        if (raw[at] !== ',') break; at++;
      }
      if (raw[at++] !== '}') throw new LanguageDocumentError();
      return { kind: 'object', start, end: at, members };
    }
    if (raw[at] === '[') {
      at++; whitespace(); const items: Node[] = [];
      if (raw[at] !== ']') while (true) {
        items.push(value(depth + 1)); whitespace(); if (raw[at] !== ',') break; at++;
      }
      if (raw[at++] !== ']') throw new LanguageDocumentError();
      return { kind: 'array', start, end: at, items };
    }
    if (raw[at] === '"') string();
    else {
      const match = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(raw.slice(at));
      if (!match) throw new LanguageDocumentError(); at += match[0].length;
    }
    return { kind: 'value', start, end: at };
  };
  const root = value(0); whitespace(); if (at !== raw.length) throw new LanguageDocumentError(); return root;
}
function child(node: Node, part: string | number): Node | undefined {
  if (typeof part === 'string') {
    if (node.kind !== 'object') throw new LanguageDocumentError();
    const members = node.members!.filter(member => member.key === part);
    if (members.length > 1) throw new LanguageDocumentError('동일한 학습 항목 이름이 중복되어 안전하게 저장할 수 없습니다. 원본을 보존했습니다.');
    return members[0]?.value;
  }
  if (node.kind !== 'array' || !Number.isSafeInteger(part) || part < 0) throw new LanguageDocumentError();
  return node.items![part];
}
function find(root: Node, path: LanguageJsonPath): Node | undefined {
  let node: Node | undefined = root;
  for (const part of path) { if (!node) return undefined; node = child(node, part); }
  return node;
}
function encode(value: unknown): string {
  const seen = new WeakSet<object>();
  const check = (item: unknown) => {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return;
    if (typeof item === 'number' && Number.isFinite(item)) return;
    if (!item || typeof item !== 'object' || seen.has(item)) throw new LanguageDocumentError();
    seen.add(item);
    if (Array.isArray(item)) { for (let index = 0; index < item.length; index++) { if (!(index in item)) throw new LanguageDocumentError(); check(item[index]); } }
    else { if (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) throw new LanguageDocumentError(); for (const entry of Object.values(item)) check(entry); }
    seen.delete(item);
  };
  check(value); return JSON.stringify(value);
}
function sameJsonNumber(left: string, right: string): boolean {
  // Compare exact decimal values rather than rounded JSON.parse numbers. This
  // preserves 3e0/3.0 while never conflating unsafe integers or underflow with 0.
  const canonical = (raw: string) => {
    const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(raw); if (!match) return null;
    let digits = (match[2] + (match[3] ?? '')).replace(/^0+/, ''); if (!digits) return '0';
    let exponent = BigInt(match[4] ?? '0') - BigInt((match[3] ?? '').length);
    const trailing = /0+$/.exec(digits)?.[0].length ?? 0; if (trailing) { digits = digits.slice(0, -trailing); exponent += BigInt(trailing); }
    return `${match[1]}${digits}e${exponent}`;
  };
  const a = canonical(left), b = canonical(right); return a !== null && a === b;
}
export class LanguageDocument {
  private raw: string;
  private root: Node;
  readonly rootKind: 'object' | 'array';
  constructor(raw: string | null | undefined, rootKind: 'object' | 'array') {
    this.rootKind = rootKind;
    this.raw = raw ?? (rootKind === 'object' ? '{}' : '[]'); this.root = parse(this.raw);
    if (this.root.kind !== rootKind) throw new LanguageDocumentError();
  }
  rawAt(path: LanguageJsonPath = []): string | undefined { const node = find(this.root, path); return node ? this.raw.slice(node.start, node.end) : undefined; }
  get<T = unknown>(path: LanguageJsonPath = []): T | undefined { const raw = this.rawAt(path); return raw === undefined ? undefined : JSON.parse(raw) as T; }
  has(path: LanguageJsonPath): boolean { return find(this.root, path) !== undefined; }
  length(path: LanguageJsonPath = []): number { const node = find(this.root, path); if (node?.kind !== 'array') throw new LanguageDocumentError(); return node.items!.length; }
  private replace(start: number, end: number, value: string) { const next = this.raw.slice(0, start) + value + this.raw.slice(end); const root = parse(next); if (root.kind !== this.rootKind) throw new LanguageDocumentError(); this.raw = next; this.root = root; }
  set(path: LanguageJsonPath, value: unknown): this {
    const encoded = encode(value);
    if (!path.length) { if (this.rawAt() !== encoded) this.replace(this.root.start, this.root.end, encoded); return this; }
    for (let length = 1; length < path.length; length++) {
      const prefix = path.slice(0, length);
      if (!find(this.root, prefix)) { if (typeof path[length] !== 'string') throw new LanguageDocumentError(); this.set(prefix, {}); }
    }
    const node = find(this.root, path);
    if (node) {
      // Scalar no-ops preserve escape spelling. Never round-trip opaque numbers:
      // JSON.parse(1e999) is Infinity and stringify would incorrectly equal null.
      const before = this.raw.slice(node.start, node.end);
      const sameScalar = node.kind === 'value' && (value === null ? before === 'null'
        : typeof value === 'string' || typeof value === 'boolean' ? JSON.parse(before) === value
          : typeof value === 'number' ? sameJsonNumber(before, encoded) : false);
      if (before !== encoded && !sameScalar) this.replace(node.start, node.end, encoded);
      return this;
    }
    const parent = find(this.root, path.slice(0, -1)), part = path[path.length - 1];
    if (!parent || typeof part !== 'string' || parent.kind !== 'object') throw new LanguageDocumentError();
    this.replace(parent.end - 1, parent.end - 1, `${parent.members!.length ? ',' : ''}${JSON.stringify(part)}:${encoded}`); return this;
  }
  /** Copy a validated source token without parsing/stringifying its opaque descendants. */
  setRaw(path: LanguageJsonPath, raw: string): this {
    const token = parse(raw); const encoded = raw.slice(token.start, token.end);
    if (!path.length) { if (this.rawAt() !== encoded) this.replace(this.root.start, this.root.end, encoded); return this; }
    for (let length = 1; length < path.length; length++) {
      const prefix = path.slice(0, length);
      if (!find(this.root, prefix)) { if (typeof path[length] !== 'string') throw new LanguageDocumentError(); this.set(prefix, {}); }
    }
    const node = find(this.root, path);
    if (node) { if (this.raw.slice(node.start, node.end) !== encoded) this.replace(node.start, node.end, encoded); return this; }
    const parent = find(this.root, path.slice(0, -1)), part = path[path.length - 1];
    if (!parent || typeof part !== 'string' || parent.kind !== 'object') throw new LanguageDocumentError();
    this.replace(parent.end - 1, parent.end - 1, `${parent.members!.length ? ',' : ''}${JSON.stringify(part)}:${encoded}`); return this;
  }
  remove(path: LanguageJsonPath): this {
    if (!path.length) throw new LanguageDocumentError();
    const parent = find(this.root, path.slice(0, -1)); if (!parent) return this;
    const part = path[path.length - 1], node = child(parent, part); if (!node) return this;
    const entries = parent.kind === 'object' ? parent.members!.map(member => ({ start: member.start, end: member.value.end })) : parent.items!.map(item => ({ start: item.start, end: item.end }));
    const index = parent.kind === 'object' ? parent.members!.findIndex(member => member.key === part) : part as number;
    const start = index === entries.length - 1 && index > 0 ? entries[index - 1].end : entries[index].start;
    const end = index < entries.length - 1 ? entries[index + 1].start : entries[index].end;
    this.replace(start, end, ''); return this;
  }
  append(path: LanguageJsonPath, value: unknown): this { return this.appendRaw(path, encode(value)); }
  appendRaw(path: LanguageJsonPath, raw: string): this {
    parse(raw); let node = find(this.root, path);
    if (!node) { this.set(path, []); node = find(this.root, path); }
    if (!node || node.kind !== 'array') throw new LanguageDocumentError();
    this.replace(node.end - 1, node.end - 1, `${node.items!.length ? ',' : ''}${raw}`); return this;
  }
  text(): string { return this.raw; }
}
export const languageDocument = (raw: string | null | undefined, root: 'object' | 'array') => new LanguageDocument(raw, root);
export function assertLanguagePathsUnchanged(sourceRaw: string | null | undefined, freshRaw: string | null | undefined, root: 'object' | 'array', paths: readonly LanguageJsonPath[]): void {
  const source = languageDocument(sourceRaw, root), fresh = languageDocument(freshRaw, root);
  for (const path of paths) {
    if (!path.length ? sourceRaw !== freshRaw : source.rawAt(path) !== fresh.rawAt(path)) throw new LanguageSourceConflictError();
  }
}
export function projectLanguageValue<T>(raw: string | null | undefined, fallback: T): { value: T; error: string | null } {
  if (raw == null) return { value: fallback, error: null };
  try { return { value: JSON.parse(raw) as T, error: null }; } catch { return { value: fallback, error: new LanguageDocumentError().message }; }
}
