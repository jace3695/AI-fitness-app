export const DRAWING_PROGRAM_ID = "drawing-foundations-v1";
export const DRAWING_PROGRAM_TITLE = "연이의 28회 그림 기초 훈련";
export const DRAWING_DAILY_MINUTES = 18;

export type DrawingSkillId = "baseline" | "line" | "shape" | "form" | "value" | "perspective" | "observation" | "memory" | "composition";
export type DrawingGuideKind =
  | "still-life"
  | "straight-lines"
  | "curves"
  | "ellipses"
  | "flat-shapes"
  | "shape-layout"
  | "cup-spoon"
  | "basic-forms"
  | "cross-contour"
  | "value-scale"
  | "sphere-light"
  | "form-light"
  | "constructed-objects"
  | "two-object-study"
  | "one-point"
  | "two-point"
  | "cylinders"
  | "bounding-box"
  | "negative-space"
  | "three-object-study"
  | "observe-redraw"
  | "memory-redraw"
  | "construction-memory"
  | "light-group"
  | "thumbnails"
  | "new-still-life"
  | "transfer-still-life";

export type DrawingLessonStep = {
  minutes: number;
  label: string;
  instruction: string;
};

export type DrawingLesson = {
  id: string;
  day: number;
  week: number;
  skill: DrawingSkillId;
  title: string;
  purpose: string;
  guide: DrawingGuideKind;
  repetitions: string;
  steps: [DrawingLessonStep, DrawingLessonStep, DrawingLessonStep, DrawingLessonStep, DrawingLessonStep];
  checks: [string, string, string];
  mistake: string;
  correction: string;
  checkpoint?: string;
  checkpointTarget?: number | null;
};

export type DrawingScoreValues = [number, number, number, number, number];

export const DRAWING_SKILL_LABELS: Record<DrawingSkillId, string> = {
  baseline: "시작·비교",
  line: "선 조절",
  shape: "평면 도형",
  form: "입체 형태",
  value: "빛과 명암",
  perspective: "원근",
  observation: "관찰과 비율",
  memory: "관찰 기억",
  composition: "화면 구성",
};

const lesson = (
  input: Omit<DrawingLesson, "id" | "week" | "steps"> & {
    steps: [string, string, string, string, string];
  },
): DrawingLesson => ({
  ...input,
  id: `drawing-day-${String(input.day).padStart(2, "0")}`,
  week: Math.ceil(input.day / 7),
  steps: [
    { minutes: 1, label: "오늘 기술 보기", instruction: input.steps[0] },
    { minutes: 3, label: "가이드 따라 하기", instruction: input.steps[1] },
    { minutes: 8, label: "가이드 없이 반복", instruction: input.steps[2] },
    { minutes: 4, label: "실제 물건에 적용", instruction: input.steps[3] },
    { minutes: 2, label: "비교하고 한 번 수정", instruction: input.steps[4] },
  ],
});

