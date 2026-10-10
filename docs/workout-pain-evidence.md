# G6 부위·운동명 반복 입력 근거

## 범위

2026-10-09 UTC, 작업 기준 HEAD `3dba1f42f4954abf7cd20eef7be1c36ef87390e1` 위의 로컬 미커밋 구현이다. 운동 홈의 기존 `WorkoutEvidence` 다음에 작은 읽기 전용 카드를 추가했다. 원문 로드맵의 반복 입력 사실 요약·원본 근거·기존 가이드 연결만 다룬다. 의료적 안전성 검증, 개인화 대체 운동·가동범위 처방 또는 전체 G6 완료를 뜻하지 않는다.

제품 변경은 다음 네 파일로 제한했다.

- `app/data/workoutPainEvidence.ts`: 날짜별 입력·분모·pair·source 순수 projection
- `app/data/workoutPainEvidenceReader.ts`: 허용된 reader-only helper, coherent snapshot과 lifecycle 경계
- `app/components/WorkoutPainEvidence.tsx`: 읽기 전용 카드·정확한 날짜 source panel·기존 가이드
- `app/fitness/page.tsx`: import와 기존 근거 카드 바로 아래 mount 두 줄

저장 schema, 입력 흐름, 기존 일반 근거 카드, 기록 migration, adaptive review/hold/결정 함수, 계획 설정, 정적 가이드 내용, sync protocol, SQL, provider는 변경하지 않는다. 카드의 읽기·열기·닫기에는 localStorage 쓰기, 복구, migration, 저장 queue, RPC, fetch가 없다. 워크플로와 Playwright 프로젝트 등록은 별도 통합 변경이다.

## 사실의 의미

브라우저의 로컬 달력 날짜 T를 기준으로 T−28~T−1, T−14~T−1, T−28~T−15를 비교한다. 오늘은 제외하며 기존 오늘 포함 adaptive 안전 보류 기간을 바꾸지 않는다. 유효한 날짜 키 하나의 현재 row가 한 표본이다. weekday 키는 제외하고 migration하지 않는다. 세트·라운드·수행 배열 중복은 날짜 수를 늘리지 않는다.

현재 저장소는 예전 요일 migration으로 만들어진 날짜와 원래 날짜를 구별할 수 없다. 화면에 실제 발생일을 확인할 수 없다는 안내를 항상 표시한다. `workoutRecordedAt`으로 과거 날짜를 인증하지 않는다.

- D: 일반 운동 완료/상태 또는 피드백이 확인되는 저장 날짜
- A + M + I = D: 부위 선택 / 미응답 / 값 확인불가
- P + Q + X = D: 부위·운동명 연결 입력 / 입력 부족 / 값 확인불가
- P의 필수 필드에 invalid 값이 있으면 missing보다 먼저 분류한다.
- boolean false, 빈 object, 다른 운동 종류만 있는 row, 계획 이름만 있는 row는 D에 넣지 않는다.
- D에는 malformed 피드백 필드도 보존하며, 잘못된 area/name은 invalid coverage에 남긴다.
- malformed **날짜 row 자체**는 일반 운동 기록인지조차 확정할 수 없으므로 D 밖의 `invalidRows`로 따로 표시한다. 이 날짜를 unrecorded/empty에 넣지 않는다. 따라서 `D + invalidRows + unrecorded = calendarDates`다. invalidRows만 있을 때는 “기록 없음” 대신 “날짜별 기록을 확인할 수 없음”을 표시한다.

pair identity는 `[지원 부위 enum, 앞뒤 공백만 제거한 운동명]`의 JSON tuple이다. 별칭, 내부 공백, Unicode 표현, 좌우·기구·변형 이름을 합치지 않는다. 서로 다른 저장 날짜 두 개 이상에서 같은 pair가 있으면 반복 입력으로 표시한다. 이는 임상 임계값이 아니다. 두 기간의 D/P와 pair 입력 날짜 수를 병렬 표시하며 발생률·안전률·변화율을 만들지 않는다.

`workoutPain=false`, 기본 painScore 0, backStatus none, 빈 신경 증상 배열은 명시적인 전신 무통증 응답으로 해석하지 않는다. session-level 부위를 다른 exercise/set에 전파하거나, 메모·점수·허리 상태로 pair를 합성하지 않는다.

## 정확한 source와 가이드

각 날짜 링크는 같은 카드의 정확한 저장 날짜 panel을 연다. 날짜만 fragment에 쓰며 broad calendar 탭을 정확한 source 링크처럼 재사용하지 않는다. 열기 직전에 owner/epoch/reset/generation/raw/date snapshot을 다시 확인한다. 바뀐 source는 열지 않고 최신 summary로 교체한다. 삭제된 날짜를 오늘로 대체하지 않는다. source는 불변 revision 링크가 아니다.

첫 활성화와 이미 열린 같은 날짜의 반복 활성화 모두 panel로 키보드 focus와 scroll을 이동한다. source에는 원문 area/name/status/done/pain/set/back 값, exact-name으로 연결된 모든 수행 후보, 원문 라운드/실행 순서와 양의 정수인 같은 세트 번호의 모든 후보를 보존한다. 잘못된 점수와 없는 값은 구분한다. 이름이 없거나 invalid이면 “운동명 입력만 있음”이라고 표시하지 않는다. 저장 메모 전체를 복제하거나 해석하지 않는다.

