import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { isRollerOuterStage, rollerOuterPose, rollerOuterStages, rollerInformationalRecoveryStages } from '../app/lib/rollerOuterMotion.ts';
import { rollerStages, rollerRecoveryStages } from '../app/lib/rollerMotion.ts';
import type { RoutinePoint as Point } from '../app/lib/routineMotion.ts';
import type { Exercise, ExerciseGuide } from '../app/data/workouts.ts';

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
type Pose = ReturnType<typeof rollerOuterPose>;

function checkContact(p: Pose) {
  const working = p.side === -1 ? p.leftLeg : p.rightLeg;
  const support = p.side === -1 ? p.rightLeg : p.leftLeg;
  assert.equal(p.target.surface, 'anterolateral-quadriceps');
  assert.equal(working.grounded, false);
  assert.equal(support.grounded, true);
  close(p.roller.z - p.roller.radius, 0);
  close(p.contact.z, p.roller.z + p.roller.radius);
  close(working.hip.z - p.skin, p.contact.z);
  close(working.knee.z - p.skin, p.contact.z);
  close(p.contact.x, p.roller.x);
  close(p.contact.y, working.hip.y);
  assert.ok(Math.abs(p.contact.y - p.roller.y) <= p.roller.halfWidth);
  assert.ok(p.contact.x >= p.target.start.x && p.contact.x <= p.target.end.x);
  assert.ok(p.target.start.x > working.hip.x && p.target.end.x < working.knee.x);
  close(p.roller.angle * p.roller.radius, -p.shift);
  close(p.travel, 2 * p.shift);
  close(p.contactFraction, (p.contact.x - working.hip.x) / p.limbLength);
}

test('new explicit review preserves seven scenes, old held composition, and ordering', () => {
  assert.equal(rollerInformationalRecoveryStages.length, 9);
  assert.deepEqual(rollerInformationalRecoveryStages.map(stage => stage.id), [
    'calf-left', 'calf-right', 'quad-left', 'quad-right', 'outer-quad-left', 'outer-quad-right', 'glute-left', 'glute-right', 'upper-back',
  ]);
  const reused = rollerInformationalRecoveryStages.filter(stage => !isRollerOuterStage(stage.id));
  rollerStages.forEach((stage, i) => assert.equal(reused[i], stage));
  assert.equal(rollerRecoveryStages.filter(stage => 'isStatic' in stage && stage.isStatic).length, 2);
  assert.equal(isRollerOuterStage('outer-left'), false);
  assert.equal(isRollerOuterStage('quad-left'), false);
  assert.equal(isRollerOuterStage('outer-quad-right'), true);
});

test('outer scenes maintain segment lengths and fixed forearm, hand, and opposite foot supports', () => {
  for (const stage of rollerOuterStages) {
    const start = rollerOuterPose(stage.id, 0);
    for (let i = 0; i <= 400; i++) {
      const p = rollerOuterPose(stage.id, i / 400);
      checkContact(p);
      close(distance(p.hip, p.shoulder), 60);
      close(distance(p.shoulder, p.head), 27);
      for (const key of ['left', 'right'] as const) {
        const arm = p[key];
        close(distance(arm.shoulder, arm.elbow), p.armLength);
        close(distance(arm.elbow, arm.hand), p.armLength);
        assert.deepEqual(arm.hand, start[key].hand);
        assert.ok(arm.elbow.z >= 3.5);
        if (arm.forearmSupported) {
          assert.deepEqual(arm.elbow, start[key].elbow);
          close(arm.elbow.z, 3.5);
          close(arm.hand.z, 3.5);
        }
      }
      for (const key of ['leftLeg', 'rightLeg'] as const) {
        const leg = p[key];
        close(distance(leg.hip, leg.knee), p.limbLength);
        close(distance(leg.knee, leg.foot), p.limbLength);
        assert.ok(leg.knee.z >= p.skin && leg.foot.z >= p.skin);
        if (leg.grounded) {
          assert.deepEqual(leg.foot, start[key].foot);
          close(leg.foot.z, p.skin);
        }
      }
      assert.equal((p.side === -1 ? p.left : p.right).forearmSupported, true);
      assert.equal((p.side === -1 ? p.right : p.left).forearmSupported, false);
    }
  }
});