export const DRAWING_LESSONS: DrawingLesson[] = [
  lesson({
    day: 1,
    skill: "baseline",
    title: "지금 실력 그대로 남기기",
    purpose: "28회 뒤 같은 대상을 다시 그려 실제 변화를 확인합니다.",
    guide: "still-life",
    repetitions: "머그컵·사과·작은 상자 정물 1장",
    steps: [
      "예시의 컵·사과·상자가 어디에 놓였는지만 30초간 봅니다.",
      "전체를 감싸는 큰 사각형과 각 물건의 중심 위치만 옅게 표시합니다.",
      "8분 안에 보이는 대로 그립니다. 틀린 선을 지우거나 예쁘게 꾸미지 않습니다.",
      "가능하면 실제 컵과 둥근 물건, 작은 상자를 놓고 큰 모양만 확인합니다.",
      "배치·비율·선·입체·명암을 각 0~2점으로 기록하고 첫 그림을 저장합니다.",
    ],
    checks: ["세 물건이 화면 안에 모두 들어왔다", "현재 실력을 감추려고 덧그리지 않았다", "비교용 첫 그림을 저장했다"],
    mistake: "잘 그려야 한다는 생각 때문에 계속 지우고 고칩니다.",
    correction: "오늘 그림은 작품이 아니라 측정용 출발점입니다. 제한 시간이 끝나면 그대로 저장합니다.",
    checkpoint: "첫 점수는 합격·실패가 없습니다. 28회차 비교 기준으로만 사용합니다.",
    checkpointTarget: null,
  }),
  lesson({
    day: 2,
    skill: "line",
    title: "두 점을 한 번에 잇기",
    purpose: "떨리는 손목선 대신 방향이 분명한 선을 익힙니다.",
    guide: "straight-lines",
    repetitions: "가로·세로·대각선 각 6개, 총 24개",
    steps: [
      "시작점과 끝점을 먼저 본 뒤 선의 경로를 눈으로 훑습니다.",
      "펜을 대지 않고 같은 경로를 두 번 움직인 다음 한 번에 긋습니다.",
      "가로·세로·양쪽 대각선을 각 6개씩 긋고 지나간 선은 덧칠하지 않습니다.",
      "책이나 휴대전화의 곧은 모서리 4개를 한 선으로 옮겨 그립니다.",
      "끝점에서 멀리 벗어난 선 하나만 골라 공중 연습 후 다시 긋습니다.",
    ],
    checks: ["24개의 선을 모두 시도했다", "19개 이상이 끝점 반경 3mm 안에 도착했다", "대부분의 선을 한 번만 그었다"],
    mistake: "정확하게 맞추려고 손목으로 아주 느리게 그어 선이 떨립니다.",
    correction: "팔꿈치와 어깨를 사용해 중간 속도로 긋고, 정확도보다 한 번에 보내는 감각을 먼저 익힙니다.",
  }),
  lesson({
    day: 3,
    skill: "line",
    title: "C선과 S선을 부드럽게",
    purpose: "컵 손잡이·잎·몸체 윤곽에 필요한 곡선을 익힙니다.",
    guide: "curves",
    repetitions: "C선 10개·S선 10개·혼합 곡선 6개",
    steps: [
      "곡선의 시작·가장 볼록한 지점·끝을 차례로 확인합니다.",
      "회색 통로 위를 공중 연습 두 번 후 한 획으로 따라갑니다.",
      "C선 10개, S선 10개, 방향이 바뀌는 곡선 6개를 그립니다.",
      "숟가락이나 안경테의 곡선 3개를 골라 길고 짧게 옮겨 봅니다.",
      "통로를 가장 많이 벗어난 곡선 하나만 다시 그립니다.",
    ],
    checks: ["26개의 곡선을 모두 시도했다", "20개 이상이 폭 4mm 안내 통로 안에 머물렀다", "짧게 끊지 않고 한 획으로 그었다"],
    mistake: "곡선 중간에서 멈추고 여러 선을 이어 붙입니다.",
    correction: "그리기 전에 전체 경로를 공중에서 두 번 움직이고, 틀려도 끝까지 한 번에 갑니다.",
  }),
  lesson({
    day: 4,
    skill: "shape",
    title: "원과 타원을 닫기",
    purpose: "컵 입구와 원기둥을 자연스럽게 그리는 기반을 만듭니다.",
    guide: "ellipses",
    repetitions: "원 10개와 방향별 타원 18개",
    steps: [
      "원과 타원의 중심축, 가장 넓은 지점, 닫히는 지점을 봅니다.",
      "회색 타원을 팔 전체로 두 바퀴 가볍게 따라 그립니다.",
      "원 10개와 가로·세로·기울어진 타원을 각 6개씩 그립니다.",
      "컵 입구와 병 바닥에서 보이는 타원 방향을 찾아 3개 그립니다.",
      "끝이 뾰족하거나 크게 열린 타원 하나를 골라 다시 그립니다.",
    ],
    checks: ["원·타원 28개를 모두 시도했다", "22개 이상이 3mm 이하 틈으로 닫혔다", "타원 14개 이상이 중심축 오차 10° 이하다"],
    mistake: "손목만 돌려 타원 양끝이 뾰족해집니다.",
    correction: "팔꿈치와 어깨로 크게 회전하고, 처음에는 연하게 두 바퀴 그려도 됩니다.",
  }),
  lesson({
    day: 5,
    skill: "shape",
    title: "복잡한 모양을 도형으로 보기",
    purpose: "물건 이름이 아니라 실제 너비·높이·각도를 보게 합니다.",
    guide: "flat-shapes",
    repetitions: "기본 도형 12개와 유기 도형 9개",
    steps: [
      "사각형·삼각형·원과 잎·물방울·구름의 큰 외곽을 비교합니다.",
      "도형을 감싸는 사각형을 먼저 잡고 안쪽 모양을 따라 그립니다.",
      "기본 도형 각 4개, 잎·물방울·구름 각 3개를 크기를 바꿔 그립니다.",
      "리모컨이나 열쇠 한 개를 가장 가까운 도형 2~3개로 나눕니다.",
      "가로세로 비율이 가장 다른 것 하나를 감싸는 상자부터 다시 그립니다.",
    ],
    checks: ["21개 모양을 모두 시도했다", "16개 이상이 예시와 가로세로 비율 오차 15% 이하다", "세부보다 큰 외곽을 먼저 그렸다"],
    mistake: "작은 부분부터 시작해 전체 크기가 맞지 않습니다.",
    correction: "항상 물건 전체를 감싸는 사각형과 중심점을 먼저 표시합니다.",
  }),
  lesson({
    day: 6,
    skill: "observation",
    title: "크기와 위치를 먼저 재기",
    purpose: "눈대중을 기준점 비교로 바꿔 배치 오차를 줄입니다.",
    guide: "shape-layout",
    repetitions: "도형 3개 배열 6세트",
    steps: [
      "각 배열에서 가장 큰 도형과 중심점을 먼저 찾습니다.",
      "큰 범위·중심·끝점만 표시한 뒤 회색 예시와 맞춰 봅니다.",
      "서로 다른 크기의 도형 3개가 있는 배열을 6세트 복사합니다.",
      "책상 위 물건 세 개의 중심 위치만 점으로 찍고 큰 모양을 둘러쌉니다.",
      "위치가 가장 어긋난 한 세트만 기준점을 다시 찍어 수정합니다.",
    ],
    checks: ["6세트를 모두 그렸다", "4세트 이상이 크기 비율 오차 15%·위치 오차 10% 이하다", "중심점과 끝점을 선보다 먼저 표시했다"],
    mistake: "기준점을 잡지 않고 보이는 윤곽부터 그립니다.",
    correction: "가장 큰 도형 하나를 기준 1로 삼고 나머지 크기와 거리를 비교합니다.",
  }),
  lesson({
    day: 7,
    skill: "observation",
    title: "1주차 확인: 컵과 숟가락",
    purpose: "선과 평면 도형이 실제 물건 관찰에 연결됐는지 확인합니다.",
    guide: "cup-spoon",
    repetitions: "컵과 숟가락 관찰화 1장",
    steps: [
      "컵과 숟가락의 전체 범위, 중심, 서로 떨어진 거리를 봅니다.",
      "회색 예시에서 컵의 사각형·타원과 숟가락의 중심선을 찾습니다.",
      "8분 동안 실제 컵과 숟가락을 보고 큰 도형부터 그립니다.",
      "컵 입구 타원과 손잡이 안쪽 빈 공간을 다시 관찰해 표시합니다.",
      "1회차와 같은 10점표로 채점하고 가장 큰 오류 하나만 적습니다.",
    ],
    checks: ["두 물건이 화면 안에 들어왔다", "입구와 손잡이를 도형으로 구성했다", "1주차 점수와 다음 보충 기술을 기록했다"],
    mistake: "컵은 컵처럼 보여야 한다며 알고 있는 상징 모양을 그립니다.",
    correction: "이름을 잠시 잊고 가로세로 비율, 타원 각도, 흰 빈 공간만 비교합니다.",
    checkpoint: "10점 중 5점이 목표입니다. 1~2점 모자라면 가장 낮은 기술을 3분, 3점 이상 모자라면 5분 교정하고 같은 유형을 한 번 재도전합니다.",
    checkpointTarget: 5,
  }),
  lesson({
    day: 8,
    skill: "form",
    title: "상자·원기둥·구 만들기",
    purpose: "평면 도형을 부피가 있는 기본 입체로 바꿉니다.",
    guide: "basic-forms",
    repetitions: "상자 6개·원기둥 6개·구 4개",
    steps: [
      "세 입체의 중심축과 보이지 않는 뒷면이 어디로 이어지는지 봅니다.",
      "회색 순서선 위에 중심축→앞면→깊이 순으로 따라 그립니다.",
      "상자 6개, 원기둥 6개, 구 4개를 방향을 바꿔 구성합니다.",
      "티슈 상자·캔·공을 각각 기본 입체 하나로 단순화합니다.",
      "방향이 가장 헷갈린 형태 하나에 중심축과 뒷면을 다시 표시합니다.",
    ],
    checks: ["16개 입체를 모두 시도했다", "12개 이상에서 앞뒤 방향이 읽힌다", "외곽보다 중심축을 먼저 그렸다"],
    mistake: "외곽선을 먼저 예쁘게 완성해 입체 방향이 흔들립니다.",
    correction: "중심선과 보이지 않는 면을 옅게 먼저 그린 뒤 마지막에 보이는 선만 진하게 합니다.",
  }),
  lesson({
    day: 9,
    skill: "form",
    title: "입체를 감싸는 선",
    purpose: "평평한 모양에 표면 방향과 부피를 더합니다.",
    guide: "cross-contour",
    repetitions: "구·원기둥·상자 각 4개",
    steps: [
      "고무줄이 각 입체 표면을 감싼다고 생각하며 휘어지는 방향을 봅니다.",
      "회색 형태 위에 가로·세로 감싸는 선을 각각 따라 그립니다.",
      "구·원기둥·상자 각 4개에 표면 방향선을 넣습니다.",
      "사과나 물병 한 개에 실제 표면을 감싸는 선 4개를 상상해 표시합니다.",
      "평평해 보이는 형태 하나의 방향선을 더 둥글게 수정합니다.",
    ],
    checks: ["12개 형태를 완성했다", "9개 이상에서 선이 표면 방향에 맞게 휘었다", "형태 중심축과 감싸는 선이 서로 맞는다"],
    mistake: "둥근 물체 위에도 곧고 평평한 선을 긋습니다.",
    correction: "공에 고무줄을 두른 모습을 떠올리고 가장 가까운 부분을 더 크게 휘게 합니다.",
  }),
  lesson({
    day: 10,
    skill: "value",
    title: "밝기 다섯 칸 구분하기",
    purpose: "색 없이도 밝고 어두운 차이를 조절하는 힘을 기릅니다.",
    guide: "value-scale",
    repetitions: "5단계 명암띠 3줄",
    steps: [
      "흰색부터 검정까지 다섯 칸의 차이가 같은 간격인지 봅니다.",
      "맨 밝은 칸과 맨 어두운 칸을 먼저 정하고 중간값을 채웁니다.",
      "5단계 명암띠를 3줄 만들며 각 칸을 한 방향으로 칠합니다.",
      "흰 컵에서 가장 밝은 곳·중간·가장 어두운 곳을 3개 칸으로 적습니다.",
      "붙어 보이는 두 칸만 골라 한쪽 밝기를 조절합니다.",
    ],
    checks: ["명암띠 3줄을 완성했다", "모든 인접 칸이 눈에 구별된다", "처음부터 전체를 진하게 칠하지 않았다"],
    mistake: "첫 칸부터 힘을 주어 중간 이후를 더 어둡게 만들 여지가 없습니다.",
    correction: "흰색·검정·중간 회색을 먼저 고정하고 남은 두 칸을 사이에 넣습니다.",
  }),
  lesson({
    day: 11,
    skill: "value",
    title: "구에 빛 한 방향 주기",
    purpose: "밝음·중간·어두움과 바닥 그림자를 구분합니다.",
    guide: "sphere-light",
    repetitions: "같은 빛을 받는 구 4개",
    steps: [
      "빛 화살표와 반대편 어둠, 바닥 그림자의 방향을 확인합니다.",
      "회색 구 위에 밝음·중간·어두움 경계와 그림자를 따라 표시합니다.",
      "같은 방향에서 빛을 받는 구 4개를 세 단계 명암으로 그립니다.",
      "둥근 과일에 휴대전화 조명을 한쪽에서 비추고 세 밝기를 찾습니다.",
      "빛 방향이 다른 구 하나만 골라 그림자 방향을 다시 맞춥니다.",
    ],
    checks: ["구 4개를 완성했다", "3개 이상에서 빛 반대편이 더 어둡다", "바닥 그림자가 빛의 반대 방향으로 놓였다"],
    mistake: "전체를 같은 회색으로 문질러 입체가 납작해집니다.",
    correction: "먼저 세 덩어리로 분리하고, 마지막 30초에 중간 경계만 조금 부드럽게 합니다.",
  }),
  lesson({
    day: 12,
    skill: "value",
    title: "입체마다 같은 빛 적용하기",
    purpose: "물체가 달라도 한 장 안의 빛 방향을 일치시킵니다.",
    guide: "form-light",
    repetitions: "상자 3개·원기둥 3개·원뿔 2개",
    steps: [
      "화면 왼쪽 위 빛 화살표와 각 입체의 밝은 면을 비교합니다.",
      "회색 예시에 밝은 면·중간 면·어두운 면을 숫자 1·2·3으로 표시합니다.",
      "상자 3개, 원기둥 3개, 원뿔 2개에 같은 방향의 빛을 적용합니다.",
      "책·캔처럼 각진 물건과 둥근 물건 하나씩에서 세 밝기를 찾습니다.",
      "빛 방향이 튄 형태 하나만 지우고 1·2·3 순서부터 다시 표시합니다.",
    ],
    checks: ["8개 입체를 완성했다", "6개 이상에서 밝기 순서가 일치한다", "화면 전체에 빛 방향 하나만 사용했다"],
    mistake: "물체마다 보기 좋은 방향으로 임의의 그림자를 넣습니다.",
    correction: "화면 모서리에 빛 화살표를 고정하고 모든 어두운 면을 반대쪽에 둡니다.",
  }),
  lesson({
    day: 13,
    skill: "form",
    title: "생활 물건을 입체로 분해하기",
    purpose: "세부 묘사 전에 큰 몸통과 축을 찾는 습관을 만듭니다.",
    guide: "constructed-objects",
    repetitions: "컵·물병·티슈 상자 각 1개",
    steps: [
      "세 물건 안에 숨어 있는 상자와 원기둥을 찾아 색으로 구분해 봅니다.",
      "몸통→중심축→작은 부품 순서로 회색 예시를 따라 구성합니다.",
      "컵·물병·티슈 상자를 각각 2분씩 그리고, 남은 2분에 가장 어려운 하나의 입체와 윤곽을 고칩니다.",
      "실제 물건 하나를 골라 몸통·축·부품 세 단계로 다시 그립니다.",
      "세부부터 시작한 물건 하나를 큰 몸통부터 한 번 더 구성합니다.",
    ],
    checks: ["세 물건을 모두 그렸다", "두 개 이상에서 기본 입체가 윤곽과 맞는다", "뚜껑이나 손잡이는 몸통 뒤에 추가했다"],
    mistake: "손잡이·뚜껑·무늬부터 그려 몸통의 크기와 방향을 잃습니다.",
    correction: "몸통 입체가 읽히기 전에는 작은 부품을 그리지 않습니다.",
  }),
  lesson({
    day: 14,
    skill: "value",
    title: "2주차 확인: 컵과 과일",
    purpose: "기본 입체와 세 단계 명암을 실제 정물에 함께 적용합니다.",
    guide: "two-object-study",
    repetitions: "컵과 과일 정물 1장",
    steps: [
      "두 물건의 큰 범위, 겹침, 빛 방향을 먼저 확인합니다.",
      "예시의 기본 입체와 밝음·중간·어두움 세 덩어리를 찾습니다.",
      "8분 동안 실제 컵과 과일을 기본 입체부터 그립니다.",
      "입구 타원과 과일의 바닥 그림자만 다시 관찰해 보완합니다.",
      "10점표로 채점하고 가장 낮은 항목 하나만 표시합니다.",
    ],
    checks: ["두 물건의 기본 입체가 읽힌다", "밝음·중간·어두움이 구분된다", "2주차 점수와 보충 기술을 기록했다"],
    mistake: "작은 반사광과 표면 무늬에 시간을 모두 씁니다.",
    correction: "큰 크기→입체→빛 세 단계가 끝나기 전에는 세부를 생략합니다.",
    checkpoint: "10점 중 6점이 목표입니다. 1~2점 모자라면 가장 낮은 기술을 3분, 3점 이상 모자라면 5분 교정하고 같은 유형을 한 번 재도전합니다.",
    checkpointTarget: 6,
  }),
  lesson({
    day: 15,
    skill: "perspective",
    title: "한 점으로 모이는 상자",
    purpose: "멀어지는 선이 한 방향으로 모이는 공간 원리를 익힙니다.",
    guide: "one-point",
    repetitions: "1점 원근 상자 12개",
    steps: [
      "눈높이선과 소실점 하나, 정면 사각형의 관계를 봅니다.",
      "정면→소실점 선→뒤쪽 면 순으로 회색 예시를 따라 그립니다.",
      "눈높이 위·아래·좌우에 상자 12개를 만들고 깊이선을 연장합니다.",
      "방 안 책상이나 서랍 한 개에서 정면과 멀어지는 선을 찾습니다.",
      "소실점에서 가장 벗어난 상자 하나의 깊이선만 다시 맞춥니다.",
    ],
    checks: ["상자 12개를 그렸다", "10개 이상에서 연장한 깊이선이 소실점 반경 5mm 안을 지난다", "정면의 가로·세로선은 유지했다"],
    mistake: "깊이선을 눈대중으로 제각각 기울입니다.",
    correction: "완성 후 모든 깊이선을 길게 연장해 같은 소실점을 지나는지 확인합니다.",
  }),
  lesson({
    day: 16,
    skill: "perspective",
    title: "두 방향으로 돌아선 상자",
    purpose: "모서리가 나를 향한 물건의 방향을 표현합니다.",
    guide: "two-point",
    repetitions: "2점 원근 상자 8개",
    steps: [
      "수직 모서리와 좌우 두 소실점으로 향하는 선 묶음을 봅니다.",
      "수직선→왼쪽 선군→오른쪽 선군→높이 순서로 따라 그립니다.",
      "높이와 방향을 바꿔 상자 8개를 그립니다.",
      "책이나 작은 상자를 비스듬히 놓고 수직선과 좌우 방향을 표시합니다.",
      "세로선이 기울어진 상자 하나를 수직선부터 다시 만듭니다.",
    ],
    checks: ["상자 8개를 그렸다", "6개 이상에서 세로선 오차가 5° 이하다", "좌우 선 묶음이 각각 같은 방향을 향한다"],
    mistake: "상자의 세로선까지 소실점 쪽으로 기울입니다.",
    correction: "눈높이가 수평인 기본 연습에서는 세로선부터 똑바로 세웁니다.",
  }),
  lesson({
    day: 17,
    skill: "perspective",
    title: "공간 속 원기둥 맞추기",
    purpose: "타원의 중심과 원기둥의 축을 같은 방향으로 유지합니다.",
    guide: "cylinders",
    repetitions: "상자 속 원기둥 8개와 캔 2개",
    steps: [
      "상자 중심선과 타원 중심축이 어떻게 일치하는지 봅니다.",
      "상자→중심축→윗타원→아랫타원 순으로 따라 그립니다.",
      "방향이 다른 상자 안에 원기둥 8개를 넣습니다.",
      "탁자 위 캔이나 컵 2개를 중심축부터 관찰해 그립니다.",
      "위아래 타원이 어긋난 하나를 중심축부터 다시 맞춥니다.",
    ],
    checks: ["형태 10개를 완성했다", "8개 이상에서 두 타원 중심이 축 위에 있다", "윗면과 아랫면 타원의 방향이 일치한다"],
    mistake: "윗타원과 아랫타원을 따로 그려 몸통이 휘어집니다.",
    correction: "긴 중심축 하나를 먼저 긋고 두 타원의 중심이 그 선 위에 오게 합니다.",
  }),
  lesson({
    day: 18,
    skill: "observation",
    title: "감싸는 상자로 비율 맞추기",
    purpose: "복잡한 물건도 전체 너비와 높이부터 정확하게 잡습니다.",
    guide: "bounding-box",
    repetitions: "물병·컵·신발 각 1개",
    steps: [
      "세 물건의 가로세로 비율과 중심선을 숫자로 비교합니다.",
      "감싸는 사각형→중심선→주요 위치 여섯 점을 따라 표시합니다.",
      "물병·컵·신발을 각각 2분씩 측정해 그리고, 남은 2분에 비율이 가장 다른 하나를 고칩니다.",
      "실제 물건 하나의 높이를 1로 보고 너비가 몇 배인지 재어 그립니다.",
      "비율이 가장 다른 물건 하나를 사각형 크기부터 수정합니다.",
    ],
    checks: ["세 물건을 모두 그렸다", "두 개 이상이 가로세로 비율 오차 12%·주요 위치 오차 10% 이하다", "주요 위치점을 윤곽보다 먼저 표시했다"],
    mistake: "물건의 이름과 기억에 의존해 실제 기울기와 비율을 놓칩니다.",
    correction: "‘병’이라고 생각하지 말고 높이 1에 대한 너비, 기울기, 빈 공간만 비교합니다.",
  }),
  lesson({
    day: 19,
    skill: "observation",
    title: "물건 대신 빈 공간 보기",
    purpose: "손잡이와 구멍처럼 틀리기 쉬운 내부 비율을 정확히 봅니다.",
    guide: "negative-space",
    repetitions: "컵·가위·포크의 빈 공간 각 1개",
    steps: [
      "컵 손잡이 안, 가위 구멍, 포크 사이의 흰 공간을 도형처럼 봅니다.",
      "물건 외곽보다 내부의 회색 빈 공간을 먼저 따라 그립니다.",
      "세 물건의 빈 공간을 먼저 그리고 그 주위에 외곽을 붙입니다.",
      "손잡이나 구멍이 있는 실제 물건 하나를 같은 순서로 그립니다.",
      "외곽과 빈 공간이 충돌한 하나에서 빈 공간 모양을 먼저 고칩니다.",
    ],
    checks: ["세 물건의 빈 공간을 먼저 그렸다", "두 개 이상에서 내부와 외곽 위치가 맞는다", "알고 있는 상징 모양 대신 흰 공간을 관찰했다"],
    mistake: "물건 윤곽만 보느라 손잡이 안쪽과 틈의 크기가 틀어집니다.",
    correction: "흰 공간도 색칠되지 않은 하나의 도형이라고 보고 먼저 복사합니다.",
  }),
  lesson({
    day: 20,
    skill: "observation",
    title: "세 물건을 동시에 배치하기",
    purpose: "한 물건씩 완성하지 않고 한 장 전체의 비율을 맞춥니다.",
    guide: "three-object-study",
    repetitions: "상자·캔·과일 정물 1장",
    steps: [
      "세 물건 전체 범위와 겹치는 순서를 봅니다.",
      "전체 범위→세 기본 입체→윤곽→명암 순서를 예시에서 찾습니다.",
      "8분 동안 네 단계를 지키며 세 물건을 동시에 발전시킵니다.",
      "실제 책·캔·과일을 놓고 중심 위치와 겹침만 4분 스케치합니다.",
      "화면 밖으로 잘리거나 크기가 튄 물건 하나만 큰 형태부터 고칩니다.",
    ],
    checks: ["세 물건이 화면 안에 들어왔다", "한 물건만 먼저 완성하지 않았다", "전체→입체→윤곽→명암 네 단계를 지켰다"],
    mistake: "첫 물건을 자세히 끝낸 뒤 나머지를 억지로 끼워 넣습니다.",
    correction: "세 물건의 큰 형태를 모두 놓기 전에는 어느 하나도 세부로 넘어가지 않습니다.",
  }),
  lesson({
    day: 21,
    skill: "observation",
    title: "3주차 확인: 처음 보는 정물",
    purpose: "외운 물건이 아니라 새 대상을 관찰해 옮기는 힘을 확인합니다.",
    guide: "new-still-life",
    repetitions: "처음 보는 세 물건 정물 1장",
    steps: [
      "새 예시의 전체 범위·가장 큰 물건·겹침을 1분간 관찰합니다.",
      "감싸는 상자와 중심축, 기본 입체만 회색 예시 위에 표시합니다.",
      "8분 제한으로 범위→비율→입체→윤곽→명암 순서로 그립니다.",
      "주변의 다른 물건 한 개를 4분 동안 같은 순서로 스케치합니다.",
      "10점표로 채점하고 가장 낮은 항목 하나만 적습니다.",
    ],
    checks: ["처음 보는 대상을 제한 시간 안에 완성했다", "큰 단계 순서를 지켰다", "3주차 점수와 보충 기술을 기록했다"],
    mistake: "연습했던 컵이나 상자만 잘 그리면 실력이 늘었다고 판단합니다.",
    correction: "처음 보는 대상에서도 같은 측정·구성 순서를 사용할 수 있는지 확인합니다.",
    checkpoint: "10점 중 7점이 목표입니다. 1~2점 모자라면 가장 낮은 기술을 3분, 3점 이상 모자라면 5분 교정하고 같은 유형을 한 번 재도전합니다.",
    checkpointTarget: 7,
  }),
  lesson({
    day: 22,
    skill: "observation",
    title: "한 가지 오류만 고쳐 재그리기",
    purpose: "모든 문제를 한꺼번에 고치지 않고 눈에 보이는 개선을 만듭니다.",
    guide: "observe-redraw",
    repetitions: "물건 4개를 관찰·그림·비교·재그림",
    steps: [
      "물건마다 20초 관찰→45초 그리기→15초 비교→40초 재그리기 순서를 봅니다.",
      "예시 하나에서 첫 그림의 가장 큰 비율 오류를 찾아 표시합니다.",
      "물건 4개를 각각 2분의 같은 시간 순서로 그리고 한 번씩 다시 그립니다.",
      "실제 물건 하나를 45초 보고 첫 그림과 수정 그림을 만듭니다.",
      "두 번째 그림에서 좋아진 한 부분에 동그라미를 표시합니다.",
    ],
    checks: ["물건 4개를 두 번씩 그렸다", "세 개 이상에서 한 가지 오차가 줄었다", "한 번에 오류 하나만 수정했다"],
    mistake: "틀린 부분을 전부 고치려다 두 번째 그림도 같은 혼란에 빠집니다.",
    correction: "크기·위치·각도 중 가장 큰 오류 하나만 선택해 다시 그립니다.",
  }),
  lesson({
    day: 23,
    skill: "memory",
    title: "45초 보고 기억으로 그리기",
    purpose: "세부 상징보다 큰 형태·방향·비율을 기억하는 힘을 기릅니다.",
    guide: "memory-redraw",
    repetitions: "물건 4개, 기억 그림과 비교 그림",
    steps: [
      "대상을 볼 때 큰 형태·방향·가로세로 비율을 말로 정리합니다.",
      "예시를 45초 보고 숨긴 뒤 60초 기억 그림을 따라 해봅니다.",
      "물건 4개를 45초 관찰하고 숨긴 뒤 각각 60초 그립니다.",
      "실제 물건 하나도 같은 방식으로 그리고 다시 보며 비교합니다.",
      "빠뜨린 가장 큰 특징 하나를 말한 뒤 한 번만 다시 그립니다.",
    ],
    checks: ["물건 4개를 기억으로 그렸다", "세 개 이상에서 큰 특징을 네 가지 이상 기억했다", "작은 무늬보다 큰 형태와 방향을 먼저 떠올렸다"],
    mistake: "로고나 작은 무늬는 기억하지만 몸통 크기와 방향을 잊습니다.",
    correction: "보기 전에 ‘큰 형태·기울기·너비/높이·부품 위치’를 말로 정리합니다.",
  }),
  lesson({
    day: 24,
    skill: "memory",
    title: "입체 조합으로 기억하기",
    purpose: "복잡한 외곽을 상자·구·원기둥 조합으로 저장합니다.",
    guide: "construction-memory",
    repetitions: "컵·주전자·신발 각 1개, 두 번씩",
    steps: [
      "세 물건의 몸통·축·부품을 기본 입체로 나눠 봅니다.",
      "예시를 보고 입체만 구성한 뒤 화면을 가리고 윤곽을 붙입니다.",
      "컵·주전자·신발을 보고 입체를 찾고, 숨긴 뒤 구성해 그립니다.",
      "실제 복합 물건 하나를 1분 관찰한 뒤 입체 조합만 기억해 그립니다.",
      "원본과 비교해 축이 가장 틀린 하나를 다시 구성합니다.",
    ],
    checks: ["세 물건을 입체 조합으로 그렸다", "두 개 이상에서 두 번째 축과 형태가 좋아졌다", "외곽 모양만 통째로 외우지 않았다"],
    mistake: "복잡한 외곽선을 사진처럼 외우려고 합니다.",
    correction: "몸통 입체 하나, 중심축 하나, 작은 부품 두세 개로 압축해 기억합니다.",
  }),
  lesson({
    day: 25,
    skill: "value",
    title: "여러 입체에 빛 통일하기",
    purpose: "한 화면 안에서 빛과 그림자의 방향을 끝까지 유지합니다.",
    guide: "light-group",
    repetitions: "구·상자·원기둥 두 묶음",
    steps: [
      "한 개의 빛 화살표가 모든 입체에 미치는 방향을 봅니다.",
      "예시 묶음에 밝음·중간·어두움을 숫자로 먼저 표시합니다.",
      "두 묶음의 여섯 형태에 같은 세 단계 명암과 바닥 그림자를 넣습니다.",
      "책상 위 물건 세 개에서 가장 밝은 면과 가장 어두운 면만 찾습니다.",
      "그림자 방향이 다른 하나를 빛 화살표 기준으로 다시 맞춥니다.",
    ],
    checks: ["여섯 형태에 명암을 넣었다", "모든 형태의 빛 방향이 일치한다", "바닥 그림자가 빛 반대편으로 향한다"],
    mistake: "각 물건을 따로 완성해 한 장 안에서 빛이 여러 방향이 됩니다.",
    correction: "작업 내내 화면 모서리의 빛 화살표를 지우지 않습니다.",
  }),
  lesson({
    day: 26,
    skill: "composition",
    title: "작은 구도 여섯 개 비교하기",
    purpose: "큰 그림 전에 크기·간격·겹침을 빠르게 시험합니다.",
    guide: "thumbnails",
    repetitions: "80초 구도 6개와 선택안 1개",
    steps: [
      "세 물건의 높이·간격·겹침이 다른 작은 예시를 비교합니다.",
      "작은 사각형 안에 큰 덩어리 세 개만 30초씩 배치합니다.",
      "같은 물건 세 개로 80초 구도안 6개를 만듭니다.",
      "가장 읽기 쉬운 하나를 골라 4분 동안 크게 옮깁니다.",
      "여백이 한쪽에 몰렸거나 일렬인 부분 하나만 수정합니다.",
    ],
    checks: ["작은 구도 6개를 만들었다", "높이·간격·겹침을 매번 바꿨다", "가장 읽기 쉬운 하나를 크게 옮겼다"],
    mistake: "세 물건을 화면 중앙에 같은 크기로 일렬 배치합니다.",
    correction: "매 구도마다 가장 큰 물건, 겹치는 쌍, 넓은 여백의 위치를 바꿉니다.",
  }),
  lesson({
    day: 27,
    skill: "observation",
    title: "새 정물 한 장 완성하기",
    purpose: "27회 동안 익힌 순서를 처음 보는 대상에 적용합니다.",
    guide: "transfer-still-life",
    repetitions: "처음 보는 정물 1장",
    steps: [
      "전체 범위·가장 큰 형태·빛 방향을 1분간 관찰합니다.",
      "범위→비율→입체→윤곽→명암 다섯 단계를 예시에서 확인합니다.",
      "8분 안에 새 정물을 다섯 단계 순서로 완성합니다.",
      "주변의 작은 물건 하나를 4분 동안 같은 순서로 그립니다.",
      "10점표로 채점하고 순서를 놓친 단계 하나만 적습니다.",
    ],
    checks: ["처음 보는 정물을 제한 시간 안에 완성했다", "다섯 단계 순서를 지켰다", "10점표를 빠짐없이 기록했다"],
    mistake: "마지막 작품이라 생각해 세부부터 예쁘게 꾸밉니다.",
    correction: "검사 목적은 작품성이 아니라 처음 보는 대상에도 같은 과정이 작동하는지 확인하는 것입니다.",
    checkpoint: "10점 중 7점이 목표입니다. 1~2점 모자라면 가장 낮은 기술을 3분, 3점 이상 모자라면 5분 교정하고 같은 유형을 한 번 재도전합니다.",
    checkpointTarget: 7,
  }),
  lesson({
    day: 28,
    skill: "baseline",
    title: "첫날 정물 다시 그리고 비교하기",
    purpose: "같은 조건의 전후 그림으로 실제 변화와 다음 목표를 확인합니다.",
    guide: "still-life",
    repetitions: "1회차와 같은 정물 1장",
    steps: [
      "1회차 그림은 가리고 같은 컵·사과·상자 배치만 다시 봅니다.",
      "전체 범위와 각 물건의 중심, 기본 입체를 옅게 표시합니다.",
      "1회차와 같은 8분 동안 범위→비율→입체→윤곽→명암 순서로 그립니다.",
      "27회차 새 정물과 오늘 그림을 함께 놓고 배운 순서를 확인합니다.",
      "첫 그림과 나란히 비교해 좋아진 세 가지와 다음 한 가지 목표를 기록합니다.",
    ],
    checks: ["첫날과 같은 제한 시간으로 완성했다", "첫 그림과 현재 그림을 나란히 비교했다", "좋아진 점 세 가지와 다음 목표 하나를 적었다"],
    mistake: "익숙한 정물 하나가 좋아진 것만 보고 전체 실력으로 판단합니다.",
    correction: "27회차의 처음 보는 정물 점수도 함께 보며 전이된 기술을 확인합니다.",
    checkpoint: "8점 이상 또는 1회차보다 2점 이상 상승이 1차 목표입니다. 둘 다 미달이면 낮은 기술을 점수 차이에 따라 3분 또는 5분 보충합니다.",
    checkpointTarget: 8,
  }),
];

