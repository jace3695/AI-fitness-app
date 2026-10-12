# 일본어 Live P3 — 다음 수업 준비 구현·검증 기록

- 작성 기준: 2026-10-10 03:58 KST / 2026-10-09 18:58 UTC
- 기준 HEAD: `5e1d5d782999bae05b16bd143d77fb193c8254e3`
- 브랜치: `agent/yeoni-cat-animation-poc`
- 상태: P3 구현은 미커밋 로컬 변경. 실제 인증 브라우저·운영 반영 완료 보고가 아니다. 상위 통합 작업자가 최종 검증·커밋·CI를 관리한다.

## 1. 범위와 요구사항

v1.3 요청서 §11은 생성·미리보기·수정·복사·이전 생성 이력을, §13은 Supabase 준비 이력 및 여러 기기 동기화를 요구한다. P0 §5E의 생성 원본/수정본/출처 버전 보존에 맞춰 기기 초안만으로 대체하지 않고 추가 서버 이력 계약을 구현했다. 호스팅 DB에는 적용하지 않았다.

- `/language/live` 안에 ‘다음 AI 수업 준비’ 탭을 추가했다. 독립 앱이나 외부 AI 호출을 만들지 않았다.
- P2의 owner 검증된 일관된 전체 snapshot, reducer, 간격 정책을 재사용한다.
- 한국 시간의 준비 날짜와 최대 3/5/10개 영역을 선택한다. 기본은 5개다.
- 재학습, 기한이 지난 복습, 추가 평가, 예정 복습, 장기 숙달 유지 확인을 우선한다. 남은 분량이 있을 때만 다가오는 장기 일정을 안내하며 바로 반복할 필요 없음을 표시한다.
- 최근 학습 날짜, 전날의 실제 보고서, 최신 단계, 다음 권장 내용, 재학습/재평가 근거를 참조한다. 오래된 보고서의 늦은 등록 시각으로 현재 단계를 덮어쓰지 않는다.
- unknown/미학습/해당 없음, 현재 상태/과거 숙달/재학습을 구분한다. 자유문장만으로 숙달이나 객관적 점수·학습시간을 만들지 않는다.
- 미래 날짜 수업·관찰은 준비 내용에서 제외하고, 날짜 미확인 기록은 최신 수업이나 전날 수업으로 단정하지 않는다.
- 새 수업, 자료 부족, 복습 없음은 정상 경로다. 조회 실패나 미적용 schema는 빈 기록으로 처리하지 않는다.
- 기존 교사의 v1.1 규칙을 유지하고 종료 보고서의 정확한 25개 표제를 그대로 넣는다. 기존 report schema를 변경하지 않았다.
- 긴 인용문은 700자까지 명시적으로 발췌하며 생략 안내와 원본 참조를 남긴다. 원본 보고서를 자르거나 변경하지 않는다.

## 2. 저장·복사·복구

- 새 `language_live_preparations` 테이블은 owner + preparation ID + revision의 append-only 이력이다. 생성 원본과 사용자 수정본, template/policy version, 날짜/시간대, 선택 이유, 출처 필드·관찰 IDs를 JSON payload에 함께 보존한다.
- 동일 request ID의 동일 payload 재시도는 기존 receipt를 반환한다. 다르면 conflict다. 이미 저장한 요청의 재생은 현재 출처 검사보다 먼저 하므로 응답 유실 뒤 원래 요청을 안전하게 재확인한다.
- 저장 응답 다음 실제 owner-scoped GET을 별도로 수행하고 전체 내용 일치를 확인해야 성공을 표시한다. 불명확한 결과는 입력과 request를 고정해 보존한다.
- 현재 수업 head(휴지통 포함)와 모든 P2 근거 batch의 ID/revision/hash를 exact source vector로 보존한다. 이는 인증 토큰이나 암호학적 진실성 증명이 아니다.
- 신규 저장은 P1/P2와 같은 owner advisory lock 아래 현재 vector와 정확히 일치해야 한다. current active event의 item/skill/source 연결과 날짜도 검사한다. 사용자 편집문 자체를 서버가 의미론적으로 검증했다고 주장하지 않는다.
- 기기 초안은 별도 owner namespace이고 기존 16개 일본어 sync 키에 포함하지 않는다. 다른 탭에서 복구하면 새로운 writable draft ID를 만든다. 오래된 탭의 수정/삭제는 최신 보관본을 덮어쓰지 않는다.
- 수업 준비의 생성 원본과 수정본은 서버 이력으로 여러 세션에서 조회할 수 있도록 구현했다. 기기 초안은 별도로 브라우저 한정임을 표시한다.
- 복사 전 최신 P2 snapshot을 다시 읽어 exact vector를 비교한다. 출처가 바뀌었거나 조회가 실패하면 복사하지 않는다. 이 확인 시점 이후 생길 미래 변경까지 고정한다고 보장하지 않는다.
- 복사 확인 중 취소/닫기/계정 전환의 늦은 결과는 새 화면을 변경하지 않는다. 클립보드 promise의 실제 성공 후에만 복사 성공을 표시한다. 실패하면 전체 선택과 수동 복사를 안내한다.
- ChatGPT 방에 자동 제출하거나 대화를 가져오지 않는다. 사용자가 검토하고 직접 붙여넣는다.
- 수업 삭제는 새 생성에서 해당 내용을 제외하되 이미 저장한 준비문은 역사적 기록으로 남긴다. 삭제 확인 화면과 준비 이력 화면에 이를 명시했다.

