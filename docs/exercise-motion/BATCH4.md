# 4차 묶음: 실내 제자리 걷기·버드독

누적 적용: 배포 `57b3309` → `batch3-additions.patch`(햄스트링 컬/맨몸 스쿼트) → `batch4-additions.patch`(이번 묶음).
기준 독립 커밋 `2e413fe00d330eff2e29c381fd3c3d750120b227` 이후의 변경만 포함한다. 이전 패치·증거는 보존했다.
합계: 배포 5종 + 이전 로컬 2종 + 이번 로컬 2종 = 제작·로컬 검증 9종 / 카탈로그 30종. 아직 미배포 4종, 미완료 21종이다.

## 서로 다른 구현

- `indoor-walk`: 카탈로그의 실내 걷기 중 제자리 걷기 예시만 구현. 한쪽 다리의 고관절/무릎 굽힘으로 발을 들고 다시 접지한 뒤 반대쪽으로 전환한다. 항상 한 발 이상 바닥에 닿고 팔은 반대 방향으로 움직인다. 전진 보행을 구현했다고 표시하지 않는다.
- `bird-dog`: 오른팔·왼다리를 순서대로 뻗고 네발기기로 복귀한 뒤 왼팔·오른다리로 교대한다. 몸통과 지지 손·무릎을 유지한다. 두 팔다리를 같은 쪽으로 잘못 묶지 않도록 명시적 테스트한다.
- 첫쪽/반대쪽 정지 버튼을 .25/.75에 연결했다. 이전 종목의 .5 정지 버튼은 그대로 유지한다. 색상 범례와 화면 문구가 좌우를 함께 설명한다.

## 공식 근거 (2026-10-20 확인)

- [NHS March on the spot](https://www.nhs.uk/live-well/exercise/how-to-warm-up-before-exercising/): 제자리 교대 걸음과 굽힌 팔의 리듬. 시간·횟수 권고는 옮기지 않았다.
- [AAOS Spine Conditioning / Bird Dog](https://www.orthoinfo.org/recovery/spine-conditioning-program/): 손은 어깨 아래, 무릎은 골반 아래, 한 팔을 먼저 안정시키고 반대 다리를 몸통 높이까지 뻗은 뒤 복귀·교대. 유지 시간·반복 처방은 옮기지 않았다.

외부 그림·영상·모션 데이터는 복제하지 않았고 각도·신체 비율은 독창적인 설명용 좌표다. 의료 처방·안전성 보장·개인 적합성 판단이 아니다.

## 검사

`node --test app/lib/alternatingExerciseMotion.test.ts app/lib/exerciseMotion.test.ts`: 6개 통과.
새 종목 각각 401프레임: 다리/팔 길이, 발 접지 또는 손/무릎 지지, 교대 조합, 몸통 고정, 몸통 위로 다리를 들지 않음, 중간·종료 시작 자세 복귀, 잘못된 입력과 경계 확인.
`node scripts/check-alternating-motion.cjs <node_modules> --ids=indoor-walk,bird-dog --out=batch4-evidence`: strict 타입, 실제 Tailwind 기반 독립 Edge 터치/키보드/0.5배속/reduced-motion/44px/320px/200% 글자 검사 통과.
첫쪽·반대쪽·시작·확대 스크린샷과 결과는 `batch4-evidence/`. 양쪽 최대로 뻗은 버드독과 걷기 첫쪽을 직접 시각 확인했다.

## 파일

신규: `app/lib/alternatingExerciseMotion.ts`, `.test.ts`, `app/components/AlternatingExerciseFigure.tsx`, `scripts/check-alternating-motion.cjs`, 이 문서와 증거.
수정: 기존 독립 `ExerciseMotionDemo.tsx`(교대 도해·문구·정지 버튼), `exerciseMotion.ts`(ID 등록). 공통 목록/페이지/추천/저장과 부모의 검사 파일은 건드리지 않았다.

## 한계와 다음 묶음

실제 체중 이동·균형, 몸통의 좌우 회전, 개인 척추 곡선은 표현하지 못한다. 인간형 선 도해이며 전문가 자세 인증·모션 캡처 결과가 아니다.
실물 기기·WebKit·스크린리더 발화·주 앱 통합은 미검증. 기존 통증 제한은 유지했다. push/배포/개인 기록 변경 없음.
나머지 21종 중 밴드 동작의 근거·시점·고정점을 다음으로 검토한다. 복합 루틴·통증 관련 보류·3차원 회전 동작을 이름만 바꿔 완료 처리하지 않는다.
