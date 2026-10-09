# 문장 타자 입력·미확정 저장 복구

작성: 2026-10-10 KST / 2026-10-09 UTC. 로컬 미커밋 구현과 검증 기록이며 운영 반영 완료가 아니다.

## 좁은 범위

로드맵 p3의 중단 후 입력·기록 보존과 업데이트 후 입력 복귀, p9 문장 타자에 해당한다. 문장 타자 화면과 전용 저장 RPC만 바꾸고 자리 타자·손글씨·공통 growth 저장 계약·기존 테이블/RLS/초기화 함수는 변경하지 않았다. 진행 중 Live/독립 운영 구현과 구분한다.

- `다시 시작`과 `다른 문장`은 기존 자리 연습의 확인 문구를 재사용한다. 취소하면 입력·문장·측정 시작 시각·pending을 그대로 둔다. 빈 입력과 저장 확인이 끝난 연습은 확인창 없이 초기화한다.
- 매 입력과 문장 선택을 소유자별 v1 로컬 checkpoint에 동기적으로 보관하고 read-back한다. 문장 원문 snapshot을 함께 보관해 이후 앱의 문장 목록 변경이 진행 중 입력 비교를 바꾸지 않게 한다.
- 최초 저장은 고정 UUID, 루틴, 날짜, 시작/종료 시각, 지표를 만들고 **정확 payload의 기기 보관 확인 이후에만** POST를 시작한다. 일반 성공·실패 응답은 서버 row의 모든 불변 payload 필드를 조회·대조한 뒤 저장 완료로 표시한다. 서버의 명시적 초기화 세대 거부와 RPC 미배포는 완료로 바꾸지 않고 즉시 보존·중단한다.
- POST 또는 조회가 불명확하면 pending을 유지한다. 새로고침 후 `같은 기록 다시 확인`은 먼저 같은 ID를 조회한다. 일치하면 추가 POST 없이 완료, 조회 실패/다른 payload면 보존·중단, 확실한 부재일 때만 같은 ID/payload로 insert한다. upsert는 사용하지 않는다.
- pending 동안 입력·reset·문장 변경을 잠근다. 재시도해도 날짜·측정 종료·지표는 다시 계산하지 않는다. 전송하는 `updated_at`도 고정된 `endedAt`을 사용하므로 RPC 인수 전체가 동일하다. `created_at` 같은 서버 metadata는 불변 연습 payload 비교 대상이 아니다.
- 계정별 keyed 화면, 동기 owner ref, getUser 전후 검사, 명시 user_id와 RLS 조건으로 A의 늦은 결과가 B 화면/임시 저장에 반영되지 않게 한다. A의 pending은 A로 돌아와 재확인할 수 있다.
- 원격 기록 초기화 marker를 조회하고, 전용 `save_sentence_typing_session` SECURITY INVOKER RPC가 기존 `reset_my_app_records`와 같은 계정별 advisory transaction lock 안에서 marker를 다시 검사하고 plain INSERT한다. 이 새 클라이언트의 save→reset 순서는 reset이 행을 지우고, reset→이전 save 순서는 INSERT를 거부한다. 기존 동일 origin growth/reset Web Lock도 공유하며 checkpoint 생성은 그 lock 안에서 수행한다.
- RPC가 서버에 아직 없으면 입력과 pending을 그대로 두고 서버 업데이트 대기를 안내한다. direct INSERT fallback은 없다. 기존 클라이언트의 direct INSERT 권한/정책은 변경하지 않아, 이전 배포의 direct-writing 탭에는 새 서버 세대 fence가 적용되지 않는 제한이 남는다.
- 저장 공간 실패와 관측된 다른 탭 변경은 화면 입력을 유지하고 cloud 쓰기/덮어쓰기를 막는다. 다른 탭과 localStorage의 모든 연산이 원자적이라고 주장하지 않는다. Web Locks가 없는 브라우저에서는 기존의 lock 없는 fallback을 쓰며 그 환경의 탭 간 동시 동작은 실제 검증이 필요하다.

