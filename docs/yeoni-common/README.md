# 공통 연이 로컬 통합 후보

기준: `jace3695/AI-fitness-app`, `agent/fitness-record-priority`의 `a08d9cf6b8cebf41dbc74916aa675fc25d61636b`.
작성: 2026-10-21 KST. 목표 10월 25일은 일정 목표이며 운영 완료 보장이 아니다.

## 격리와 변경 범위

원본 작업공간은 Git 읽기만 했다. 지정 커밋의 추적 파일을 archive로 별도 폴더에 추출하고 `.env*`는 제외했다. 원본의 작업 중 변경, 실제 사용자 로컬 저장소, 인증정보는 가져오지 않았다. 이 사본은 별도 Git 저장소이며 첫 커밋은 환경 파일을 제외한 기준 스냅샷이다. 따라서 이 저장소의 전체 이력을 원본에 병합하지 말고 후속 변경 커밋의 패치만 적용한다.

공통 레이아웃, 캐릭터 UI, 기기 설정과 공통 계약만 변경했다. 일본어 전용 파일, 운동/가계부/비서의 업무·기록·DB·인증 구현은 수정하지 않았다. push, 배포, 환경 설정 변경, 외부 AI/유료 호출, 새 음성 생성은 수행하지 않았다.

## 구현

- 루트 레이아웃에 `CommonCharacterShell`을 한 번 배치한다. 홈 및 모든 앱 경로에 같은 `SwitchableCharacterStage`를 사용한다. 기존 독립 `*check` 검수 화면은 중복 호스트를 제외한다.
- 기존 `yeoniAppearanceSettingsV1`에 비민감 `appearance: cat | human`만 추가한다. 기존 `visible/motion` 및 레거시 설정을 보존하고 알 수 없는 외형/추가 필드는 정규화한다. 저장 실패는 메모리 선택을 유지한다. 새 계정/클라우드 동기화는 없다.
- `AppCompanion` 안내문은 유지한다. 공통 호스트 안의 `YeoniMascot` 장식은 생략한다. 비서 `ReplyCharacterPanel`은 기존 응답·오디오·안내문을 유지하면서 공통 호스트로 제어 입력만 전달한다. 독립 검수 패널은 기존 방식이다.
- 한 개의 표시 Canvas, 기존 Controller/외형 렌더러와 단일 오디오를 재사용한다. 고양이 preserved-motion-v3와 사람형 reference-v3/rig-v4 이미지 및 저장 MP3는 변경하지 않았다. `evidence/asset-hashes.json`과 기준 대비 무변경 검사를 남겼다.
- 모바일은 문서 흐름 안에 배치한다. 입력 포커스, 운동 전체 경로, 그림/필기/타이핑 경로에서는 정적 축소한다. 운동 화면 전체를 보수적으로 정지시켜 업무 로직 연결이 필요하지 않게 했다. 기존 reduced-motion, 화면 밖, 비활성 문서 정책도 유지한다.
- 경로/계정 경계에서 공통 음성 중단 이벤트, 응답 세션 초기화, 제어 채널 해제 및 렌더러 수명 정리를 수행한다. 기기 외형만 남기며 응답 텍스트/사용자 ID/개인 기록은 호스트에서 저장하지 않는다. 기존 인증 이벤트를 읽기 전용 구독하며 인증 상태를 변경하지 않는다.

## 활성화 후보

`commonCharacterEnabled`는 개발 실행에서 활성화하며 `YEONI_COMMON_CHARACTER_ENABLED=0`으로 끈다. Preview는 `VERCEL_ENV=preview`와 `YEONI_COMMON_CHARACTER_ENABLED=1`이 모두 있어야 활성화한다. 운영 및 일반 production build에서는 공통 호스트를 활성화하지 않는다. 기존 비서의 별도 운영 플래그 동작은 그대로다. 실제 환경 변수는 바꾸지 않았다. 비활성 상태에서는 루트에서 공통 클라이언트 호스트를 렌더하지 않는다.

Preview 승인 후 변경할 환경 설정의 후보를 명세한 것이며 게시한 결과가 아니다. 운영 정책 결정/승인과 별도 패치 없이는 운영 공통 활성화가 되지 않는다.

## 담당자 통합 사항

`lib/yeoni/speech-participant.ts`는 앱 소유 음성을 위한 선택적 어댑터다. 기존 비서 저장 음성과 Zephyr reader는 이미 같은 focus/stop 이벤트를 사용한다. 운동 음성 및 일본어 전용 재생기는 수정 권한 범위 밖이므로 아직 이 어댑터를 채택하지 않았다. **모든 앱의 음성 상호배제가 완료되었다고 해석하면 안 된다.** 담당자가 아래 수명 계약을 연결해야 한다.

