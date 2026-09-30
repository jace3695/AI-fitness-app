# PHASE 7 — 인간형 A안 자산 제작

2026-09-30. **PHASE 7 외형 보완 중. 사용자 눈·입 조화 피드백으로 완료 판정을 재개방했다. 전체 5/16 완료(1~4·6), PHASE 5 사용자 청취 보류.**

## 결과물

**ChatGPT 안에서 기존 파일의 그림/버튼이 작동하지 않으면 [스크립트 없는 호환 미리보기](Yeoni_Human_A_Compatible_Preview.html)를 사용한다.** 대화에는 같은 내용의 전용 시각화로 표시한다.

- [독립 검수 미리보기](Yeoni_Human_A_Asset_Preview.html): 다운로드 후 열기. 눈 3종, 입 6종, 흰색/연보라/어두운 배경 선택. 음성·로그인·서버 요청 없음.
- [모델 시트](human-a-model-sheet.png): 전신 정면·사선·측면·뒷면, 6가지 표정 참고. 원본에 없던 하의/신발은 크림색 바지/연보라 플랫슈즈로 제안했다. 사용자 추가 확정으로 간주하지 않는다.
- [대기·설명 자세와 12감정 참고 시트](human-a-poses-expressions.png): 기본·미소·기쁨·뿌듯함·응원·걱정·놀람·생각·진지함·아쉬움·졸림·위로. 단일 참고 이미지이며 12종 애니메이션 구현을 뜻하지 않는다.
- [선택 원본](reference/human-a-selected.png): A안 SHA-256 `086109dd5bdfa452247020885209559d266438d4aae79715988f298802bcc984` 대조.
- [기존 몸통·머리 atlas](../../public/yeoni/human/poc-atlas-v1.png), [수정 눈·입](../../public/yeoni/human/face-parts-v2.png), [v2 합성 명세](../../public/yeoni/human/poc-atlas-v2.json). v1 자산·명세는 비교용으로 보존한다.
- [밝음/어두움 정지 합성](evidence/static-assembly.png): Node Canvas로 같은 source/destination 명세를 그린 이미지. 브라우저 캡처가 아니다.

## 범위와 품질

갈색 단발·보라색 눈·연보라 카디건·아이보리 상의·민트 네 갈래 별을 유지한다.
머리 바탕에는 눈/눈썹/입이 없고, 코·볼·머리카락이 포함된다. 몸통에는 목·의상·목걸이가 포함된다.
눈은 뜸/반감음/감음, 입은 닫힘/아/이/우/에/오를 각각 교체한다. v2의 보조 small 파츠는 아직 준비하지 않았다. 생성된 좌표가 요청 격자와 달라 실제 source rectangle을 측정했다.
초기 합성에서 목 아래 빈 부분과 인접 파츠 혼입을 발견해 이미지 편집과 source/destination 좌표 조정으로 보완했다.

이 자산은 2.5D PoC용이다. 전신 회전도·표정 시트는 외형 참고용이며 전신 리깅 완성본이 아니다.
머리카락은 머리에, 눈썹은 눈에 포함되어 있다. 손 2종은 참고 파츠로 확보했지만 팔에 연결하지 않았다.
작은 화면 합성용 얼굴 비율을 조정했으며 원본 A안과 완전히 동일한 픽셀 이미지가 아니다. 최종 외형 선호 확인은 사용자 검토로 남는다.

## 공통 Controller 연결 기준

명세 `controllerBinding`은 기존 `CharacterFrame.blink`와 `viseme` 의미 ID를 파츠에 대응한다.
`rest/closed`는 닫힘, `a/i/u/e/o`는 각기 다른 파츠다. v2의 보조 small 바인딩은 미정이며 Controller 연결 전에 보완한다. 새 음소 규칙·AI·TTS 로직을 만들지 않는다.
PHASE 8은 기존 `mountCharacterStage`와 `CharacterController`를 사용하는 인간형 렌더러를 구현한다.
PHASE 9는 기존 39자 MP3·60개 음소 시각을 재사용한다. 이번 정지 검수 화면은 Controller 연동이나 실제 인간형 립싱크 검증이 아니다.
피벗 값은 초기 합성 기준이다. 회전 제한과 목/머리 겹침 여유는 PHASE 8에서 실제 동작으로 검증한다.

## v1 검증 이력 (v2 외형 승인 근거가 아님)