## 파일

- `app/growth/typing/page.tsx`
- `app/growth/typing/useSentenceTypingPractice.ts`
- `lib/sentence-typing-draft.ts`
- `lib/sentence-typing-draft.test.ts`
- `tests/sentence-typing-recovery.test.ts`
- `tests/e2e/sentence-typing-recovery.spec.ts`
- `supabase/migrations/20261009183602_save_sentence_typing_session.sql`: 전용 RPC 추가만 수행
- `tests/sentence-typing-migration.test.ts`: 로컬 PostgreSQL 호환 실행 검증
- `scripts/e2e-stack.mjs`: disposable seed에 위 RPC 추가
- `playwright.config.ts`: 새 문장 spec과 별도 담당의 `language-live-learning.spec.ts`를 기존 WebKit 목록에 추가. 기존 목록은 유지.

## 실행한 검증

- focused unit: **26/26 통과** (독립 검토 후). `node --experimental-strip-types --test lib/sentence-typing-draft.test.ts tests/sentence-typing-recovery.test.ts`.
- hook unit은 실제 shipping TypeScript를 transpile해 합성 React/auth/storage/PostgREST 경계에서 실행한다. 단순 source 문자열 검사가 아니다. quota, reload 후 미확정 조회, 확인된 부재, 같은 ID payload 충돌, A→B 늦은 응답, 기록 초기화, 저장 완료 후 로컬 정리 실패, 다른 탭 변경, 중복 클릭, marker GET 뒤 원격 reset, RPC 미배포 후 동일 요청 복구, marker 조회 실패 중 원본 보존을 포함한다.
- `updated_at` 재생성은 60초 이동한 재시도 회귀가 수정 전 실패함을 확인한 뒤 고정했다. 전송 전체 인수 equality를 검사하며 E2E에서도 metadata를 제외하지 않는다.
- 초기 client-only marker GET/INSERT 경합은 합성 경계 진단에서 reset 뒤 이전 행이 생기고 saved로 표시됨을 재현했다. 추가 RPC가 이 새 클라이언트 경로의 쓰기 세대를 직렬화한다.
- 서버 migration: **16/16 PGlite 통과**. 실제 growth 테이블/제약/RLS와 현재 reset 함수 원문으로 두 실행 순서, 같은 실제 transaction advisory lock 보유/해제, 소유자/다른 루틴/익명 거부, 중복 ID 무변경, 설치 전후 기록·정책·table grant·reset 함수 동일성을 확인했다. `node --experimental-strip-types --test tests/sentence-typing-migration.test.ts`.
- 최종 focused 조합은 **42/42 통과**. PGlite는 단일 연결이며 실제 서로 다른 연결의 lock 대기·동시 실행을 검증한 것으로 표시하지 않는다. 이 환경에서 허용된 로컬 PostgreSQL 실행 파일/소켓을 찾지 못했으며 hosted 연결이나 다른 제한 우회는 시도하지 않았다.
- 변경 파일 focused ESLint 통과.
- `npx tsc --noEmit --incremental false` 통과. 최종 통합 트리에 대한 aggregate/build 검사는 부모 작업의 결과와 구분한다.

## 작성했으나 실행하지 않은 acceptance

`tests/e2e/sentence-typing-recovery.spec.ts`의 7개 사례를 Chromium/WebKit 양쪽에 연결했다.

1. 320px: 빈 상태 이동, 두 reset 취소, 원본 checkpoint/timer reload 복구, 부분 저장·기존 부분 기록 보존, 저장 후 무확인 reset, 명시 확인 후 초기화, 키보드 focus, overflow.
2. 같은 흐름 390px.
3. POST 실제 반영 + POST 응답/조회 모두 실패 → reload → 조회 실패 동안 POST 없음 → read-only 확인, 중복 row 없음.
4. POST 미반영 + 조회 실패 → reload → 확실한 부재 조회 후 같은 ID/시간/지표 재시도.
5. A 저장 응답 지연 중 B 로그인 → B 입력/완료 상태 오염 없음 → A 복귀 후 추가 POST 없이 확인.
6. marker GET 뒤 다른 기기의 reset을 먼저 실행 → RPC가 이전 입력의 INSERT를 거부 → 원본 입력/pending 보존, 다른 계정 행 불변.
7. RPC 미배포 응답 → pending 보존·안내 → reload 후 배포 가능 상태에서 read-first 전체 동일 인수 재시도.

