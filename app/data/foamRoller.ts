export type FoamRollerTiming = "before" | "after" | "both" | "recovery";

export const FOAM_ROLLER_AREAS = ["종아리", "허벅지 앞", "허벅지 바깥쪽", "엉덩이", "등 위쪽"];

export const FOAM_ROLLER_TIMING_LABELS: Record<FoamRollerTiming, string> = {
  before: "운동 전",
  after: "운동 후",
  both: "전후 모두",
  recovery: "회복일",
};

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
  { area: "종아리", guide: "종아리 밑에 폼롤러를 놓고 천천히 굴립니다. 좌우 30초씩 진행합니다. 아픈 부위를 오래 누르지 말고 시원한 정도로만 진행합니다." },
  { area: "허벅지 앞", guide: "엎드린 자세에서 허벅지 앞쪽을 폼롤러에 올리고 천천히 굴립니다. 좌우 30초씩 진행합니다. 무릎 바로 위를 세게 누르지 않습니다." },
  { area: "허벅지 바깥쪽", guide: "옆으로 누워 허벅지 바깥쪽을 가볍게 굴립니다. 좌우 20~30초씩 진행합니다. 통증이 심하면 팔로 체중을 덜어 강도를 낮춥니다." },
  { area: "엉덩이", guide: "폼롤러 위에 엉덩이를 올리고 살짝 좌우로 움직입니다. 좌우 30초씩 진행합니다. 허리 부담이 있는 사람은 허리보다 엉덩이와 골반 주변을 푸는 것이 더 안전합니다." },
  { area: "등 위쪽", guide: "폼롤러를 등 위쪽, 날개뼈 아래쪽에 두고 천천히 굴립니다. 30초~1분 진행합니다. 손으로 머리를 가볍게 받치고 목을 꺾지 않습니다. 허리 아래쪽까지 내려가지 않습니다." },
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
