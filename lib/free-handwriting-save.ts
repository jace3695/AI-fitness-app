import { confirmHandwritingSave, type HandwritingSaveIO } from './handwriting-save.ts';
import { type FreeSave } from './free-handwriting-draft.ts';

/** Reuse exact-row/object transport only, never course validation or its RPC. */
export async function confirmFreeSave(job: FreeSave, io: HandwritingSaveIO): Promise<void> {
  return confirmHandwritingSave({
    ...job,
    png: new Blob([new Uint8Array(job.png).buffer], { type: 'image/png' }),
  }, {
    ...io,
    commit: async () => {
      const result = await io.commit();
      const error = result.error as { message?: string } | null;
      if (error?.message === 'free_handwriting_reset_changed') throw Error('handwriting_reset_changed');
      return result;
    },
  });
}
