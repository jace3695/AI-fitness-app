# 21차: 기본 정리운동 8장면

20차 후 적용. 기존 안내의 걷기·어깨 뒤로·가슴 열기·앞 허벅지 좌우·종아리 좌우·호흡 정리를 모두 표시한다. 7장면은 움직임, 마지막 호흡은 정지 안내로 재생·반복·속도 버튼을 비활성화한다. 호흡 속도·시간·유지 시간 처방은 추가하지 않았다. 반복은 기본 꺼짐이며 늘렸다 풀기만 모식적으로 보여 준다.

앞 허벅지는 한 손으로 고정 지지대를 잡고 반대 손으로 같은 쪽 발 앞부분을 이미 잡은 변형이다. 잡기·놓기 과정은 생략했다고 명시한다. 종아리는 양손 벽 지지, 앞 무릎 굽힘, 뒤 무릎 펴기와 양발 바닥 접촉을 보존한다. 가슴 열기는 허리 젖힘 없이 팔의 작은 뒤 이동만 표현한다. 각 장면 201프레임에서 분절 길이와 지지 손·발 접촉을 검사한다.

출처는 원본 안내 코드와 아래 동작 원리다. 외부 사진·영상·모델은 복제하지 않았다. 치료 대상·효과·시간·횟수를 이 시범에 옮기지 않았다.

- Hartford HealthCare, standing quad stretch: https://hhcseniorservices.org/health-wellness/health-resources/health-library/detail?id=acl0236&lang=en-us — 지지한 상태의 발 잡기와 무릎 정렬.
- NHS, stretch after exercising: https://www.nhs.uk/live-well/exercise/how-to-stretch-after-exercising/ — 앞 무릎 굽힘, 뒤 다리·뒤꿈치 유지와 벽 지지.

독립 `StagedMotionDemo`로 기존 몸풀기 조작부를 추출하고 새 `CooldownMotionDemo`, `CooldownFigure`, `cooldownMotion.ts`를 추가했다. 연결은 `<ExerciseMotionDemo exerciseId="basic-cooldown" />`이다. 공통 운동 목록·페이지·저장은 변경하지 않았다.

신규 단위 검사 3개 통과. strict 타입 검사, 8장면 320px/200% 글자/44px 목표, 모션 감소, 키보드, 0.5배 속도, 단계 변경 초기화·자동 전환 없음, 언마운트 검사 통과. 몸풀기 회귀 결과는 `batch21-warmup-regression`에 별도로 기록한다. 기존 20차 PNG 증거는 보존했다. 초기 회귀 검사에서 React 언마운트 렌더 전 비교가 한 번 실패해 완료 대기를 추가했다.

전문가 자세 검수·개인별 적합성·앱 본체·실물 기기·스크린리더 음성 검사는 미실시다. 균형이 불안하거나 발을 잡을 수 없으면 해당 장면을 건너뛰도록 안내한다. 허리 질환 안전성을 보장하지 않는다.

통합 확정: 커밋 `74cf0c382507865f8af6b8bf269ca6085c073e5c`, 런타임 소스 순증 7868 B, 개별 패치 754044 B. 패치 SHA-256 `c051eb8eb44ea770d377fe496fb7ea999058763af562706165d65bb3d7e24f43`. 전체 56개 단위 검사 및 별도 적용·역적용 검증 결과는 최종 단일 인계 문서 참조. 크기는 압축 번들이 아니며 문서·PNG 제외 소스 순증이다.
