# PHASE 13 — 답변·음성·표정·몸짓 연결

시작 요청: 2026-10-02 23:42 KST “다음 단계 진행해 주세요.”
현재: 연결 구현과 격리 검증 완료, 실제 로그인 계정의 AI 응답 검증 대기. **전체 완료는 11/16 유지, PHASE 13 진행 중.**

## 연결

- 일반 대화 `/api/assistant/chat`와 무료 AI 조언 `/api/ai/free-advice`가 최종 응답 문장, 응답 ID, 언어, 음성, 표정·몸짓 의도를 `performance`로 전달한다. 기존 API 응답 필드는 유지한다.
- 무료 모드에서 일반 채팅의 유료 생성형 fallback은 비활성이다. 실제 AI 검수 화면은 기존 **무료 조언 API**와 `FreeAdvicePanel`의 기록 미리보기·자료 활용 동의·fingerprint 검증을 그대로 사용한다. 유료 모드 전환이나 새 모델 호출 경로를 추가하지 않았다.
- `/assistant/character-check`는 기존 작업 브랜치의 Vercel Preview에서만 열리고 기존 Assistant AuthGate를 따른다. 현재 미배포다. 서버가 기존 MP3/WAV만 읽어 제공하며 Next 빌드 추적 파일에 두 음성이 포함되는 것도 확인했다.
- 조언의 요약·다음 행동·근거·한계를 모두 그대로 연결한다. 개인정보나 기록을 새로 저장하는 기능을 추가하지 않았다. 표정은 `rules-v1`의 보수적인 문장 규칙이며 모델의 감정 추론 결과가 아니다. 규칙에 없으면 중립이다.
- 음성은 정확한 문장·언어·선택한 voice ID가 일치하는 저장 표본만 연결한다. 실제 파일 SHA-256·문장 해시·길이·음소 타임라인 검증도 유지한다. 다른 답변에 표본 음성을 대신 틀지 않는다. 혼합/미지원 언어, 새 문장은 글로 표시한다.
- 한국어 `ko-KR-Chirp3-HD-Zephyr`, 일본어 `gemini-3.8-flash-tts/Zephyr`. 승인된 음성·타임라인·그림·Controller·렌더러·입 보간을 그대로 보존했다. 새 TTS는 0회.
- 엔진 독립 `ReplySession`이 응답 교체/취소/해제와 지연 도착을 제어한다. 한 오디오의 시각을 기존 공통 Controller에 전달하며, 몸짓은 재생 시작에 한 번만 발생한다. 일시정지·끝·대기·탐색에서는 중립으로 복귀하고 재개 시 같은 몸짓을 반복하지 않는다. 처음으로/재생 완료 후 명시적 재생은 새 몸짓을 허용한다.

## 검토본

`Yeoni_Reply_Character_Preview.html`의 경로와 저장 식별자는 `delivery.json`에 있다.
새 AI 생성 응답처럼 표시하지 않는 **저장 표본 미리보기**다. 네트워크 차단 CSP, 음성·그림 내장.

1. 움직임 켜기
2. 한국어·다정한 답변 또는 일본어·응원하는 답변 선택
3. 답변 듣기 — 고양이형/인간형을 재생 중 교체 가능
4. 음성이 없는 새 답변 선택 — 이전 음성이 멈추고 글만 표시되는지 확인

## 검증 결과