```ts
const voice = createSpeechParticipant(uniqueOwner, stopOwnedPlayback);
const stillOwnsFocus = voice.claim();
const prepared = await prepareExistingAudio();
if (!stillOwnsFocus()) return; // 이동·계정 변경·다른 음성 이후 늦은 재생 금지
await playPreparedAudio(prepared);
// 앱 소유 비동기 play 완료 뒤에도 lease 확인 및 기존 취소 처리 유지
// 컴포넌트 정리: voice.dispose();
```

`stopOwnedPlayback`은 해당 앱의 요청 취소/재생 중단 함수를 사용한다. 어댑터는 브라우저 전역 음성 API를 가로채거나 임의 음악을 멈추지 않는다. focus 소유자 ID는 마운트마다 유일해야 한다. 신규 앱 응답 제어는 `CommonCharacterContext.publish()`를 통해 전달하고 반환된 cleanup을 호출한다. 원본 응답의 계정 검증과 지연 응답 배제는 앱 소유자의 기존 책임이다.

공통 루트 배치는 상단 공간을 차지한다. 각 앱의 실제 고정 헤더/하단 내비게이션/키보드 조합은 통합 브라우저·실기기에서 추가 검증해야 한다. 본 검사는 실제 공통 컴포넌트와 합성 페이지 콘텐츠를 사용했다.

## 검증 증거

- `evidence/browser.json`: 격리 Edge/Chromium 390×844, 실제 공통 React 컴포넌트, 합성 route/auth. 14개 시나리오 통과, pageerror 0, 외부 요청 0. StrictMode 단일 Canvas, 외형 유지/새로고침, 정지/축소, 실제 저장 표본 재생과 외형 전환 중 오디오 동일성, 다른 focus 중단, 계정/경로 초기화, reduced-motion, 화면 겹침/가로 넘침 없음, 숨김/안내문 보존, 다른 탭, 저장 실패, 이미지 실패/재시도, 빠른 이동과 데스크톱 응답 폭을 포함한다. 사용자 브라우저 프로필은 사용하지 않았다.
- `evidence/mobile-human.png`, `mobile-cat.png`: 배치 검토용 스크린샷. 원본 자산의 신규 외형 승인이나 물리 기기 검수가 아니다.
- `evidence/common-unit.txt`: 정책/설정/음성 lease 검사 7개 통과.
- `evidence/unit-tests.txt`: 전체 903개 중 898 통과, 5개는 sandbox loopback EACCES. 실패한 두 파일만 권한 허용된 로컬 합성 서버로 재실행한 `local-http-recheck.txt`는 12/12 통과. 이후 추가된 음성 lease 1개는 common-unit에 별도 포함한다. 전체 904개 단일 재실행을 했다고 보고하지 않는다.
- `evidence/typecheck.txt`: TypeScript noEmit 통과. `evidence/lint.txt`: 변경 프로덕션 파일 ESLint 통과. `git diff --check` 통과.
- `evidence/build.txt`: **빌드 미완료**. Next webpack이 분리 사본 `.next/types/app/.well-known/oauth-protected-resource` 생성 중 `EPERM`으로 중단됐다. 코드 컴파일 성공/배포 가능으로 보고하지 않는다. 원본 소스 접근 거부는 없었고, 빌드 실패 대상은 이 사본의 생성 디렉터리다. 해당 빌드는 재시도하지 않았다.

초기 브라우저 실행은 sandbox Edge 프로세스 종료로 실패했다. 도구에서 허용된 별도 실행으로 격리 프로필 검사를 완료했다. 초기에 테스트 번들 환경 및 오류 주입 캐시 때문에 실패한 하네스는 수정 후 전 시나리오 재실행했다.

## 남은 검증과 기술 결정

실제 Next 라우터/실서버 인증 후 각 앱 기록·저장·재조회, 실제 사용자 계정 전환, iPhone/Android 키보드·Bluetooth·백그라운드·장시간 배터리, 물리 기기 음성 청취는 이번 작업에서 검증하지 않았다. 기존 다른 단계의 승인 결과를 이번 변경의 실기기 승인으로 대신하지 않는다. 운영 병합/배포 승인도 없다.

새 답변 자동 음성/립싱크는 구현하지 않았다. 기존 정확한 문장·언어·voice·검증된 오디오/정렬이 일치하는 표본만 입모양 동기화가 가능하다. 일반 응답은 텍스트/표정과 기존 안내를 유지한다. 후속으로 TTS 제공자·비용/승인 범위, 실제 발화문 정규화, 음소 타임라인 공급/정렬, 캐시 소유권/삭제, 실패 시 닫힌 입 정책, 언어별 검수 및 사용자 청취 승인 절차를 결정해야 한다. 새 음성 호출 승인과 구현은 별도다.
