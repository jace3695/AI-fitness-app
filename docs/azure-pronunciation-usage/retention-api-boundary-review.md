> **1단계 기록(미연결 후보):** 아래 내용은 당시 범위를 보존한 역사 문서입니다. 이 2단계 overlay에서는 actual Next route와 동의 UI가 v2에 소스상 연결됐지만, 원격 배포·DB 적용·활성화는 하지 않았습니다. 최신 범위는 [2단계 연결 설계](retention-wiring-design.md)를 따릅니다.

# J6 v2 후보 — 소스 API 경계 검토표

작성: 2026-10-29. 판정: **로컬 후보 검토, 실제 API 경계 승인 아님.**
검토 대상 파일 해시는 별도 `SOURCE-IDENTITIES.json`/검증 영수증에 보존한다. 테스트와 설정의 검토 hash는 전부 합성 값이다.

| 경계 | 소스에서 확인/검사한 조치 | 남은 실제 확인 |
|---|---|---|
| 기존 앱 | 실제 Next route, v1 route/adapter/SQL, 브랜치·리소스·계정 gate 미변경 | v2 정책/동의/route를 실제로 연결하지 않음 |
| 호출자 | auth.uid + 지정 owner + auth.users 존재, hard-delete와 FK CASCADE | 실제 로그인 사용자/계정 삭제 UI/세션 폐기 |
| 증명 | v2 HMAC, action/owner/request/payload/정책 hash/30초 유효기간, 잠금 뒤 시간 재검사 | 실제 서버 증명 설정 scope/수명/회전; 키 값 조회 금지 |
| body | こんにちは。·5초 이하·PCM 형식은 기존 handler, adapter 리소스/지역 유지 | 실제 음원/제공자 응답 및 물리 기기 |
| 데이터 API | API에는 ready/consume/finish만 EXECUTE, 테이블·helper·purge 직접 권한 없음 | 실제 노출 schema 및 PostgREST 동작/로그/호스팅 경계 |
| privileged SQL | 고정 schema, 빈 search_path, 입력 recomputation, 명시 auth/owner 검사; definer는 원자적 private 원장용 | 실제 role 상속/default privileges/advisor 결과 |
| 원장 | global 2열과 사용자 receipt 분리, 정상 finish/계정 삭제/만료 후 재개방 없음 | 다중 PostgreSQL 세션·장애·이관/복구 시험 |
| 권한 이탈 | 설치 전 role/Vault 검사, 설치 후 모든 객체 grant 검사; inherited grant 실패 시 원자 rollback | 신규 환경 별 실제 role·노출 변경 승인 |
| 만료/삭제 | 만료 finish 거절, privileged purge는 정책 OFF에도 작동, owner 연결 해제 | scheduler·무트래픽 삭제·최대 지연·실패 알림 미구현/미검증 |
| 원음/결과 | 새 영구 저장 열 없음; 기존 응답/UI 메모리 유지 | 제공자/브라우저/로그/APM/백업 전체 비보관 보장 아님 |
| 활성화 | 기본 OFF/TTL null/marker consumed=true; 실제 env/DB를 바꾸는 코드 없음 | 어떤 값도 채워서 활성화하지 않음 |
| 통계 | 실제 소스 SQL과 합성 입력의 로컬 검사 | hosted DB·provider·CI·운영 검증 또는 J6 완료 아님 |

## 독립 검토에서 발견·보완

1. 잠금 대기 전에만 proof freshness를 검사하면 대기 중 만료된 proof가 통과할 수 있음 → HMAC 비교 반환과 consume의 marker 잠금 후 시각 재검사 추가. purge clock도 잠금 후 계산.
2. receipt 만료와 policy/key OFF를 동시에 설정한 테스트는 원인을 분리하지 못함 → ON 상태의 만료 거절을 먼저 확인한 뒤 OFF 상태 purge를 검증. 미만료 receipt 보존과 과거/미래 proof 거절도 확인.
3. 사용자 식별 필드 없는 global boolean을 완전 익명이라고 부르지 않음. policy owner도 receipt와 함께 해제. 실제 계정 hard-delete와 logout/soft-delete를 구분.

## 승인과 분리할 사항

이 문서는 `api_boundary_reviewed_at`, `deletion_path_reviewed_at`나 실제 정책 ID를 채우는 권한이 아니다. 값 존재 검사는 fail-closed를 위한 필요조건이며 실제 검토의 충분조건이 아니다. 실제 적용 전에는 exact 이관 SQL·소스·동의 문구·기간/삭제 지연·runner·로그/백업·복구·rollback·노출/role readback을 별도로 검토하고 승인 범위를 확정해야 한다.

원격 DB 마이그레이션, 정책/키 활성화, credential/env 조회, Preview 변경, provider 호출, 실제 사용자 자료 입력/전송은 이번 작업에서 모두 0이다. 기존 성공 QA와 이 미게시 후보를 분리해 보존한다.
