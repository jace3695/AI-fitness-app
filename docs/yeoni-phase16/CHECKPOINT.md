# PHASE 16 재개 지점

## 2026-10-08 11:07 KST 앱 소개 재확인

- 운영 `/assistant`의 앱 소개 href는 `/about`이며, 화면 하단으로 이동해 링크가 실제로 드러난 상태에서 클릭하자 `/about`과 소개 내용이 정상 표시됐다. 이전 자동 클릭/이동 대기 과정의 식단 이동은 앱의 잘못된 링크로 재현되지 않았다. 코드 수정은 하지 않았다.

## 2026-10-08 운영 적용·최종 검증 완료

- 사용자 10월 7일 23:33 KST 승인으로 후보 `5298b3271c25fc5195960717022aede17b643baa`를 PR #207에서 main에 병합했다. 운영 커밋 `62c2141b9ccb29daeac680e088007309d195c665`, 배포 `dpl_7sQeDrCAVugwnwhgHkNt6MLkxhfK`, Production READY 및 `ai-fitness-app-ten.vercel.app` 연결 확인.
- Production 전용 `YEONI_ASSISTANT_CHARACTER_ENABLED=1` 적용. 음성·그림·정렬·DB 스키마는 변경하지 않았다. 직전 운영 복구 대상은 `dpl_CA5xqJa7drXgTBqZt136qMcDQmL2`다.
- 보안 로그인 중단 후 10월 8일 재개 요청으로 로그인에 성공했다. 실제 운영 `/assistant`에서 고양이·인간형, 검증용 인사 응답과 text-only 상태, 새로고침 후 대화 복원, 캐릭터 숨김/복귀를 확인했다. 오디오 6개 모두 paused/source 없음. 기존 예시 조언도 복원됐다. 새 TTS 호출 없음.
- 다른 앱 화면 이동 뒤 비서 화면 재진입 시 대화를 재조회했다. 앱 소개 클릭 검사는 의도와 달리 식단 화면으로 이동해 해당 링크 자체는 통과 항목에서 제외했다. 식단 기록은 수정하지 않았다. 검수 전용 `/assistant/character-check`는 실제 운영 브라우저에서 404 화면으로 차단됐다.
- 전체 CI `Isolated browser verification` run `37636223224`가 최종 success다. 이전 로컬 733개 검사·타입/린트/빌드·Preview·iPhone 검증은 재실행하지 않고 보존한다.
- Vercel 최근 30분 production error/fatal 조회 결과 없음. 1시간 요청은 보존 기간 경계 오류로 30분으로 줄였다. 전체 배포 기간 무오류 또는 지속 모니터링 구축을 의미하지 않는다. Drains 구성은 별도 확인하지 않았다.
- 증거: `evidence/production-20261008.jpg`. 대화에 검증용 인사 한 건과 응답이 남는다. 개인 운동·식단·가계부 기록을 수정/삭제하지 않았다.
- **저장 표본 기반 캐릭터 PoC 16/16 완료.** 일반 새 답변의 자동 TTS·자동 음소 정렬은 완료 범위가 아니다. 원본 음성/물리 기기 검증 반복, 재병합·재배포는 불필요하다.

아래는 완료 전 이력이며 위 상태가 최신이다.

## 2026-10-07 23:05 KST iPhone 확인 완료

- 사용자가 새 버튼/입력창 배치가 잘리지 않고 정상이라고 확인했다. `evidence/user-acceptance-20261007.json`에 기록했다. 작은 화면 검증을 다시 요청하지 않는다.
- 23:06 KST 다음 단계 요청으로 운영 후보를 준비했다. 실제 `/assistant`의 운영용 명시적 Config와 Preview 검수 gate를 분리했다. 원본 UI/그림/음성은 유지한다.
- `RELEASE-CANDIDATE.md`에 기능 범위·변경 경로·검증·승인 후 적용·복구 절차를 정리했다. 전체 검사 733개와 타입/변경 파일 lint/운영 활성화 로컬 빌드 통과. 운영 설정은 아직 변경하지 않았다.
- 전체 15/16, 다음은 후보 SHA를 고정한 최종 운영 승인/Production 설정/main 병합/자동 운영 배포 확인이다. 자동 TTS/일반 문장 자동 정렬은 별도 기능이다.

## 2026-10-07 22:56 KST 로그인 완료 후 확인

- 사용자가 같은 고정 Preview 탭에서 로그인을 완료했고, 실제 인증 후 화면으로 확인했다. 이전 `Invalid login credentials`로 인한 중단은 해소되었다.
- 브랜치 head `97eac230264ea53dc1c3bffb644dd6a2e66e5b90`의 배포 `dpl_DRpQXtTEsABHEaSgtgKLoikcM9c9`는 READY다. 실행 코드는 `649083b`와 같다.
- 수정된 고양이형/인간형 버튼은 각각 83×45px이며 합계 166px+간격 8px가 카드 안쪽 174px에 맞는다. 두 버튼 모두 경계 안에 들어오며 인간형 전환 후 실제 그림과 안내가 정상 표시된다.
- 기존 검증용 대화와 가상 예시 조언이 다시 표시된다. 캐릭터는 idle/empty, 오디오 5개는 모두 paused이며 src가 없다. 로그인/이력 복원/외형 전환으로 음성을 생성하거나 자동 재생하지 않았다.
- 실제 CSS viewport는 1363×936px, 문서 폭 1359px이며 가로 넘침이 없다. 이 확인을 모바일 검증으로 확대하지 않는다. 캡처 `evidence/assistant-layout-20261007.jpg`, 수치 `evidence/layout-verification-20261007.json`.
- 남은 확인은 iPhone의 실제 비서 화면에서 고양이형/인간형 버튼과 입력창이 잘리지 않는지 보는 짧은 배치 확인이다. 과거 음성 청취·10분 사용·잠금·앱 전환 확인은 완료 상태를 유지한다.
- 다음 단계 전에 이 작은 화면 확인을 받고, 운영 후보의 범위·기능 제한·복구 대상을 최종 정리한다. PHASE 16 전체 완료나 운영 적용으로 처리하지 않는다.

