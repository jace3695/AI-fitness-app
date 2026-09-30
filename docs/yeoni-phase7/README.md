# PHASE 7 — 인간형 A안 자산 제작

2026-09-30. 자산 제작 및 정지 합성 검수 진행. PHASE 5 사용자 청취 보류 유지.

## 결과물

- [독립 검수 미리보기](Yeoni_Human_A_Asset_Preview.html): 다운로드 후 열기. 눈 3종, 입 7종(필수 여섯 모양 + small), 흰색/연보라/어두운 배경 선택. 음성·로그인·서버 요청 없음.
- [모델 시트](human-a-model-sheet.png): 전신 정면·사선·측면·뒷면, 6가지 표정 참고. 원본에 없던 하의/신발은 크림색 바지/연보라 플랫슈즈로 제안했다. 사용자 추가 확정으로 간주하지 않는다.
- [선택 원본](reference/human-a-selected.png): A안 SHA-256 `086109dd5bdfa452247020885209559d266438d4aae79715988f298802bcc984` 대조.
- [투명 atlas](../../public/yeoni/human/poc-atlas-v1.png) 및 [좌표·합성 명세](../../public/yeoni/human/poc-atlas-v1.json).
- [밝음/어두움 정지 합성](evidence/static-assembly.png): Node Canvas로 같은 source/destination 명세를 그린 이미지. 브라우저 캡처가 아니다.

## 범위와 품질

갈색 단발·보라색 눈·연보라 카디건·아이보리 상의·민트 네 갈래 별을 유지한다.
머리 바탕에는 눈/눈썹/입이 없고, 코·볼·머리카락이 포함된다. 몸통에는 목·의상·목걸이가 포함된다.
눈은 뜸/반감음/감음, 입은 닫힘/아/이/우/에/오/small을 각각 교체한다. 생성된 좌표가 요청 격자와 달라 실제 source rectangle을 측정했다.
초기 합성에서 목 아래 빈 부분과 인접 파츠 혼입을 발견해 이미지 편집과 source/destination 좌표 조정으로 보완했다.

이 자산은 2.5D PoC용이다. 전신 회전도·표정 시트는 외형 참고용이며 전신 리깅 완성본이 아니다.
머리카락은 머리에, 눈썹은 눈에 포함되어 있다. 손 2종은 참고 파츠로 확보했지만 팔에 연결하지 않았다.
작은 화면 합성용 얼굴 비율을 조정했으며 원본 A안과 완전히 동일한 픽셀 이미지가 아니다. 최종 외형 선호 확인은 사용자 검토로 남는다.

## 공통 Controller 연결 기준

명세 `controllerBinding`은 기존 `CharacterFrame.blink`와 `viseme` 의미 ID를 파츠에 대응한다.
`rest/closed`는 닫힘, `a/i/u/e/o/small`은 각기 다른 파츠다. 새 음소 규칙·AI·TTS 로직을 만들지 않는다.
PHASE 8은 기존 `mountCharacterStage`와 `CharacterController`를 사용하는 인간형 렌더러를 구현한다.
PHASE 9는 기존 39자 MP3·60개 음소 시각을 재사용한다. 이번 정지 검수 화면은 Controller 연동이나 실제 인간형 립싱크 검증이 아니다.
피벗 값은 초기 합성 기준이다. 회전 제한과 목/머리 겹침 여유는 PHASE 8에서 실제 동작으로 검증한다.

## 검증

- 원본 기준 해시와 PNG RGBA/실제 투명 채널 확인.
- 밝은/어두운 배경 정지 합성 검수. 표정 시트와 atlas 직접 시각 확인.
- 실제 브라우저 검증은 `scripts/yeoni-human-assets/check.mjs`로 Chromium/WebKit 각각 6개 항목을 실행한다.
- 로컬 브라우저 실행 파일이 없어 설치를 시도했으나 다운로드 파일이 올바른 ZIP이 아니어서 실패했다. 로컬 브라우저 통과로 보고하지 않는다.
- 기존 캐릭터 CI에 검수 화면 검증을 추가했다. 최종 결과는 별도 기록한다.
- 운영 앱·기록·DB·음성 API는 변경하지 않았다. 추가 TTS 요청 0회.

## 재현

```sh
node scripts/yeoni-human-assets/export.mjs
node scripts/yeoni-human-assets/check.mjs
YEONI_BROWSER=webkit node scripts/yeoni-human-assets/check.mjs
```

미리보기는 원본/모델시트/atlas를 내장한다. 렌더러는 source rectangle으로 읽으며 파츠 이미지를 수동 픽셀 편집하지 않았다.
제작 방식과 프롬프트는 [제작 기록](generation.md)에 보관한다.
