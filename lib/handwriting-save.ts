import { hashBytes, handwritingRowMatches, type FrozenHandwritingSave } from './handwriting-draft.ts';
type Result<T> = { data: T | null; error: unknown };
export type HandwritingSaveIO = {
  assertCurrent: () => Promise<void>;
  readSession: () => PromiseLike<Result<unknown>>;
  readResource: () => PromiseLike<Result<unknown>>;
  download: () => PromiseLike<Result<Blob>>;
  upload: () => PromiseLike<{ error: unknown }>;
  commit: () => PromiseLike<{ error: unknown }>;
};
export function confirmedObjectAbsent(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { code?: string; statusCode?: string | number; status?: number; message?: string };
  return e.code === 'NoSuchKey' || e.code === 'not_found' || String(e.statusCode ?? e.status) === '404' || String(e.statusCode ?? e.status) === '400' && e.message === 'Object not found';
}
/** Always re-read exact rows/bytes. Errors never mean absence; flags never authorize skipping verification. */
export async function confirmHandwritingSave(job: FrozenHandwritingSave, io: HandwritingSaveIO): Promise<void> {
  const boundary = async <T>(call: () => PromiseLike<T>) => { await io.assertCurrent(); const result = await call(); await io.assertCurrent(); return result; };
  const rows = async () => {
    const session = await boundary(io.readSession);
    if (session.error) throw Error('handwriting_save_unconfirmed');
    const resource = job.resource ? await boundary(io.readResource) : { data: null, error: null };
    if (resource.error) throw Error('handwriting_save_unconfirmed');
    if (session.data && !handwritingRowMatches(job.session, session.data) || resource.data && !handwritingRowMatches(job.resource!, resource.data)
      || session.data && job.resource && !resource.data) throw Error('handwriting_save_conflict');
    return { session, resource };
  };
  const initial = await rows();
  if (job.resource) {
    let object = await boundary(io.download);
    if (object.error) {
      if (!confirmedObjectAbsent(object.error) || initial.session.data || initial.resource.data) throw Error('handwriting_save_unconfirmed');
      // Upload response can be lost. Regardless, download and hash the fixed path.
      await boundary(io.upload);
      object = await boundary(io.download);
    }
    if (object.error || !object.data) throw Error('handwriting_save_unconfirmed');
    const digest = await hashBytes(object.data); await io.assertCurrent();
    if (digest !== job.pngSha256) throw Error('handwriting_save_conflict');
  }
  if (!initial.session.data) {
    const result = await boundary(io.commit);
    const error = result.error as { code?: string; message?: string } | null;
    if (error?.code === 'PGRST202' || error?.code === '42883') throw Error('handwriting_save_schema_unavailable');
    if (error?.message === 'handwriting_reset_changed') throw Error('handwriting_reset_changed');
    // Even an error may follow a committed transaction. Exact independent GET is authority.
  }
  const final = await rows();
  if (!final.session.data || job.resource && !final.resource.data) throw Error('handwriting_save_unconfirmed');
  await io.assertCurrent();
}
