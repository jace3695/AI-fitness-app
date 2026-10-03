# 일본어 실제 음성 검토본

받은 원본 MP3를 재사용한다. 추가 TTS 요청은 0회. 자동 정렬 후보이며 청취 승인·PHASE 12 완료가 아니다.

## 결과

- Julius 4.6 및 공식 segmentation-kit의 일본어 monophone 모델로 42개 구간 측정.
- 문장 발음은 사람이 지정했고 발음 변환 자체를 ASR로 검증한 것은 아니다. 정확한 읽기는 alignment/julius-approved.txt 참조.
- 분석용 WAV는 원본 MP3를 16kHz/16bit mono로 변환했으며 자르기·속도 변경 없음. 원본 MP3를 재생한다.
- silB/silE→sil, sp→pau, q→cl, o:→o로 표기만 변환. 긴 모음의 측정 구간을 분할하지 않는다. 원래 시간은 보존한다.
- 실제 pause 후보: 0.7025–1.2525초, 1.7125–2.0025초.
- 마지막 라벨 4.0125초 이후 파일 끝 4.056초까지 기존 재생기의 무음 구간 처리.
- Chromium 390px: 로딩/자동재생 방지, 외형 전환 시 동일 오디오 유지, 시각별 음소와 렌더 프레임 일치, 양 외형의 모음·쉼·양순음, 정지·배속, 새로고침 6개 검증 통과. 외부 요청·페이지 오류 0.
- 작은 화면 이미지 확인: 한글/일본어 표시, 가로 넘침 없음, 원본 외형·렌더러 파일 변경 없음.
- WebKit 런타임은 확보했으나 필수 공유 라이브러리 부재. 격리 패키지 다운로드의 setgroups 오류로 검증 미완료. Chromium 결과를 Safari/iPhone 통과로 확대하지 않는다.
- 청취 및 음소 경계 정확도·표본 밖 일본어 발음 검증은 남아 있다.

## 재현

1. https://github.com/julius-speech/julius 의 v4.6을 작업 폴더에 빌드한다. 시스템 설치 불필요.
2. https://github.com/julius-speech/segmentation-kit 의 provenance.json에 기록된 커밋을 사용한다.
3. ffmpeg로 원본 MP3를 16kHz PCM WAV로 변환하고 julius-approved.txt를 같은 이름의 txt로 둔다.
4. 빌드한 Julius를 kit의 bin/julius-4.3.1 경로에 복사한다. 실제 엔진 버전은 4.6이며 이 파일명은 kit의 실행 경로다.
5. kit 폴더에서 perl segment_julius.pl <WAV 디렉터리> 실행. 모델·도구 해시 및 표기 변환은 alignment/provenance.json 참조.
6. prepare-timeline.mjs에 원본 MP3·media/approved-ja.txt·openjtalk-labels.lab·seconds를 전달한다.
7. node scripts/yeoni-japanese/export-real.mjs 로 독립 미리보기를 생성한다.
8. YEONI_CHROMIUM=<실행파일> node scripts/yeoni-japanese/check-real.mjs

## 사용자 확인

미리보기 HTML을 Chrome 또는 Edge에서 열고 ‘일본어 실제 음성 불러오기’ → ‘재생’을 누른다. 재생 중 고양이형/인간형을 전환해 입 움직임과 쉼을 확인한다. 음성은 HTML에 포함되어 있으며 파일은 외부 요청을 차단한다.
