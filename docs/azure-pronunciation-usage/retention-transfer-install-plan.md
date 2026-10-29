# v1 → fresh v2 최초 예산 인계 — 운영 미적용 후보

기준 QA 8066e8ffc03aec9c1491208f11f54e56a0bf339a / tree b8930ba43b3d57a211417cc52a86c684efe58391. 원본은 변경하지 않는다. 이 후보는 실제 정책/기간/스케줄/키를 설정하거나 Preview를 배포하지 않는다.

## 파일과 기본 닫힘

- `lib/speech-retention-transfer.ts`: pinned v1/v2 원문을 받아 SQL 문자열만 만드는 오프라인 renderer. DB/client/env/network/filesystem I/O가 없다. 앱 route에 연결하지 않는다.
- `retention-transfer-candidate.sql`: 검토용 전체 SQL. **첫 transaction 안에서 unconfigured 예외를 발생시켜 DDL/DML 전에 중지한다.** zero evidence digest/unknown history는 실제 검토 증거가 아니다. guard를 임의로 지우고 실행하는 절차가 아니다.
- `lib/speech-retention-transfer.test.ts`: 실제 두 계약 SQL과 renderer 결과를 한 in-memory PGlite에서 순차 실행. 예산/계정/키/원장/실패 주입은 모두 합성이다. 기존 모델 21개를 실제 이관 검증으로 세지 않는다.

실제 실행본은 별도의 승인된 이관 검토 뒤, `legacyHistory`와 그 근거 `evidenceSHA256`를 명시해 생성·해시 고정·독립 검토한다. renderer의 null 기본값은 거절이다. `reviewed-unused`라는 문자열이나 hash 형식이 승인/과거 미사용을 증명하지 않는다. 이것은 보관 policy ID/API 검토 timestamp를 채우는 입력이 아니다. 실제 이관 대상·쓰기/메타 삭제·잠금 영향에 대한 승인은 아직 없다.

## 원자적으로 바뀌는 것

1. 실제 source/destination 설치 SQL bytes가 기준 SHA256과 같아야 한다. v1 schema/3개 table가 있어야 하고 v2 schema는 없어야 한다. 이미 있는 v2가 pristine해 보여도 true→false 초기화하지 않는다.
2. v1 policy → keys → total을 ACCESS EXCLUSIVE 순서로 잠근다. 기존 guarded v1 transaction이 먼저 commit했다면 소모를 최신 상태로 읽는다. 잠금 timeout/실패는 전체 transaction 중단이다. 운영 v1 API를 잠시 기다리게 하므로 승인된 작은 maintenance window에서만 적용할 후보다. 무관한 테이블을 잠그거나 reset하지 않는다.
3. 실제 v1 함수 5개의 signature/language/body/definer/search_path와 기존 API 권한 경계를 대조한다. table 직접 reset 권한이나 private helper 노출/함수 drift가 있으면 수정하지 않고 중단한다. 이는 기존 1회 차단 전제의 확인이지 새 포괄 보안 감사를 요구하는 작업이 아니다. 별도 원장/외부 직행 writer의 부재는 이 검사만으로 증명하지 못한다.
4. 기존 v2 install의 바깥 BEGIN/COMMIT만 renderer에서 제거하고 내부 role/grant/default-null 검사 그대로 실행한다. fresh schema/total/정책/health는 **이 transaction 안에서만** 생성된다. 원본 install을 먼저 따로 commit한 뒤 reset하지 않는다.
5. private/RLS `transfer_claim` singleton을 만들고 양쪽 total과 claim을 잠근다. 직접 사용자/request/음성 식별자는 넣지 않는다. claim에는 초기 pre-retirement 분류·두 계약 hash·근거 hash·retirement 여부만 남으며, 문맥 결합 가능성이 있어 완전 익명이라고 보장하지 않는다.
6. `reviewed-unused` 근거가 있고 잠금 뒤 v1 consumed=false, finished=false, 요청 4필드 NULL일 때만 fresh v2 초기값을 false로 정한다. used/불일치/unknown이면 true다. 누락 singleton은 새 예산으로 보지 않고 전체를 거절한다.
7. 같은 transaction에서 v1 consumed=true retirement를 남긴다. 과거 요청 UUID/hash/길이/시각은 지우고, v1 policy.owner 연결도 해제한다. **원음/점수를 복사하지 않으며 가짜 사용 요청을 만들지 않는다.** 기존 finished boolean은 보존한다. keys의 Vault 참조는 읽거나 옮기지 않고 disabled 상태 그대로 둔다.
8. v2 receipt/keys는 비어 있고 policy/기간/health는 미설정 상태를 유지한다. 소모 예산 인계는 provider 활성화가 아니다. 한 transaction의 COMMIT으로만 완결한다.

