# PHASE 12 — 일본어 입력과 공통 입 움직임 연결

**최신 상태 (2026-10-02 23:30 KST):** 기존 한국어 + Gemini 일본어 후보의 [캐릭터 검토본](gemini-candidate/README.md)에 대해 사용자가 “확인 완료 문제 없습니다.”라고 회신했다. 관련 코드 검사 34개·Chromium 흐름 7개와 표본 사용자 검토를 마쳐 **PHASE 12 표본 PoC 완료, 전체 11/16(1~4·6~12)**로 기록한다. 다음은 PHASE 13 실제 AI 응답 연결이다. 자세한 음소 경계 감사, 실제 기기·표본 밖 발음 검증, 운영 반영은 별도다. 아래 내용은 최초 무음 연결 당시의 이력이다.

PHASE 11 외형 전환 미리보기는 사용자 확인 완료. 다음 단계로 일본어 입력을 공통 Controller에 연결했다. **PHASE 12는 진행 중이며 전체 기술 PoC는 10/16을 유지한다.** 실제 일본어 음성 생성·측정 정렬·청취 검증은 아직 하지 않았다.

## 변경 내용

- 기존 한국어 v1 계약을 유지하고 일본어는 `version:2`, `language:ja-JP`, `phoneSet:openjtalk-v1`로 구분한다.
- OpenJTalk의 44개 분절 음소를 명시적으로 처리한다. 같은 `j`라도 한국어 IPA의 활음과 일본어 파찰음을 구분하며, 무성화 모음은 모음 모양을 유지한다. `N`과 `cl`을 일괄 양순 폐쇄로 처리하지 않는다.
- 기존 표시용 전환 알고리즘에 언어별 모음·활음 분류를 연결한다. 렌더러·외형·음소 시각을 새로 만들지 않는다.
- 실제 음성에 이미 정렬된 3열 라벨을 읽는 CLI를 추가했다. 초 또는 HTS 100ns 단위를 반드시 지정하며 파일 덮어쓰기는 거부한다. G2P만으로 시간 구간을 생성하지 않는다.
- 일본어를 선택하면 한국어 전용 청취 구간 안내를 숨긴다. 언어 변경은 새 클립 로딩이므로 정지·처음 위치로 시작하고, 같은 클립의 외형 전환은 계속 재생한다.

## 미리보기

[Yeoni_Japanese_LipSync_Preview.html](Yeoni_Japanese_LipSync_Preview.html)을 다운로드해서 Chrome/Edge 등에서 연다. 채팅의 텍스트 미리보기는 HTML을 실행하지 않을 수 있다.

`일본어 입 모양 점검 (무음)`은 기존 8초 무음 PCM 시계와 명시적인 합성 검사 구간을 사용한다. 문장을 실제로 발화하지 않으며, 일본어 발음/정렬/자연스러움 완료 증거가 아니다. 저장된 한국어 Zephyr MP3는 기존 파일을 그대로 사용한다. 외부 요청은 없다.

## 실측 라벨 가져오기

```bash
node --experimental-strip-types scripts/yeoni-japanese/prepare-timeline.mjs \
  audio.mp3 exact-spoken-text.txt measured-monophones.lab seconds new-timeline.json
```

라벨은 `시작 종료 음소` 3열이다. 전체 문맥 라벨이나 운율 기호는 먼저 검토해서 분절 음소로 변환해야 한다. CLI는 ffprobe의 파일 길이와 정확한 음성/UTF-8 텍스트 SHA-256을 기록한다. 해시·메타데이터 검증만으로 음성 제공자·실제 언어·음소 경계의 정확성을 증명하지 않는다. 출력은 항상 `automatic-phonemes` 후보다.

## 남은 검증

실제 일본어 Zephyr 한 문장 확보 → 그 음성의 측정 정렬 → 두 외형 재생·청취 비교가 필요하다. 기존 우형 자산을 재사용하므로 일본어 /u/의 비원순·압축 특성을 정확히 표현하는지 별도 시각 검토해야 한다. 물리 iPhone/Bluetooth 지연도 미검증이다. 다음 요청 범위는 [JAPANESE-SPEECH-PLAN.md](JAPANESE-SPEECH-PLAN.md)에 기록했다.

코드·브라우저 결과와 기존 파일 보존 증거는 [evidence/verification.json](evidence/verification.json)을 참조한다. 이전 61개 원본 비교·영상 검사는 다시 실행하지 않았다.

## 자료

- [Google Cloud 공식 음성 목록](https://docs.cloud.google.com/text-to-speech/docs/list-voices-and-types): ja-JP-Chirp3-HD-Zephyr.
- [ttslearn OpenJTalk frontend 원본](https://r9y9.github.io/ttslearn/latest/_modules/ttslearn/tacotron/frontend/openjtalk.html): 분절 음소 목록과 무성화 모음. 이 목록 자체는 실제 녹음의 시간 정렬이 아니다.