**실제 브라우저는 이번 slice에서 실행하지 않았다.** 기존 실행 환경의 EPERM 차단과 재시도 금지 지시를 준수했다. 테스트 정의·unit·lint·types 통과를 브라우저 통과로 표시하지 않는다. 허가된 disposable Supabase 환경에서 위 spec의 Chromium/WebKit 실행과 최종 후보 전체 회귀가 남아 있다. 물리 iPhone Safari/PWA의 키보드·앱 강제 종료·장시간 background·실제 앱 업데이트 복귀도 별도 미검증이다. 클라우드 marker 확인 실패 상태에서는 복구 내용을 보여 주되 편집·저장을 잠그므로 오프라인 편집 보장을 뜻하지 않는다.

커밋·push·hosted DB·env 파일·운영 설정·자격 증명 변경은 하지 않았다. 브라우저 gate와 운영 반영 승인은 별도다.


## 로컬 서버 계약과 배포/되돌리기 조건

추가 migration은 함수 하나와 그 함수의 실행 권한만 만든다. 기존 기록을 수정/삭제하거나 기존 reset 동작을 교체하지 않는다. 의존성은 기존 `growth_sessions`, `user_app_state`, `auth.uid()`, RLS와 `reset_my_app_records`의 계정별 `app-record-reset:` advisory lock 규약이다. disposable 브라우저 fixture는 growth 테이블/정책 뒤에 함수를 설치한다. 운영에는 적용하지 않았다.

클라이언트 배포 전 서버 migration을 적용하는 순서가 필요하다. 함수를 제거하는 되돌리기는 저장된 행을 지우지 않지만 새 클라이언트의 저장을 pending-deployment 상태로 막는다. 로컬 초안과 pending은 남고 direct INSERT로 우회하지 않는다. 기존 버전 클라이언트는 direct INSERT를 계속 할 수 있으므로 전체 오래된 클라이언트를 포함한 초기화 fencing은 이 범위의 완료 주장에 포함하지 않는다.

## 실제 CI 실패 후 수정 · 2026-10-10 KST / 2026-10-09 UTC

후보 `3a36a3951dad625d94a65e607cb3a16ca8c99733`의 GitHub Actions run `37975602088`에서 문장 spec 7개가 Chromium과 WebKit 각각 실패했다. 따라서 위의 미실행 기록은 최초 구현 시점의 기록이며, 이 후보의 실제 브라우저 결과는 **14개 실패**다. 수정 뒤 새 브라우저 실행은 아직 대기 중이다.

### 확인한 원인과 최소 수정

1. **입력 뒤 정확한 label 조회가 사라지는 마크업 구조.** CI는 입력 전 편집 확인·입력·저장 또는 확인창 단계까지 진행한 뒤 `getByLabel('입력 칸', { exact: true })`를 다시 평가하는 48/95/143/196행에서 시간 초과했다. 기존 `<label>입력 칸<textarea ... /></label>`의 textarea에는 React 19의 제어값 동기화로 입력 내용이 descendant text로 생긴다. 설치된 Playwright 1.63의 `getElementLabels`는 연결된 label의 전체 descendant text를 읽으므로 입력 뒤에는 `입력 칸xx`처럼 정확한 label 문자열이 달라진다. label과 textarea를 형제로 분리하고 `htmlFor="sentence-typing-input"` / 같은 `id`로 연결했다. 선택자를 느슨하게 바꾸거나 timeout·retry·assertion을 줄이지 않았다.
   - 새 `tests/sentence-typing-ui.test.ts`는 실제 shipping component를 transpile하고 React `renderToStaticMarkup`으로 빈 입력, 입력 중, pending 복구, 업데이트 대기 값을 렌더링한다. label의 고정 문자열/명시 연결과 textarea 값/readonly를 함께 확인한다. 수정 전 명시 연결 검사가 실패했고 수정 후 4/4 통과했다. 이것은 렌더 회귀이며 실제 DOM·브라우저 통과를 대신하지 않는다.