가이드는 `Object.hasOwn(exerciseGuides, exactName)`인 경우에만 기존 `ExerciseGuidePanel`로 연다. unknown/prototype key에 fallback을 만들지 않는다. 별칭이 같은 가이드를 가리켜도 pair identity는 합치지 않는다. 기존 URL/content/검색어는 보존하고 추가 개인 정보나 부위를 검색어에 넣지 않는다. 일반 가이드이며 이 기록에 대한 안전 판정이 아니라는 안내를 표시한다. 적용·교체·계획 변경 버튼은 없다.

## 읽기와 수명주기

ready owner와 epoch를 확보하고 하나의 coherent snapshot에서 운동 raw store, fitness reset marker, generation을 읽는다. 계산 후 다시 snapshot/owner/reset을 확인한다. missing store만 검증된 empty로 취급한다. malformed JSON/map, invalid 또는 불완전 reset marker, pending journal/prepared protocol, read exception, owner 준비 중, reset 중은 unavailable이다. reader가 복구하거나 기록을 수정하지 않는다.

다음 경계에서 재검증하고 열린 source/guide를 닫는다: records/session/reset 이벤트, 관련 storage key와 clear, focus, pageshow, hidden/visible, pagehide. 자정 타이머는 다음 로컬 midnight에 재계산하며 cleanup한다. StrictMode 형태의 mount-cleanup-remount에서도 listener/timer가 남지 않도록 한다. 비동기 fetch/promise를 사용하지 않아 늦은 응답이 이전 source를 재게시하지 않는다.

## 실행한 검증

아래 명령은 설치된 CLI만 사용했다. 네트워크·브라우저·hosted 서비스·개인 건강 데이터·새 dependency·commit/push/publication은 사용하지 않았다.

1. `node --experimental-strip-types --test app/data/workoutPainEvidence.test.ts tests/workout-pain-evidence-reader.test.ts`
   - 최종 focused 결과: **44/44 통과** (pure 23, reader/수명주기/실제 컴포넌트 handler 21)
   - 날짜 경계/윤일/연도/DST, distinct dates, exact names, 분모 불변식, raw preservation, malformed 값, guide own-property, freeze된 adaptive 결과와 오늘 hold/applied 거절을 검사했다.
   - coherent read, read 오류/pending/corruption, owner/epoch/reset, silent edit/delete, 자정, 이벤트 중첩/hidden/resume, cleanup/remount, source·guide 재검증과 storage write spy 0회를 검사했다.
   - 컴포넌트 검사는 shipped TSX를 synthetic hooks/host로 실행한다. 실제 React 브라우저·실계정 acceptance가 아니다.
2. `node node_modules/typescript/bin/tsc --noEmit --incremental false --pretty false`
   - 전역 타입 검사 통과. 초기 병렬 작업 중의 타 파일 오류와 이후 이 spec의 Window cast 오류는 최종 성공 결과로 대체했다.
3. `node node_modules/eslint/bin/eslint.js app/data/workoutPainEvidence.ts app/data/workoutPainEvidenceReader.ts app/data/workoutPainEvidence.test.ts app/components/WorkoutPainEvidence.tsx app/fitness/page.tsx tests/workout-pain-evidence-reader.test.ts tests/e2e/workout-pain-evidence.spec.ts`
   - scoped lint 통과.
4. `YEONI_E2E=1 NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 node node_modules/@playwright/test/cli.js test tests/e2e/workout-pain-evidence.spec.ts --list --reporter=list`
   - discovery 통과: Chromium 4 + WebKit-small 4 + 필수 auth-preservation 4 = **12개 등록**.
   - discovery만 수행했으며 browser/server/account를 실행하지 않았다.
5. `git diff --check`
   - 통과.

최종 전체 `npm test`/full lint/build는 통합 작업에서 별도 실행·기록한다. 위 focused 결과를 전체 통과로 확대하지 않는다.

## Authenticated browser acceptance: 작성했으나 미실행

`tests/e2e/workout-pain-evidence.spec.ts`의 4개 시나리오는 기존 격리 계정 fixture를 사용하도록 작성했다.

1. 320px에서 coverage·두 기간·불확실성 안내, 오늘 hold와 적용 불가, exact source/반복 키보드 focus, 기존 guide URL, source/guide interaction의 local writes 0회와 서버 원본 보존, reload와 Back/Forward
2. silent source 삭제 후 클릭 직전 재검증, 오늘로 잘못 대체하지 않음
3. corrupt raw/pending journal/reset/pagehide/pageshow 시 private panel 제거와 verified recovery
4. 두 탭의 source 삭제와 reset generation 변경 후 old panel 제거

이 시나리오는 **아직 실행하지 않았다**. 실제 Chromium/WebKit 레이아웃·인증 후 동작·브라우저 lifecycle·서버 불변성·fixture cleanup의 terminal 결과는 미검증이다. pageshow/persisted 합성 이벤트는 실제 BFCache 입장을 증명하지 않는다. 실제 owner-switch/same-owner 준비 지연, 물리 기기 자정·백그라운드/시간대 변경, 저장 실패·reset 실패의 실사용 조합도 별도다. 위 단위/handler 검사가 이를 브라우저 통과로 대체하지 않는다. 운영 병합·배포 승인을 뜻하지 않는다.
