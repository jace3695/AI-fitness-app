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
