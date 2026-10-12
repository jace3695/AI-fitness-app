# 로컬 동기화 요청 제어와 메타데이터 진단

실제 앱·브라우저·일회용 인증 서버 검증은 [격리 E2E 절차](../../tests/e2e/README.md)를 따른다. 이 도구는 별도의 개발용 요청 제어기이며, 자동 단위 테스트나 수집 성공을 실제 브라우저·인증·RLS·저장 내용 검증으로 보고하지 않는다. 승인된 테스트 환경과 합성 데이터만 사용한다. 브라우저 접근 거부나 계정·배포 제한을 우회하지 않는다.

## 실행과 범위

Node 22.6 이상과 기존 의존성이 있는 저장소에서 다음 실행기는 전체 Next 개발 앱을 loopback 주소로 연다. 기본 구성은 공개 Supabase 설정을 사용할 수 있으므로, 실행 전에 대상 서버가 승인된 테스트 환경인지 확인한다. 개인·호스팅 계정 사용을 이 문서가 승인하지 않는다.

```sh
node --experimental-strip-types scripts/sync-qa/start.mjs 3000
```

- A: `http://127.0.0.1:3000/?qa-sync=1`
- B: `http://localhost:3000/?qa-sync=1`

`development`, loopback 브라우저 hostname, 명시적 `qa-sync=1`이 모두 필요하다. 탭의 opt-in은 sessionStorage에서 유지한다. 운영·미리보기·production build에서는 비활성화되며 인증이나 RLS를 변경하지 않는다.

수집·제어 대상은 설정된 Supabase origin의 다음 요청뿐이다.

- `/rest/v1/user_app_state`: GET, 기존 PATCH, 기존 INSERT POST
- `/rest/v1/rpc/save_cloud_state_if_unchanged`: POST만

다른 RPC·테이블·인증 경로·origin과 RPC의 다른 HTTP 메서드는 그대로 통과하며 제어를 소비하지 않는다. `language_user_state`의 기존 PATCH는 대상이 아니다.

## 수집되는 정보와 검증 한계

새 캡처는 기존 `yeoni-sync-qa-v1` 컨테이너를 유지하고 `bodyPolicy: "metadata-only"`를 추가한다. 요청 번호, 고정 작업 이름, 메서드, 처리 시각, HTTP 상태, 행·상태 키 개수, 조건 종류와 응답의 boolean 결과만 보관한다. `snapshot()`·화면·JSON·로컬 파일에 기록 본문, 키 이름, 메모, 소유자, 조건 시각 값, 요청 URL/query, 헤더, 인증 토큰, 값 해시를 남기지 않는다. 실제 요청·응답은 변경하지 않고 파싱한 값에서 메타데이터만 추출한다. 서버 오류 본문도 수집하지 않는다.

RPC의 `owner-content-version`은 요청에 소유자·기대 JSON 객체·기대 시각이 함께 있다는 뜻이다. `owner-absent`는 기대 상태와 시각이 모두 명시적 null이라는 뜻이다. 이 형태 정보는 올바른 소유자나 원본 내용에 대한 증명이 아니다. 실제 RPC boolean false는 조건부 쓰기 거절로 분리한다.

**키 개수가 같아도 저장 내용이 같다는 뜻이 아니다.** 원본·확인 GET의 전체 내용 비교는 실제 E2E의 메모리 내 assertions에서 별도로 수행한다. 새 메타데이터 감사는 확인 GET이 있어도 `confirmation-unverified`와 `stateComparisonAvailable: false`를 반환하며 저장 보존 통과를 주장하지 않는다.

기존 비공개 v1 캡처의 원본 JSON 객체는 감사 도구에서 계속 비교할 수 있다. 누락·문자열 redaction은 같더라도 `confirmation-matches`로 처리하지 않는다. 과거 본문 포함 파일은 새 도구가 자동으로 정리하거나 재작성하지 않는다.

## 요청 시점 제어

패널에서 현재 공유 동기화 쓰기는 **POST · 조건부 동기화**를 선택한다. GET은 서버 조회, PATCH는 이전 방식의 직접 수정 진단용이다. 선택한 메서드의 다음 일치 요청에 적용되므로 실제 요청 번호와 작업 이름을 확인한다. 기존 직접 INSERT도 POST이며 작업 이름으로 구분한다.

- 전송 전 보류: 서버에 보내지 않고 기다린다. 해제한 뒤 원래 요청을 전송한다.
- 서버 응답 후 전달 보류: 서버 응답을 받은 뒤 SDK 전달 전에 기다린다. 저장은 이미 반영되었을 수 있다.
- 서버 응답 후 전달 실패 모사: 실제 응답 메타데이터를 남기고 SDK에 오류를 돌려준다. TCP 단절이나 쓰기 롤백을 뜻하지 않는다.
- GET 오류 모사: 해제할 때까지 GET과 SDK 재시도에 합성 503을 반환한다. 실제 서버 장애 증거가 아니다.

보류는 120초 후 자동 전송하지 않고 오류로 끝난다. AbortSignal은 보류와 후속 응답 전달을 취소하지만 이미 반영된 서버 쓰기를 되돌리지 않는다. 제어 해제 후 처리 중 요청 0건에서 수집 내용을 비우거나 종료한다. 새로고침하면 메모리 내 수집은 사라진다.

## 내보내기와 감사

JSON 다운로드 또는 같은 개발 서버로 **비공개 증거 로컬 파일 보관**을 사용한다. 로컬 파일 API는 개발 모드·loopback·동일 origin·전용 헤더를 검사하고 Git 제외 디렉터리에 새 파일을 만든다. 새 캡처는 메타데이터만 포함하지만 과거 파일은 본문을 포함할 수 있으므로 공개하지 않는다.

```sh
node scripts/sync-qa/audit.mjs scripts/sync-qa/private/session-a.json
```

감사는 요청 번호·상태·결과만 출력한다. `completeCapture`는 수집 한도·진행 중 요청·보류·캡처 오류만 나타낸다. `true`나 CLI 종료 코드 0은 상태 동일성, 사용자 의도, UI, 원본 보존, 인증, 정리 완료를 뜻하지 않는다. 반영된 쓰기의 응답 유실은 `response-not-delivered`, boolean false/기존 빈 PATCH 결과는 `cas-rejected`, 확인 GET 부재는 `confirmation-missing`으로 표시한다.

## 자동 검사와 별도 검증

```sh
node --experimental-strip-types --test lib/syncQaTrace.test.ts
```

검사는 실제 Supabase SDK와 합성 loopback HTTP 서버로 정확한 RPC payload·boolean 응답, 이전 PATCH, 내용만 바뀐 stale CAS, 부재 조건, 전송 전/후 취소, 응답 유실·GET 재시도, 비대상 경로, 비밀·본문 미수집 및 감사의 fail-closed 처리를 확인한다. 실제 Supabase Auth/Postgres/RLS나 브라우저 실행은 아니다. 실제 앱 저장 후 원본·다른 기기 readback·작은 화면·재로딩과 물리 iPhone/PWA 수명은 별도 승인된 환경에서 검증한다.