test('left and right geometry are true reflected supports, contact, and limbs', () => {
  const reflected = (a: Point, b: Point) => { close(a.x, b.x); close(a.y, -b.y); close(a.z, b.z); };
  for (let i = 0; i <= 200; i++) {
    const left = rollerOuterPose('outer-quad-left', i / 200), right = rollerOuterPose('outer-quad-right', i / 200);
    for (const key of ['hip', 'shoulder', 'head', 'contact', 'roller'] as const) reflected(left[key], right[key]);
    for (const key of ['shoulder', 'elbow', 'hand'] as const) {
      reflected(left.left[key], right.right[key]);
      reflected(left.right[key], right.left[key]);
    }
    for (const key of ['hip', 'knee', 'foot'] as const) {
      reflected(left.leftLeg[key], right.rightLeg[key]);
      reflected(left.rightLeg[key], right.leftLeg[key]);
    }
  }
});

test('outer motion is bounded, non-static, closes at endpoints and clamps invalid progress', () => {
  for (const stage of rollerOuterStages) {
    const start = rollerOuterPose(stage.id, 0);
    assert.deepEqual(rollerOuterPose(stage.id, 1), start);
    for (const value of [-1, 2, NaN, Infinity, -Infinity]) assert.deepEqual(rollerOuterPose(stage.id, value), start);
    const peak = rollerOuterPose(stage.id, 0.5);
    assert.ok(peak.hip.x > start.hip.x);
    assert.notEqual(peak.roller.angle, start.roller.angle);
    for (let i = 0; i <= 200; i++) {
      const p = rollerOuterPose(stage.id, i / 200);
      assert.ok(p.shift >= 0 && p.shift <= 6);
      assert.ok(p.contactFraction > 0 && p.contactFraction < 1);
      close(p.shift, rollerOuterPose(stage.id, 1 - i / 200).shift);
    }
  }
});

test('contact checks reject broken floor/body/side/target/rolling relationships', () => {
  const base = rollerOuterPose('outer-quad-left', 0.5);
  const mutations: ((p: Pose) => void)[] = [
    p => { p.roller.z += 1; }, p => { p.contact.z += 1; },
    p => { p.contact.y = p.rightLeg.hip.y; },
    p => { p.contact.x = p.leftLeg.knee.x; },
    p => { p.roller.angle = 0; }, p => { p.travel = 0; },
    p => { p.rightLeg.grounded = false; }, p => { p.contactFraction = 0; },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(base);
    mutate(changed);
    assert.throws(() => checkContact(changed));
  }
});

// Actual TSX composition and SSR only. No browser layout, animation effects, or clinical QA claim.
const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const modules = new Map<string, { exports: Record<string, unknown> }>();
function loadSource(relative: string): Record<string, unknown> {
  const filename = path.resolve(root, relative), cached = modules.get(filename);
  if (cached) return cached.exports;
  const loaded = { exports: {} };
  modules.set(filename, loaded);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, {
    module: loaded, exports: loaded.exports, process: { env: { NODE_ENV: 'test' } },
    require: (name: string) => {
      if (!name.startsWith('.')) return require(name);
      const candidate = path.resolve(path.dirname(filename), name);
      const dependency = [candidate, candidate + '.ts', candidate + '.tsx'].find(file => fs.existsSync(file) && fs.statSync(file).isFile());
      assert.ok(dependency, `resolve ${name}`);
      return loadSource(dependency);
    },
  }, { filename });
  return loaded.exports;
}
type StagedProps = {
  stages: { id: string; name: string; isStatic?: boolean }[];
  renderFigure: (id: string, progress: number, label: string) => React.ReactNode;
};

