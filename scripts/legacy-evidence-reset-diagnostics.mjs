import { types } from 'node:util';

// Optional observation only. No identity, arbitrary string, error or storage bytes.
export const RESET_DIAGNOSTIC_TYPE = 'b2-e10-reset-recovery-v1';
const COUNTS = ['navigations', 'panels', 'visiblePanels', 'notices', 'visibleNotices'];
const FLAGS = ['receiptPresent', 'busyVisible', 'uncertainVisible', 'cleanupErrorVisible'];
/** @param {unknown} value */
export function projectResetRecoveryDiagnostic(value) {
  try {
    if (!value || typeof value !== 'object' || types.isProxy(value) || Array.isArray(value)) return undefined;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.length !== COUNTS.length + FLAGS.length || keys.some(key => typeof key !== 'string' || ![...COUNTS, ...FLAGS].includes(key))) return undefined;
    const result = {};
    for (const key of [...COUNTS, ...FLAGS]) {
      const descriptor = descriptors[key];
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) return undefined;
      const item = descriptor.value;
      if (COUNTS.includes(key) ? !Number.isSafeInteger(item) || item < 0 || item > 8 : typeof item !== 'boolean') return undefined;
      result[key] = item;
    }
    if (result.visiblePanels > result.panels || result.visibleNotices > result.notices) return undefined;
    return result;
  } catch { return undefined; }
}
/** Only a single exact annotation, bounded before JSON parsing, is eligible.
 * @param {unknown} annotations */
export function resetRecoveryAnnotation(annotations) {
  try {
    if (!Array.isArray(annotations) || types.isProxy(annotations)) return undefined;
    const length = Object.getOwnPropertyDescriptor(annotations, 'length')?.value;
    if (!Number.isSafeInteger(length) || length < 0 || length > 32) return undefined;
    const arrayDescriptors = Object.getOwnPropertyDescriptors(annotations);
    const arrayKeys = Reflect.ownKeys(arrayDescriptors);
    if (arrayKeys.length !== length + 1 || arrayKeys.some(key => typeof key !== 'string' || (key !== 'length' && !Array.from({ length }, (_, index) => String(index)).includes(key)) || !Object.hasOwn(arrayDescriptors[key], 'value'))) return undefined;
    let found;
    for (let index = 0; index < length; index++) {
      const entry = Object.getOwnPropertyDescriptor(annotations, String(index));
      if (!entry || !Object.hasOwn(entry, 'value')) return undefined;
      const row = entry.value;
      if (!row || typeof row !== 'object' || types.isProxy(row)) return undefined;
      const own = Object.getOwnPropertyDescriptors(row);
      if (Reflect.ownKeys(own).some(key => !['type', 'description', 'location'].includes(String(key)) || !Object.hasOwn(own[key], 'value'))) return undefined;
      if (own.type?.value !== RESET_DIAGNOSTIC_TYPE) continue;
      if (found !== undefined) return undefined;
      const raw = own.description?.value;
      if (typeof raw !== 'string' || raw.length > 1024) return undefined;
      found = projectResetRecoveryDiagnostic(JSON.parse(raw));
      if (!found) return undefined;
    }
    return found;
  } catch { return undefined; }
}
