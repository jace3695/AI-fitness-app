import { z } from 'zod';
import { isRecordTimezone } from './study-policy.ts';
import { SERVER_EVIDENCE_PROTOCOL } from './server-types.ts';
import { LocalEvidenceError, type Immutable } from './persistence-types.ts';

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
export const admissionMarkerSchema = z.object({ present: z.boolean(), value: z.string().min(1).max(200).nullable() }).strict()
  .refine(value => value.present || value.value === null);
export const frozenEnrollmentIntentSchema = z.object({
  version: z.literal(1), ownerId: uuid, requestId: uuid, resetMarker: admissionMarkerSchema,
  studyDayTimezone: z.string().max(100).refine(isRecordTimezone), protocol: z.literal(SERVER_EVIDENCE_PROTOCOL),
  manifestRelease: z.string().min(1).max(200).regex(/^[A-Za-z0-9:_@./-]+$/), manifestDigest: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();
/** Inert request bytes. Neither these fields nor an incarnation authenticate an owner. */
export type FrozenEnrollmentIntent = Immutable<z.infer<typeof frozenEnrollmentIntentSchema>>;
export const storeIncarnationSchema = z.object({
  version: z.literal(1), incarnationId: uuid, origin: z.enum(['created', 'unproven_upgrade']),
  continuity: z.enum(['unknown', 'verified']),
}).strict();
export type StoreIncarnation = z.infer<typeof storeIncarnationSchema>;
export const localGenerationAdmissionSchema = z.object({
  version: z.literal(1), ownerId: uuid, generationId: uuid, incarnationId: uuid,
  continuity: z.literal('verified'), kind: z.enum(['first_enrollment', 'reset_carry']),
  creationRequestId: uuid, initialGenerationId: uuid, resetMarker: admissionMarkerSchema,
  resetRequestId: uuid.nullable(),
}).strict().refine(value => value.kind === 'first_enrollment'
  ? value.resetRequestId === null && value.generationId === value.initialGenerationId
  : value.resetRequestId !== null);
export type LocalGenerationAdmission = z.infer<typeof localGenerationAdmissionSchema>;
export const enrollmentIntentRowSchema = z.object({
  version: z.literal(1), ownerId: uuid, incarnationId: uuid, intent: frozenEnrollmentIntentSchema,
}).strict().refine(value => value.ownerId === value.intent.ownerId);
export type EnrollmentIntentRow = z.infer<typeof enrollmentIntentRowSchema>;
export type AdmissionSnapshot = Immutable<{
  incarnationId: string; origin: StoreIncarnation['origin']; continuity: 'unknown' | 'verified';
  admission: LocalGenerationAdmission | null; intent: FrozenEnrollmentIntent | null;
}>;
export function checkedAdmissionValue<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new LocalEvidenceError('corrupt_record');
  return parsed.data;
}