export const DRAWING_WEEK_SUMMARIES = [
  { week: 1, title: "손과 눈 맞추기", description: "선·곡선·원·도형·위치를 통제합니다." },
  { week: 2, title: "평면을 입체로", description: "상자·원기둥·구와 빛의 세 단계를 익힙니다." },
  { week: 3, title: "비율과 공간 맞추기", description: "원근·중심축·빈 공간·여러 물건 배치를 연습합니다." },
  { week: 4, title: "관찰을 결과로 연결", description: "관찰·기억·수정·구도를 한 장에 연결합니다." },
] as const;

export const DRAWING_CONTINUATION_WEEKS = [
  {
    weeks: "5주",
    title: "복합 생활용품",
    description: "신발·가방·공구를 기본 입체로 분해합니다.",
    sessions: ["신발을 감싸는 상자와 중심축 6회", "가방을 상자·원기둥으로 분해 6회", "가위·펜치를 큰 입체부터 각 4회", "생활용품 3개를 4분씩 관찰", "처음 보는 물건 1개를 10점표로 검사"],
  },
  {
    weeks: "6주",
    title: "방과 가구 원근",
    description: "1점·2점 원근을 실제 공간에 적용합니다.",
    sessions: ["소실점 하나로 방 상자 8개", "책상·선반의 깊이선 각 6개", "두 소실점 상자 8개", "의자·책상을 상자로 단순화해 각 4회", "방 한쪽을 12분 관찰하고 선을 연장해 검사"],
  },
  {
    weeks: "7주",
    title: "재질과 가장자리",
    description: "금속·유리·천·나무를 명암과 경계로 구별합니다.",
    sessions: ["금속 숟가락의 밝기 5단계 4회", "투명 컵의 밝은·어두운 가장자리 4회", "접은 천의 큰 명암 6회", "나무 상자의 면과 결 방향 4회", "서로 다른 재질 2개를 10점표로 검사"],
  },
  {
    weeks: "8주",
    title: "관찰 기억 강화",
    description: "관찰→가리기→기억→비교를 반복합니다.",
    sessions: ["물건 6개를 30초 보고 60초씩 그리기", "물건 4개의 비율 네 가지를 말한 뒤 기억 그림", "생활용품 3개를 입체 조합으로 기억", "같은 물건의 첫 그림·수정 그림 각 4쌍", "처음 보는 물건을 관찰·기억 두 방식으로 검사"],
  },
  {
    weeks: "9주",
    title: "세 분야 체험과 선택",
    description: "제품·캐릭터·풍경의 구조를 한 번씩 체험한 뒤 하나를 고릅니다.",
    sessions: ["제품 체험: 상자·원기둥 조합 12회", "캐릭터 체험: 머리 구와 중심축을 정면·측면·3/4 각 4회", "풍경 체험: 눈높이와 큰 덩어리 6개", "세 체험의 선·비율·입체 항목을 각 0~2점 비교", "가장 다시 그리고 싶은 분야 하나와 이유 기록"],
  },
  {
    weeks: "10주",
    title: "관심 분야 비율·빛",
    description: "9주차에 고른 분야 하나만 이어서 측정합니다.",
    sessions: ["선택 분야 참고 대상 4개의 감싸는 상자·중심축 표시", "큰 구조를 방향을 바꿔 12회", "가로세로 비율과 주요 위치 여섯 점 6회", "같은 대상에 한 방향 빛을 적용해 4회", "처음 보는 같은 분야 대상의 비율·입체·명암을 10점표로 검사"],
  },
  {
    weeks: "11주",
    title: "관심 분야 한 장",
    description: "작은 구도에서 수정까지 한 장의 과정을 연결합니다.",
    sessions: ["80초 구도안 6개", "선택 구도의 큰 구조를 12분 완성", "가장 큰 비율 오류 하나를 찾아 재구성", "한 방향 빛과 세 단계 명암 추가", "18분 완성본에 수정 표시를 더해 나란히 저장"],
  },
  {
    weeks: "12주",
    title: "최종 비교",
    description: "익숙한 대상과 처음 보는 대상을 같은 조건으로 검사합니다.",
    sessions: ["1회차 정물을 같은 8분 조건으로 재검사", "처음 보는 정물을 8분 조건으로 검사", "선·비율·입체·명암 점수 전후 비교", "가장 낮은 기술만 교정해 한 번 재도전", "좋아진 세 가지와 다음 4주 목표 하나 기록"],
  },
] as const;

