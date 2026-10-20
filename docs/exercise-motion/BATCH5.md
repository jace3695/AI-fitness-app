# 5차 묶음: 밴드 로우

배포 확인 기준 `57b3309426bdd845afae1e2014e10e4f39083b31`. 로컬 기준 `33b62fa1f69e2a5838dd6d1d9087714851d4b898` 이후 변경분이다.
순서: `batch3-additions.patch` → `batch4-additions.patch` → `batch5-additions.patch`. 앞선 패치는 수정하지 않았다.
이 세 패치를 적용하면 기존 배포 5종에 로컬 5종을 추가한다. 총 10종의 도해이며, 전체 30종 중 20종은 미완료다. 실내 걷기는 제자리 예시만, 밴드 로우는 팔꿈치를 굽혀 시작하는 짧은 로우 변형만 구현했다.

## 자산과 소유 범위

- `app/lib/bandRowMotion.ts`: 고정점과 고정 몸통, 일정한 상완/전완 길이를 가진 독창적 측면 좌표 및 한국어 설명.
- `app/components/BandRowFigure.tsx`: 외부 그림·영상·모델 없이 SVG로 그린 몸과 밴드. 장력이 당기는 방향과 개념 고정점을 별도로 표시한다.
- `app/lib/bandRowMotion.test.ts`: 401프레임 고정 접촉점·길이·밴드 길이 증가/감소·입력 경계·주기 복귀. 팔꿈치가 뒤로 이동하는 로우가 기존 컬과 다름을 검사한다.
- `scripts/check-band-row-motion.cjs`: 새 ID의 독립 브라우저 검사. 부모의 기존 접근성 검사 파일은 변경하지 않는다.
- 변경되는 기존 파일은 독립 시범 영역의 `ExerciseMotionDemo.tsx`와 `exerciseMotion.ts`뿐이다. 목록·페이지·추천·저장은 바꾸지 않는다.

## 근거와 한계

[AAOS Shoulder Conditioning / Standing Row](https://www.orthoinfo.org/recovery/rotator-cuff-and-shoulder-conditioning-program/)의 팔꿈치를 몸 옆에 굽힌 상태에서 뒤로 이동하고 천천히 복귀하는 원칙만 참고했다(2026-10-20). 권장 횟수·저항·원문의 문손잡이 설치 방법은 채택하지 않았다. 이미지·영상은 다운로드하거나 복제하지 않았다.

한쪽 팔 경로만 표시한다. 견갑골·손목 회전·밴드 실제 장력·고정 장치 적합성은 검증하지 못한다. 그림 크기·각도는 처방값이 아니다. 전문가 자세 검수, 실물 기기, 스크린리더 발화, WebKit 검사는 미실시다. 허리 질환에 안전하다고 단정하거나 자동 추천하지 않는다.

## 검증과 연결

`node --test app/lib/bandRowMotion.test.ts app/lib/exerciseMotion.test.ts` 5개 통과.

`node scripts/check-band-row-motion.cjs <read-only-node_modules> --ids=band-row --out=batch5-evidence` 통과: strict TypeScript, 실제 Tailwind 스타일, 격리 Edge에서 320px/200% 글자, 44px 조작부, 키보드·터치, 0.5배속, 재생 중 reduced-motion 전환. 실기기 검증은 아니다. 증거 `batch5-evidence/after.json` 및 PNG.

기존 `<ExerciseMotionDemo exerciseId={exercise.id} />` 연결에서 `band-row`가 새로 활성화된다. 이전 버전에서 컴포넌트를 연결하지 않았다면 INTEGRATION.md의 연결 예시만 참고하고 공통 페이지 수정은 부모가 순차 적용한다.

신규 런타임 2개 파일과 기존 2개 파일의 순증가량은 `batch5-evidence/sizes.json`에 기록한다. PNG 검사 증거를 런타임에 import하지 않는다. 외부 리소스 요청은 없으며 신규 패키지는 없다.
