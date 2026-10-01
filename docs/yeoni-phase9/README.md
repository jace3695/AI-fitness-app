# PHASE 9 — 인간형 기존 음성·립싱크 연결

2026-10-01 15:05 KST 사용자가 현재 상태를 확인한 뒤 다음 단계 진행을 요청했다. PHASE 8 원본 보존 인간형에 기존 `LipSyncPlayer`와 `CharacterController`를 연결한다. 원본 그림·승인 눈/입 패치·5.376초 MP3·60개 음소 자동 정렬은 변경하지 않는다. 새 TTS 요청은 없다.

`SpeechLab`은 고양이와 인간형의 재생·파일 검증·구간 듣기 화면을 공유한다. 인간형은 `speech` 스냅샷만 공통 Stage에 전달하며 자체 음소 매핑이나 타이머를 만들지 않는다. 재생 시간 갱신마다 렌더러를 다시 만들지 않으며, 일시정지·정지·끝·오류·버퍼 대기에는 같은 Controller가 닫힌 입으로 돌아간다.

[독립 미리보기](Yeoni_Human_Speech_Preview.html)는 원본과 승인 자산, 기존 MP3를 내장한다. 파일을 브라우저에서 열고 ‘저장된 연이 음성 불러오기’ → ‘재생’을 누른다. ‘조금 쉬는’·‘좋겠어요’ 구간을 정상/0.5배속으로 들을 수 있다. 작은 화면에서는 발화 그림을 크게 표시하고, 넓은 화면에는 원본을 나란히 표시한다. ChatGPT 내부 HTML 미리보기에서 실행이 차단되면 별도 영상으로 확인한다.

## 검증 범위

```sh
node scripts/yeoni-human-speech/export.mjs
YEONI_CHARACTER=human node scripts/yeoni-speech-poc/check.mjs
YEONI_CHARACTER=human YEONI_BROWSER=webkit node scripts/yeoni-speech-poc/check.mjs
node scripts/yeoni-human-speech/check-visual.mjs
YEONI_BROWSER=webkit node scripts/yeoni-human-speech/check-visual.mjs
```

같은 화면 흐름 검사를 두 외형에 사용한다. 실제 MP3의 미디어 시각과 렌더 viseme를 대조하고, 자연 재생·탐색·배속·정지·재생 거부·손상/불일치 파일·오류 복구·백그라운드 복귀·작은 화면을 검사한다. 합성 무음 샘플과 실제 MP3 결과를 구분한다. 실제 발화 중 캡처한 픽셀은 승인 파츠의 별도 기준 합성과 기존 검증된 변형을 대조하고 목 알파도 검사한다. 최종 통과 수와 직접 원본 검수는 결과가 나온 뒤 기록한다.

## 완료로 해석하지 않는 항목

- 음소 시각은 기존 자동 정렬 후보다. 실제 음성 청취·음소 경계 정확도와 자연스러움은 사용자 검토 대기이며 PHASE 5를 완료로 바꾸지 않는다.
- 이 문장의 `u` 입 모양은 /sʷ/ 둥글림이다. 독립 /u/ 모음과 /p, pʰ/ 폐쇄는 표본에 없다.
- 브라우저 미디어와 화면의 시각 차이는 스피커/Bluetooth 지연이나 음소 정렬 오차가 아니다. 물리 기기의 발열·배터리·잠금은 별도 검증이다.
- 외형 전환 중 발화 연속성, 운영 화면 연결·병합·배포는 이번 범위에 없다.

현재 브라우저 검증 진행 중. 기존 완료 단계 7/16을 유지한다.
