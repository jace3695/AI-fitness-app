# 폼롤러 회복: 외측 대퇴사두근 일반 설명의 새 정의

2026-10-26. 기존 원 안내의 의도를 확인했다는 보고가 아니라, **별도로 명명한 일반 정보용 장면**의 개발 기준과 구현 기록이다. 개인에게 적합한 운동·가동 범위·압력·시간을 선택하지 않는다.

## 실제 기능과 보존 범위

- `ExerciseGuidePanel`의 폼롤러 회복 안내에 기본적으로 닫힌 `RollerRecoveryInformationalReview`를 추가했다. 사용자가 설명을 열어야 플레이어가 마운트되고, 별도로 재생해야 움직인다. 닫으면 플레이어를 제거한다.
- `RollerRecoveryReviewDemo`는 기존 `StagedMotionDemo`를 그대로 사용한다. 재생 엔진이나 별도 자동 진행 타이머를 만들지 않았다.
- 기존 7개 `rollerStages` 객체와 `RollerFigure`를 그대로 재사용한다. 그 사이에 `outer-quad-left` / `outer-quad-right`의 새 장면을 배치한 **정보용 9장면**이다.
- 기존 `rollerRecoveryStages`의 `outer-left` / `outer-right` 보류와 구형 `RollerMotionDemo`의 7+2 구성은 보존했다. 이것을 몰래 9개 완료로 바꾸지 않았다.
- `ExerciseMotionDemo('foam-roller-recovery')`는 계속 `null`이다. 개인 운동의 자동 시연 활성화·추천·기록·DB 변경은 없다. 현재 제품 구분은 자동 모션 분기와 별도의 명시적으로 여는 일반 설명이다.
- 원본 `exerciseGuides.ts`의 대상 표현·20~30초 등 기존 시간·중단 기준을 수정하지 않았다. 정보용 장면을 만들었다고 그 시간이나 원 루틴의 개인 적합성을 검증한 것이 아니다.

## 원 안내에서 확인되지 않은 것

`exerciseGuides.ts`의 폼롤러 회복은 “허벅지 바깥쪽”만 말한다. 정확한 조직·접촉 경로·지지 자세의 원출처는 없다. `BATCH22.md` / `NEXT-SCOPE-REVIEW.md`의 문제 제기는 이 모호함이다. 이번에 외측 대퇴사두근을 선택한 것은 명시적인 일반 설명의 작성 결정이지, 원래 뜻을 복원하거나 담당 전문가의 개인 승인을 받았다는 뜻이 아니다.

## 공개 자료에서 채택한 내용

2026-10-26에 공개 원문을 확인했다. 개인 건강정보는 검색어로 보내지 않았다. 아래는 치료 효과·연구 용량·통증 지점 유지 등의 주장을 가져온 표가 아니다.

