import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import type { InbodyRecord, BodyMetricSource, BodyMetricSources } from '../app/data/recordStorage';
import { bodyForm, mergeBodyFields, mergeBodyImport } from '../app/lib/bodyImport.ts';
import { OA_REPORT_INVENTORY } from '../app/lib/oaReportInventory.ts';
import { INBODY_270S_INVENTORY } from '../app/lib/inbodyReportParser.ts';

// Render the shipped field groups and source disclosure, not a parallel copy of their labels.
// This is not a browser layout test; native narrow review/reload assertions cover actual pixels.
const source = readFileSync('app/components/BodyRecordCard.tsx', 'utf8');
const tree = ts.createSourceFile('BodyRecordCard.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const definitions = tree.statements.filter(statement =>
  (ts.isVariableStatement(statement) && statement.declarationList.declarations.some(item => item.name.getText(tree) === 'fieldGroups'))
  || (ts.isExpressionStatement(statement) && statement.expression.getText(tree).startsWith('fieldGroups.push(')));
assert.equal(definitions.length, 2);
let groups: ts.JsxExpression | undefined, sources: ts.JsxElement | undefined;
function visit(node: ts.Node) {
  if (ts.isJsxExpression(node) && node.expression?.getText(tree).startsWith('fieldGroups.map(')) groups = node;
  if (ts.isJsxElement(node) && node.openingElement.tagName.getText(tree) === 'details'
    && node.getText(tree).includes('<summary>사진 항목 출처·원문 보기</summary>')) sources = node;
  ts.forEachChild(node, visit);
}
visit(tree); assert.ok(groups && sources);
const code = ts.transpileModule(`${definitions.map(node => node.getText(tree)).join('\n')}
export default function render() { return <div>${groups.getText(tree)}${sources.getText(tree)}</div>; }`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const require = createRequire(import.meta.url);
const day = '2025-04-07';
const inbodySource: BodyMetricSource = { device: 'InBody 270S English report', originalLabel: 'Body Fat Mass', originalUnit: 'kg', originalText: 'Body Fat Mass (kg) 17.4', method: 'ocr', mappingVersion: 'inbody-270s-en-v1' };
const oaSource: BodyMetricSource = { device: 'OA long report', originalLabel: '지방량', originalUnit: 'kg', originalText: '지방량 19.2kg', method: 'ocr', mappingVersion: 'oa-pro-v1' };
function render(record: InbodyRecord, patch?: Record<string, string>, metricSources: BodyMetricSources = {}, oa = false) {
  const visibleForm = { ...bodyForm({}, { [day]: record }, day), ...patch };
  const exports: { default?: () => ReactElement } = {};
  vm.runInNewContext(`(function(exports, require){${code}\n})`, {
    visibleForm, currentInbody: record, draft: patch ? { patch, metricSources, date: day } : null,
    isOaRecord: oa, importing: false,
    legacyHasValues: ['skeletalMuscleMass', 'bodyFatMass', 'bodyAge'].some(key => Boolean(visibleForm[key]?.trim())),
    OA_REPORT_INVENTORY, INBODY_270S_INVENTORY,
  })(exports, (name: string) => { assert.equal(name, 'react/jsx-runtime'); return require(name); });
  assert.ok(exports.default); return renderToStaticMarkup(exports.default());
}
function field(html: string, key: string) {
  const match = html.match(new RegExp(`<label[^>]*data-body-field="${key}"[\\s\\S]*?</label>`));
  assert.ok(match, key); return match[0];
}
function provenance(html: string) { const match = html.match(/<ul aria-label="사진 항목 출처"[^>]*>([\s\S]*?)<\/ul>/); assert.ok(match); return match[1]; }
function neutral(html: string) {
  assert.match(html, /data-body-group="추가 체성분 항목"/);
  assert.match(html, /사진 입력과 기존·직접 입력값이 함께 표시될 수 있어요/);
  assert.match(html, /사진에 없는 값은 자동으로 바꾸지 않아요/);
  assert.match(html, /사진 출처가 있는 항목은 위 원문 보기에서 확인해요/);
  assert.doesNotMatch(html, /다른 기기·직접 입력/);
  assert.match(field(html, 'bodyFatMass'), /^<label[^>]*>체지방량<div/);
  assert.match(field(html, 'bodyAge'), /신체연령 \(기존 항목\)/);
}

test('new InBody photo draft and preserved fields share neutral labels without inventing sources', () => {
  const old = { skeletalMuscleMass: 31.4, bodyFatMass: 20.1, bodyAge: 41 };
  const html = render(old, { bodyFatMass: '17.4' }, { bodyFatMass: inbodySource }); neutral(html);
  assert.match(field(html, 'bodyFatMass'), /value="17.4"/);
  assert.match(field(html, 'skeletalMuscleMass'), /value="31.4"/);
  assert.match(field(html, 'bodyAge'), /value="41"/);
  const list = provenance(html); assert.equal((list.match(/<li>/g) || []).length, 1);
  assert.match(list, /InBody 270S English report/); assert.match(list, /사진 입력/);
  assert.doesNotMatch(list, /골격근량|신체연령/);
});

test('actual save and JSON reload preserve mixed OA, InBody and source-absent values with only recorded sources', () => {
  const old: InbodyRecord = { fatMass: 19.2, skeletalMuscleMass: 31.4, bodyAge: 41, memo: 'synthetic keep', metricSources: { fatMass: oaSource } };
  const before = JSON.stringify(old);
  const next = mergeBodyImport({}, { [day]: old }, day, { bodyFatMass: '17.4' }, '2026-10-28', { bodyFatMass: inbodySource });
  const record: InbodyRecord = JSON.parse(JSON.stringify(next.inbody[day]));
  assert.equal(JSON.stringify(old), before); assert.equal(record.skeletalMuscleMass, 31.4); assert.equal(record.bodyAge, 41); assert.equal(record.memo, 'synthetic keep');
  assert.deepEqual(record.metricSources, { fatMass: oaSource, bodyFatMass: inbodySource });
  const html = render(record, undefined, {}, true); neutral(html);
  assert.match(field(html, 'bodyFatMass'), /value="17.4"/);
  assert.equal((provenance(html).match(/<li>/g) || []).length, 2);
  assert.match(provenance(html), /OA long report/); assert.match(provenance(html), /InBody 270S English report/);
  assert.doesNotMatch(provenance(html), /골격근량|신체연령/);
});

test('OA-only incoming fields do not replace or relabel preserved unknown-source additional fields', () => {
  const old = { bodyFatMass: 20.1, skeletalMuscleMass: 31.4, bodyAge: 41 };
  const next = mergeBodyImport({}, { [day]: old }, day, { fatMass: '19.2' }, '2026-10-28', { fatMass: oaSource });
  assert.deepEqual(next.inbody[day], { ...old, fatMass: 19.2, metricSources: { fatMass: oaSource } });
  const html = render(next.inbody[day], undefined, {}, true); neutral(html);
  assert.match(field(html, 'bodyFatMass'), /value="20.1"/);
  assert.equal((provenance(html).match(/<li>/g) || []).length, 1);
  assert.doesNotMatch(provenance(html), /InBody|체지방량|골격근량|신체연령/);
});

test('manual records and empty fields never acquire a photo source or an unverified device label', () => {
  for (const record of [{ bodyFatMass: 20.1, skeletalMuscleMass: 31.4, bodyAge: 41 }, {}]) {
    const html = render(record); neutral(html); assert.equal(provenance(html), '');
    assert.doesNotMatch(field(html, 'bodyFatMass'), /사진 입력|OA|InBody|다른 기기/);
  }
});

test('explicit manual corrections and clearing retain existing provenance semantics rather than automatic preservation', () => {
  const old = { bodyFatMass: 17.4, bodyAge: 41, metricSources: { bodyFatMass: inbodySource } };
  const edited = mergeBodyFields(old, { bodyFatMass: '18.1' });
  assert.deepEqual(edited.metricSources?.bodyFatMass, { ...inbodySource, method: 'ocr-edited' });
  const html = render(edited); neutral(html); assert.match(provenance(html), /사진 입력 후 수정/);
  const cleared = mergeBodyFields(old, { bodyFatMass: '' });
  assert.equal(cleared.bodyFatMass, undefined); assert.equal(cleared.metricSources, undefined); assert.equal(cleared.bodyAge, 41);
});
