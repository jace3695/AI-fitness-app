> **2단계 QA5ad 기록:** 아래는 성공 QA와 함께 보존한 연결 범위입니다. 새 별도 source-only 후보의 예정시각 인증 gate는 [3단계 설계](retention-scheduled-health-design.md)에 정리합니다. 실제 scheduler/DB 적용/기간 승인은 여전히 없습니다.

# J6 v2 보관·동의·정리 — 2단계 연결 후보

2026-10-29. **소스상 연결됨 / 원격 미배포 / 실제 DB 미적용 / 실제 기간 미정.** 기준 QA는 `0d0d57aff0e44c94bbd86979d2196db0e5b7e0b3`다. 기존 오류 안내 2파일과 1단계 분리 원장 후보를 포함한다. 1단계 문서는 당시의 미연결 상태를 보존한 기록이며, 이 문서가 현재 overlay의 연결 범위다. 구현 진척은 **34/36 = 94.4% 그대로**다.

## 실제 route와 동의 계약

- `app/api/language/assessment/route.ts`는 v2 전용 `speech-retention-api-route.ts`를 사용한다. 이전 v1 route는 회귀용 소스로 남지만 actual Next 진입점의 fallback이 아니다.
- `YEONI_SPEECH_RETENTION_POLICY_JSON`은 설정되지 않은 상태가 기본이며 strict descriptor가 없으면 auth client/DB 생성 전 503으로 닫힌다. 현재 값은 읽거나 설정하지 않았다. TTL, 허용 종료, 검토 자료 hash, 정리 주기 I·최대 시작 지연 J·실행 제한 Q가 모두 명시돼야 한다. 합성 시험의 120초 / I60·J10·Q5 / 1시간은 실제 정책이 아니다.
- GET 공개 응답은 비밀·owner 없이 보관 descriptor와 hash를 담는다. 브라우저는 정확한 필드·기간·hash를 재계산하고 해시 검증 전후 만료를 검사한다. 확인을 다시 하면 이전 동의는 해제된다.
- POST는 새 v2 동의 버전과 정확히 같은 정책 hash를 요구한다. 기간·종료·검토 자료·I/J/Q가 바뀌면 이전 동의와 proof는 거절한다. UI의 로컬 확인만 한 상태(null hash)는 전송 자격이 아니다.
- 기존 로그인 owner·허용 Preview branch·리소스/지역·정확한 문장 `こんにちは。`·canonical PCM WAV·5초 이하·최대 30초 handler·한 번 소모·응답 불명확 시 재전송 금지 경계를 유지한다. 새 정책이 없으면 v1으로 내려가지 않는다.

## 저장과 삭제 의미

앱에 원음·문장·점수를 영구 저장하는 열/기능을 추가하지 않았다. 결과는 현재 화면의 상태이며 계정·문장·녹음·화면 경계에서 정리한다. 공급자·호스팅 로그·APM·백업 전체 비보관을 보장하지 않는다.

`receipt`의 owner UUID·요청 ID·payload hash·길이·시각은 사용자 연결 메타다. 정상 finish 확인 시 receipt를 삭제하고 정책 owner도 해제한다. 만료된/불명확한 요청은 만료 후 정리 대상이다. Auth 계정 hard-delete는 FK CASCADE로 receipt·정책을 지우지만 logout/soft-delete와 같지 않다.

전역 `total`에는 singleton/consumed 두 boolean만 남는다. 요청 메타/계정 삭제로 시험이 다시 열리지 않는다. 개인 식별 필드는 없지만 지정 계정이라는 맥락·로그/백업 결합 가능성이 있으므로 완전 익명/법적 비개인정보를 보장하지 않는다. 신규 설치는 consumed=true/정책 OFF/기간 null이며 기존 소모를 false로 재설정하는 migration을 제공하지 않는다.

## 정리 실행기 후보와 지연 경계

`createSpeechRetentionCleanupRunner`는 **스케줄러가 아니다.** import/생성 시 타이머·DB·env·provider를 만들지 않는다. 호출자가 명시한 nominal tick, wall/monotonic clock, 타이머, purge capability만 주입받는다.

정상 실행 가정은 주기 I, 최대 시작 지연 J, SQL 커밋 확인까지 제한 Q다. 매 tick이 이 조건을 만족하면 만료 후 삭제 지연 목표는 **I + J + Q**다. TTL 이후라는 뜻이지 TTL만큼 보관 후 즉시 삭제 보장이 아니다. 로컬 건강 만료는 완료시각이 아닌 nominal due + I + J + Q다. 늦거나 누락/중복/역순 tick, clock 이상, 거절/timeout/불명확 응답은 건강 상태를 닫는다. timeout은 DB rollback 증거가 아니며 실제 주입 작업이 끝날 때까지 중복 실행을 막는다.

