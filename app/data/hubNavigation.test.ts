import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_HUB_NAV_IDS,
  HUB_NAV_MAX_VISIBLE_APPS,
  isHubAppActive,
  normalizeHubNavIds,
  parseHubNavIds,
} from "./hubNavigation.ts";

test("기본 하단 메뉴는 언어 학습을 직접 노출한다", () => {
  assert.deepEqual(DEFAULT_HUB_NAV_IDS, [
    "assistant",
    "fitness",
    "budget",
    "diet",
    "language",
  ]);
});

test("저장된 메뉴는 중복과 알 수 없는 값을 제거하고 AI 연이를 유지한다", () => {
  assert.deepEqual(
    normalizeHubNavIds(["language", "language", "unknown", "calendar"]),
    ["assistant", "language", "calendar"],
  );
});

test("하단에는 앱을 최대 여섯 개까지만 둔다", () => {
  const result = normalizeHubNavIds([
    "assistant",
    "fitness",
    "budget",
    "diet",
    "language",
    "calendar",
    "settings",
  ]);
  assert.equal(result.length, HUB_NAV_MAX_VISIBLE_APPS);
  assert.deepEqual(result, [
    "assistant",
    "fitness",
    "budget",
    "diet",
    "language",
    "calendar",
  ]);
});

test("손상된 브라우저 설정은 안전한 기본 메뉴로 복구한다", () => {
  assert.deepEqual(parseHubNavIds("not-json"), DEFAULT_HUB_NAV_IDS);
  assert.deepEqual(parseHubNavIds(null), DEFAULT_HUB_NAV_IDS);
});

test("하위 화면에서도 해당 앱을 활성 상태로 인식한다", () => {
  assert.equal(isHubAppActive("/language/review", "/language"), true);
  assert.equal(isHubAppActive("/growth", "/growth"), true);
  assert.equal(isHubAppActive("/assistant/quick", "/"), true);
  assert.equal(isHubAppActive("/fitness", "/fitness"), true);
  assert.equal(isHubAppActive("/budget", "/"), false);
});