test('review composes nine real moving figures with explicit target inset, not renamed quad geometry', () => {
  const Demo = loadSource('app/components/RollerRecoveryReviewDemo.tsx').default as () => React.ReactElement<StagedProps>;
  const staged = Demo().props;
  assert.equal(staged.stages.length, 9);
  for (const stage of staged.stages) {
    assert.notEqual(stage.isStatic, true);
    const start = renderToStaticMarkup(staged.renderFigure(stage.id, 0, stage.name));
    const middle = renderToStaticMarkup(staged.renderFigure(stage.id, 0.5, stage.name));
    assert.notEqual(start, middle, stage.id + ' actually moves');
    if (isRollerOuterStage(stage.id)) {
      assert.match(start, /전외측 근육/);
      assert.match(start, /IT밴드 띠 제외/);
      assert.match(start, /TFL 제외/);
      assert.match(start, /전완 \+ 반대 손·발 지지/);
      assert.equal((start.match(/<svg\b/g) || []).length, 2);
      const caption = start.match(/<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/)?.[1];
      assert.ok(caption, 'normal HTML caption stays outside SVG text');
      for (const label of ['앞쪽과 가쪽', '외측 대퇴사두근', '전완', '반대 손·발', 'IT밴드 띠', 'TFL', '골반의 돌출 뼈', '무릎·슬개골']) {
        assert.ok(caption.includes(label), label + ' has a wrapping HTML equivalent');
      }
    } else assert.equal((start.match(/<svg\b/g) || []).length, 1);
  }
  const initial = renderToStaticMarkup(React.createElement(Demo));
  assert.match(initial, /새 일반 정의/);
  assert.match(initial, /원 안내/);
  assert.match(initial, /전문가 자세 검수는 미실시/);
  assert.equal((initial.match(/<option\b/g) || []).length, 9);
  assert.match(initial, /aria-pressed="false"[^>]*>재생/);
  assert.doesNotMatch(initial, /checked=""/);
  assert.doesNotMatch(initial, /<animate\b|<animateTransform\b/);
});

test('all seven reused roller figures repeat the unchanged SVG legends in wrapping HTML captions', () => {
  const Demo = loadSource('app/components/RollerRecoveryReviewDemo.tsx').default as () => React.ReactElement<StagedProps>;
  const { renderFigure } = Demo().props;
  const legends = [
    '초록: 대상 부위 · 주황: 롤러 · 접촉 모식도',
    '작은 구간만 이동 · 관절·목·허리 직접 압박 제외',
    '바닥 준비·좌우 자세 전환은 별도로 수행',
  ];
  for (const stage of rollerStages) for (const progress of [0, 0.5, 1]) {
    const markup = renderToStaticMarkup(renderFigure(stage.id, progress, stage.name));
    const svg = markup.match(/<svg\b[\s\S]*?<\/svg>/)?.[0];
    const caption = markup.match(/<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/)?.[1];
    assert.ok(svg && caption, stage.id + ' retains its SVG and adds a separate HTML caption');
    assert.match(svg, /viewBox="0 45 320 235"/);
    assert.deepEqual([...svg.matchAll(/<text\b[^>]*>(.*?)<\/text>/g)].map(match => match[1]), legends);
    assert.deepEqual([...caption.matchAll(/<p>(.*?)<\/p>/g)].map(match => match[1]), legends);
    assert.ok(markup.indexOf('<figcaption') > markup.indexOf('</svg>'));
    assert.doesNotMatch(caption, /<svg\b|<text\b/);
  }
});

test('the real staged component puts the complete selected heading beside the select before its figure', () => {
  const Staged = loadSource('app/components/StagedMotionDemo.tsx').default as React.ComponentType<{
    title: string; intro: string; stages: typeof rollerInformationalRecoveryStages; renderFigure: StagedProps['renderFigure'];
  }>;
  const Demo = loadSource('app/components/RollerRecoveryReviewDemo.tsx').default as () => React.ReactElement<StagedProps>;
  for (const stage of rollerInformationalRecoveryStages) {
    const markup = renderToStaticMarkup(React.createElement(Staged, {
      title: 'Synthetic component check', intro: '', stages: [stage], renderFigure: Demo().props.renderFigure,
    }));
    const heading = markup.match(/<h3\b[^>]*>(.*?)<\/h3>/);
    assert.ok(heading);
    assert.equal(heading[1], `1. ${stage.name}`);
    assert.ok(markup.indexOf('</select>') < markup.indexOf(heading[0]));
    assert.ok(markup.indexOf(heading[0]) < markup.indexOf('<button'));
    assert.ok(markup.indexOf(heading[0]) < markup.indexOf('<figure'));
    assert.equal((markup.match(/<h3\b/g) || []).length, 1, 'selected heading is not repeated below the figure');
  }
});

