import { z } from "zod";

const text = z.string().trim().min(1).max(1800);
const id = z.string().regex(/^[A-Za-z0-9_.-]{1,80}$/);
const point = z.tuple([z.number().min(0).max(400), z.number().min(0).max(400)]);
export const lineSchema = z.object({
  id, label: text, d: z.string().min(1).max(3000).regex(/^[MmLlHhVvCcSsQqTtAaZz0-9.,\s-]+$/),
  start: point, direction: point, group: z.enum(["shape", "detail", "gesture", "guide"]),
  fill: z.enum(["ink", "none"]).optional(),
});
export const exampleSchema = z.object({
  id, name: text, source: text, lines: z.array(lineSchema).min(1).max(60),
  parts: z.array(z.object({ id, label: text, point, radius: z.number().min(10).max(80) })).max(12).optional(),
});
export const lessonSchema = z.object({
  id, stage: z.number().int().min(1).max(9), title: text, goal: text,
  instructions: z.array(text).min(1).max(10), check: text, easier: text,
  help: z.number().int().min(0).max(3), minutes: z.number().int().min(10).max(20),
  examples: z.array(exampleSchema).max(4),
  steps: z.array(z.object({ text, lines: z.array(id).max(60), action: z.enum(["look", "draw", "compare", "collect"]), hideLines: z.array(id).max(60).optional() })).max(10),
  practice: z.object({
    mode: z.literal("copy"), baseLines: z.array(id).max(12), anchors: z.array(id).max(12),
    easyLines: z.array(id).max(12), easyAnchors: z.array(id).max(12), largeLines: z.array(id).max(12),
    demoBaseLines: z.array(id).max(12), scale: z.number().min(.4).max(1),
  }).optional(),
  references: z.array(id).max(12),
  easyLines: z.array(id).max(12).optional(),
  readiness: z.object({ manuscript: z.boolean(), examples: z.boolean(), visualMatch: z.boolean(), browser: z.boolean() }),
});
export const packSchema = z.object({
  schemaVersion: z.literal(1), id, version: id, title: text,
  stages: z.array(z.object({ id: z.number().int().min(1).max(9), title: text, criterion: text })).length(9),
  lessons: z.array(lessonSchema).min(80).max(200),
  projects: z.array(z.object({ id, title: text, sessions: z.array(text).length(4), check: text })).min(4).max(40),
}).superRefine((pack, ctx) => {
  const ids = new Set(pack.lessons.map(l => l.id));
  if (ids.size !== pack.lessons.length) ctx.addIssue({ code: "custom", message: "수업 ID 중복" });
  if (new Set(pack.stages.map(s => s.id)).size !== 9) ctx.addIssue({ code: "custom", message: "단계 ID 중복" });
  const expected = [8, 8, 12, 6, 8, 10, 8, 10, 10];
  expected.forEach((count, i) => {
    if (pack.lessons.filter(l => /^D\d{2}$/.test(l.id) && l.stage === i + 1).length !== count)
      ctx.addIssue({ code: "custom", message: `${i + 1}단계 기본 수업 수 불일치` });
  });
  for (let n = 1; n <= 80; n++) if (!ids.has(`D${String(n).padStart(2, "0")}`)) ctx.addIssue({ code: "custom", message: "기본 수업 누락" });
  for (const lesson of pack.lessons) {
    if (lesson.references.some(ref => !ids.has(ref))) ctx.addIssue({ code: "custom", message: `${lesson.id}: 연결 수업 누락` });
    if (lesson.readiness.examples && (!lesson.examples.length || !lesson.steps.length)) ctx.addIssue({ code: "custom", message: `${lesson.id}: 시각 자료 누락` });
    if (lesson.readiness.visualMatch && !lesson.readiness.examples) ctx.addIssue({ code: "custom", message: "검수 상태 오류" });
    for (const ex of lesson.examples) {
      if (new Set(ex.lines.map(l => l.id)).size !== ex.lines.length) ctx.addIssue({ code: "custom", message: "선 ID 중복" });
      if (lesson.steps.some(s => s.lines.some(key => !ex.lines.some(l => l.id === key)))) ctx.addIssue({ code: "custom", message: `${lesson.id}: 시범 선 누락` });
      if (lesson.easyLines?.some(key => !ex.lines.some(l => l.id === key))) ctx.addIssue({ code: "custom", message: `${lesson.id}: 쉬운 과제 선 누락` });
      const practice = lesson.practice;
      const copyIds = practice ? [...practice.baseLines, ...practice.anchors, ...practice.easyLines, ...practice.easyAnchors, ...practice.largeLines, ...practice.demoBaseLines] : [];
      if ([...copyIds, ...lesson.steps.flatMap(s => s.hideLines ?? [])].some(key => !ex.lines.some(l => l.id === key))) ctx.addIssue({ code: "custom", message: `${lesson.id}: 모작 도움 연결 오류` });
      if (practice && lesson.stage !== 3) ctx.addIssue({ code: "custom", message: `${lesson.id}: 모작 단계 오류` });
      if (ex.parts && new Set(ex.parts.map(p => p.id)).size !== ex.parts.length) ctx.addIssue({ code: "custom", message: "부위 ID 중복" });
    }
  }
});
export type Pack = z.infer<typeof packSchema>;
export type Lesson = z.infer<typeof lessonSchema>;
export type Example = z.infer<typeof exampleSchema>;
export type DrawingLine = z.infer<typeof lineSchema>;
export type Help = 0 | 1 | 2 | 3;
export type Check = "unconfirmed" | "assisted" | "independent" | "difficult";
export type Stroke = { points: [number, number, number][]; color: string; width: number; erase: boolean };
export type DrawingDocument = {
  schemaVersion: 1; lesson: Lesson; example: Example; packVersion: string;
  strokes: Stroke[]; photo: string | null; tool: "app" | "paper" | "external";
  help: Help; usedHelp: Help; step: number; minutes: number; short: boolean;
  check: Check; difficulty: string; memo: string; references: string[];
  partChecks?: string[];
  correctionSource?: { attemptId: string; revision: number; lessonId: string; example: Example; scale: number };
  comparison?: { focus: "width" | "ears" | "eyes" | "space"; reason: string };
  character: { name: string; role: string; personality: string; features: string; improvement: string };
};
export type Attempt = {
  id: string; user_id: string; revision: number; status: "draft" | "completed";
  document: DrawingDocument; created_at: string; updated_at: string;
};