| 자료 | 이번에 사용하는 좁은 내용 |
|---|---|
| [Doug James, 물리치료사·족부치료사 — intraining](https://intraining.com.au/how-to-use-your-itb-roller-for-recovery/) | 외측 대퇴사두근을 별도로 설명한다. 허벅지 중간의 롤러, 손/팔꿈치와 한 발의 바닥 지지, 근육 길이 방향의 왕복, 골반·무릎의 뼈를 피하는 설명을 채택했다. 양발을 드는 진행형은 채택하지 않았다. |
| [Niki Heeter, PT/DPT — Jacksonville Orthopaedic Institute](https://www.joionline.net/library/foam-roller/) | 외측 대퇴사두근을 IT밴드 자체와 구분한다. 뼈 돌출부·허리 직접 압박을 피하고 팔·다리를 지지에 사용하는 원칙만 채택했다. 개인 통증 대처·압력 증량·분 단위 사용량은 채택하지 않았다. |
| [Maryke Louw, Chartered Physiotherapist — Sports Injury Physio](https://www.sports-injury-physio.com/post/foam-rolling-it-band-dos-and-don-ts) | 기존 BATCH22 출처 재확인. 외측 대퇴사두근·TFL·둔근·IT밴드를 동일시하지 않는다. 가쪽 무릎의 통증 부위 직접 압박 제외를 대조했다. |
| [HSS — Foam Roller Exercises](https://www.hss.edu/health-library/move-better/foam-roller-exercises) | 근육을 대상으로 하고 뼈·관절 위로 굴리지 않는 일반 원칙만 대조했다. |

출처의 권위는 이 SVG의 해부학적 정확성·개인 적합성을 인증하지 않는다. 공개 자료마다 IT밴드 직접 롤링에 관한 표현이 같지는 않으므로 “모든 전문가의 합의”라고 하지 않는다. 출처 사진 링크는 웹 도구의 fetch 실패로 실제 픽셀을 확인하지 못했다. **텍스트 자세 원리 기반의 자체 모식도이며 원본 사진과 시각 비교 완료가 아니다.** 외부 사진·그림·모델을 복제하지 않았다.

## 모션·표시 계약

- 대상: 선택한 쪽 허벅지 중간의 **전외측 대퇴사두근 영역을 나타내는 초록 구간**. 골반 가까운 TFL이나 길게 이어지는 가쪽 IT밴드 띠로 바꾸지 않는다.
- 지지: 아래쪽 전완·반대 손·반대 발. 작업 다리는 편 상태로 유지하고 반대 다리는 굽혀 발을 바닥에 둔다. 두 다리를 쌓아 압력을 더하는 진행형은 없다. 손/팔꿈치 지지 중 이 배열을 택한 것은 모식도 작성 선택이며 특정 개인의 지지 능력 판단이 아니다.
- 경로: 근육 길이 방향으로 이동 후 원위치. 롤러는 바닥 접촉을 유지하고 몸의 이동과 회전이 일치한다. 접촉점은 초록 구간 안에만 있다. 몸통/팔다리 길이와 바닥 지지점은 보존한다.
- 회복 9장면의 순서: 종아리 좌우 → 앞 허벅지 좌우 → **새 정의 외측 대퇴사두근 좌우** → 엉덩이 좌우 → 등 위쪽.
- 부위 판독: 선 인체만으로 앞/옆 근육을 구분할 수 없으므로 **축척 없는 펼친 위치도**를 별도로 둔다. 앞쪽, 가쪽, IT밴드 띠 제외, TFL 제외, 골반/무릎, 현재 접촉 위치의 대응을 명시한다. 초록은 목표 위치이지 IT밴드나 주변 조직의 압력이 0임을 보장하는 표시가 아니다.
- 작은 SVG 글자만으로 의미를 전달하지 않는다. 그림 밖의 일반 HTML 캡션에 전외측 근육 대상·전완/반대 손/발 지지·IT밴드/TFL/골반 뼈/무릎·슬개골 제외를 다시 적었다. 이 텍스트는 줄바꿈·글자 크기 설정을 따르지만, 실제 320px/200% 화면 검증을 대신하지 않는다.
- 제외: 뼈 돌출부, 무릎/슬개골, 가쪽 무릎 통증 부위, 허리. 압력·통증 부위 지속 누르기·새 반복 횟수·실제 거리·각도는 정의하지 않는다.
- 화면 좌표와 몸통 기울기는 그림을 그리기 위한 값이다. 임상적으로 검증된 자세 각도·안전 여유 거리·이동 범위로 해석하지 않는다.
- 반복은 기존 공용 플레이어의 명시적 선택 기능이며 기본 꺼짐이다. 장면 자동 전환은 없다. 바닥 준비·일어서기·좌우 자세 전환은 장면에 포함하지 않는다.

## 검증의 종류

`tests/roller-informational-review.test.ts`는 다음을 검사한다.

- 기존 7개 장면 객체 재사용, 새 ID/순서, 기존 2개 보류 보존.
- 좌우 각 401개 프레임: 몸통·머리·팔다리 분절 길이, 지지점 고정, 바닥 침투 없음, 롤러–바닥/몸 접촉, 대상 구간 내부, 이동/회전 관계.
- 좌우 반사, 실제 이동, 끝점 복귀, 잘못된 progress 제한, 잘못된 접촉/대상/회전 관계를 넣었을 때 검출.
- 실제 컴포넌트의 SSR: 새 9장면의 비정지 변화, 명시적인 위치도, 기본 정지·반복 꺼짐, dispatcher 미활성.
- 실제 GuidePanel의 닫힌 설명 분기, 원본 안내 시간·경고 보존, sourceExerciseId 우선, guide 제거, AB/데드버그 보존.
- 래퍼 상태 전환: 명시적 열기만 실제 설명 컴포넌트를 추가하고 닫으면 제거한다. 래퍼 테스트는 네이티브 toggle 이벤트나 자식 effect 정리를 실행한 브라우저 검사가 아니다.

SSR SVG를 Sharp로 래스터화한 좌우 0 / 0.25 / 0.5 / 1 접촉 시트도 확인했다. 첫 출력에서 어깨 연결이 불명확해 어깨 횡선과 목 선을 추가한 후 다시 확인했다. 정지 샘플에는 눈에 띄는 분리 접촉이나 잘림이 없다. 이 검사는 실제 브라우저·프레임 간 동작 자연스러움·320px/200% 글자·키보드·스크린리더·실물 기기·전문가 자세 검수가 아니다.

검사 명령:

```sh
node --experimental-strip-types --test \
  tests/roller-informational-review.test.ts app/lib/rollerMotion.test.ts \
  tests/pending-motion-criteria.test.ts tests/motion-validation-paths.test.ts
npx eslint app/lib/rollerOuterMotion.ts app/components/RollerOuterFigure.tsx \
  app/components/RollerRecoveryReviewDemo.tsx app/components/RollerRecoveryInformationalReview.tsx \
  app/components/ExerciseGuidePanel.tsx tests/roller-informational-review.test.ts
npx tsc --noEmit --incremental false
git diff --check
```

최종 집중 검사 **25/25 통과**(새 롤러 검사 9 + 기존 롤러 3 + 기준 계약 7 + 구성 회귀 6), 실패·건너뜀 0. 위 대상 ESLint, 프로젝트 타입 검사, diff 공백 검사도 통과했다. 전체 테스트·전체 빌드는 이 작업의 검사 범위가 아니다. 최초 테스트의 VM에 NODE_ENV가 없어 실제 guide 읽기가 실패했으며, 테스트 전용 환경값을 명시한 뒤 재실행해 통과했다. 이전 동시 작업의 타입 오류도 해결된 최종 트리에서 타입 검사를 재실행했다.

정지 이미지: `/tmp/roller-review-20261026/contact-sheet.png` (임시 로컬 증거). 외부 전문가 검수나 브라우저 캡처가 아니다. 이 문서의 로컬 정보 기능 구현을 운영 배포 또는 사용자 실사용 검증으로 보고하지 않는다.
