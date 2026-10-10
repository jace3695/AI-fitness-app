import { CURRICULUM, type CurriculumLesson } from '../../data/curriculum.ts';
import type { TaskDescriptor, TaskFormat } from './types.ts';

export const CHOICE_GRADING_VERSION = 'legacy-choice-v1';
export const TYPED_GRADING_VERSION = 'legacy-typed-v1';

/** References are assigned where content is authored. Never match prompts, readings or answers. */
export function buildEvidenceCatalogue(lessons: readonly CurriculumLesson[]): readonly TaskDescriptor[] {
  const tasks = new Map<string, TaskDescriptor>();
  const questionIds = new Set<string>();
  for (const lesson of lessons) {
    for (const [index, quiz] of lesson.quiz.entries()) {
      if (!quiz.evidenceRef) throw new Error(`Missing authored evidence reference: ${lesson.id}:${index}`);
      const ref = quiz.evidenceRef;
      if (!ref.itemId || !ref.taskId || !Number.isSafeInteger(ref.contentRevision) || ref.contentRevision < 1) throw new Error('Invalid authored reference');
      const key = `${ref.taskId}@${ref.contentRevision}`;
      const legacyQuestionId = `${lesson.id}:${index}`;
      if (tasks.has(key) || questionIds.has(legacyQuestionId)) throw new Error(`Authored identity collision: ${key}`);
      questionIds.add(legacyQuestionId);
      const formats: TaskFormat[] = quiz.kind === 'listening' ? ['listening_choice'] : quiz.kind === 'input' ? ['meaning_choice', 'typed_answer'] : ['meaning_choice'];
      tasks.set(key, { ...ref, lessonId: lesson.id, legacyQuestionId,
        bindings: formats.flatMap(taskFormat => (['course_lesson', 'course_review'] as const).map(source => ({ source, taskFormat,
          gradingVersion: taskFormat === 'typed_answer' ? TYPED_GRADING_VERSION : CHOICE_GRADING_VERSION,
        }))),
      });
    }
  }
  return [...tasks.values()];
}

export const LEGACY_EVIDENCE_CATALOGUE = buildEvidenceCatalogue(CURRICULUM);