## 최종 CSS 후보와 로그인 인계

- 최종 실행 코드 로컬 `0e75560fe8123f2c3a15530d3a14b2e6a749c836`, 원격 `649083b34129523d2d0799319587a324fe55f1c2`, tree `65c21b8876db3924016c70ee1f354ebbcd6bc5a1` 일치.
- 배포 `dpl_DAUKvr7dLVtfrP1ZSX4Bv4Jwzp17`, 수정 범위는 embedded CSS와 문서. 고정 주소는 https://ai-fitness-app-git-agent-yeoni-cat-an-ec20ab-jace3695s-projects.vercel.app/assistant 이다.
- 아래 최초 후보에서는 보안 로그인 성공 후 실제 대화·예시 조언·저장 재조회·화면 이동·잘못된 긴 제목의 오류 안내·캐릭터 숨김을 확인했다. 새 TTS 요청은 없었다. 긴 제목은 서버 저장 전 거절되었으며 개인 기록을 수정하지 않았다.
- 최종 후보를 고정 주소에서 확인하려 했으나, 별도 origin의 보안 로그인 제출 후 `Invalid login credentials`가 표시되었다. 자격 증명을 읽거나 재사용하지 않았고 자동 재시도를 하지 않았다. 이 탭에서 사용자가 직접 로그인한 뒤 최종 버튼 배치 확인을 이어간다.
- 브라우저 확대 키가 CSS viewport 폭을 바꾸지 않아 작은 화면 검증으로 계산하지 않았다. 작은 화면의 새 배치 확인은 여전히 남는다. 기존 10분/앱 전환/잠금/음성 청취 확인을 반복할 필요는 없다.
- 이 기록 이후 문서 전용 커밋이 생겨도 최종 실행 코드는 위 CSS 후보와 동일하다. 현재 15/16, 운영 적용 미승인.

## 최초 연결 후보의 검증 이력

- 로컬 구현 커밋: `5785c424bca1f9b2f22ddcd8dc2ac7da683f3f40`.
- 원격 구현 커밋: `4567b1f82d66b5b9e358b60eb2617054c0b8b230`, 기존 브랜치 `agent/yeoni-cat-animation-poc`에 fast-forward로 게시.
- 두 커밋의 tree: `31ccff0543730df9681295651bd5e7a94903fd9a` 일치. 로컬 구현과 앞선 사용자 확인·분석 기록 43개 변경 경로를 보존했다.
- Preview 배포: `dpl_61anDfDoHjZ58DPYX2Tp4veGeGM8`, 프로젝트 `prj_UDkVoWjM3D1EMRJk9hcBaFvq2sj3`, 팀 `team_infdz4ulqNZRy7vk5BTGUXmt`.
- 실제 화면: https://ai-fitness-nr72npee9-jace3695s-projects.vercel.app/assistant
- 위 Preview는 READY이며 빌드 45.365초. 보안 로그인 성공 후 실제 캐릭터·대화 이력 표시를 확인했다. 예시 기록 조언 요청/응답, 새로고침 후 대화/조언 재조회, 화면 이동 후 복귀도 확인했다. 새 음성 생성 없이 전 과정의 무음·idle/text-only 상태를 확인했다.
- 화면 검수에서 외형 선택 버튼 2개의 합계 폭(208px)이 카드 안쪽(174px)을 넘는 문제를 확인했다. embedded 화면의 버튼 최소 폭과 무대 높이를 수정했다. 기능 로직·원본 자산은 바꾸지 않았다. 이 CSS 수정 후보의 최종 브라우저 확인은 별도다.
- 빌드/타입/린트, 관련 단위 19개, 모의 컴포넌트 9개 시나리오는 통과했다. `evidence/code-verification.json` 참조.
- 전체 완료 상태는 **15/16** 유지. 운영 병합/배포, 새 TTS 생성은 하지 않았다. 현재 feature gate는 해당 Preview 브랜치에서만 실제 캐릭터를 연결한다.
- 다음 작업: CSS 수정 후보의 배치와 작은 화면 확인. 실제 조언에는 가상 예시만 사용했다. 대화 이력에 검증용 인사와 예시 조언이 남고, 운동/가계부 등 개인 기록을 수정하지 않았다. 기존 기기/음성/외형 검토는 반복하지 않는다.
- 기존 dirty `docs/yeoni-phase9/Yeoni_Human_Speech_Preview.html`은 게시·수정하지 않았다.
