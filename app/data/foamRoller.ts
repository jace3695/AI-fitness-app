export type FoamRollerTiming = "before" | "after" | "both" | "recovery";

export const FOAM_ROLLER_AREAS = ["종아리", "허벅지 앞", "허벅지 바깥쪽", "엉덩이", "등 위쪽"];

export const FOAM_ROLLER_TIMING_LABELS: Record<FoamRollerTiming, string> = {
  before: "운동 전",
  after: "운동 후",
  both: "전후 모두",
  recovery: "회복일",
};

export const foamRollerAreaOptions = FOAM_ROLLER_AREAS;
export const foamRollerTimingLabels = FOAM_ROLLER_TIMING_LABELS;

export const FOAM_ROLLER_INTRO =
  "폼롤러는 운동을 더 힘들게 만드는 장비가 아니라, 몸을 준비하고 회복을 돕는 도구입니다. 시간이 부족하면 운동 전 3분 또는 운동 후 5분 중 하나만 진행해도 됩니다.";

export const FOAM_ROLLER_BEFORE_ROUTINE = [
  "종아리 30초",
  "허벅지 앞 30초",
  "엉덩이 30초",
  "등 위쪽 30초",
  "가벼운 몸풀기 1분",
];

export const FOAM_ROLLER_AFTER_ROUTINE = [
  "종아리 좌우 30초",
  "허벅지 앞 좌우 30초",
  "허벅지 바깥쪽 좌우 20~30초",
  "엉덩이 좌우 30초",
  "등 위쪽 1분",
];

export const FOAM_ROLLER_RECOVERY_ROUTINE = [
  "폼롤러 회복 5~10분",
  "가벼운 호흡 1~2분",
  "가벼운 스트레칭 3~5분",
];

export const FOAM_ROLLER_AREA_GUIDES = [
  {
    id: "calf",
    area: "종아리",
    duration: "좌우 30초씩",
    purpose: "슬라이딩보드 후 종아리와 발목 주변 긴장 완화",
    steps: [
      "바닥에 앉아 한쪽 종아리 아래에 폼롤러를 둡니다.",
      "양손은 엉덩이 뒤쪽 바닥을 짚어 몸을 지지합니다.",
      "엉덩이를 살짝 들어 종아리에 체중을 조금 실어줍니다.",
      "발목 쪽부터 무릎 아래쪽까지 천천히 굴립니다.",
      "너무 아프면 반대쪽 다리를 바닥에 내려 체중을 줄입니다.",
    ],
    cautions: ["무릎 뒤쪽을 직접 세게 누르지 마세요.", "찌릿한 저림이 있으면 즉시 중단하세요."],
  },
  {
    id: "front-thigh",
    area: "허벅지 앞",
    duration: "좌우 30초씩",
    purpose: "덤벨 스쿼트, 슬라이딩보드 후 허벅지 앞쪽 긴장 완화",
    steps: [
      "엎드린 자세에서 폼롤러를 허벅지 앞쪽 아래에 둡니다.",
      "팔꿈치나 손으로 바닥을 짚어 몸을 지지합니다.",
      "골반 아래쪽부터 무릎 위쪽까지 천천히 굴립니다.",
      "한쪽씩 진행하면 강도를 조절하기 쉽습니다.",
      "너무 아프면 양쪽 허벅지를 동시에 올려 압력을 줄입니다.",
    ],
    cautions: ["무릎뼈 바로 위를 세게 누르지 마세요.", "허리가 꺾이면 복부에 힘을 주고 범위를 줄이세요."],
  },
  {
    id: "outer-thigh",
    area: "허벅지 바깥쪽",
    duration: "좌우 20~30초씩",
    purpose: "루프밴드 사이드워크, 슬라이딩보드 후 허벅지 바깥쪽 긴장 완화",
    steps: [
      "옆으로 누워 폼롤러를 허벅지 바깥쪽 아래에 둡니다.",
      "위쪽 다리는 앞쪽 바닥에 내려 균형을 잡습니다.",
      "팔과 위쪽 다리로 체중을 덜어내며 천천히 굴립니다.",
      "골반 바로 아래부터 무릎 위쪽까지만 진행합니다.",
      "통증이 강하면 아주 짧은 범위만 움직입니다.",
    ],
    cautions: ["처음에는 매우 아플 수 있으므로 강도를 낮게 시작하세요.", "통증을 참으면서 오래 누르지 마세요."],
  },
  {
    id: "glute",
    area: "엉덩이",
    duration: "좌우 30초씩",
    purpose: "허리 부담 감소, 골반 주변 긴장 완화, 둔근 회복",
    steps: [
      "폼롤러 위에 엉덩이를 올리고 앉습니다.",
      "양손은 뒤쪽 바닥을 짚어 몸을 지지합니다.",
      "한쪽 엉덩이에 체중을 살짝 옮깁니다.",
      "작은 범위로 앞뒤 또는 좌우로 천천히 움직입니다.",
      "너무 아프면 체중을 양손과 발로 분산합니다.",
    ],
    cautions: ["허리 아래쪽을 직접 굴리지 마세요.", "다리 저림이 생기면 즉시 중단하세요."],
  },
  {
    id: "upper-back",
    area: "등 위쪽",
    duration: "30초~1분",
    purpose: "밴드 로우, 랫풀다운, 턱걸이 초기자세 후 등 위쪽 긴장 완화",
    steps: [
      "폼롤러를 등 위쪽, 날개뼈 아래쪽에 둡니다.",
      "무릎을 세우고 발은 바닥에 둡니다.",
      "양손으로 머리를 가볍게 받칩니다.",
      "가슴을 살짝 열고 등 위쪽을 천천히 굴립니다.",
      "날개뼈 주변까지만 진행하고 허리 아래쪽까지 내려가지 않습니다.",
    ],
    cautions: ["목을 꺾지 마세요.", "허리 중앙이나 허리 아래쪽을 직접 굴리지 마세요."],
  },
];

export const foamRollerGuides = FOAM_ROLLER_AREA_GUIDES;

export const foamRollerVideoLinks = [
  {
    title: "초보자 폼롤러 사용법",
    source: "HSS",
    description: "폼롤러 기본 사용법과 주의사항을 참고할 수 있는 영상",
    url: "https://www.youtube.com/watch?v=mntOW3zgVbU",
  },
  {
    title: "근육 부위별 폼롤러 사용법",
    source: "MD Anderson",
    description: "종아리, 햄스트링, 대퇴사두근 등 부위별 폼롤러 사용 참고 영상",
    url: "https://www.youtube.com/watch?v=MUTyBF15_sM",
  },
];

export const FOAM_ROLLER_FORBIDDEN = [
  "허리 중앙이나 허리뼈 위를 직접 세게 굴리지 마세요.",
  "목을 강하게 누르지 마세요.",
  "통증 부위를 오래 누르고 버티지 마세요.",
  "다리 저림이 있으면 즉시 중단하세요.",
  "멍들 정도로 세게 하지 마세요.",
  "운동 전 폼롤러를 너무 오래 해서 힘이 빠지게 하지 마세요.",
];

export const FOAM_ROLLER_DISC_WARNING =
  "허리디스크 이력이 있으므로 허리 아래쪽 직접 폼롤링은 금지입니다. 허리 자체보다 종아리, 허벅지, 엉덩이, 등 위쪽을 중심으로 진행하세요.";