- 원본 기준 해시와 PNG RGBA/실제 투명 채널 확인.
- 밝은/어두운 배경 정지 합성 검수. 표정 시트와 atlas 직접 시각 확인.
- 실제 브라우저 검증은 `scripts/yeoni-human-assets/check.mjs`로 Chromium/WebKit 각각 6개 항목을 실행한다.
- 로컬 브라우저 실행 파일이 없어 설치를 시도했으나 다운로드 파일이 올바른 ZIP이 아니어서 실패했다. 로컬 브라우저 통과로 보고하지 않는다.
- [최종 CI](https://github.com/jace3695/AI-fitness-app/actions/runs/36685972331): 코드 `7407f08e71170d2bba03923c2d0da72c333ef341`에서 단위 690개·린트·타입·빌드 통과. 신규 인간형 정지 자산 검사 Chromium/WebKit 각각 6개, 기존 캐릭터 각각 51개, 총 **114개 브라우저 검사 통과**.
- CI ZIP SHA-256 대조 후 [모바일 WebKit 화면](evidence/webkit/mobile-390.png), [어두운 배경](evidence/webkit/dark.png), [여섯 입 모양](evidence/chromium/mouth-comparison.png)을 직접 시각 검수했다. 런타임 오류·외부 요청 0.
- [검증 요약](evidence/verification.json), [Chromium 결과](evidence/chromium/results.json), [WebKit 결과](evidence/webkit/results.json). 이 당시 후속 커밋은 참고 그림·문서·증거만 추가했다. 아래 v2 수정은 별도 검증한다.
- 이 결과는 정지 자산 검수다. 실제 인간형 움직임/립싱크, 물리 iPhone, 전체 앱 인증/저장 흐름을 검증한 것으로 확대하지 않는다.
- 운영 앱·기록·DB·음성 API는 변경하지 않았다. 추가 TTS 요청 0회.

## 재현

```sh
node scripts/yeoni-human-assets/export.mjs
node scripts/yeoni-human-assets/check.mjs
YEONI_BROWSER=webkit node scripts/yeoni-human-assets/check.mjs
```

미리보기는 원본/모델시트/atlas를 내장한다. 렌더러는 source rectangle으로 읽으며 파츠 이미지를 수동 픽셀 편집하지 않았다.
제작 방식과 프롬프트는 [제작 기록](generation.md)에 보관한다.

v1의 `assembly`, v2 파츠의 `destinationRect` 및 `pivotsNormalized`는 전체 디자인 좌표계(760×1150) 기준이다.
`parent`는 향후 변환 계층 관계이며, 현재 값이 이미 부모의 로컬 좌표로 변환되어 있다는 뜻은 아니다.
눈/입은 머리 변환을 상속하고 몸통/머리 pivot의 실제 회전·이동 범위는 PHASE 8에서 검증한다.

## 다음 단계

먼저 v2 눈·입의 외형 조화를 사용자에게 검토받는다. 이후 PHASE 8: 같은 Controller를 사용하는 인간형 기본 애니메이션 PoC. 깜빡임·숨쉬기·고개 움직임과 정지/숨김/동작 줄이기를 검증한다. PHASE 9에서 기존 음성에 연결한다.

## 9월 30일 미리보기 호환 수정

사용자는 파일은 열리지만 그림/버튼이 작동하지 않는다고 보고했고, 사용 환경을 ChatGPT 내부 미리보기로 확인했다.
기존 파일은 Canvas/JavaScript가 초기화되어야 캐릭터와 버튼이 동작하는 구조였다. JavaScript를 끈 Chromium/WebKit에서 기존 파일의 초기화 누락을 재현했다. 사용자 ChatGPT 내부 실행 정책을 직접 진단한 결과는 아니므로 플랫폼의 원인을 확정하지 않는다.

호환본은 native radio와 CSS 파츠 합성을 사용하며 script/canvas/API 요청이 없다. 초기 그림은 스크립트 실행 전제가 없고, 같은 atlas를 WebP로 압축하여 약 300KB에 내장했다. 기존 Canvas 개발 검수본은 유지한다. 대화 표시용 fragment와 다운로드용 독립 문서는 같은 소스에서 생성한다.

검증 코드 `be2d87d0c02bafe09c3e0401fdacf8d0007b646b`, [CI compatibility job](https://github.com/jace3695/AI-fitness-app/actions/runs/36704348851/job/109850943037).
JavaScript 비활성화 Chromium/WebKit 각각 6개, **총 12개 통과**. 여섯 입 모양 픽셀 차이, 눈 선택/배경/새로고침, 320/390px, scripts 허용이 없는 sandbox iframe을 포함한다.
[결과 요약](evidence/compatibility/verification.json), [Chromium](evidence/compatibility/chromium/results.json), [WebKit](evidence/compatibility/webkit/results.json).
스크린샷과 ZIP 해시를 대조했다. 당시 사용자 ChatGPT 화면에서의 최종 동작은 확인 전이었다. 이후 사용자는 그림을 확인하고 눈·입의 조화가 부족하다고 지적했다. 기존 6/16 보고는 철회하며 5/16 완료, PHASE 7 보완 중으로 정정한다.


## 9월 30일 눈·입 조화 보완 — v2

사용자 피드백: “눈과 입이 그림과 조화롭지 못한 것 같다.” 원본 A안과 비교했을 때 v1의 둥글고 진한 눈·굵은 윤곽, 두껍고 광택이 강한 입술이 주요 차이였다. 기능 테스트와 외형 승인 기준을 분리한다.

- 원본 A안을 기준으로 눈·입을 다시 생성했다. 눈매·눈썹의 질감, 낮은 채도의 입술과 부드러운 피부 경계를 맞춘 수정 후보다.
- 기존 머리/몸통/헤어/의상/목걸이 PNG는 변경하지 않았다. 새 얼굴 파츠만 v2 파일로 추가했다.
- 눈의 실제 폭을 줄이고 위치를 맞췄다. 입은 각 crop의 중앙 대신 입 중심 랜드마크로 배치해 모양 전환 시 위치 차이를 줄였다.
- Canvas 검수본과 스크립트 없는 대화 검수본이 같은 v2 명세를 사용한다. 그림의 조화는 사용자의 최종 외형 검토가 남는다.
- [수정 전/후 정지 합성](evidence/revision-v2/before-after.png)은 왼쪽 v1, 오른쪽 v2이며 Node Canvas 출력이다. 브라우저 증거와 구분한다.
- v2 브라우저 검증은 아래 별도 기록으로 추가한다. 과거 v1 통과 결과를 재사용하지 않는다.
- 인간형 움직임·음성 동기화는 아직 구현하지 않았다. PHASE 8 착수 전에 이 외형 수정 검토를 마친다.
