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
import type { Exercise } from '../app/data/workouts';

// Composition and initial server markup only: no browser, effects, layout or playback claim.
const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const { createControls } = require('../scripts/motion-accessibility-harness.cjs');
type Options = { entry?: string; props?: Record<string, unknown> };
type Demo = React.ComponentType<{ exerciseId?: string; recovery?: boolean }>;
type Stage = { id: string; isStatic?: boolean };
type StagedProps = {
  stages: Stage[];
  renderFigure: (id: string, progress: number, label: string) => React.ReactNode;
};
const modules = new Map<string, { exports: Record<string, unknown> }>();

function loadSource(relative: string): Record<string, unknown> {
  const filename = path.resolve(root, relative);
  const cached = modules.get(filename);
  if (cached) return cached.exports;
  const loaded = { exports: {} };
  modules.set(filename, loaded);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, {
    module: loaded, exports: loaded.exports,
    require: (name: string) => {
      if (!name.startsWith('.')) return require(name);
      const candidate = path.resolve(path.dirname(filename), name);
      const dependency = [candidate, candidate + '.ts', candidate + '.tsx'].find(file => fs.existsSync(file) && fs.statSync(file).isFile());
      assert.ok(dependency, `resolve ${name} from ${filename}`);
      return loadSource(dependency);
    },
  }, { filename });
  return loaded.exports;
}

// Execute each real check script up to its harness call. Stop before CSS generation/browser launch.
function selectedOptions(script: string, flags: string[] = []): Options {
  const filename = path.join(root, 'scripts', script);
  const stop = new Error('captured harness configuration');
  let options: Options | undefined;
  assert.throws(() => vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    __dirname: path.dirname(filename),
    process: { argv: ['node', filename, path.join(root, 'node_modules'), ...flags], env: {} },
    require: (name: string) => {
      if (name === './motion-accessibility-harness.cjs') return (_dependencies: string, _out: string, selected: Options = {}) => {
        options = selected;
        throw stop;
      };
      if (name === 'fs' || name === 'node:fs') return { ...fs, mkdirSync: () => undefined };
      return require(name);
    },
  }, { filename }), error => error === stop);
  assert.ok(options);
  return options;
}

function fixture(options: Options) {
  const Demo = loadSource(options.entry || 'app/components/ExerciseMotionDemo.tsx').default as Demo;
  const Wall = loadSource('app/components/WallPushupDemo.tsx').default as Demo;
  let element: React.ReactElement<{ exerciseId?: string; recovery?: boolean }> | null = null;
  // Same serialized function as the browser bundle; only root.render is replaced by capture.
  const controls = vm.runInNewContext(`(${createControls.toString()})`, {})(React, {
    render: (next: typeof element) => { element = next; },
  }, Demo, Wall, options);
  return {
    show(id: string) { controls.show(id); return renderToStaticMarkup(element); },
    clear() { controls.clear(); assert.equal(element, null); },
    element: () => { assert.ok(element); return element; },
    Demo, Wall,
  };
}

test('AB static check directly selects PreparationPoseDemo, never enables app routing or playback', () => {
  const options = selectedOptions('check-remaining-preparation.cjs');
  assert.equal(options.entry, 'app/components/PreparationPoseDemo.tsx');
  const f = fixture(options);
  const markup = f.show('ab-slider-ready-position');
  assert.equal(f.element().type, f.Demo);
  assert.match(markup, /role="img"[^>]*aria-labelledby=/);
  assert.match(markup, /정지 도해/);
  assert.doesNotMatch(markup, /<(?:button|input|animate|animateTransform)\b/);
  assert.equal(f.show('unsupported'), '');
  assert.equal(f.show('wall-pushup'), '', 'independent entries must not silently route to WallPushupDemo');
  f.clear();
});

test('recovery check directly composes recovery=true with seven figures and two held stages', () => {
  const options = selectedOptions('check-roller-routine.cjs', ['--recovery']);
  assert.equal(options.entry, 'app/components/RollerMotionDemo.tsx');
  assert.equal(options.props?.recovery, true);
  const f = fixture(options);
  const markup = f.show('foam-roller-recovery');
  assert.equal(f.element().type, f.Demo);
  assert.equal(f.element().props.recovery, true);
  assert.match(markup, /부분 시범/);
  assert.equal((markup.match(/<option\b/g) || []).length, 9);
  const component = f.Demo as (props: { recovery?: boolean }) => React.ReactElement<StagedProps>;
  const staged = component(f.element().props).props;
  assert.equal(staged.stages.length, 9);
  let moving = 0, held = 0;
  for (const [index, stage] of staged.stages.entries()) {
    const figure = renderToStaticMarkup(staged.renderFigure(stage.id, 0.5, stage.id));
    if (index === 4 || index === 5) {
      assert.equal(stage.isStatic, true);
      assert.match(figure, /role="note"/);
      assert.doesNotMatch(figure, /<svg\b/);
      held++;
    } else {
      assert.notEqual(stage.isStatic, true);
      assert.match(figure, /<svg\b/);
      moving++;
    }
  }
  assert.equal(moving, 7);
  assert.equal(held, 2);
  // RollerMotionDemo does not resolve catalog IDs; explicitly clear instead of assuming unsupported => null.
  assert.notEqual(f.show('unsupported'), '');
  f.clear();
});

test('preparation mode retains the app dispatcher and its fourteen-stage routine', () => {
  const options = selectedOptions('check-roller-routine.cjs');
  assert.equal(options.entry, undefined);
  assert.equal(options.props, undefined);
  const f = fixture(options);
  const markup = f.show('foam-roller-prep');
  assert.equal((markup.match(/<option\b/g) || []).length, 14);
  assert.doesNotMatch(markup, /부분 시범/);
  assert.equal(f.show('foam-roller-recovery'), '');
  assert.equal(f.show('unsupported'), '');
});