export function getDrawingLesson(day: number) {
  const safeDay = Math.min(DRAWING_LESSONS.length, Math.max(1, Math.round(day) || 1));
  return DRAWING_LESSONS[safeDay - 1];
}

export function drawingLessonDayFromMetrics(metrics: unknown): number | null {
  if (!metrics || typeof metrics !== "object") return null;
  const record = metrics as Record<string, unknown>;
  if (record.programId !== DRAWING_PROGRAM_ID) return null;
  const day = Number(record.lessonDay);
  return Number.isInteger(day) && day >= 1 && day <= DRAWING_LESSONS.length ? day : null;
}

export function drawingScoresFromMetrics(metrics: unknown): DrawingScoreValues | null {
  if (!metrics || typeof metrics !== "object") return null;
  const values = (metrics as Record<string, unknown>).scores;
  if (!Array.isArray(values) || values.length !== 5 || values.some((value) => !Number.isInteger(value) || Number(value) < 0 || Number(value) > 2)) return null;
  return values as DrawingScoreValues;
}

export function getDrawingScoreAdvice(scores: DrawingScoreValues, targetScore: number | null = 8, baselineTotal?: number) {
  const total = scores.reduce((sum, score) => sum + score, 0);
  if (targetScore === null) return { total, supplementMinutes: 0, label: "비교용 출발점 저장" };
  if (total >= targetScore) return { total, supplementMinutes: 0, label: "이번 체크포인트 목표 달성 · 다음 수업으로 진행" };
  if (baselineTotal !== undefined && total >= baselineTotal + 2) return { total, supplementMinutes: 0, label: `1회차 대비 +${total - baselineTotal}점 · 변화 목표 달성` };
  if (total >= Math.max(0, targetScore - 2)) return { total, supplementMinutes: 3, label: "가장 낮은 기술을 다음 수업 전에 3분 보충" };
  return { total, supplementMinutes: 5, label: "가장 낮은 기술을 5분 교정한 뒤 같은 유형 한 번 재도전" };
}

export function getNextDrawingDay(completedDays: Iterable<number>) {
  const completed = new Set(completedDays);
  return DRAWING_LESSONS.find((item) => !completed.has(item.day))?.day ?? DRAWING_LESSONS.length;
}

async function deterministicUuid(scope: string) {
  const input = new TextEncoder().encode(scope);
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", input)).slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function getDrawingRoutineId(userId: string) {
  return deterministicUuid(`${DRAWING_PROGRAM_ID}:${userId}:routine`);
}

export function getDrawingSessionId(userId: string, lessonId: string) {
  return deterministicUuid(`${DRAWING_PROGRAM_ID}:${userId}:${lessonId}`);
}
