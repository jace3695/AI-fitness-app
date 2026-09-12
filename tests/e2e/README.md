# 장소에 제한 없는 브라우저 검증

PR의 **Checks → Isolated browser verification → Details**에서 실행·결과를 확인한다. GitHub가 제공하는 일회용 Ubuntu에서 앱, 브라우저, Supabase를 함께 실행하므로 개인 PC나 데스크톱 앱을 켜 둘 필요가 없다. PR에 커밋이 추가되면 자동 실행된다. 실행 후 GitHub 웹의 **Re-run jobs**로 재검증할 수 있다. 처음 추가한 workflow의 `workflow_dispatch` 버튼은 기본 브랜치에 workflow가 있어야 표시되므로, 버튼을 만들기 위해 운영 병합하지 않는다.

## 환경과 경계

- `npm ci`에 고정된 Playwright·Supabase CLI, Chromium/WebKit, 실제 `next build`/`next start`를 사용한다. 실제 React 화면에서 이메일/비밀번호 로그인과 식단 저장·수정을 수행한다.
- `.e2e/stack`의 **새로운 임시 Supabase Auth/PostgREST/Postgres**만 사용한다. `schema.sql`은 앱 상태 동기화/RLS, 가계부 삭제·복원, AI 연이 브리핑 조회에 필요한 최소 계약의 fixture다. 운영 스키마 전체 복제나 운영 마이그레이션 적용 검증이 아니다.
- 운영 계정, 운영 DB, 개인 백업, GitHub Secrets, Supabase 로그인/프로젝트 연결이 필요 없다. 실행 전 URL을 검사하고 브라우저의 외부 origin 요청을 차단한다. Next 빌드도 격리 URL과 공개 키가 없으면 실패한다.
- 매 테스트마다 임시 사용자를 만들고 실제 Auth 로그인과 소유자 RLS로 합성 17개 원본 키를 넣는다. 테스트 후 브라우저를 닫고 사용자를 삭제하며 연쇄 삭제된 DB 행 부재를 확인한다. 실패해도 정리하고 마지막 단계에서 해당 stack의 컨테이너·볼륨·키 파일을 제거한다.
- 기존 단위 검사와 25개 VM 회귀를 먼저 실행한다. 그 통과와 브라우저 검증 통과는 따로 표시한다. 재시도로 실패를 숨기지 않는다(`retries: 0`).

## 검증 내용

로그인·로그아웃·재로그인, 이전 버전 잔여 기준값, 늦은 GET과 로그아웃, 다른 사용자 RLS, 최초 GET 지연 중 실제 폼 저장, 독립 브라우저 두 세션의 양방향 CAS 충돌, PATCH 응답 보류 중 추가 저장·페이지 이탈, 반영 후 응답 유실, 저장 확인 GET 오류/SDK 재시도·복구, 삭제 후 재등장 방지를 검사한다. 상태 코드 외에 **PATCH 본문 전체와 이후 실제 GET 본문을 메모리에서 비교**한다. 17개 원본의 기존 값·날짜·내부 백업 시각은 별도로 비교한다.

320px/390px 식단 전체 화면의 입력·스크롤·저장·설정·새로고침을 Chromium과 WebKit에서 검사한다. 기존 주요 8개 화면의 수동 통과를 전체 iPhone 통과로 확대하지 않는다.

Chromium의 업데이트 검사는 production 앱을 실행한 같은 origin에서 `public/sw.js`의 임시 주석을 바꿔 실제 worker 설치·대기·활성화와 작성 중 보류를 확인한 뒤 파일을 복원한다. 앱 배포나 Vercel preview 전환을 수행하지 않는다.

P1 검사는 실제 가계부 행의 지출·수입·저축 삭제와 즉시 복원 후 **삭제 전 서버 행 전체 대조**, 최근 3회 안전한 운동 기록에서 한 운동의 0.5kg 증가를 제안하고 준비 확인 뒤 한 요일에만 적용하는 흐름, AI 연이가 오늘 완료 상태를 읽어 언어 앱의 정확한 다음 학습 주소로 연결하는 흐름을 추가한다. 각 화면은 320px 또는 390px의 페이지 가로 넘침도 함께 검사한다.

실제 Vercel preview 전환은 고정 브랜치 alias에서 이전 worker가 현재 문서를 제어하는 것을 먼저 확인한 뒤, 캐시 세대가 다른 새 preview를 배포해 같은 alias에서 `waiting`·‘지금 갱신’·`controllerchange`·재로드를 차례로 관찰한다. Deployment Protection의 일회성 share 쿠키는 alias가 새 배포를 가리킬 때 다시 인증을 요구할 수 있으므로, 장기 세션은 해당 preview 접근 권한이 있는 Vercel 계정과 2단계 인증을 사용한다. 이를 위해 protection을 끄거나 production으로 승격하지 않는다. 보호 계층이 앱보다 먼저 로그인으로 이동시키면 배포 성공과 앱 업데이트 전환을 분리해 기록한다.

## 공개 증거와 남은 범위

Actions Summary와 7일 보관 `browser-verification-<SHA>` artifact에 판정, 메서드, 시각, HTTP 상태, CAS 사용 여부, 합성 요청 여부, 상태 본문 SHA-256·키 수, 계정 정리 결과만 올린다. 인증 헤더·JWT·비밀번호·storageState·HAR·trace 원문·개인 데이터는 업로드하지 않는다. 서버에 반영했지만 응답 전달을 끊은 경우와 실제 서버 응답을 구분한다.

운영 DB 시스템 카탈로그의 읽기 전용 조회로 `user_app_state` 컬럼·제약·RLS·grants가 fixture와 같음을 대조했다. 개인 행은 조회하지 않았다. 이 결과가 통과해도 **호스팅 Auth 설정과 실제 호스팅 세션 E2E, 개인 계정 데이터 보존 재확인, 실제 iPhone 화면 잠금/백그라운드 타이머, 전체 iPhone 화면, 실제 배포 업데이트**는 별도다. 이전 실계정 실패와 복원 결과는 검증 문서에 그대로 남긴다. PR Draft 유지, 운영 병합·배포 없음.
