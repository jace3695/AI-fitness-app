# J6 정리 예정시각과 DB 준비 gate 연결 — 3단계 소스 후보

2026-10-29. 기준 QA `5ad1847b4e0298dcd925b52ac33180b4f7ba663c`, tree `40146f0c25bf5e5d734c1ba3a60d17c5bfaf868e`. 성공한 기준 소스·CI·이미지·백업은 보존하고 별도 작은 overlay만 수정했다. **실제 보관기간/지연 SLA/스케줄은 null, 원격 DB 적용·scheduler 설치·권한/키 활성화·Preview 배포·provider 호출은 0이다.** 구현 진척은 34/36 그대로다.

## 닫으려는 정확한 공백

기준 5ad의 `maintenance(hash)`는 최근 purge 완료 시각만 DB에 기록했다. local runner가 늦음/누락/불확실성을 표시해도 DB는 nominal due를 몰라 준비를 열 수 있었다. 새 후보의 ready/consume은 그 기록을 더 이상 권한으로 쓰지 않고 **DB가 보관한 예정 tick·세대·단일 실행 token으로 인증한 유한 lease**만 읽는다. 기존 hash-only maintenance와 local-only runner는 호환/회귀용이며 이 gate를 열 수 없다.

## 상태와 데이터

- `cleanup_health`는 owner/request/audio/점수가 없는 별도 singleton이다. 예정시각, 최근 실행, 시계 관측, 인증 만료 및 세대/실행 식별자만 갖는다. 설치 시 모든 값 null/state unconfigured다. 실제 주기 I·시작 지연 J·실행 제한 Q도 policy에 정해지지 않는다.
- `policy.cleanup_schedule_generation`은 명시한 운영 세대와 연결한다. 새/삭제 후 재생성한 policy는 기본 null이라 옛 인증이 자동 이식되지 않는다. 정책 hash는 기존 보관기간·종료·검토 artifact·I/J/Q와 연결한다.
- generation과 attempt token은 **운영 세대/fencing UUID**다. 로그인 세션, API key, 비밀번호 또는 provider 자격증명이 아니다. token을 안다고 API 역할이 private 함수를 실행할 수 없다. 그래도 연결 가능한 운영 메타이므로 실제 값은 로그/공개 UI에 내보내지 않으며 완전 익명이라고 보장하지 않는다. 테스트 값/임시 DB가 생성한 token만 사용했다.
- request receipt와 global consumed는 이전 분리 계약 그대로다. 어떤 health reset·purge·정책/계정 삭제도 `total.consumed`를 false로 바꾸지 않는다.
- 실제 policy DELETE 시 private trigger가 OLD 세대와 같은 operational 상태의 필드를 null/unconfigured로 비운다. 다른/NULL 세대는 새 상태를 지우지 않는다. 정상 finish/purge가 이미 allowed_owner를 해제했으면 이후 계정 삭제가 policy DELETE를 유발하지 않을 수 있으므로, **모든 계정 삭제가 모든 운영 tick·로그·백업을 지운다고 하지 않는다.** 운영 메타 보관/폐기는 실제 정책 검토 대상이다.

## 프로토콜 — 외부 scheduler를 설치하지 않음

| 단계 | 소스 계약 | 준비/소모 효과 |
|---|---|---|
| begin | private fixed SQL에 hash/generation/nominal due 전달. policy→health 순서 잠금 후 현재 세대만 처리 | 먼저 이전 인증을 닫고 token을 무효화 |
| purge | begin 내부의 별도 예외 블록에서 만료 receipt 정리. 정책/provider OFF와 독립 | 일반 purge 오류가 outer closed 상태를 rollback시키지 않도록 분리; 삭제 성공만으로 준비 안 열림 |
| 실행 검증 | DB의 next_due와 정확히 같고, DB 시간상 due≤시작≤due+J이며 원래 Q 안이면 일회 token 발급, next_due+=I | running 상태는 준비 닫힘. 누락 tick을 현재시각으로 재기준화하지 않음 |
| finalize | 같은 hash/generation/token/due, 로컬 건강 확인, **begin부터의 원래 deadline**, 현재 정책 hash·필수시각/순서 검사 | 통과 시에만 due+I+J+Q까지 인증. finalize가 Q를 새로 시작하지 않음 |
| ready/consume | 새 인증과 DB 현재시각 검사. consume은 total 잠금 대기 뒤 소모 직전에도 재검사 | 만료/불일치/미설정이면 차단. finish는 health gate와 분리하여 정상 요청 메타 정리를 막지 않음 |
| replay/재시작 | 성공 token은 소진. 구세대/구token finalize는 실패하고 만료시각을 늘리지 않음 | **이미 정상 인증된 유한 lease를 replay 때문에 rollback했다고 하지 않음.** 새 token·소모 환불 없음 |

