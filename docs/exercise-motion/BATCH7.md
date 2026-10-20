# 7차: 팔 붙인 밴드 외회전

6차 다음에 `batch7-additions.patch` 적용. 별도 `bandRotationMotion.ts`, `.test.ts`, `BandRotationFigure.tsx`, `check-band-rotation-motion.cjs`를 추가하며 기존 독립 플레이어와 ID 등록만 확장한다.

3차원 전완은 고정 팔꿈치를 중심으로 일정 길이로 회전한다. 정면은 상완/몸통 고정, 윗면은 회전 경로와 몸 앞쪽/반대편 고정점을 보여 준다. 처음 정면에서 전완이 짧게 보이는 것은 투영 겹침임을 화면에 설명한다. 기존 밴드 로우와 달리 팔꿈치가 뒤로 이동하지 않는다.

[AAOS External Rotation](https://www.orthoinfo.org/recovery/rotator-cuff-and-shoulder-conditioning-program/)과 참조 커밋의 `expandedHomeExercises.ts`를 대조했다. 몸 옆에 굽힌 팔꿈치를 유지하며 바깥으로 회전하는 원칙을 반영했다. 원문의 문손잡이 설치·저항·횟수는 채택하지 않았다. 외부 영상/모델/그림은 가져오지 않았다.

검사: 401프레임 3차원 상완/전완 길이, 직각 팔꿈치, 고정 몸통/발/팔꿈치/고정점, 당길 때 늘어나는 밴드, 주기 복귀, 정면의 단축과 윗면 깊이 차이. strict 타입·격리 Edge·320px/200% 글자·44px·키보드/터치·배속·reduced-motion 검사는 `batch7-evidence/after.json`과 PNG로 남긴다.

제한: 한쪽 예시이며 반대쪽은 고정 방향부터 재준비해야 한다. 손목/손가락 그립, 실제 견갑골 운동, 밴드 저항·고정 장치 적합성은 검증하지 못한다. 그림의 각도는 권장 가동범위가 아니다. 전문가 자세 검수·실기기 검증은 미실시다.
