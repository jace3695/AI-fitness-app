# 8차: 밴드 풀어파트

7차 다음 `batch8-additions.patch` 적용. 기존 목록/페이지/저장 및 OCR 변경 없음. 신규 `pullApartMotion.ts`, `.test.ts`, `PullApartFigure.tsx`, `check-pull-apart-motion.cjs`; 독립 플레이어/ID 등록만 확장한다.

양팔의 상완/전완은 일정한 길이와 작은 팔꿈치 굽힘을 유지하며 어깨를 중심으로 벌어진다. 손은 가슴 높이를 유지한다. 윗면은 정면에 숨은 깊이를 보여 준다. 외회전처럼 팔꿈치를 고정하는 동작으로 재명명하지 않았으며, 밴드 로우처럼 팔꿈치를 뒤로 당기지 않는다. 한 변형과 예시 범위만 표시한다.

[Fukunaga 등, IJSPT 2022](https://ijspt.scholasticahq.com/article/33026-band-pull-apart-exercise-effects-of-movement-direction-and-hand-position-on-shoulder-muscle-activity)의 수평 벌림 및 손바닥 아래 방향 변형을 확인했다. 근활성 수치·피험자 저항·반복 처방을 사용자에게 적용하지 않았다. 독창적인 기하 코드이며 논문 이미지나 외부 서비스 영상/모델을 복제하지 않았다.

검사: 401프레임 양팔 길이·팔꿈치 굽힘·고정 몸통/발·손 높이·대칭·밴드 길이 증가/감소·몸통 앞쪽의 밴드 경로·주기 복귀. 별도 브라우저 검사와 PNG 증거는 `batch8-evidence/`.

한계: 팔 길이는 실제 신체 측정값이 아니며 손가락 그립, 미세한 상완 축 회전, 견갑골은 단순화했다. 실물 밴드 허용 신장률/저항을 표현하지 않는다. 통증/저림과 허리 과신전 시 중단 안내 및 전문가·실기기 검증 미실시를 유지한다.
