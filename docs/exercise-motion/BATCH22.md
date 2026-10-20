# 22차: 폼롤러 준비 완료 / 회복 부분 시범

기준: 21차 `74cf0c3`. 새 파일 `rollerMotion.ts`, `.test.ts`, `RollerFigure.tsx`, `RollerMotionDemo.tsx`, `check-roller-routine.cjs`. 기존 독립 표시 컴포넌트에 두 카탈로그 ID 분기만 추가한다. 공통 목록·페이지·저장 구조 변경 없음.

- **폼롤러 준비 (`foam-roller-prep`)**: 종아리·앞 허벅지·엉덩이 좌우와 등 위쪽 7장면 + 기존 기본 몸풀기 7장면 = 14단계. 카탈로그의 네 부위 및 마지막 몸풀기 그룹을 모두 제공한다.
- **폼롤러 회복 (`foam-roller-recovery`)**: 기존 9단계 중 위 7개 부위 장면 제공. 바깥 허벅지 좌우 2단계는 명시적인 보류 화면이며 재생 비활성화. **루틴 전체 완료로 세지 않는다.**

## 기하와 표현

반지름 14 모식 단위의 롤러가 바닥에 닿고, 몸이 이동한 거리의 절반만 롤러가 이동하도록 모델링했다. 회전각은 이동거리/반지름과 일치한다. 피부 두께를 나타내는 선의 아래쪽과 롤러 위쪽 접촉을 맞췄다. 하중·압력·연부조직 변형을 계산한 모델은 아니다.

종아리는 양손과 반대 발, 앞 허벅지는 양쪽 전완과 반대 발, 엉덩이는 양손과 반대 발로 지지한다. 엉덩이 장면은 작업 쪽 발목을 반대 무릎에 둔 변형으로 그 접촉을 검사한다. 등 위쪽은 양발과 롤러가 받치며 양손을 머리에 둔다. 기하 검사는 분절·몸통 길이, 고정 지지점, 좌우 대상, 반복 경계, 롤러 바닥/몸 접촉, 관절 및 허리로 넘어가지 않는 한정된 구간을 확인한다. 초록 강조는 해당 연부조직 구간에만 표시하며 허리 전체를 강조하지 않는다.

바닥에 내려가기·일어서기·좌우 전환·장비 설치는 시범에서 생략했다. 각 장면은 이미 준비된 자세에서 시작하며 수동 선택 후 정지한다. 다리 겹치기가 불편하거나 지지가 불안하면 건너뛰도록 설명한다. 힘·시간·횟수를 신규 처방하지 않는다. 동작 크기와 인체 비례는 원본 벡터 모식도이며 사람별 동작 범위나 허리 질환 안전성의 근거가 아니다.

## 대조 자료

외부 텍스트의 자세 원리만 참고했고 그림·모델·영상은 복제하지 않았다. 아래 자료의 치료 효과·횟수·압력·통증 지속 누르기는 채택하지 않았다.

- NASM calf: https://www.nasm.org/resource-center/exercise-library/foam-roll-calves — 뒤 손 지지·종아리 위치 원리. 다리를 겹쳐 압력을 높이는 변형 대신 반대 발 지지.
- Swift Health quadriceps: https://www.swifthealthchiropractic.com/6-foam-roller-exercises-for-beginners/ — 엎드린 전완 지지·앞 허벅지 접촉. 본 시범은 반대 발 지지를 명시한 자체 변형.
- ACE glute: https://www.acefitness.org/resources/pros/expert-articles/5895/recover-faster-and-more-effectively-with-these-foam-roller-moves/ — 한쪽 엉덩이·반대 허벅지에 발목을 놓는 자세 원리.
- Human Kinetics upper back: https://us.humankinetics.com/blogs/excerpt/foam-rolling-exercise-for-the-upper-back — 굽힌 다리와 바닥 발 지지·등 위쪽 위치. 척추 굽힘/폄은 본 시범에 넣지 않음.
- NASM cautions: https://www.nasm.org/resource-center/blog/recovery/foam-rolling-and-self-myofascial-release-the-trainer-application-guide — 관절·요추 직접 압박 제외 및 개인별 판단이 필요한 조건.
- Sports Injury Physio: https://www.sports-injury-physio.com/post/foam-rolling-it-band-dos-and-don-ts — 외측 대퇴 근육과 IT밴드/무릎 통증 부위 직접 압박 구별.

## 회복 보류에 필요한 입력

기존 코드는 “허벅지 바깥쪽”만 지정한다. 이는 외측 대퇴 근육, TFL, IT밴드 직접 압박을 구별하지 않는다. 위 자료도 이들을 같은 것으로 취급하지 않는다. 임의로 표적을 바꾸면 카탈로그 안내와 불일치할 수 있어 좌우 2장면을 보류했다. 필요한 입력은 전문가가 확인한 **정확한 대상 연부조직·피할 구간·지지 자세/변형**이다. 개인 진단기록·사진·계정 접근은 필요하지 않다. 나머지 7장면은 이 판단과 독립적으로 구현·검증했다.

## 검증 및 한계

새 단위 검사 3개, 각 부위 201프레임 검사. strict 타입, 준비 14/회복 9단계의 320px·200% 글자·44px 조작 영역, 키보드·모션 감소·0.5배 속도·단계 초기화·자동 전환 없음·보류 단계 재생 비활성화·언마운트를 임시 headless Edge에서 검사했다. 모든 네트워크 요청 차단. PNG 증거는 준비/회복 별도 폴더에 기록했다. 전문가 자세 검수·앱 본체·실물 기기·스크린리더 음성 검사는 미실시다.

통합 확정: 커밋 `38abadc58eda7e22459a732c89062064d3d666a8`, 런타임 소스 순증 9871 B, 개별 패치 1262922 B. 패치 SHA-256 `4134567675aa3aaa19846e84aaf129d773c6567d0890845771febed6cb230e4e`. 전체 56개 단위 검사 및 별도 적용·역적용 검증 결과는 최종 단일 인계 문서 참조. 크기는 압축 번들이 아니며 문서·PNG 제외 소스 순증이다.