test('routing retains 27 moving / 3 motion-inactive; GuidePanel keeps AB static and deadbug information closed', () => {
  const options = selectedOptions('check-final-motion-routing.cjs');
  assert.equal(options.entry, undefined);
  const f = fixture(options);
  const blocked = ['dead-bug', 'foam-roller-recovery', 'ab-slider-ready-position'];
  const catalog = JSON.parse(fs.readFileSync(path.join(root, 'docs/exercise-motion/batch3-evidence/catalog.json'), 'utf8')).rows as { id: string }[];
  assert.equal(catalog.length, 30);
  const complete = catalog.filter(({ id }) => !blocked.includes(id));
  assert.equal(complete.length, 27);
  for (const { id } of complete) {
    const markup = f.show(id);
    assert.match(markup, /type="range"/, id);
    assert.match(markup, /role="img"/, id);
    assert.match(markup, /전문가/, id);
    assert.equal(f.element().type, id === 'wall-pushup' ? f.Wall : f.Demo, id);
    f.clear();
  }
  for (const id of [...blocked, 'unsupported']) assert.equal(f.show(id), '', id);
  const dispatcher = f.Demo as (props: { exerciseId?: string }) => React.ReactElement | null;
  for (const id of [...blocked, 'wall-pushup']) assert.equal(dispatcher({ exerciseId: id }), null, id);
  const Panel = loadSource('app/components/ExerciseGuidePanel.tsx').default as React.ComponentType<{ exercise: Exercise }>;
  // Use the real panel too, so a future removal/duplication of its wall side branch is detected.
  // This is initial composition, not browser navigation, persistence or live playback validation.
  for (const { id } of [...catalog, { id: 'unsupported' }]) {
    for (const usesSourceId of [false, true]) {
      const exercise: Exercise = {
        name: 'Synthetic routing fixture', exerciseId: usesSourceId ? 'fixture-instance' : id,
        ...(usesSourceId ? { sourceExerciseId: id } : {}), details: [],
        guide: { setup: [], movement: [], commonMistakes: [], stopCriteria: ['existing-guide-stop'] },
      };
      const markup = renderToStaticMarkup(React.createElement(Panel, { exercise }));
      const active = !blocked.includes(id) && id !== 'unsupported';
      assert.equal((markup.match(/type="range"/g) || []).length, active ? 1 : 0, id);
      if (id === 'ab-slider-ready-position') {
        assert.equal((markup.match(/<svg\b/g) || []).length, 1, id);
        assert.match(markup, /정지 준비 자세만 표시합니다/);
        assert.match(markup, /앞으로 미는 롤아웃 동작은 포함하지 않습니다/);
        assert.doesNotMatch(markup, /<animate(?:Transform)?\b/);
      } else if (!active) assert.doesNotMatch(markup, /<svg\b/, id);
      if (id === 'dead-bug') {
        assert.match(markup, /<details\b/);
        assert.match(markup, /데드버그 동작 설명 보기 · 개인 추천 아님/);
        assert.doesNotMatch(markup, /<details[^>]*\bopen(?:\s|=|>)/);
        assert.doesNotMatch(markup, /시범 단계|aria-pressed=/);
      } else assert.doesNotMatch(markup, /데드버그 동작 설명 보기/);
      assert.match(markup, /자세 가이드/, id);
      assert.match(markup, /existing-guide-stop/, id);
    }
  }
});

test('AB still honors sourceExerciseId precedence and is removed with its guide, without adding playback', () => {
  const Panel = loadSource('app/components/ExerciseGuidePanel.tsx').default as React.ComponentType<{ exercise: Exercise }>;
  const exercise: Exercise = {
    name: 'Synthetic static guide', exerciseId: 'dead-bug', sourceExerciseId: 'ab-slider-ready-position',
    details: [{ type: 'warn', text: 'existing-routine-warning' }],
    guide: { setup: [], movement: ['existing-guide-step'], commonMistakes: [], stopCriteria: ['existing-guide-stop'] },
  };
  const render = (value: Exercise) => renderToStaticMarkup(React.createElement(Panel, { exercise: value }));
  const markup = render(exercise);
  assert.equal((markup.match(/<svg\b/g) || []).length, 1);
  assert.doesNotMatch(markup, /type="range"|aria-pressed=|<animate(?:Transform)?\b/);
  for (const unchanged of ['existing-routine-warning', 'existing-guide-step', 'existing-guide-stop']) assert.ok(markup.includes(unchanged));
  const overridden = render({ ...exercise, exerciseId: 'ab-slider-ready-position', sourceExerciseId: 'dead-bug' });
  assert.doesNotMatch(overridden, /<svg\b|정지 도해/);
  const missingGuide = render({ ...exercise, guide: undefined });
  assert.equal(missingGuide, '');
  // The real independent still has no playback controls; clearing removes its captured root.
  // This is static composition/removal, not a browser lifecycle or RAF assertion.
  const f = fixture({ entry: 'app/components/PreparationPoseDemo.tsx' });
  assert.match(f.show('ab-slider-ready-position'), /정지 도해/);
  f.clear();
  assert.equal(f.show('dead-bug'), '');
});

test('existing dead-bug review remains independently composed without changing its two unconnected variants', () => {
  const options = selectedOptions('check-dead-bug-review.cjs');
  assert.equal(options.entry, 'app/components/DeadBugReviewDemo.tsx');
  const f = fixture(options);
  const markup = f.show('review-only');
  assert.match(markup, /미연결 검토 초안/);
  assert.equal((markup.match(/<option\b/g) || []).length, 2);
  f.clear();
});