## 3. 변경 파일

새 제품 파일:

- `lib/language-live/preparation-types.ts`
- `lib/language-live/preparation.ts`
- `lib/language-live/preparation-validation.ts`
- `app/language/live/preparation-draft.ts`
- `app/data/languageLivePreparationRepository.ts`
- `components/language/live/LivePreparationWorkspace.tsx`
- `supabase/migrations/20261009184604_language_live_preparations.sql`

기존 UI의 제한적 변경:

- `components/language/live/LiveWorkspace.tsx`: 탭 연결, 작업 중 이동 보호, 삭제 보존 안내
- `components/language/live/LiveLearningWorkspace.tsx`: 아직 제공하지 않는다는 기존 안내 한 문장 갱신
- `app/language/live/live.css`: 준비 화면의 기존 스타일 보완

새 테스트:

- `lib/language-live/preparation.test.ts`
- `lib/language-live/preparation-repository.test.ts`
- `app/language/live/preparation-draft.test.ts`
- `tests/language-live-preparation-ui.test.ts`
- `tests/language-live-preparation-migration.test.ts`
- `tests/e2e/language-live-preparation.spec.ts`

상위 통합 작업자가 별도로 수정한 연결:

- `playwright.config.ts`, `.github/workflows/browser-verification.yml`: Chromium/WebKit 및 조기 회귀 선택
- `scripts/e2e-stack.mjs`: P1 → P2 → P3 순서의 disposable schema seed
- `tests/e2e/fixture.ts`: 합성 계정 cleanup/검증에 새 테이블 추가
- service_role SELECT 추가는 disposable fixture의 cleanup 검증 전용이며 제품 migration 권한이 아니다.

## 4. 실제 실행 결과와 한계

2026-10-09 18:58 UTC까지 실행한 구현 담당 검증:

| 검사 | 결과 | 범위 |
|---|---:|---|
| 결정적 준비/validation 단위 | 91/91 통과 | 날짜·우선순위·미확인·현재/과거 근거·정확한 25개 표제·1,000개 출처 포함 |
| repository 경계 | 7/7 통과 | owner 전환·immutable retry·실제 readback 대조·bounded history |
| 기기 초안 | 7/7 통과 | owner namespace·깊은 복구 복사·stale write/delete·quota·잘못된 캐시 보존 |
| 실제 shipping UI의 hook 경계 실행 | 11/11 통과 | 확인/편집·저장 응답 유실·복사 실패/취소/출처 변경·계정 전환·두 탭·캐시 오류 |
| PGlite P1/P2/P3 migration | 12/12 통과 | invoker/RLS·직접 INSERT·same-owner CAS·exact source vector·원문 유지·1000-reference 실제 builder round-trip |
| TypeScript | 통과 | 마지막 UI 경고 분리 전 전체 checkout에서 통과. 이후 최종 통합 재검사 필요 |
| scoped ESLint | 통과 | 위 제품/테스트 파일. 최종 리뷰 수정 뒤 재검사 필요 |
| `git diff --check` | 통과 | 18:58 UTC 시점 |
| Playwright `--list --reporter=line` | 로딩 성공 | P3 9개×Chromium/WebKit =18개 + 기존 auth dependency4개. 실행 증거 아님 |
| 실제 브라우저 | 미실행/차단 유지 | 기존 로컬 브라우저 EPERM 차단을 재시도하거나 우회하지 않음 |
| 실제 Preview/물리 기기 | 미검증 | 기존 인증 Preview/iPhone/iPad/Pencil 및 OS clipboard 확인과 구분 |