test('app exercise dispatcher still does not activate recovery', () => {
  const Demo = loadSource('app/components/ExerciseMotionDemo.tsx').default as React.ComponentType<{ exerciseId: string }>;
  assert.equal(renderToStaticMarkup(React.createElement(Demo, { exerciseId: 'foam-roller-recovery' })), '');
});

test('roller disclosure explicitly mounts/removes the actual review; nested toggle is ignored', () => {
  const filename = path.join(root, 'app/components/RollerRecoveryInformationalReview.tsx');
  const loaded = { exports: {} as Record<string, unknown> };
  let open = false;
  const Review = loadSource('app/components/RollerRecoveryReviewDemo.tsx').default;
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, {
    module: loaded, exports: loaded.exports,
    require: (name: string) => name === 'react'
      ? { useState: () => [open, (value: boolean) => { open = value; }] }
      : name === './RollerRecoveryReviewDemo' ? { default: Review } : require(name),
  });
  type DetailsProps = { onToggle: (event: unknown) => void; children: React.ReactNode };
  const Wrapper = loaded.exports.default as () => React.ReactElement<DetailsProps>;
  let tree = Wrapper();
  const initial = renderToStaticMarkup(tree);
  assert.match(initial, /폼롤러 일반 동작 설명 보기 · 바깥 허벅지는 새 정의/);
  assert.doesNotMatch(initial, /<svg\b|type="range"|<select\b|<details[^>]*\bopen/);
  tree.props.onToggle({ target: {}, currentTarget: { open: true } });
  assert.equal(open, false);
  const target = { open: true };
  tree.props.onToggle({ target, currentTarget: target });
  tree = Wrapper();
  assert.ok(React.Children.toArray(tree.props.children).some(child => React.isValidElement(child) && child.type === Review));
  const opened = renderToStaticMarkup(tree);
  assert.equal((opened.match(/<option\b/g) || []).length, 9);
  assert.match(opened, /aria-pressed="false"[^>]*>재생/);
  assert.match(opened, /type="range"[^>]*value="0"/);
  target.open = false;
  tree.props.onToggle({ target, currentTarget: target });
  assert.doesNotMatch(renderToStaticMarkup(Wrapper()), /<svg\b|type="range"|<select\b/);
  // This tests the wrapper's conditional removal, not native events or player effect cleanup.
});

test('GuidePanel adds only a closed information disclosure and preserves real routine timings and warnings', () => {
  const Panel = loadSource('app/components/ExerciseGuidePanel.tsx').default as React.ComponentType<{ exercise: Exercise }>;
  const guides = loadSource('app/data/exerciseGuides.ts').exerciseGuides as Record<string, ExerciseGuide>;
  const guide = guides['폼롤러 회복'];
  const before = JSON.stringify(guide);
  const base: Exercise = { name: '폼롤러 회복', exerciseId: 'foam-roller-recovery', details: [{ type: 'warn', text: 'existing-routine-warning' }], guide };
  const render = (exercise: Exercise) => renderToStaticMarkup(React.createElement(Panel, { exercise }));
  for (const exercise of [base, { ...base, exerciseId: 'fixture-instance', sourceExerciseId: 'foam-roller-recovery' }]) {
    const markup = render(exercise);
    assert.match(markup, /폼롤러 일반 동작 설명 보기 · 바깥 허벅지는 새 정의/);
    assert.doesNotMatch(markup, /<svg\b|type="range"|<select\b|<details[^>]*\bopen/);
    for (const text of [...guide.movement, ...guide.stopCriteria, 'existing-routine-warning']) assert.ok(markup.includes(text), text);
  }
  assert.equal(JSON.stringify(guide), before);
  assert.equal(render({ ...base, guide: undefined }), '');
  const ab = render({ ...base, sourceExerciseId: 'ab-slider-ready-position' });
  assert.match(ab, /정지 준비 자세/);
  assert.doesNotMatch(ab, /폼롤러 일반 동작 설명 보기/);
  const deadbug = render({ ...base, sourceExerciseId: 'dead-bug' });
  assert.match(deadbug, /데드버그 동작 설명 보기/);
  assert.doesNotMatch(deadbug, /폼롤러 일반 동작 설명 보기/);
  assert.doesNotMatch(render({ ...base, sourceExerciseId: 'unsupported' }), /폼롤러 일반 동작 설명 보기/);
});