`createSpeechRetentionMaintenancePurge`는 고정 SQL과 hash 하나만 bind하는 주입 bridge다. 실 DB 연결·역할·스케줄 설치·재시도·비밀 조회가 없다. 커밋이 확인된 단일 응답의 정확한 hash/0~1 삭제 수만 수용하며 raw DB 오류를 반환하지 않는다.

SQL `purge_expired()`는 정책/키 OFF에도 만료 메타를 지우되 heartbeat를 갱신하지 않는다. private `maintenance(hash)`는 정책 잠금 아래 요청 hash가 현재 계약과 일치하고 Q 이내 완료된 경우에만 heartbeat를 기록한다. 구계약 요청은 삭제는 할 수 있어도 새 계약 readiness를 열지 못한다. API role에는 두 함수 EXECUTE가 없다.

**SQL heartbeat와 로컬 runner 건강은 동일하지 않다.** DB는 최근 동일 정책의 삭제 실행 완료 사실과 완료 후 I+J+Q 경과만 검사한다. nominal due나 외부 scheduler의 지연/누락을 이 hash-only bridge로 알 수 없다. 늦은 tick이 cleanup에 성공하면 runner는 degraded여도 DB의 최근 완료 gate는 통과할 수 있다. 따라서 이것만으로 운영 자동삭제 SLA/전체 fail-closed scheduler 연동을 주장하지 않는다. 실제 활성 전에 scheduler의 due/health를 준비 gate에 묶는 계약, heartbeat/미실행 알림, 담당자·중단 조치와 무트래픽/장애 시험을 검토해야 한다.

ready/consume은 최근 heartbeat를 요구한다. 이미 소모한 정상 finish는 heartbeat만 만료됐다는 이유로 메타 삭제를 막지 않는다. owner·auth.users 존재·서명·현재 정책·키·미만료 receipt 검사는 계속 필요하며 정책 OFF/만료 때 강제로 성공을 만들지 않는다. 그 경우 만료 cleanup이 남는다.

## 검증과 남은 범위

- 실제 Next route를 읽어 VM으로 불러온 handler + 사용자 JWT 모양의 주입 adapter + 실제 PGlite/pgcrypto SQL을 합성 WAV로 검사한다. 실제 Supabase/HTTP/provider/실음성은 아니다.
- 계정 삭제·만료·소모/finish 응답 유실·병렬 요청/취소·구 동의/hash·30초 proof·5초 경계·권한 상속·구정책 maintenance·stale heartbeat finish·실제 SQL bridge/runner 정리를 검사한다.
- React component handler와 `renderToStaticMarkup` 검사는 UI 문구/동의 경계를 다룬다. React scheduling/HTTP/decode는 mock이므로 native UI 증거가 아니다.
- 기존 격리 GitHub QA CI용 `AssessmentFixture.tsx`와 `assessment.spec.ts`에 390px 보관 동의, 320px 미설정/불일치→복구 재동의 사례를 준비했다. local Chromium/CUA를 실행하지 않았다. 양 엔진 실제 CI 및 PNG 독립 검토가 아직 필요하다.
- 원격 migration·policy/key activation·env 값 조회·scheduler 설치·Preview 변경·provider 호출·개인자료 전송 0. 실제 기간 선택, v1→v2 소모 보존 이관, PostgreSQL 다중 세션, 제공자/계정/무료 계층, 로그/APM/백업/PITR 복구 후 재삭제/소모 보존은 별도 승인·검증 대상이다. 실제 J6/C4 완료로 세지 않는다.

## 발견한 문제와 보완 기록

첫 집중 SQL 실행에서 PL/pgSQL record와 UPDATE target의 `policy` 이름 모호성이 발생했다. 별칭을 분리하고, 오류 후 fixture rollback 순서를 고쳐 원인과 cascade 실패를 구분했다. 초기 로그를 보존했다. 독립 읽기에서 발견한 구계약 heartbeat 갱신 및 finish 과차단은 위 방식으로 수정하고 실제 SQL 회귀를 추가했다. 브라우저 digest await 동안 만료되는 경우도 후검사를 추가했다. 검사 수·현재 hash는 별도 후보 영수증에 기록하며 기존 QA의 전체 CI 통과를 이 후보에 승계하지 않는다.