## 재실행·실패·구 writer

- 재실행은 `v2 schema exists`로 거절한다. 자동 no-op을 위해 상태를 추정하거나 claim을 덮어쓰는 기능을 만들지 않는다. 이후 API·finish·purge·계정삭제에는 false를 쓰는 새 기능이 없다.
- source 분류는 retirement 전에 claim에 남긴다. v1 retirement=true를 새 실제 시험 소모로 해석해 다시 예산을 지급하지 않는다.
- 현재 v1 consume은 auth 후 total 잠금/consumed 확인을 한다. retirement=true 후에 구 policy/key가 합성 검사에서 다시 활성화돼도 실제 v1 consume은 limit으로 막힌다. 이 검사는 살아 있는 두 PostgreSQL 세션을 동시에 대기시킨 증거가 아니다.
- 부분 실패는 fresh DDL/claim/v1 retirement/메타 삭제/v2 초기값을 함께 rollback한다. 이미 transaction 전에 commit된 소모를 false로 돌려놓는 보상 동작은 없다.
- COMMIT 응답 유실이면 실제 commit 가능성을 유지한다. 재실행해 초기화하거나 이전 백업을 복원해 한도를 살리지 않는다. 읽기 확인 전까지 앱은 계속 닫힌다.
- claim 삭제/관리자 강제 reset/PITR는 정상 앱 기능이 아니다. 그런 복구 뒤에는 과거 false를 신뢰하지 않고 두 writer를 닫은 상태에서 보수적으로 재검토해야 한다. 이 후보는 관리자/복구까지 절대 불변인 전역 저장장치를 구현했다고 주장하지 않는다.

## 정확한 설치 계획의 남은 경계

설치 전 승인 대상 프로젝트·DB·기존 원장과 고정 old/new schema 이름의 일치를 비밀 값 없이 확인해야 한다. 잠금 전의 false/empty 관찰만으로 과거 미사용을 입증하지 않으며, 최종 분류는 승인된 근거와 transaction 안의 잠금 후 상태를 함께 대조한다. 이 문서는 특정 운영 환경의 설치·사용 상태를 제공하지 않는다.

1. 이전 전 source/writer/기존 소모의 범위를 확인하고 사용자가 정확한 이관·기존 메타 정리·짧은 잠금 영향을 승인한다. 미사용 근거가 불명확하면 `unknown`으로 보수적 소모 처리하며 새 시험을 자동 지급하지 않는다.
2. 실행본의 context/정확 SQL hash를 봉인한다. 사용자의 비밀/owner/request 값을 파일이나 채팅에 복제하지 않는다. 원본 v1/key refs를 포함한 데이터 dump를 개발 ZIP에 넣지 않는다.
3. **바깥 transaction이 없는 전용 승인된 연결**에서 generated single transaction을 한 번 실행한다. renderer 자체에는 실행 기능이 없다. 오류 시 client가 ROLLBACK으로 세션을 정리해야 하며 일부 문장만 재실행하지 않는다. 이미 활성화된 v2를 대상으로 쓰지 않는다.
4. 결과는 schema/claim/두 consumed/disabled/메타-null boolean과 row count만 확인한다. API role table/claim 직접 접근 거절, 원래 consume 제한 및 v2 missing-policy 거절은 별도 승인된 연결 검증이다.
5. 이관 COMMIT 확인 뒤에만 별도 `retention-db-executor-candidate.sql` 설치 후보를 검토한다. 이 파일의 설치 transaction과 이후 단일 top-level CALL은 분리한다. 합성 연속 검사에서 미사용/unknown 두 분류 모두 설치·unconfigured CALL 뒤 예산이 바뀌지 않고 ready=false를 유지하는지 확인한다. 실제 executor/기간/운영 삭제/로그/backup 검토와 proof/Preview 활성화는 별도 단계다. v2의 `transfer_claim`는 이관 예산 보존용 최소 운영 근거이며 계정삭제로 지우고 예산을 새로 만드는 용도가 아니다. 필요 수명·복구 포함 설명은 실제 보관 검토에 포함한다.

### 검증 구분

PGlite는 실제 SQL DDL/DML/COMMIT/ROLLBACK과 원본 함수 동작을 검사한다. 실제 Supabase migration history/PostgREST/다중 세션 MVCC/pg_cron/권한 주체/네트워크/운영 지연을 검증하지 않는다. 초기 renderer newline 오류와 수정 후 결과를 별도 영수증에 보존하며 최종 검사 수는 그 영수증을 기준으로 한다.

잠금 근거: [PostgreSQL explicit locking](https://www.postgresql.org/docs/17/explicit-locking.html). lock timeout/row/table wait 및 privileged DDL 경쟁은 실제 환경에서 별도 확인하며 문서만으로 운영 성공을 선언하지 않는다.