별도의 전체 단위 suite는 중간 시점 1,236/1,236 통과했다. 이후 8개 초안/UI 테스트와 병행 작업이 추가되어 이 숫자를 최종 전체 suite 결과로 재사용하지 않는다. 최종 build/전체 회귀/정확한 commit CI는 상위 통합 단계가 소유한다.

독립 UI/DB 리뷰가 이 시점 진행 중이므로 이 표는 이후 리뷰 수정의 통과를 주장하지 않는다. 최종 상위 체크포인트에서 보완 결과를 확인해야 한다.

### 브라우저에 작성한 시나리오

1. 첫 수업의 25필드, generated/edited revision 보존, reload 및 별도 인증 세션 조회
2. 전날/재학습/미학습/미확인 영역, 320px/768px 화면과 overflow
3. 출처 삭제 후 stale copy 차단 및 과거 준비 이력 유지
4. 클립보드 거절 시 수동 선택과 거짓 성공 방지
5. post-commit readback 유실, reload 후 immutable request 재시도
6. 지연된 source read의 복사 취소/닫기 보존
7. 두 탭의 별도 초안, 지우기 취소, leave/back/forward 보존
8. schema 오류를 첫 수업으로 오인하지 않음
9. in-flight owner A 저장 후 B 계정 전환, A 요청의 idempotent 복구 및 RLS

클립보드 브라우저 시나리오는 성공/실패 API 경계를 통제한다. 실제 OS clipboard나 물리 iOS 붙여넣기 권한의 검증은 아니다. PGlite는 단일 연결이므로 진짜 여러 PostgreSQL 세션의 동시 잠금/트랜잭션 경합 검증이 아니다. 독립 browser session 시나리오도 실제 실행 전이다.

## 5. 비용·데이터 보존·운영 승인 경계

- 유료 model/TTS/STT/Realtime, 자격증명, 기존 automation, 운영 데이터를 사용하거나 변경하지 않았다.
- Supabase 저장/조회 사용량은 늘 수 있다. 모델 API 비용이 없다는 것과 인프라 비용 0 보장은 다르다.
- 기존 P1/P2 테이블과 raw report/learning events, legacy completion/sync/reset/grants는 이 migration이 변경하지 않는다.
- 새 테이블은 RLS 및 authenticated owner SELECT/INSERT만 허용한다. UPDATE/DELETE/anon은 막으며 함수는 SECURITY INVOKER, 빈 search_path를 고정한다. 직접 INSERT도 trigger 검사를 거친다.
- 전체 history는 1,000 rows/10 MB, 저장 payload는 4 MB로 제한해 불완전한 일부 목록을 완전한 이력처럼 반환하지 않는다. 한도 초과 시 데이터는 남고 명시적 오류로 중단한다. 큰 규모의 pagination은 후속 범위다.
- hosted migration은 아직 적용하지 않았으며 이 보고서는 적용 승인이 아니다. 정확한 SQL, 기존 migration history 차이, 권한·용량·복구 경로를 별도 검토해야 한다.
- 운영 rollback 1차는 새 준비 메뉴/기능을 끄거나 이전 앱 버전으로 돌아가는 것이다. 이미 저장한 append-only 준비/수업/근거를 DROP/TRUNCATE하거나 되돌리는 파괴적 rollback은 하지 않는다.
- 운영 backup metadata와 실제 복구 검증은 기존 미확인 항목으로 남아 있다. 개인 데이터 export도 수행하지 않았다.
- 운영 main 병합과 Production 배포, 유료 리소스 도입은 별도 최종 승인 전 금지다.

## 6. 로드맵 반영

- P0: 기존 설계 산출물 재사용, 중복 설계/개발하지 않음.
- P1/P2: 기존 로컬 구현·검증 계약을 사용하고 근거 및 브라우저 차단을 그대로 보존.
- P3: 규칙 기반 지시문 + durable history + 안전한 UI 구현. 최종 독립 리뷰와 실제 인증 브라우저가 남음.
- P4: 실제 수업 샘플, browser/멀티세션/물리 기기/backup restore/운영 후보 전체 회귀는 별도 미완료.
- 전체 연이 AI의 다른 앱/캐릭터/Preview 검증은 이 P3가 완료로 올리지 않는다. 기존 진행 중 CI가 terminal 상태로 끝나고 증거가 보존되기 전 새 push하지 않는다.
