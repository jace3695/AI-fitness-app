> **1단계 기록(미연결 후보):** 아래 내용은 당시 범위를 보존한 역사 문서입니다. 이 2단계 overlay에서는 actual Next route와 동의 UI가 v2에 소스상 연결됐지만, 원격 배포·DB 적용·활성화는 하지 않았습니다. 최신 범위는 [2단계 연결 설계](retention-wiring-design.md)를 따릅니다.

# J6 보관·삭제 / 공용 1회 소모 분리 — 로컬 후보

작성: 2026-10-29. **운영 정책·마이그레이션·활성화 승인이 아니다.**

## 결론과 기준

원음·문장·점수를 영구 저장하는 기능을 추가하지 않는다. 현재 UI 결과는 React 상태, 녹음은 Blob/object URL이고, 서버는 결과를 응답으로 반환한다. 새 후보는 원장에 필요한 일시적 요청 메타만 별도 보관하고, 정상 정리가 확인되면 즉시 삭제한다. 실패·취소·응답 불명확 사례의 최대 보관 기간은 **미정**이다.

기준은 QA `0d0d57aff0e44c94bbd86979d2196db0e5b7e0b3` / tree `382ef4f630edf42315be4bf181b41aad7da20cc7`와 별도 검토된 J6 오류 안내 2파일 후보다. 기존 QA 전체 성공을 이 후보의 전체 성공으로 옮겨 적지 않는다. 구현 집계는 **34/36 = 94.4% 그대로**, J6/C4 실제 검증은 남는다.

새 `retention-contract-candidate.sql`, `speech-retention-proof.ts`, `speech-retention-usage.ts`는 별도 v2 계약이다. 현재 `speech-api-route.ts`, 실제 Next route, UI/동의 버전, v1 DB 초안은 바꾸지 않았다. 테스트의 handler 주입은 실제 배포 연결이 아니다. 이 문서는 실행할 SQL 명령이나 설정 값을 채워 넣는 절차서가 아니다.

## 기존 공백

v1 `total`은 계정 FK가 없는 하나의 공용 행이지만 요청 ID·payload hash·길이·시각·finished도 보관한다. `policy.allowed_owner ON DELETE SET NULL`만으로 이 요청 메타가 삭제되지 않는다. `finished=true`는 삭제가 아니고, 30초 서명 만료도 원장 TTL이 아니다.

최신 비밀 없는 메타 보고는 실제 정책/증명키 비활성, 보관정책 ID·API 검토 기록 미설정, 공용 한도 미소모를 확인했다. 이것은 키 재저장 요청의 근거가 아니다. 실제 허용 Preview와 최신 QA는 다른 소스이며 이 후보는 둘 어디에도 반영하지 않았다. 이 소스 작업에서 원격 값·원장·키를 조회하지 않았다.

## 세 종류의 데이터

| 영역 | 후보의 저장 내용 | 제거/보존 |
|---|---|---|
| 녹음·문장·점수 | 기존 메모리/응답 경로 유지. 새 DB 열 없음 | 현재 화면·계정·문장 경계의 정리 유지. 브라우저/호스팅/제공자 로그·백업의 전체 삭제 보장은 별도 검토 |
| `receipt` | owner UUID, 요청 ID, payload hash, 길이, 시작/만료 시각 | 정상 finish 즉시 삭제, Auth **hard-delete** FK CASCADE, 미종료는 명시된 만료 뒤 maintenance purge |
| `total` | singleton + consumed 두 boolean 열만 | 전역 시험 소모 표시 유지. cleanup/finish/계정 삭제는 이를 수정하지 않음 |

payload hash 역시 다른 정보와 연결 가능한 요청 메타이며 익명 데이터로 간주하지 않는다. `total`은 **개인 식별 필드 없는 전역 소모 표시**다. 단일 지정 계정이라는 맥락, 로그·백업과 결합할 수 있으므로 완전 익명/법적으로 개인정보가 아님을 보장하지 않는다. per-person 영구 지문을 새로 만들지 않는다.

