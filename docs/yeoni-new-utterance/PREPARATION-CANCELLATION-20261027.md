# C4 저장 답변 음성 준비 취소 — 2026-10-27 UTC

기준: `3d0c914b7d9a736e213aecbd27cad6732a7119d0`. **기존 자료의 로컬 준비 UI 보완이며 새 발화·새 음성 생성·실제 정렬 품질·운영 활성화 또는 C4 전체 완료가 아니다.**

## 재현한 공백과 수정

`ReplyCharacterPanel`의 취소 버튼은 `waiting`에만 있었고, 실제 카탈로그 resolver나 파일 loader를 기다리는 `loading`에는 사라졌다. 비서용 `assistant` presentation은 `ready` 전의 버튼 영역 자체를 숨겨 취소할 수 없었다. 새 회귀를 수정 전 실행하면 취소 버튼이 없어서 실패한다.

- 검수용·비서용 모두 `waiting`/`loading` 동안 **취소**를 표시한다. 비서용에서는 아직 쓸 수 없는 재생 버튼을 같이 노출하지 않는다.
- 기존 `resetReply` → `ReplySession.reset` 경로를 그대로 사용한다. 현재 응답 ID를 dismissed로 기록하고 요청을 abort하며 player를 초기화한다. 별도 Controller·재생기·음성 시계·요청 정책을 만들지 않는다.
- 취소 후 늦은 resolver/loader 결과, 같은 ID의 복제 props, resolver 교체로 기존 응답을 복구하지 않는다. 같은 저장 문장도 새 응답 ID로 도착해야 다시 준비하며 자동 재생하지 않는다.
- 취소는 이 **로컬 캐릭터 답변 세션의 준비/미디어 소유권**을 해제한다. 상위 채팅의 `busy`, 이미 시작한 외부 AI/TTS 공급자 작업, 비용·서버 보관을 중단했다는 뜻이 아니다. 이 패치는 그런 외부 요청을 만들거나 취소하지 않는다.

## 최종 증거와 한계

- 수정 전: 패널 통합 검사 **4 통과 / 신규 1 실패**. 실패는 `loading` 중 취소 버튼 부재다.
- 수정 후: `node --experimental-strip-types --test lib/yeoni/*.test.ts tests/yeoni-reply-source-integration.test.ts` **77/77 통과**. 신규 두 검사는 검수용·비서용의 transport 대기, resolver 대기, 파일 loader 대기, 반복 취소 handler, 늦은 결과, 소스 교체와 새 응답 회복을 검사한다. 실제 TSX/세션 코드를 쓰지만 React hooks와 미디어를 모의하므로 DOM·실제 디코더 검증은 아니다.
- 전체 단위 검사 `--test-concurrency=1`: **1,407/1,407 통과**, 실패/취소/건너뜀 0. 전체 프로젝트 `tsc --noEmit --incremental false`와 전체 ESLint도 통과했다. Next 프로덕션 빌드는 이번 개별 후보에서 실행하지 않았으며 최종 통합 후보 검사는 부모 게시 작업의 범위다.
- 변경 4파일 ESLint `--max-warnings 0`, `git diff --check`, 기존 독립 component-site 번들 빌드 통과.
- 독립 읽기 전용 검토: 범위 내 차단 결함 없음. 검토자가 관련 검사 **27/27**을 별도 실행했다. 77개와 중복되는 수치이며 합산하지 않는다.
- 기존 `browser-verification.yml`의 component lane에 검수용/비서용 두 시나리오를 추가했다. Chromium/WebKit 각각 실행하므로 **신규 4개**다. Playwright `--list`에서 네 항목의 발견만 확인했다. 클릭/키보드 Enter, 44px 버튼, 가로 넘침, 취소·늦은 결과·소스 교체·새 응답·새로고침을 검사하도록 작성했다.
- **신규 브라우저 4개는 이 로컬 작업에서 미실행**이다. 부모 작업이 확인한 로컬 Chromium sandbox 실행 차단을 반복하거나 우회하지 않았다. 실제 실행은 검사용 브랜치의 기존 격리 CI에서 최종 합친 후보로 확인해야 한다. discovery/번들 통과는 브라우저 통과가 아니다.

새 공급자 호출·녹음·오디오/음소 자료·계정/DB/보안 설정 변경은 없다. 기존 정렬·음성·외형·Controller는 변경하지 않았다. 실제 새 발화의 음성/측정 정렬 확보 및 자연스러움 검토, 실제 인증 흐름·물리 기기 검증은 여전히 별도다.