정리 begin/finalize는 미래의 검토된 driver가 **각각 커밋을 확인하는 별도 호출**이어야 한다. 전체를 하나의 트랜잭션으로 묶으면 ‘begin의 closed가 먼저 커밋됨’이라는 경계가 사라진다. 현재 코드는 driver를 생성하지 않고 `execute`를 주입받으며 고정 SQL/bind만 사용한다. 새 운영 DB 로그인/최소 역할/EXECUTE 권한, 네트워크·스케줄 연결은 별도 권한이 필요한 미실행 작업이다. 일반 authenticated/anon/service_role에는 table/helper/begin/finalize 권한이 없다.

## 실패·무트래픽·시계와 분산 응답

- 초기 null/default는 I/O·타이머·클라이언트를 만들지 않는다. 명시 tick만 begin/finalize를 수행하며 자동 재시도나 provider 호출은 없다.
- 늦음/누락/중복/역순/시간 이상/초과/불완전 ack는 로컬 건강을 닫는다. timeout 뒤에도 실제 주입 작업이 끝날 때까지 busy를 유지하여 겹친 재시도를 막는다. Q는 begin+finalize의 한 예산이다.
- 네트워크 단절, transaction 취소 또는 커밋 응답 유실이면 이전 DB 상태를 알 수 없다. **로컬 uncertain은 DB rollback/전역 즉시 닫힘과 같지 않다.** finalize가 커밋되고 응답만 사라지면 DB에는 해당 due에서 계산한 유한 인증이 남을 수 있다. 이 후보는 그 경계를 합성 autocommit 검사로 드러낸다. 별도 토큰별 조회/폐기 endpoint나 자동 retry를 만들지 않는다.
- 무트래픽 자체는 아무 정리도 실행하지 않는다. 다음 ready/consume은 DB 시각으로 만료 인증을 거절하지만, 이것이 이미 저장된 메타의 자동 삭제를 실행했다는 뜻은 아니다. 실제 무트래픽 정리에는 독립 scheduler가 필요하다.
- DB는 관측된 시간 역행을 faulted로 닫고, purge 전후/잠금 대기 뒤/소모 직전 시각을 재확인한다. 순수 SQL wall clock으로 관측되지 않은 clock jump까지 증명할 수 없다. 실제 clock 모델·지연 측정·알림 검토는 남는다.
- local runner anomaly latch는 **같은 인스턴스**의 복구만 막는다. 새 인스턴스를 만들면 메모리 latch는 초기화된다. 이것을 schedule 세대 재승인으로 해석하지 않는다. 재가동·장애·PITR 복구 때는 기존 소모를 보수적으로 보존하고 generation/next due를 별도 검토해야 한다. 이 후보는 자동 재설정/활성화 도구를 제공하지 않는다.

## 검증 범위

실제 후보 SQL을 PGlite/pgcrypto에서 합성 정책/계정으로 실행한다. 정상·old purge 무권한·늦음/누락/미래 due·중복 begin·token replay/구세대·NULL/불일치 lease·무트래픽 만료·시계 역행·purge 오류·계정/정책 삭제·일회 소모 보존을 검사한다. 별도 autocommit case는 새 TS runner→실제 SQL과 finalize 응답 유실, purge 실패 후 closed 커밋을 확인한다. 일부 rollback-isolated case는 트랜잭션 내부 상태검사이지 실제 외부 commit 증거가 아님을 구분한다.

기존 actual Next/handler+v2 adapter+SQL 회귀도 유지한다. 이는 실제 hosted DB/PostgREST·다중 PostgreSQL 세션·driver cancellation·cron·실제 계정/음성·공급자·운영 SLA 검증이 아니다. UI 소스는 바꾸지 않았고 기준 5ad의 실제 양 엔진 성공을 새 DB/runner의 운영 검증으로 승계하지 않는다. 결과/해시/초기 fixture 오류는 별도 후보 영수증에 보존한다.

실제 활성 전에 필요한 선택: 보관기간/운영 메타 수명, I/J/Q와 clock 기준, 실행자 최소 권한, 무트래픽 스케줄/알림·중단 담당, 재시작/복구 세대 관리, 원래 소모 보존 이관, 로그/APM/백업 처리. 기간을 임의로 정하거나 사용자가 지금 키를 재저장하도록 요구하지 않는다.

## 참고 문서

빈 search_path와 명시 EXECUTE 제한은 definer 권한을 대신하지 않으며 별도 검토한다. [Supabase Database Functions](https://supabase.com/docs/guides/database/functions). 일관된 잠금 순서를 사용하되 다중 세션 deadlock/대기 검증을 수행한 것으로 간주하지 않는다. [PostgreSQL Explicit Locking](https://www.postgresql.org/docs/current/explicit-locking.html). 2026-10-29 [Supabase changelog](https://supabase.com/changelog)를 재확인했으며 이 소스 작업은 새 원격 schema 노출/권한 변경을 하지 않는다.