2. **disposable schema에서 빠진 기존 reset 권한.** CI의 원격 reset 사례는 160행 `reset.error === null`에서 실패했다. 실제 `tests/e2e/schema.sql`을 그대로 로드한 PGlite에서 `reset_my_app_records('growth',...)`가 `42501 permission denied for table growth_ai_reviews`로 실패함을 재현했다. 기존 production migration `20260906141943_add_app_record_resets.sql` 4, 7–8행의 `grant delete ... to authenticated`와 owner-only DELETE policy가 disposable schema에는 없었다. 그 테이블의 DELETE grant와 동일한 owner policy만 browser 전용 `tests/e2e/growth-reset-contract.sql` fragment로 추가하고 `scripts/e2e-stack.mjs`가 seed에 포함한다. production migration, reset 함수, sentence save RPC와 SECURITY INVOKER/RLS 계약은 바꾸지 않았다.
   - 새 `tests/sentence-typing-fixture.test.ts`는 fixture 전체와 browser 전용 fragment, 실제 reset/save 함수 원문을 실행한다. frozen payload readback, save→reset, reset→stale-save 거부, 새 세대 저장, 다른 계정 행·루틴·상태 보존, owner-only DELETE와 anon 거부를 검증한다. 수정 전 실제 권한 거부를 재현했고 수정 후 3/3 통과했다. 별도 연결의 동시 lock 대기 검증은 아니다.
   - 최초 수정은 공유 `schema.sql`에 policy를 넣었으나 통합 unit 검사에서 원래 reset migration도 적용하는 fixture들과 policy 이름이 충돌했다. 공유 schema를 원상 복구하고 browser 전용 fragment로 이동했다. production migration이나 다른 fixture를 느슨하게 변경하지 않았으며, 동일 의미의 중복 permissive policy도 추가하지 않는다.

CI 원본 artifact는 지원되는 다운로드 경로에서 접근이 거부되어 원문 assertion/trace를 열지 않았다. 시간 초과 위치와 진행 범위는 CI 전체 로그에 근거하며, label 원인 설명은 설치된 React/Playwright 코드와 렌더 회귀로 뒷받침했다. 외부 접근 제한을 우회하지 않았다.

### 수정 후 로컬 검증

- sentence focused **49/49 통과**: 기존 draft/hook/migration 42개 + UI 4개 + 실제 fixture SQL 3개.
- browser 전용 fragment로 분리한 뒤 전체 `npm test` **1312/1312 통과**, 실패·취소·skip 0. 공유 fixture와 기존 reset migration의 policy 충돌이 없는지 전체 회귀로 재확인했다.
- 수정한 TS/TSX 파일 ESLint 통과.
- 문장 수정의 `npx tsc --noEmit --incremental false` 19:21 UTC 검사 통과. 19:24 통합 재검사에서는 동시에 추가된 growth progression test의 unknown 타입 오류 2개만 보고되어 부모 작업에 전달했다. 최종 통합 타입 검사는 부모 작업의 확인과 구분한다.
- `git diff --check` 통과.
- 기존 7개 acceptance/14개 browser case의 assertion·timeout·retry를 변경하지 않았다.

이 수정의 Chromium/WebKit 재검증, 통합 최종 후보 전체 회귀와 physical device 검증은 남아 있다. 로컬 브라우저 실행 차단/재시도 금지를 준수했으며 hosted DB/API, 운영 변경, commit/push는 하지 않았다.