정책 owner도 사용자 연결 정보다. finish 또는 만료 purge에서 `allowed_owner=null`과 `enabled=false`를 함께 적용한다. Auth hard-delete는 receipt와 정책 행을 CASCADE한다. 로그아웃, 세션 만료, UI에서 계정 숨기기나 soft-delete는 이 FK 삭제와 같지 않다.

## 수명주기와 소모 불변식

1. **설치:** 정책·키 OFF, TTL/검토/활성 종료값 없음, 새 전역 marker는 consumed=true. 설치만으로 새 시험을 열 수 없다. 합성 시험의 false 설정은 fixture이며 실제 활성화 레시피가 아니다.
2. **ready:** 기존 계정의 존재, 지정 owner, HMAC, v2 정책 hash, 유효기간, 검토 항목 및 미소모 전역 marker를 모두 검사한다. 소모하지 않는다.
3. **consume:** こんにちは。·5초 이하·리소스/지역 경계를 유지한다. 하나의 트랜잭션에서 global consumed=true와 receipt를 함께 기록한다. receipt의 만료는 승인된 기간과 활성 종료시각 중 빠른 시각이다. marker 누락·기존 receipt 불일치면 재구성하지 않고 닫힌다.
4. **finish:** 같은 계정/요청/내용 지문, 미만료 receipt를 확인한 뒤 receipt 삭제와 owner 연결 해제를 같은 트랜잭션으로 처리한다. finished 행이나 점수를 남기지 않는다. 이미 삭제된 finish의 재시도는 성공을 꾸며내지 않는다.
5. **만료:** 만료 receipt는 finish할 수 없다. maintenance 전용 `purge_expired()`가 삭제한다. 정책/키 OFF여도 실행 가능하다. **expires_at 열은 스케줄러가 아니므로, 무트래픽 자동 삭제 완료를 주장하지 않는다.**
6. **계정 hard-delete:** FK가 요청 메타와 정책을 지워도 global consumed는 유지한다. 새 owner를 지정하거나 동일 요청을 재전송해도 소모가 복구되지 않는다.
7. **응답 유실·취소·오류:** consume 커밋 여부가 불명확하면 provider를 자동 재호출하지 않는다. finish 응답이 유실돼 메타가 실제로 지워졌더라도 점수 성공으로 간주하지 않는다. receipt 삭제와 provider 처리 종료는 다른 사실이다.

트랜잭션 잠금 대기 뒤에는 서명 시각을 다시 검사한다. cleanup 기준 시각도 정책 잠금 획득 뒤 계산한다. 로컬 PGlite는 실제 SQL 계약을 검사하지만 다중 PostgreSQL 세션·PostgREST·운영 스케줄러 동시성 검증을 대신하지 않는다.

## 기간은 아직 결정하지 않았다

**최소 보관 권고:** 정상 finish 후 요청 메타를 즉시 제거하고, 확인하지 못한 요청만 운영상 필요한 가장 짧은 승인된 기간까지 둔다. 점수는 기존처럼 세션 표시만 한다. 오류 원인 조사를 이유로 원음·문장·점수 저장을 늘리지 않는다.

미종료 기간의 실제 숫자, 정리 실행 주기, 최대 삭제 지연, 실패 알림 담당/조치는 함께 결정해야 한다. SQL/TS의 `>30초`는 현재 HTTP handler 최대 대기시간 30초와 충돌하지 않기 위한 **기술 하한**일 뿐 권고 보관 기간이 아니다. 테스트의 120초·1시간은 합성 fixture 숫자이며 실제 정책으로 승인되지 않았다. 기본값은 null이다.

대안:
- **더 최소화:** durable 요청 메타를 전혀 남기지 않고 global 소모 표시만 유지. 중복/정리 확인 계약과 불명확 응답 처리를 새로 설계해야 하며 현재 후보가 이 방식을 구현했다고 하지 않는다.
- **진단상 필요할 때만:** 짧은 명시 기간 동안 요청 메타를 유지. 구체 목적·기간·삭제 지연·로그/백업 처리와 고지 검토가 선행돼야 한다. 편의상 7일/30일/영구로 정하지 않는다.

