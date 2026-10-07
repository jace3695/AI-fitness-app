# PHASE 16 재개 지점

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