const documentSchema = z.object({
  schemaVersion: z.literal(1), lesson: lessonSchema, example: exampleSchema, packVersion: id,
  strokes: z.array(z.object({
    points: z.array(z.tuple([z.number().min(0).max(400), z.number().min(0).max(400), z.number().min(0).max(1)])).min(1).max(6000),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/), width: z.number().min(.1).max(30), erase: z.boolean(),
  })).max(1000),
  photo: z.string().max(1_500_000).regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/).nullable(),
  tool: z.enum(["app", "paper", "external"]), help: z.number().int().min(0).max(3), usedHelp: z.number().int().min(0).max(3),
  step: z.number().int().min(0).max(9), minutes: z.number().int().min(1).max(20), short: z.boolean(),
  check: z.enum(["unconfirmed", "assisted", "independent", "difficult"]), difficulty: z.string().max(100), memo: z.string().max(1000),
  references: z.array(z.string().uuid()).max(100),
  partChecks: z.array(id).max(12).optional(),
  correctionSource: z.object({ attemptId: z.string().uuid(), revision: z.number().int().min(1), lessonId: z.string().regex(/^D2[0-6]$/), example: exampleSchema, scale: z.number().min(.4).max(1) }).optional(),
  comparison: z.object({ focus: z.enum(["width", "ears", "eyes", "space"]), reason: z.string().max(500) }).optional(),
  character: z.object({ name: z.string().max(300), role: z.string().max(300), personality: z.string().max(300), features: z.string().max(300), improvement: z.string().max(300) }),
}).superRefine((doc, ctx) => {
  if (doc.step >= doc.lesson.steps.length || !doc.lesson.examples.some(e => e.id === doc.example.id)) ctx.addIssue({ code: "custom", message: "그림의 수업 연결이 올바르지 않아요." });
  if (doc.partChecks?.some(id => !doc.example.parts?.some(p => p.id === id))) ctx.addIssue({ code: "custom", message: "부위 확인 연결 오류" });
  if (doc.correctionSource && (doc.lesson.id !== "D27" || !doc.references.includes(doc.correctionSource.attemptId))) ctx.addIssue({ code: "custom", message: "수정 전 그림 연결 오류" });
});
const attemptSchema = z.object({
  id: z.string().uuid(), user_id: z.string().uuid(), revision: z.number().int().min(0),
  status: z.enum(["draft", "completed"]), document: documentSchema,
  created_at: z.string().min(1), updated_at: z.string().min(1),
});
export function parseAttempt(value: unknown): Attempt { return attemptSchema.parse(value) as Attempt; }

export function newDocument(lesson: Lesson, example: Example, version: string): DrawingDocument {
  return { schemaVersion: 1, lesson, example, packVersion: version, strokes: [], photo: null,
    tool: "app", help: lesson.help as Help, usedHelp: lesson.help as Help, step: 0, minutes: 10, short: false,
    check: "unconfirmed", difficulty: "", memo: "", references: [],
    character: { name: "", role: "", personality: "", features: "", improvement: "" } };
}

export function parsePack(value: unknown): Pack { return packSchema.parse(value); }
export function playable(lesson: Lesson) { return lesson.readiness.examples && lesson.readiness.visualMatch; }
