# PHASE 12 체크포인트

- 기반 커밋: `2e4a2c30f9bca55a800f57f15f942082bf7e670b`. PHASE 11 외형 전환 사용자 확인 완료.
- 일본어 v2/openjtalk-v1 계약, 44개 음소, 언어별 입 전환, 실측 라벨 importer와 별도 무음 미리보기 구현.
- 코드 715/715, lint/타입/빌드 통과. Chromium 153.0.8010.12 / WebKit 26.6에서 각 13개, 총 26개 통과.
- 각 브라우저 정상 파일 12회 교체 및 외형 12회 전환 통과. 길이 불일치/음소/해시 오류 거부 확인. 한국어 기준 770프레임 동일.
- 사용자 영역의 WebKit/47개 의존성·CJK 글꼴로 실행. 시스템 패키지 설치 없음.
- 기존 원본·미디어·증거 351개 파일 불변. 기존 61개 검사는 재실행하지 않음.
- 실제 일본어 TTS/정렬/청취 미실행. 전체 기술 PoC **10/16**, PHASE 12 진행 중.
- 2026-10-02 09:00:41 KST: 일본어 문장·Zephyr·1회 생성 명시 승인 완료. 공급자 요청 0회. tts-approval.json과 approved-tts-request.json 참조. 다음은 생성 경로 접근 해결이며 생성 승인을 다시 요청하지 않는다.
- 이번 커밋은 `git log -1 -- docs/yeoni-phase12/CHECKPOINT.md`로 확인. 승인 전 운영 병합/배포 없음.
- 재개 시 evidence/verification.json과 git status부터 확인. 이미 통과한 검사나 미디어 제작을 처음부터 반복하지 않는다.

## 브라우저 경로 확인 후 중단 상태

2026-10-02 09:11:40 KST 브라우저 접근 승인 후 기존 Preview 접속 성공. 앱 로그인 화면에서 보안 인증 입력·제출을 진행했으나 `Failed to fetch`가 표시됨. 인증 성공과 로그인 후 생성 화면은 확인되지 않았다. 비밀번호 오류나 봇 차단으로 단정하지 않는다. 자동 재로그인과 공급자 요청은 하지 않았으며 일본어 TTS 요청은 **0회**. 1회 생성 승인과 브라우저 접근 승인은 유지한다. 다음에는 로그인 통신 문제부터 해결하고 기존 검사·미디어를 재생성하지 않는다.

## 2026-10-02 일본어 전용 생성 경로 준비

- 사용자 PC 캡처: 최초 `Invalid login credentials`/400 뒤 로그인 성공 및 기존 한국어 테스트 페이지 진입 확인. 클라우드 브라우저의 Failed to fetch 해결과는 구분.
- 작업공간 정리 후 GitHub `69f7fcd`를 재복제. 앞선 로컬 진단 기록은 미push 상태였으므로 이 항목에 핵심을 재기록.
- `/assistant/japanese-voice-check`, `/api/tts/japanese-check` 추가. Preview 및 기존 PoC 브랜치에만 제공. 기존 한국어 API/페이지 불변.
- 승인 문장/ja-JP-Chirp3-HD-Zephyr/MP3 및 UUID `0d862ef8-b60d-41f4-b094-2936853cb905` 서버 고정. 기존 인증·무료 한도·DB의 전역 중복 예약 거부 재사용. DB 스키마/인증 설정 변경 없음.
- 로컬 1회 요청 마커, MP3 다운로드·보관·새로고침 복원 구현. 서버 고정 UUID가 다중 탭/브라우저의 최종 중복 방지 담당. 불확실한 결과는 재생성 금지. UUID 변경 금지.
- 신규 모의 API 5개 + 기존 PGlite 무료 한도 13개 = 18개 통과. 변경 파일 ESLint 및 Next build/TypeScript 통과. 모의 공급자 응답만 사용했고 실제 TTS 요청 0회.
- 로컬 화면 자동 검증 미완료: Next dev 기본 호스트에서 uv_interface_addresses 오류, Playwright Chromium 다운로드가 잘못된 ZIP 응답으로 실패. 시스템 설치 변경 없음. 이 상태를 브라우저 통과로 보고하지 않는다.
- Google 공식 Chirp3 HD 문서에서 ja-JP/Zephyr/MP3 지원 확인: https://docs.cloud.google.com/text-to-speech/docs/chirp3-hd
- PHASE 12 실제 음성 생성·정렬·청취 및 iPhone 검증 남음. 기술 PoC 10/16 유지. 운영 병합/배포 없음.
