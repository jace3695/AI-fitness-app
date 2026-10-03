# PHASE 10 — 두 외형의 공통 제어 통합

2026-10-01 20:51 KST 사용자의 다음 단계 요청에 따라 공통 제어 통합·중복 제거·계약 회귀 검증을 진행했다. 기준 커밋은 `e2738c7969a8f938ac91fd6d66fcebb72ff20c89`이다. [PHASE 9](../yeoni-phase9/README.md)의 0초 로딩 수정은 그대로 유지한다.

## 구현한 내용

- `useCharacterStage`로 고양이·인간형 React 초기화, 최신 음성 입력 전달, 활성 상태, 해제 처리를 통합했다. 외형별 그림·좌표·대체 이미지는 기존 렌더러와 컴포넌트에 남긴다.
- 양 렌더러가 같은 `CharacterStageOptions` 및 외부 Controller 주입 계약을 받는다. 인간형에서 주입한 Controller가 누락되는 차이를 없앴다.
- 화면 갱신으로 음성 콜백/동작 객체가 다시 만들어져도 렌더러를 재생성하거나 같은 몸짓을 재시작하지 않는다. 몸짓은 `id`와 `kind` 변화로 구분한다.
- 렌더러 생성 예외를 공통 오류 상태로 처리하고, 오류·해제 후 늦은 준비 완료 콜백이 Stage를 되살리지 않게 했다. 해제 후 명령은 Controller를 바꾸지 않으며 반복 해제는 한 번만 처리한다.
- [독립 미리보기](Yeoni_Shared_Control_Preview.html)에 기존 음성 하나로 두 외형을 나란히 확인하는 화면을 추가했다. 두 가시 Stage 각각의 루프 하나를 검사하는 화면이며, 외형 전환 기능은 PHASE 11이다.

음성·원본 그림·표정 파츠·변형 계산·음소 매핑·CSS 크기는 바꾸지 않았다. 변경된 공통 코드가 포함되도록 PHASE 5·6·8·9 독립 HTML의 코드만 다시 내보냈다. 해당 내장 이미지/음성/CSS는 이전 버전과 동일하며 기존 영상·검증 JSON은 보존했다.

## 검증 결과

| 항목 | Chromium 153.0.8010.12 | WebKit 26.6 |
| --- | --- | --- |
| 신규 통합 검사 | 14/14 | 14/14 |
| 영향받는 기존 HTML 진입점 | PHASE 5·6·8·9, 4/4 | PHASE 5·6·8·9, 4/4 |
| 저장 MP3의 두 외형 재생 표본 | 326 | 149 |
| 각 렌더 시각의 입 모양 불일치 | 0 | 0 |
| 반복 진입·해제 | 10회, 해제 후 Stage 관찰자/루프 0 | 10회, 해제 후 Stage 관찰자/루프 0 |
| 런타임 예외·외부 요청 | 0 / 0 | 0 / 0 |

브라우저 검사 총 **36개**, 전체 코드 검사 **696/696**, lint·타입 검사·Next.js 빌드 통과. 같은 Controller의 불변 프레임을 양 실제 Canvas 어댑터가 변경 없이 받았고, 각 외형에서 여섯 필수 입 모양이 다른 픽셀 출력을 만든다. 해제 후 그리기 요청은 빈 캔버스를 되살리지 않는다. 이 계약 검사는 무음 시계 표본이고, 별도의 실제 MP3 자연 재생 결과와 구분한다.

StrictMode 반복 초기화, 재렌더링, 입력·모달·화면 밖·동작 줄이기·합성 숨김 이벤트, 외형별 이미지 오류와 복구, 생성 예외와 늦은 콜백을 검사했다. 최초 자원 계수는 검사 도구가 만든 관찰자를 포함해 실패했으며, 공통 Stage 생성 스택에서 만든 관찰자만 계수하도록 범위를 고친 뒤 최종 양 브라우저 실행을 통과했다. 누수 기준을 완화하지 않았다.

320·390·1280px 가로 넘침 검사를 통과했다. 두 브라우저의 390·1280px 전체 화면 캡처를 검토했으며 글자·버튼 겹침은 없었다. 브라우저별 축소 질감·기본 오디오 컨트롤 차이는 있으며 물리 기기의 성능 보증으로 해석하지 않는다.

[최종 검증 JSON](evidence/verification.json) · [Chromium 결과](evidence/chromium/results.json) · [WebKit 결과](evidence/webkit/results.json) · [복구 체크포인트](CHECKPOINT.md)

## 재현

```sh
node scripts/yeoni-control/export.mjs
YEONI_BROWSER=chromium node scripts/yeoni-control/check.mjs
YEONI_BROWSER=webkit node scripts/yeoni-control/check.mjs
YEONI_BROWSER=chromium node scripts/yeoni-control/check-legacy.mjs
YEONI_BROWSER=webkit node scripts/yeoni-control/check-legacy.mjs
```

준비된 사용자 영역 실행 파일은 `YEONI_CHROMIUM`, `YEONI_WEBKIT`으로 지정한다. 이전 단계에서 마련한 동일 환경을 재사용했으며 시스템 설치를 다시 시도하지 않았다. 세부 의존성은 [PHASE 9 환경 기록](../yeoni-phase9/evidence/environment.json)을 따른다. 기존 61개 원본 비교·영상 검사 및 완료된 영상 생성은 다시 실행하지 않았다.

## 진척도와 다음 단계

기술 PoC **9/16(1~4·6~10)**. PHASE 9 음성 연결과 PHASE 10 제어 통합의 기술 검증을 완료로 집계한다. PHASE 5 사용자 청취·정렬 경계·자연스러움은 여전히 보류다. 물리 iPhone·잠금·Bluetooth·발열·배터리도 별도 검증이다.

다음 PHASE 11은 **발화 도중 고양이↔인간형을 바꿔도 같은 오디오·재생 위치·Controller 상태를 유지하는 기능**이다. 이번 나란히 보기 결과로 전환 연속성을 완료 처리하지 않는다. 새 TTS 요청이나 운영 화면 연결·병합·배포는 없으며 PR #207은 Draft를 유지한다. 완료된 영상/원본 검사를 자동 재생성하는 기존 CI는 `[skip ci]`로 실행하지 않고 이번 로컬 검증 결과를 보존한다.
