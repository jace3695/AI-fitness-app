# J6 Azure v1 점수 범위 검증 — 2026-10-28 UTC

기준: `7cd53ee5c4ec4429dee25cdfb2b2b8f6fdaab31d`, tree `c71d2f29faf83202805c80d8c35ea0f5ce017e99`. **고정된 클라이언트 응답 계약의 로컬 검증이며 실제 공급자 평가·점수 품질·운영 활성화 증거가 아니다.**

## 재현한 공백

`lib/azure-pronunciation-server.ts`의 현재 Azure v1 endpoint는 accuracy/fluency를 모두 `min: 0`, `max: 100`으로 반환하고 값도 0~100만 수용한다. 그러나 browser client는 다른 공급자에도 쓰는 일반 `validateAssessmentResult`만 통과하면 임의의 min/max를 받아들였다. 따라서 `value: -10, min: -100, max: 100`, 0~1, 0~1000 등의 응답을 해당 고정 공급자의 정상 결과처럼 반환했다.

회귀를 수정 전 실행하면 기대한 거절이 없어 **7 통과/신규 1 실패**였다. 이 증거는 잘못된 합성 응답을 주입한 결과이며 실제 Azure가 그런 응답을 보냈다는 뜻은 아니다.

## 최소 변경

- `AssessmentBrowserClient`에서 기존 ID/공급자/언어/metric 유효성 검사를 통과한 결과에도 두 metric 모두 정확한 `min === 0 && max === 100`을 요구한다.
- 잘못된 범위를 재정규화·반올림·보정해 정상 점수로 만들지 않고 기존 오류 경로로 거절한다. 기존 검증이 값의 유한성·범위·중복 metric을 계속 담당한다.
- 일반 validator/adapter의 다른 범위 지원은 변경하지 않았다. 서버 응답, provider 호출, request-ID 중복 방지, readiness/동의/타임아웃, 1회 시험 원장·비용·permission 정책도 변경하지 않았다.

## 검증

- 신규 2개 테스트: accuracy/fluency 각각 잘못된 범위 4종(총 8 variant) 거절 및 같은 requestId 자동 재전송 없음; 정상 0/100 경계값을 그대로 보존.
- 관련 focused 검사 **69/69 통과**, 변경 2파일 ESLint `--max-warnings 0`, `git diff --check` 통과.
- 전체 프로젝트 `tsc --noEmit --incremental false`도 통과했다.
- 독립 읽기 전용 검토: 현재 서버의 0~100 계약과 변경 한정을 확인하고 관련 **38/38** 재실행 통과, 추가 숫자 경계 20건 거절과 정상 소수 81.25 보존 확인. focused 수치와 중복되며 합산하지 않는다.
- 이 별도 후보는 전체 단위/Next 빌드/실제 브라우저·마이크·실서버/계정·DB·기기 검증을 수행하지 않았다. 다른 J6 UI 후보와 합칠 경우 최종 통합본의 전체 검사를 다시 실행해야 한다.

기존 체크인된 합성 입력/모의 HTTP만 사용했다. 실제 사용자 음성, 비밀정보, 새 음성 API, 보관 정책 변경 또는 운영 배포는 사용하지 않았다.
