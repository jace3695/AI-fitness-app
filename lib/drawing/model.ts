import { z } from "zod";

const text = z.string().trim().min(1).max(1800);
const id = z.string().regex(/^[A-Za-z0-9_.-]{1,80}$/);
const point = z.tuple([z.number().min(0).max(400), z.number().min(0).max(400)]);
export const lineSchema = z.object({
  id, label: text, d: z.string().min(1).max(3000).regex(/^[MmLlHhVvCcSsQqTtAaZz0-9.,\s-]+$/),
  start: point, direction: point, group: z.enum(["shape", "detail", "gesture", "guide"]),
  fill: z.enum(["ink", "none"]).optional(),
});
const strokeSchema = z.object({
  points: z.array(z.tuple([z.number().min(0).max(400), z.number().min(0).max(400), z.number().min(0).max(1)])).min(1).max(6000),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/), width: z.number().min(.1).max(30), erase: z.boolean(),
});
export const exampleSchema = z.object({
  id, name: text, source: text, lines: z.array(lineSchema).min(1).max(60),
  parts: z.array(z.object({ id, label: text, point, radius: z.number().min(10).max(80) })).max(12).optional(),
  identity: z.object({
    comparison: z.array(lineSchema).max(30).optional(), easyReference: z.array(lineSchema).max(30).optional(), anchors:z.array(point).max(4).optional(),
    family: z.enum(['cat', 'rabbit']), baseline: z.array(lineSchema).min(1).max(30),
    features: z.array(z.object({id, label: text, lines: z.array(id).min(1).max(6)})).length(3),
    options: z.array(z.object({id, label: text, lines: z.array(lineSchema).min(1).max(30), frames: z.array(z.array(id).max(30)).length(5)})).min(1).max(2),
  }).optional(),
  gesture: z.object({
    lines: z.array(lineSchema).min(1).max(30), frames: z.array(z.array(id).max(30)).length(5),
    baseLines: z.array(id).max(20), easyLines: z.array(id).max(20), anchors: z.array(point).max(8),
    focus: text, choices: z.array(z.object({id, label: text, lines: z.array(lineSchema).min(1).max(8)})).max(2),
  }).optional(),
  structure: z.object({
    lines: z.array(lineSchema).min(1).max(20),
    easyLines: z.array(id).min(1).max(8),
    frames: z.array(z.array(id).max(20)).length(5),
    hidden: z.array(lineSchema).max(8),
    explanation: text,
    choices: z.array(z.object({ id, label: text, lines: z.array(lineSchema).min(1).max(8) })).max(3),
  }).optional(),
  variations: z.array(z.object({ id, label: text, changed: text, kept: text, instruction: text,
    remove: z.array(id).min(1).max(12), lines: z.array(lineSchema).min(1).max(12),
    anchors: z.array(point).max(8), easy: z.enum(['kept', 'anchors', 'trace']),
  })).min(1).max(5).optional(),
});
const memoryPracticeSchema = z.object({
  features: z.array(z.object({ id, label: text, lines: z.array(id).min(1).max(12) })).min(2).max(4),
  hint: z.enum(['words', 'outline', 'choices', 'copy', 'preview', 'masses']),
  hintLines: z.array(id).max(12),
});
export const lessonSchema = z.object({
  id, stage: z.number().int().min(1).max(9), title: text, goal: text,
  instructions: z.array(text).min(1).max(10), check: text, easier: text,
  help: z.number().int().min(0).max(3), minutes: z.number().int().min(10).max(20),
  examples: z.array(exampleSchema).max(4),
  steps: z.array(z.object({ text, lines: z.array(id).max(60), action: z.enum(["look", "draw", "compare", "collect"]), hideLines: z.array(id).max(60).optional(), memoryPhase: z.enum(["observe", "recall", "compare"]).optional() })).max(10),
  practice: z.object({
    mode: z.literal("copy"), baseLines: z.array(id).max(12), anchors: z.array(id).max(12),
    easyLines: z.array(id).max(12), easyAnchors: z.array(id).max(12), largeLines: z.array(id).max(12),
    demoBaseLines: z.array(id).max(12), scale: z.number().min(.4).max(1),
  }).optional(),
  memoryPractice: memoryPracticeSchema.optional(),
  identityPractice: z.enum(["draw", "expressions", "poses"]).optional(),
  gesturePractice: z.literal(true).optional(),
  structurePractice: z.enum(["analyze", "assemble", "occlusion", "direction"]).optional(),
  variationPractice: z.literal(true).optional(),
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
      if (lesson.identityPractice && (lesson.stage !== 8 || !ex.identity)) ctx.addIssue({code:'custom',message:'캐릭터 비교 예제 누락'});
      if (ex.identity) {
        const c=ex.identity;
        if (!lesson.identityPractice || new Set(c.options.map(o=>o.id)).size!==c.options.length || c.features.some(f=>f.lines.some(id=>!c.baseline.some(l=>l.id===id)))) ctx.addIssue({code:'custom',message:'기준 특징 연결 오류'});
        for (const o of c.options) if (new Set(o.lines.map(l=>l.id)).size!==o.lines.length || o.frames.flat().some(id=>!o.lines.some(l=>l.id===id))) ctx.addIssue({code:'custom',message:'자세 시범 연결 오류'});
      }
      if (lesson.gesturePractice && (lesson.stage !== 7 || !ex.gesture)) ctx.addIssue({code:'custom',message:'크로키 예제 누락'});
      if (ex.gesture) {
        const g=ex.gesture;
        if (!lesson.gesturePractice || new Set(g.lines.map(l=>l.id)).size!==g.lines.length || [...g.frames.flat(),...g.baseLines,...g.easyLines].some(id=>!g.lines.some(l=>l.id===id)) || new Set(g.choices.map(c=>c.id)).size!==g.choices.length) ctx.addIssue({code:'custom',message:'크로키 시범 연결 오류'});
      }
      if (lesson.structurePractice && (lesson.stage !== 6 || !ex.structure)) ctx.addIssue({ code: 'custom', message: '도형화 예제 누락' });
      if (ex.structure) {
        const st = ex.structure;
        if (!lesson.structurePractice || new Set(st.lines.map(l => l.id)).size !== st.lines.length || [...st.easyLines,...st.frames.flat()].some(id => !st.lines.some(l => l.id === id)) || new Set(st.choices.map(c => c.id)).size !== st.choices.length) ctx.addIssue({ code: 'custom', message: '도형화 연결 오류' });
      }
      if (lesson.variationPractice && (lesson.stage !== 5 || !ex.variations?.length)) ctx.addIssue({ code: 'custom', message: '변형 예제 누락' });
      if (ex.variations) {
        if (!lesson.variationPractice || new Set(ex.variations.map(v => v.id)).size !== ex.variations.length) ctx.addIssue({ code: 'custom', message: '변형 선택 오류' });
        for (const v of ex.variations) {
          if (v.remove.some(key => !ex.lines.some(l => l.id === key)) || new Set(v.remove).size !== v.remove.length || new Set(v.lines.map(l => l.id)).size !== v.lines.length || v.lines.some(l => !v.remove.includes(l.id))) ctx.addIssue({ code: 'custom', message: '변형 선 연결 오류' });
        }
      }
      if (new Set(ex.lines.map(l => l.id)).size !== ex.lines.length) ctx.addIssue({ code: "custom", message: "선 ID 중복" });
      if (lesson.steps.some(s => s.lines.some(key => !ex.lines.some(l => l.id === key)))) ctx.addIssue({ code: "custom", message: `${lesson.id}: 시범 선 누락` });
      if (lesson.easyLines?.some(key => !ex.lines.some(l => l.id === key))) ctx.addIssue({ code: "custom", message: `${lesson.id}: 쉬운 과제 선 누락` });
      if (lesson.memoryPractice) {
        if (lesson.stage !== 4 || lesson.steps.some(s => !s.memoryPhase)) ctx.addIssue({ code: "custom", message: "기억 연습 단계 오류" });
        const keys = [...lesson.memoryPractice.hintLines, ...lesson.memoryPractice.features.flatMap(f => f.lines)];
        if (keys.some(key => !ex.lines.some(l => l.id === key))) ctx.addIssue({ code: "custom", message: "기억 특징 연결 오류" });
      }
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
const identitySourceSchema=z.object({attemptId:z.string().uuid(),revision:z.number().int().min(1),lessonId:z.string().regex(/^D(6[1-9]|70)$/),family:z.enum(['cat','rabbit']),label:text,lines:z.array(lineSchema).min(1).max(30),strokes:z.array(strokeSchema).min(1).max(1000)});
const identityStateSchema=z.object({features:z.array(id).max(2),choice:id,compared:z.boolean(),note:z.string().max(500),baseline:identitySourceSchema.optional(),collection:z.array(identitySourceSchema).max(3),editing:z.string().uuid().optional()});
export type IdentityState=z.infer<typeof identityStateSchema>;
export type IdentitySource=z.infer<typeof identitySourceSchema>;
export type DrawingDocument = {
  schemaVersion: 1; lesson: Lesson; example: Example; packVersion: string;
  strokes: Stroke[]; photo: string | null; tool: "app" | "paper" | "external";
  help: Help; usedHelp: Help; step: number; minutes: number; short: boolean;
  check: Check; difficulty: string; memo: string; references: string[];
  partChecks?: string[];
  correctionSource?: { attemptId: string; revision: number; lessonId: string; example: Example; scale: number };
  comparison?: { focus: "width" | "ears" | "eyes" | "space"; reason: string };
  memory?: { selected: string[]; peeking: boolean; peeks: number; copyMode: boolean; recalled: string; compared: string;
    source?: { attemptId: string; revision: number; lessonId: string } };
  identity?: IdentityState;
  gesture?: { trace: Stroke[]; surface: "trace" | "free"; choice: string; directionChecked: boolean; compared: boolean; note: string };
  structure?: { analysis: Stroke[]; surface: "analysis" | "assembly"; choice: string; identified: boolean; compared: boolean; note: string;
    source?: { attemptId: string; revision: number; lessonId: "D45"; exampleId: string } };
  variation?: { choice: string; changedChecked: boolean; keptChecked: boolean; note: string };
  character: { name: string; role: string; personality: string; features: string; improvement: string };
};
export type Attempt = {
  id: string; user_id: string; revision: number; status: "draft" | "completed";
  document: DrawingDocument; created_at: string; updated_at: string;
};

const documentSchema = z.object({
  schemaVersion: z.literal(1), lesson: lessonSchema, example: exampleSchema, packVersion: id,
  strokes: z.array(strokeSchema).max(1000),
  photo: z.string().max(1_500_000).regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/).nullable(),
  tool: z.enum(["app", "paper", "external"]), help: z.number().int().min(0).max(3), usedHelp: z.number().int().min(0).max(3),
  step: z.number().int().min(0).max(9), minutes: z.number().int().min(1).max(20), short: z.boolean(),
  check: z.enum(["unconfirmed", "assisted", "independent", "difficult"]), difficulty: z.string().max(100), memo: z.string().max(1000),
  references: z.array(z.string().uuid()).max(100),
  partChecks: z.array(id).max(12).optional(),
  correctionSource: z.object({ attemptId: z.string().uuid(), revision: z.number().int().min(1), lessonId: z.string().regex(/^D2[0-6]$/), example: exampleSchema, scale: z.number().min(.4).max(1) }).optional(),
  comparison: z.object({ focus: z.enum(["width", "ears", "eyes", "space"]), reason: z.string().max(500) }).optional(),
  memory: z.object({ selected: z.array(id).max(4), peeking: z.boolean(), peeks: z.number().int().min(0).max(10000), copyMode: z.boolean(), recalled: z.string().max(500), compared: z.string().max(500),
    source: z.object({ attemptId: z.string().uuid(), revision: z.number().int().min(1), lessonId: z.string().regex(/^D(29|3[0-2])$/) }).optional(),
  }).optional(),
  character: z.object({ name: z.string().max(300), role: z.string().max(300), personality: z.string().max(300), features: z.string().max(300), improvement: z.string().max(300) }),
  identity: identityStateSchema.optional(),
  gesture: z.object({ trace: z.array(strokeSchema).max(1000), surface: z.enum(['trace','free']), choice: z.string().max(80), directionChecked: z.boolean(), compared: z.boolean(), note: z.string().max(500) }).optional(),
  structure: z.object({ analysis: z.array(strokeSchema).max(1000), surface: z.enum(['analysis','assembly']), choice: z.string().max(80), identified: z.boolean(), compared: z.boolean(), note: z.string().max(500),
    source: z.object({ attemptId: z.string().uuid(), revision: z.number().int().min(1), lessonId: z.literal('D45'), exampleId: id }).optional(),
  }).optional(),
  variation: z.object({ choice: id, changedChecked: z.boolean(), keptChecked: z.boolean(), note: z.string().max(500) }).optional(),
}).superRefine((doc, ctx) => {
  if (doc.identity) {
    const c=doc.identity,meta=doc.example.identity;
    if (!doc.lesson.identityPractice || !meta || c.features.some(id=>!meta.features.some(f=>f.id===id)) || new Set(c.features).size!==c.features.length || !meta.options.some(o=>o.id===c.choice)) ctx.addIssue({code:'custom',message:'캐릭터 특징 연결 오류'});
    const sources=[...(c.baseline?[c.baseline]:[]),...c.collection];
    if (sources.some(x=>x.family!==meta?.family || !doc.references.includes(x.attemptId)) || (c.baseline && c.baseline.lessonId!=='D61') || new Set(c.collection.map(x=>x.attemptId)).size!==c.collection.length || (c.editing&&!c.collection.some(x=>x.attemptId===c.editing))) ctx.addIssue({code:'custom',message:'캐릭터 원본 연결 오류'});
    const allowed=doc.lesson.id==='D65'?['D62','D63','D64']:doc.lesson.id==='D70'?['D66','D67','D68','D69']:[];
    if(c.collection.some(x=>!allowed.includes(x.lessonId)))ctx.addIssue({code:'custom',message:'모음 수업 연결 오류'});
  }
  if (doc.gesture && (!doc.lesson.gesturePractice || !doc.example.gesture || (doc.gesture.choice && !doc.example.gesture.choices.some(c=>c.id===doc.gesture!.choice)))) ctx.addIssue({code:'custom',message:'크로키 선택 연결 오류'});
  if (doc.structure) {
    if (!doc.lesson.structurePractice || !doc.example.structure || (doc.structure.choice && !doc.example.structure.choices.some(c => c.id === doc.structure!.choice))) ctx.addIssue({ code: 'custom', message: '도형화 선택 오류' });
    if (doc.structure.source && (doc.lesson.id !== 'D46' || !doc.references.includes(doc.structure.source.attemptId) || doc.structure.source.exampleId !== doc.example.id)) ctx.addIssue({ code: 'custom', message: '분석 원본 연결 오류' });
  }
  if (doc.variation && (!doc.lesson.variationPractice || !doc.example.variations?.some(v => v.id === doc.variation!.choice))) ctx.addIssue({ code: 'custom', message: '변형 선택 연결 오류' });
  if (doc.step >= doc.lesson.steps.length || !doc.lesson.examples.some(e => e.id === doc.example.id)) ctx.addIssue({ code: "custom", message: "그림의 수업 연결이 올바르지 않아요." });
  if (doc.memory && (!doc.lesson.memoryPractice || doc.memory.selected.some(key => !doc.lesson.memoryPractice?.features.some(f => f.id === key)) || new Set(doc.memory.selected).size !== doc.memory.selected.length)) ctx.addIssue({ code: "custom", message: "기억 연습 연결 오류" });
  if (doc.memory?.source && (!['D33','D34'].includes(doc.lesson.id) || !doc.references.includes(doc.memory.source.attemptId))) ctx.addIssue({ code: "custom", message: "이전 기억 그림 연결 오류" });
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
