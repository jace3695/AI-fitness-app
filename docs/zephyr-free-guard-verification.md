# Zephyr 무료 문자수 안전장치 — 2026-09-15

실행 순서 **3번의 서버 안전장치 준비**다. 음성 재연결 전체 완료가 아니다. 실제 음성 활성화·가계부/빠른 명령 재생 연결·iPhone 확인은 결제 검증 후 진행한다. `FREE_MODE=true`는 그대로다.

## 확인한 Google 자료와 남은 조건

- 사용자가 제공한 이번 달 보고서: 두 프로젝트·세 서비스·14개 SKU 범위 확인. 기존 Gemini 합계 112원, Standard TTS 5문자/0원. Chirp3-HD에는 아직 사용량 행이 없었다.
- 사용자는 `Chirp 3: HD Voices`의 Zephyr로 고정 문장 61자의 생성 완료를 알렸다. 이 작업자가 Google에 새 음성을 생성한 것은 아니다.
- 최신 Chirp3 SKU 단독 화면은 9월 1~13일 기준, “표시할 결과가 없습니다”, 0원이다. **방금 생성한 음성의 사용량·과금 검증은 반영 대기**다. 표시되지 않은 사용량을 실제 0문자나 테스트 비용 0원으로 확정하지 않는다.
- 공식 [TTS 요금표](https://cloud.google.com/text-to-speech/pricing)의 Chirp3-HD 무료 한도는 월 100만 문자, 초과 단가는 100만 문자당 USD 30이다. 결제 연결이 필요하고 초과분은 자동 과금된다.
- [결제 보고서](https://docs.cloud.google.com/billing/docs/how-to/reports)의 집계 지연을 고려한다. 보고서에 Chirp3 사용량과 비용이 실제로 나타난 뒤 대조한다. 추가 생성은 필요하지 않다.

## 구현한 제한

| 항목 | 동작 |
|---|---|
| 기본 차단 | 서버의 `GOOGLE_TTS_FREE_ENABLED=true`와 해당 월의 DB 승인 모두 필요. 기존 유료 키·과거 1만 원 예산으로 켜지지 않는다 |
| 공용 한도 | `zephyr_free_months` 월별 한 행을 모든 사용자·Preview/운영 배포·키 교체가 함께 사용. 앱 상한 최대 10만 문자 |
| 외부 사용분 | 같은 결제 계정의 기존 사용량과 앞으로 다른 프로젝트가 쓸 여유분을 별도로 승인. 두 수치+앱 한도는 90만 이하로 제한해 최소 10만 문자를 남긴다 |
| 월별 승인 | 프로젝트·결제 계정·키 SHA-256·검증 시각·만료 시각 필수. 청구 보고서의 Pacific 시간 경계에 맞춤. 다음 달 자동 갱신 없음. 만료 2분 전부터 차단 |
| 사전 집계 | PostgreSQL 행 잠금 안에서 문자 수 확인, 요청 영수증 저장, 공용 잔액 차감이 함께 완료된 뒤 Google 호출 |
| 중복·오류 | 요청 UUID 재사용은 사용자·월에 관계없이 새 호출 불가. DB 응답 유실·Google 오류·시간 초과에도 차감 취소 없음. 공급자 자동 재시도 없음 |
| 추가 제한 | 1회 1,200 Unicode 문자, 사용자별 하루 5,000문자, 같은 사용자 요청 간 5초. 예약 후 10초 내에만 전송 시작 허용 |
| 계정 삭제 | 사용자 참조만 지우고 영수증·공용 차감은 유지해 삭제/재가입으로 한도가 복구되지 않음 |
| 인증·저장 | 서버와 Edge에서 `getUser()` 확인. Edge가 실제 로그인 사용자와 본문으로 문자 수를 결정. 브라우저는 설정·원장·RPC에 직접 접근 불가. 본문 원문 대신 해시 저장 |
| 공급자 | `ko-KR-Chirp3-HD-Zephyr`와 MP3 고정. Google 한 번 호출, 30초 타임아웃, 리다이렉트 금지. 키는 URL 대신 헤더. 다른 목소리/유료 AI 대체 없음 |
| 상태 조회 | 인증된 `GET /api/tts`에 예약 수·한도 제공, 캐시 금지. 확인 불가 상태를 0원/0문자로 표시하지 않음 |

이 제한이 Google 결제 계정 전체의 실시간 사용량을 자동 조회하거나 다른 앱의 호출을 차단하는 것은 아니다. 다른 프로젝트의 사용 여유분을 통제할 수 없으면 승인하지 않고 꺼 둔다. 무료 범위와 실제 청구 내역은 구분한다.

## 활성화 전 확인할 것

1. 사용자가 이미 생성한 테스트의 Chirp3 SKU `F977-2280-6F1B` 사용량·비용 반영 확인.
2. 앱의 기존 `GOOGLE_TTS_API_KEY`가 확인한 프로젝트/결제 계정에 속하는지 검증. 키 원문을 대화에 보내지 않는다.
3. 같은 결제 계정의 다른 사용량·앞으로의 사용 여유분을 확정하고, 관리자만 월별 승인값을 기록. 빈 설정이나 누락된 값은 차단한다.
4. Preview 전용 활성화 설정 및 본문별 요청 UUID/재생 캐시를 쓰는 화면 연결, 짧은 실제 재생 검증. 아직 진행하지 않았다.
5. 실제 iPhone 확인을 마지막에 수행. PR #189는 Draft로 유지하고 운영 병합은 그 뒤에 결정한다.

## 검증

- 로컬 통합 검사 17/17 통과: 새 안전장치 13개 + 기존 유료 차단 4개. Route → Edge 핸들러 → 실제 PGlite SQL은 연결하고 Google 응답만 합성했다. 정상 응답, 유실, 실패, 권한, Unicode, 한도, 만료, 계정 삭제를 확인했다.
- 로컬 전체 단위/DB 325개·lint·TypeScript 검사 통과.
- 실제 PostgreSQL의 서로 다른 두 세션 동시 요청·12회 중복 재시도 검사를 격리 CI에 추가했다. 이 검사는 서비스 키를 브라우저에 주지 않으며 실제 Google 호출도 하지 않는다.
- 호스팅 적용 내역은 아래에 기록했다. 수정 후 최종 CI 실행·검사 수·정리 결과는 [PR #189의 최신 검증](https://github.com/jace3695/AI-fitness-app/pull/189) 상단에서 확인한다.

## 호스팅 적용

- 기능 커밋 `7d11a84b04672d53985ac9b87eb30ba87db4f9a2`, Preview `dpl_7SHotvGpDSXKEmykzTwUWYVS1ANP` READY, target Preview. 운영 병합 없음.
- Supabase에 새 테이블 두 개와 service-role 전용 invoker RPC 두 개 적용. Edge `zephyr-budget` v1 ACTIVE, JWT 확인 켜짐.
- 마이그레이션은 CLI로 생성한 뒤 호스팅 적용 이력에서 확인한 버전 `20260915011629`에 파일명·테스트 참조를 맞췄다. SQL 본문은 검증한 내용과 동일하다.
- 기존 데이터 12개 테이블의 행 수·전체 행 내용 해시가 적용 전후 모두 일치. 기존 지출 36건과 기존 AI 사용 이력 13건 보존.
- 새 승인 월 0개·예약 0개, `CONFIRMATION_REQUIRED`. 일반 사용자 읽기·수정 및 RPC 실행 불가, service role도 예약 삭제 불가 확인. 이 0은 새 앱 예약 원장 수이며 Google 테스트 사용량을 뜻하지 않는다.
- 보안 점검의 [RLS 정책 없음](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) INFO 두 건은 일반 사용자의 직접 접근을 모두 막은 의도한 설정이다. 기존 [유출 비밀번호 보호](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) WARN은 이번 변경과 별개이며 설정을 바꾸지 않았다.
- 성능 점검: 새 원장에 대한 [월 외래키 인덱스 없음](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys) INFO는 월 승인 삭제·월 키 변경을 앱에서 지원하지 않아 현재 요청 경로에 영향이 없다. [미사용 인덱스](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index)는 아직 실제 음성을 켜지 않아 생긴 INFO다. 사용자별 일일 한도 조회에 필요한 인덱스는 유지한다.

## 첫 CI와 수정

[첫 실행](https://github.com/jace3695/AI-fitness-app/actions/runs/34916575409)은 단위/DB 325개·VM 25개·lint·타입·빌드, 브라우저 61/62가 통과했다. WebKit의 새 검사에서 모든 제한/인증 확인 뒤 화면을 닫는 순간 `route.fulfill: Fetch response has been disposed`가 발생했다. 기존 `free-advice` 브라우저 검사가 담당하는 빠른 명령 화면의 중복 실행을 제거하고, 새 검사를 인증된 HTTP·실제 DB 동시 요청 경계에 한정했다. 기존 화면 검사는 그대로 유지한다. 수정 후 결과로 완료 여부를 판단한다.
