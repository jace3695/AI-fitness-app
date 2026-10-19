# 지지형 동작 2종 인계 — 2026-10-19

주 저장소 확인 기준: `36bb28d5b01a720b973fb9e45dd18f95b07f7375`.
개발 위치: `C:\Users\박재민\Documents\Codex\2026-10-18\task-2\motion-extension`.
이전 독립 커밋 `3b8e815badb20e755fc8530a380bda278249793f`의 후속 변경이다.
주 저장소는 추적 코드만 읽었고 편집·checkout하지 않았다. 계정·건강사진·비밀정보를 읽지 않았다.

## 선정 근거 및 출처

현재 목록의 `supported-calf-raise`(지지형 양발 종아리 들기), `supported-side-leg-raise`(지지형 옆 다리 들기)는 등록되어 있으나 기존 세 시연에 포함되지 않았다.
추가 중량·밴드 고정점 없이 움직임을 단순 도해로 표현할 수 있어 선정했다. 사용자에게 적합하거나 안전한 운동이라는 선정은 아니다. 옆 다리 들기는 한발 지지가 필요하다.

공식 자료: [NHS Strength exercises](https://www.nhs.uk/live-well/exercise/strength-exercises/), 확인 2026-10-19, 문서 검토일 2024-02-28.
`Calf raises`의 손 지지·양쪽 뒤꿈치 올리기·느린 제어, `Sideways leg lift`의 손 지지·옆 방향 다리 들기·몸통과 골반 정렬·기울임 방지를 확인했다.
위 원칙을 한국어로 요약하고 직접 작성한 좌표 도형으로 표현했다. 원문 사진·모델·영상·동작 파일은 복제하거나 다운로드하지 않았다.
그림의 각도·신체 비율·6초 재생 주기는 도해 파라미터다. 원문 반복 횟수나 강도 증가 제안은 개인 처방으로 옮기지 않았다.

## 파일별 변경

| 파일 | 변경 |
| --- | --- |
| `app/lib/supportedExerciseMotion.ts` | 신규: 두 동작 ID, 쉬운 3단계 안내, 제한과 주의, 고정 접점과 사지 길이를 유지하는 좌표 |
| `app/components/SupportedExerciseFigure.tsx` | 신규: 종아리 측면·옆 다리 정면 SVG 도해 |
| `app/lib/supportedExerciseMotion.test.ts` | 신규: 접점·사지 길이·골반·몸통·주기·경계 검증 4개 |
| `app/lib/exerciseMotion.ts` | 기존 두 ID와 함수를 보존하고 두 새 ID와 안내를 등록 |
| `app/components/ExerciseMotionDemo.tsx` | 기존 재생기에서 새 SVG 및 쉬운 안내·공식 출처 표시 |
| `scripts/check-supported-exercise-motion.cjs` | 신규: 기존 두 동작 회귀와 새 동작 키보드·배속·터치 검사 |
| `docs/exercise-motion/expansion-evidence/*` | 새 검사 결과·크기·스크린샷. 이전 증거 보존 |

공통 목록·페이지·추천·저장 코드는 변경하지 않는다. 주 저장소에서 이미 `ExerciseMotionDemo`를 ID로 호출하므로 별도 패널 연결 패치는 필요 없다.
이전 `guide-integration.patch`와 `exercise-motion-additions.patch`를 다시 적용하지 않는다.

## 적용

`supported-expansion.patch`는 현재 주 저장소에 있는 두 기존 파일을 수정하고 필요한 신규 파일만 추가한다. `.gitignore` 및 이전 문서·검사 스크립트를 수정하지 않는다.
대상 저장소에서 먼저 `git apply --check <패치 절대경로>`를 실행한다. 최신 변경과 충돌하면 덮어쓰지 말고 수동 통합한다.
기준의 두 원본 파일을 읽기 전용으로 가져온 별도 Git 검사 폴더에서 실제 적용·역적용 가능성을 확인했다.

## 검증

- `node --test app/lib/exerciseMotion.test.ts app/lib/supportedExerciseMotion.test.ts`: 7개 통과. 새 종목 각각 201프레임의 손 접점·양팔 길이·발 접점 또는 지지 다리·몸통·범위 검사.
- TypeScript strict 검사 통과. 추가 모듈도 의존 그래프로 검사한다.
- `MOTION_BROWSER_CHANNEL=msedge` 환경에서 `node scripts/check-supported-exercise-motion.cjs <설치 node_modules 경로>` 통과. 라이브러리는 읽기만 하며 네트워크는 차단한다.
- 실제 Edge 렌더러에서 4종 초기 정지, 재생/정지/탐색/끝/반복/다시 재생, ID 변경 초기화, 미지원 ID 확인.
- 키보드 ArrowRight 슬라이더, Enter 정지 자세, Space 재생/정지. 실제 컴포넌트에 제어된 rAF 시계를 넣어 정상/느린 재생 진행량 2:1 확인.
- 동작 줄이기 변경 시 정지 및 정지 자세 버튼, 합성 숨김 이벤트 후 자동 재개 없음.
- 320px 가로 넘침 없음, 390px 터치 에뮬레이션에서 새 두 종목 재생/정지/정지 자세/동작 줄이기 확인.
- 새 두 종목 시작·올린 자세 스크린샷 시각 점검. 실행 소스 크기는 `expansion-evidence/sizes.json`에 기록한다. 래스터 실행 자산은 0바이트다.

## 미검증 및 한계

단순 도해이며 전문 모델·모션 캡처·전문가 자세 검수를 거치지 않았다. 종아리 동작의 발목 좌우 기울기, 옆 다리 동작의 발끝 방향과 앞뒤 기울기, 실제 균형·지지대 안정성은 표현하지 않는다. 옆 다리는 한쪽만 시연한다.
허리 디스크·데드버그 통증 이력을 이유로 안전성을 보장하거나 자동 추천하지 않는다. 화면에 개인 처방이 아님과 통증·저림 중단 기준, 적용 여부의 전문가 확인을 명시했다.
전체 앱 빌드·통합 운동 카드·실물 휴대폰·WebKit·OS 잠금은 미검증이다. 모바일은 Edge 터치 에뮬레이션이며 실제 기기 검증이 아니다.
미리보기는 격리 CSS를 사용하여 주 앱 Tailwind 스타일 검증을 대체하지 않는다. 결과 페이지가 길어 세로 스크롤이 필요하다.
push·배포·DB 쓰기·업로드·유료 서비스 이용은 하지 않았다.