| 범위 | 결과 | 증거 |
| --- | --- | --- |
| 상태·입력 계약 | 9개 세부 검사 통과: 다른 문장/voice 거부, 원본 음성, 혼합 언어, 지연 응답/파일 무효화, 중복 몸짓 방지, 오류 복구 | `evidence/unit.txt` |
| Chromium 실제 음성 UI | 5개 흐름 통과: 한국어/일본어 원본 해시, 표정·몸짓·입 중립, 외형 교체, 새 답변으로 중단, pagehide/재진입/새로고침, 동작 줄이기, 320/390/1280px | `evidence/chromium/results.json` |
| 실제 API 코드 경계 | 가상 인증/Google 응답 대역으로 401, 동의 없음 400, fingerprint 불일치 409에서 provider 대역 호출 0; 성공에서 1회 및 전체 문장 보존 | `evidence/boundaries.json` |
| 실제 무료 조언 React 컴포넌트 연결 | 가상 인증/응답으로 동의 → 요청 → 서버 계획 → 캐릭터 전달 확인. 음성 없는 답변, 한도 오류, 이전 결과 제거, 자동 재시도 없음, 새로고침 초기화 | `evidence/boundaries.json` |
| 타입·린트·앱 빌드 | 통과. 새 Preview 페이지 포함, 두 음성 파일 tracing 확인 | `types.txt`, `lint.txt`, `build.txt`, `build-trace.json` |
| 보존·시각 확인 | 시작 커밋과 18개 원본/정렬/외형 관련 파일 바이트 동일. 새 모바일 고양이/인간형 캡처 직접 확인 | `preservation.json`, `chromium/*-390.png` |

API/React 연결 검사의 인증과 AI 응답은 대역이다. 실제 계정·호스팅 DB·Google 응답이 검증됐다는 뜻이 아니다. 테스트 최초 즉시 DOM 검사는 React 상태 반영 전 시점을 읽어 실패했고, 상태 반영 대기로 고쳐 통과했다. 구현을 완화하거나 인증·동의 단계를 우회하지 않았다.

React 검토: 정적 음성 목록 메모화, effect 정리 시 요청/재생기 해제, 실시간 입 시계는 기존 Stage 루프 유지, 반복 TTS 없음. Supabase 변경 이력·getSession/getUser 공식 문서를 확인했고 기존 인증 코드를 변경하지 않았다. 최근 DB/self-hosting 변경은 이번 응답 DTO 연결에 적용되지 않는다.

## 남은 확인과 배포 범위

- 로컬 `GEMINI_FREE_API_KEY`, `GEMINI_API_KEY`, `GOOGLE_TTS_API_KEY`, `VERCEL_TOKEN`은 값 출력 없이 부재 확인. 실제 AI·TTS 호출, 개인 기록 읽기/쓰기, push/배포 모두 0회.
- 기존 push 승인은 `3837f94`에 한정된다. 이번 변경을 포함한 작업 브랜치 Preview 갱신은 별도 승인 후 진행한다. 원격 `2e52b1f`는 로컬 `3837f94`와 동일 tree인 별도 커밋이므로 정상 병합/재적용으로 연결하고 force push하지 않는다.
- Preview 배포 후 로그인 → `/assistant/character-check` → 예시 기록 확인 → Google 자료 활용 동의 → 무료 AI 조언 1회 → 실제 응답/표정 전달을 확인한다. 실제 예시 조언은 저장 표본과 다르므로 음성은 준비되지 않은 상태가 정상이다.
- 새 AI 문장을 소리까지 연결하려면 그 **확정 문장·선택 음성·횟수**에 대한 새 TTS 승인과 해당 오디오 정렬이 필요하다. 이전 2회 비교 생성 허용량은 소진되어 재사용하지 않는다. 생성 요청 UI나 자동 재시도는 이번 구현에 없다.
- 새 검토본의 사용자 확인, 실제 AI 연결, 물리 iPhone·WebKit 검증은 미완료다. 기존 WebKit 실행 환경 제약을 해결했다고 보고하지 않는다. PHASE 5 음소 경계/표본 밖 발음 검토, 14/15 기기 확인, 16 운영 적용도 남는다.

## 재현

```sh
node --experimental-strip-types --test --test-isolation=none lib/yeoni/reply-session.test.ts
node scripts/yeoni-reply/export.mjs
YEONI_CHROMIUM=/path/to/chromium node scripts/yeoni-reply/check.mjs
YEONI_CHROMIUM=/path/to/chromium node scripts/yeoni-reply/check-boundaries.mjs
```

`check-boundaries.mjs`는 실제 API 핸들러와 클라이언트 컴포넌트를 임시 디렉터리에 묶으며 인증/AI만 명시적 대역이다. 가짜 키는 테스트 메모리에서만 사용하고 원래 환경을 복구한다. 외부 네트워크 요청은 없다.
