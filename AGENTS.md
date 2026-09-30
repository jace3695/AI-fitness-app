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
