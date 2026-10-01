<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## 사용자 요청: 실사용 검증 필수

- 화면이나 학습·기록 흐름을 변경할 때는 실제 브라우저에서 핵심 사용자 흐름을 검증한다. 로그인 게이트만 확인한 것을 인증 후 학습·저장 검증으로 보고하지 않는다.
- 테스트·린트·타입 검사·빌드 통과와 실제 브라우저 검증 결과를 구분해서 기록한다. 화면 이동·새로고침·저장 후 재조회·오류 안내·작은 화면 사용성을 포함한다.
- 개인 기록을 변경하는 검증은 허가된 테스트 계정과 데이터로만 한다. 인증, 브라우저 접근 제한, 외부 배포 승인 요구를 우회하지 않는다.
- 실사용 검증이 차단되면 정확한 미검증 범위와 필요한 사용자 조치를 보고한다. 이를 완료로 처리하거나 검증을 생략한 채 운영 병합·배포를 진행하지 않는다.

## 연이 캐릭터 PoC — 사용자 추가 지시 (2026-09-29)

- CSS + Canvas 2D로 PoC를 진행한다. [공통 Controller·립싱크 설계 기준](docs/yeoni-character-architecture.md)을 캐릭터 후속 작업 전에 읽는다.
- 립싱크의 최종 목표는 한국어 실제 발화 텍스트/음소 → viseme → TTS 오디오 시각 동기화다. 음량에 따른 입 벌리기, 임의 타이밍, 글자별 균등 배분을 완료로 처리하지 않는다.
- 고양이형은 최소 닫힘/아/이/우/에/오의 여섯 시각적 입 모양을 구분한다. 기존 `round`의 우/오, `wide`의 이/에 공유는 초기 PoC 상태이며 최종 기준을 충족하지 않는다.
- 공통 Character Controller와 렌더러를 분리한다. AI 응답·TTS·감정·립싱크 로직에 Canvas/Rive/Live2D 종속 코드를 넣지 않고, 인간형도 같은 Controller 계약을 사용한다.
- 공통 계약과 최소 Controller 분리는 PHASE 5부터 진행한다. PHASE 10은 통합 완성 단계이지 분리를 처음 시작하는 단계가 아니다.
- 저장한 39자 Zephyr MP3를 재사용한다. 음소 타임라인 정렬·실음성 동기화·자연스러움 검증이 끝나기 전에는 PHASE 5를 완료로 보고하지 않는다.
- 2026-09-30 사용자 지시: 이전·현재 음성의 실제 청취는 귀가 후로 보류하고 PHASE 6 개발은 계속한다. 청취 완료로 기록하거나 운영 적용 승인으로 해석하지 않는다.
- 2026-09-30 사용자 지시: 캐릭터 수정본은 사용자에게 제시하기 전에 반드시 선택한 원본 A안과 직접 비교한다. 같은 크기/좌표의 확대 비교·겹침 비교로 얼굴형, 눈선, 고개 각도, 입술 두께/색, 피부 경계와 표정 전환을 검수한다. 이전 수정본과의 비교만으로 대체하지 않는다.
- 중립 기본 모습은 원본을 보존한다. 표정 편집 범위 밖의 변화와 이중 윤곽을 검사하고, 모든 눈/입 조합을 직접 시각 확인한다. 브라우저 기능 테스트나 서로 다른 픽셀만으로 자연스러움을 통과 처리하지 않는다. 발견한 부자연스러움이 남으면 수정본 제시를 보류하고 보완한다.
- 2026-09-30 후속 지시: 인간형 v3 정지 외형은 사용자 확인 완료. 다음 단계 전에 고양이도 공식 원본 `public/yeoni-cat-sprite-v1.webp`와 재비교하고 필요하면 수정하여 다시 제시한다. 생성된 PoC atlas를 원본으로 취급하지 않는다. 정지 외형 검수와 투명 분리 자산·동작 리깅 검수를 구분한다.
- 2026-09-30 21:29 KST: 사용자가 고양이 reference-v2 정지 외형을 확인하고 다음 단계 진행을 요청했다. 승인 원본을 사용하는 동작 재연결부터 진행한다. 원본 보존을 위한 흰 배경의 연속 2D 변형 PoC는 투명 분리 자산 완성이나 새로운 전체 단계 완료로 보고하지 않는다.
- 2026-10-01 09:14 KST: 사용자가 고양이 동작 v3를 확인하고 다음 단계 진행을 요청했다. 인간형 A안 원본 보존 자산 준비를 진행한다. 고양이 동작 확인을 실제 음성 청취 승인으로 해석하지 않는다. 인간형의 배경 분리는 불투명 얼굴·의상 RGB를 보존하며, 배경/알파 및 반투명 외곽 경계 변경과 정지 합성 검증을 동작 검증과 구분한다.
- 2026-10-01 10:00 KST: 사용자가 인간형 v4 정지 자산을 확인하고 다음 단계 진행을 요청했다. 같은 Controller를 사용하는 PHASE 8 기본 동작을 진행하고, 실제 움직임의 얼굴 파츠 고정·목 경계·투명 외곽과 정지 정책을 원본 대비 검증한다. 실제 인간형 음성 연결은 PHASE 9다.

- 2026-10-01 15:05 KST: 사용자가 상태 확인 후 다음 단계 진행을 요청했다. PHASE 9에서 저장된 MP3/자동 정렬을 인간형에 연결한다. 이를 PHASE 5 청취 승인으로 해석하지 않는다.