보관 기간만 정해도 충분하지 않다. 운영 로그/APM/SQL 로깅이 본문·오디오·지문·owner를 수집하지 않는지, DB 백업/PITR에서 삭제 자료가 얼마나 남는지, 복구 후 재삭제 절차가 있는지 별도 확인한다. 앱이 로그에 쓰지 않는 소스와 플랫폼 전체 비보관을 구분한다. 공급자 보관 안내도 별도 경계다.

## API·정책 hash와 실제 검토

서명은 v2 도메인, action/owner/request/payload뿐 아니라 `metadata_retention_seconds`, `authorization_expires_at`, `review_artifact_sha256`로 계산한 정책 hash에도 묶인다. 기간·활성 종료·검토 자료가 달라지면 이전 proof를 거절한다. 이전 v1 proof를 v2에 재사용할 수 없다.

**hash나 reviewed 플래그 자체가 검토/사용자 동의의 증거는 아니다.** 검토 대상 소스·정리 경로·기간/최대 지연·로그/백업·미해결 사항을 담은 실제 artifact, 독립 검토, 승인 범위를 먼저 확정해야 한다. 현재 artifact는 미연결 후보의 로컬 검토일 뿐 실제 API 경계 승인란에 넣을 자료가 아니다.

사용자 UI에는 결정된 기간·정리 지연·계정 삭제 의미·전역 소모 표시 보존·취소 불확실성을 이해하기 쉽게 고지해야 한다. UI 동의 버전, API가 내보내는 버전, 서버/DB 정책 hash를 한 계약으로 연결하고 실제 브라우저에서 재동의 경계를 검증하기 전에는 이 v2를 연결하지 않는다. 현재의 '삭제 미확인' 안내를 완료 문구로 바꾸지 않았다.

## 실제 연결 전에 남은 일 — 현재 실행하지 않음

- 기간·삭제 실행자/주기/최대 지연·실패 감지·계정 hard-delete·로그/백업 정책을 구체화하고 독립 검토한다. scheduler는 이번 파일에 설치하지 않는다.
- 현재 v1 소모를 보존하는 **별도 in-place 이관 설계**가 필요하다. v1/v2를 둘 다 미소모 상태로 열면 두 번 호출될 수 있다. 기존 OFF 확인, 미종료 요청 확인, 원래 소모의 보수적 유지, 단일 권한 경로, 반영/되돌리기 테스트를 먼저 한다. 이전 행 삭제→새 false 행 생성은 금지한다.
- backup rollback은 전역 boolean까지 과거로 되돌릴 수 있다. 복구 시 서비스 OFF, 소모 여부 불명확하면 consumed=true 유지, 소모 증거 보존/대조 없이 재개방하지 않는 운영 절차가 필요하다. 이 후보만으로 DB 관리자나 PITR에 대한 불변성을 보장하지 않는다.
- 스키마 노출·직접/상속 권한·API role·Vault/proof 접근·네트워크 경계를 실제 환경의 비밀 없는 메타로 검토하고 별도 승인된 제한 Preview에 exact source를 반영한다. 현재 Preview가 최신 QA라고 가정하지 않는다.
- 계정/리소스/무료 계층 연결, 전체 비용 경계, 실제 녹음 1회 전송 동의는 별도다. 키 재저장, 유료 전환, 무조건 0원, J6 전체 완료를 요구·선언하지 않는다. C4는 이 후보와 별개다.

## 공식 문서 확인

현재 함수 권한 문서는 definer의 권한 우회와 기본 EXECUTE를 경고하며 owner 검사·빈 search_path·명시적 권한 제한을 요구한다. [Supabase Database Functions](https://supabase.com/docs/guides/database/functions)

Auth hard-delete와 발급된 access token의 만료는 다른 경계다. 후보는 SQL에서 auth.users 존재를 확인하지만, 실제 세션 취소/삭제 전체 흐름 검증은 남는다. [Supabase User Management](https://supabase.com/docs/guides/auth/managing-user-data)

2026-10-29 changelog를 확인했다. 공용 스키마의 자동 노출 기본값 변경은 별도 custom schema의 권한 검토를 대신하지 않는다. [Data API 노출 변경](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically)
