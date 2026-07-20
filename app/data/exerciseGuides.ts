import { ExerciseGuide } from './workouts';

export type ExerciseGuideEntry = ExerciseGuide & { summary: string; purpose: string; homeTips?: string[]; alternatives?: string[]; videoTitle?: string };

const stopDefault = ['통증이 있으면 즉시 중단하세요.', '허리 통증이나 다리 저림이 있으면 회복 모드로 전환하세요.', '반동으로 하지 말고 천천히 진행하세요.'];

export const fallbackExerciseGuide = (name: string, summary?: string): ExerciseGuideEntry => ({
  summary: summary || '이 운동의 상세 설명이 아직 등록되지 않았습니다. 자세가 불안하면 무리하지 말고 회복 모드로 전환하세요.',
  purpose: summary || '안전한 범위에서 몸을 움직이고 컨디션을 확인합니다.',
  setup: ['통증 없는 편안한 자세에서 시작합니다.', '허리와 무릎에 부담이 느껴지면 범위를 줄입니다.'],
  movement: [summary || `${name} 동작을 천천히 진행합니다.`],
  breathing: '숨을 참지 말고 편하게 내쉬며 진행합니다.',
  target: summary || name,
  commonMistakes: ['빠르게 진행함', '통증을 참고 계속함'],
  stopCriteria: stopDefault,
  keyPoint: summary || '빈 화면 방지를 위한 기본 안전 가이드입니다.',
  videoSearchQuery: `${name} 운동 자세`,
});

export const exerciseGuides: Record<string, ExerciseGuideEntry> = {


  'cat-cow': { id: 'cat-cow', name: '캣카우', category: 'warmup', reps: '6~8회', summary: '등과 골반을 부드럽게 움직여 허리 주변 긴장을 낮추는 운동', purpose: '허리 주변 긴장 완화, 척추 움직임 회복, 운동 전 준비', setup: ['네발기기 자세를 만듭니다.', '손은 어깨 아래, 무릎은 골반 아래에 둡니다.', '통증 없는 범위에서 천천히 움직입니다.'], movement: ['숨을 들이마시며 가슴을 살짝 열고 허리를 아주 가볍게 내려줍니다.', '숨을 내쉬며 등을 둥글게 말고 배를 살짝 당깁니다.', '목을 과하게 젖히거나 숙이지 않습니다.', '천천히 6~8회 반복합니다.'], breathing: '들이마시며 열고, 내쉬며 등을 둥글게 만듭니다.', target: '허리 주변 긴장 완화, 척추 움직임 회복', commonMistakes: ['허리를 과하게 꺾음', '빠르게 반동으로 진행'], stopCriteria: ['허리를 과하게 꺾지 마세요.', '통증이 있으면 범위를 줄이거나 중단하세요.', '빠르게 반동으로 하지 마세요.'], keyPoint: '허리 운동이라기보다 부드럽게 움직여 몸을 깨우는 운동으로 생각하세요.', homeTips: ['허리 운동이라기보다 부드럽게 움직여 몸을 깨우는 운동으로 생각하세요.'] },
  'pelvic-tilt': { id: 'pelvic-tilt', name: '골반 기울이기', category: 'core', reps: '8~10회', summary: '누운 자세에서 골반을 작게 움직이며 허리 중립 감각을 익히는 운동', purpose: '허리 중립 감각 회복, 복부 힘 조절, 허리 부담 감소', setup: ['바닥에 누워 무릎을 세웁니다.', '발바닥은 바닥에 두고 어깨 힘은 뺍니다.', '허리를 과하게 누르거나 띄우지 않습니다.'], movement: ['배에 가볍게 힘을 줍니다.', '허리가 바닥에 살짝 가까워지도록 골반을 작게 말아줍니다.', '1초 유지한 뒤 다시 중립으로 돌아옵니다.', '허리가 과하게 뜨지 않게 조절합니다.', '천천히 8~10회 반복합니다.'], breathing: '골반을 말 때 숨을 내쉬고, 돌아올 때 들이마십니다.', target: '허리 중립 감각, 복부 힘 조절', commonMistakes: ['큰 동작으로 진행', '복부 힘이 풀림'], stopCriteria: ['큰 동작으로 하지 마세요.', '허리 통증이 있으면 중단하세요.', '복부 힘이 풀리면 잠시 쉬었다가 진행하세요.'], keyPoint: '작은 움직임으로 허리 중립을 찾는 연습입니다.', homeTips: ['작은 움직임으로 허리 중립을 찾는 연습입니다.'] },
  'sliding-board-cardio': { id: 'sliding-board-cardio', name: '슬라이딩보드', category: 'cardio', duration: '20~30분', summary: '체지방 감량 보조와 활동량 증가를 위한 저강도 유산소', purpose: '체지방 감량 보조, 하체 순환, 활동량 증가', setup: ['슬라이딩보드 주변에 걸리는 물건이 없는지 확인합니다.', '처음 2~3분은 아주 천천히 시작합니다.', '균형이 흔들리면 속도를 낮춥니다.'], movement: ['양발을 슬라이딩보드 위에 올립니다.', '좌우로 천천히 이동하며 몸을 데웁니다.', '호흡이 너무 가빠지지 않는 속도를 유지합니다.', '중간에 허리나 무릎 불편감이 있으면 즉시 멈춥니다.', '마지막 2~3분은 속도를 낮추며 마무리합니다.'], breathing: '대화가 가능한 정도로 편하게 호흡합니다.', target: '체지방 감량 보조, 하체 순환, 활동량 증가', commonMistakes: ['처음부터 빠르게 진행', '통증을 참고 지속'], stopCriteria: ['처음부터 빠르게 하지 마세요.', '허리 통증이나 무릎 통증이 있으면 중단하세요.', '다리에 힘이 풀리면 즉시 쉬세요.'], keyPoint: '토요일에는 무리해서 오래 하기보다 꾸준히 움직이는 것을 목표로 합니다.', homeTips: ['토요일에는 무리해서 오래 하기보다 꾸준히 움직이는 것을 목표로 합니다.'] },
  'indoor-walk': { id: 'indoor-walk', name: '실내 걷기', category: 'cardio', duration: '20~30분', summary: '집 안에서 가볍게 걷거나 제자리 걷기로 활동량을 늘립니다.', purpose: '가벼운 유산소, 활동량 증가, 회복 보조', setup: ['미끄럽지 않은 바닥에서 진행합니다.', '방해물이 없는 공간을 확보합니다.'], movement: ['천천히 걷기 또는 제자리 걷기로 시작합니다.', '팔을 가볍게 흔들며 20~30분 진행합니다.', '숨이 너무 차면 속도를 낮춥니다.', '마지막 2~3분은 천천히 걸으며 마무리합니다.'], breathing: '대화가 가능한 정도로 호흡합니다.', target: '가벼운 유산소, 활동량 증가', commonMistakes: ['숨찰 정도로 빠르게 걸음'], stopCriteria: ['무릎 통증이 있으면 시간을 줄이세요.', '어지러우면 즉시 앉아서 쉬세요.'], keyPoint: '날씨와 상관없이 가볍게 진행합니다.' },
  'outdoor-walk': { id: 'outdoor-walk', name: '야외 산책', category: 'cardio', duration: '30분', summary: '밖에서 가볍게 걸으며 활동량을 늘립니다.', purpose: '가벼운 유산소, 스트레스 완화, 감량 보조', setup: ['편한 신발을 착용합니다.', '무리하지 않는 평지 코스를 선택합니다.'], movement: ['처음 5분은 천천히 걷습니다.', '중간 20분은 대화 가능한 속도로 걷습니다.', '마지막 5분은 속도를 낮춰 마무리합니다.'], breathing: '대화 가능한 강도를 유지합니다.', target: '가벼운 유산소, 스트레스 완화', commonMistakes: ['더위나 통증을 참고 진행'], stopCriteria: ['허리나 무릎 통증이 있으면 중단하세요.', '더위나 어지럼이 있으면 무리하지 마세요.'], keyPoint: '컨디션이 괜찮을 때 가볍게 걷습니다.' },
  'basic-warmup': { summary: '폼롤러 후 관절을 부드럽게 움직여 본운동을 준비합니다.', purpose: '관절 가동성 확보, 체온 상승, 허리·무릎 부담 감소', setup: ['좁지 않은 공간에서 편하게 섭니다.', '통증 없는 범위에서 천천히 움직입니다.', '반동을 주지 않습니다.'], movement: ['목과 어깨를 가볍게 돌립니다.', '어깨를 앞뒤로 천천히 5회씩 돌립니다.', '골반을 좌우로 천천히 움직입니다.', '무릎을 살짝 굽혔다 펴며 하체를 깨웁니다.', '발목을 좌우 5회씩 돌립니다.', '제자리 걷기를 30초~1분 진행합니다.'], breathing: '편하게 호흡합니다. 숨을 참지 않습니다.', target: '관절 가동성, 체온 상승', commonMistakes: ['허리를 크게 돌림', '통증 방향으로 억지로 움직임'], stopCriteria: ['허리를 크게 돌리지 마세요.', '통증이 있는 방향으로 억지로 움직이지 마세요.', '어지럽거나 균형이 흔들리면 멈추세요.'], keyPoint: '운동 전에는 땀이 많이 날 정도가 아니라 몸이 부드러워지는 정도만 진행하세요.' },
  'basic-cooldown': { summary: '운동 후 호흡을 정리하고 몸을 천천히 회복 상태로 전환합니다.', purpose: '호흡 안정, 심박 안정, 근육 긴장 완화', setup: ['운동 직후 바로 눕지 말고 천천히 서 있거나 앉습니다.', '숨이 차면 먼저 제자리 걷기로 호흡을 가라앉힙니다.'], movement: ['제자리에서 천천히 걷거나 좌우로 가볍게 움직입니다.', '어깨를 천천히 뒤로 돌립니다.', '가슴을 가볍게 열어 호흡을 정리합니다.', '허벅지 앞쪽과 종아리를 가볍게 늘립니다.', '마지막 30초는 천천히 코로 들이마시고 입으로 내쉽니다.'], breathing: '코로 들이마시고 입으로 천천히 내쉽니다.', target: '호흡 안정, 심박 안정, 근육 긴장 완화', commonMistakes: ['허리를 강하게 숙임', '반동을 주는 스트레칭'], stopCriteria: ['허리를 강하게 숙여 늘리지 마세요.', '반동을 주는 스트레칭은 하지 마세요.', '어지러우면 앉아서 호흡을 먼저 정리하세요.'], keyPoint: '운동 후 바로 멈추기보다 3~5분 정도 천천히 몸을 식히세요.' },
  '폼롤러 준비': { summary: '운동 전 몸을 깨우는 3분 폼롤러 준비', purpose: '운동 전 몸을 부드럽게 깨우고, 종아리·허벅지·엉덩이·등 위쪽 긴장을 줄입니다.', setup: ['폼롤러를 바닥에 두고 통증 없는 압력으로 시작합니다.'], movement: ['종아리 30초', '허벅지 앞 30초', '엉덩이 30초', '등 위쪽 30초', '가볍게 몸풀기 1분'], breathing: '굴릴 때 숨을 참지 않고 천천히 내쉽니다.', target: '종아리·허벅지·엉덩이·등 위쪽 긴장 완화', commonMistakes: ['허리 아래쪽을 직접 굴림', '통증 부위를 오래 누름'], stopCriteria: ['허리 아래쪽을 직접 굴리지 마세요.', '통증 부위를 오래 누르지 마세요.', '다리 저림이 있으면 즉시 중단하세요.'], keyPoint: '허리 아래쪽은 피하고 가볍게 몸을 깨우는 정도로만 진행합니다.' },
  '운동 전 묵주기도 슬라이딩보드': { summary: '기도와 저강도 유산소를 함께하는 운동 전 준비 시간', purpose: '기도와 저강도 유산소를 함께하는 운동 전 준비 시간입니다. 체온을 올리고 감량을 보조합니다.', setup: ['슬라이딩보드 위에 안정적으로 올라섭니다.', '균형이 흔들리면 벽이나 손잡이 가까이에서 시작합니다.'], movement: ['슬라이딩보드 위에서 천천히 좌우로 이동합니다.', '처음 2~3분은 아주 가볍게 시작합니다.', '묵주기도를 이어갈 수 있을 정도의 속도를 유지합니다.', '숨이 너무 차면 속도를 줄입니다.', '허리나 무릎 통증이 있으면 즉시 중단합니다.'], breathing: '기도를 이어갈 수 있을 정도로 편하게 호흡합니다.', target: '체온 상승, 저강도 유산소, 감량 보조', commonMistakes: ['처음부터 빠르게 움직임', '균형이 흔들리는데 속도를 유지함'], stopCriteria: ['운동 전부터 지칠 정도로 빠르게 하지 마세요.', '균형이 흔들리면 속도를 낮추세요.', '기도를 이어갈 수 없는 강도라면 너무 강한 것입니다.'], keyPoint: '기도가 이어지는 강도가 오늘의 적정 강도입니다.' },
  '묵주기도 슬라이딩보드': { summary: '기도를 이어갈 수 있는 저강도 슬라이딩보드', purpose: '가볍게 체온을 올리고 회복을 방해하지 않는 유산소를 진행합니다.', setup: ['슬라이딩보드 위에 안정적으로 올라섭니다.'], movement: ['천천히 좌우 이동합니다.', '기도가 끊기지 않는 속도를 유지합니다.', '컨디션이 좋으면 5분만 추가합니다.'], breathing: '대화와 기도가 가능한 호흡을 유지합니다.', target: '저강도 유산소와 회복', commonMistakes: ['회복일에 강도를 높임'], stopCriteria: stopDefault, keyPoint: '회복일에는 가볍게 끝내는 것이 목표입니다.' },
  '버드독': { summary: '허리 안정화와 코어 조절을 돕는 운동', purpose: '허리 안정화, 코어 조절, 골반 흔들림 감소', setup: ['네발기기 자세를 만듭니다.', '손은 어깨 아래, 무릎은 골반 아래에 둡니다.'], movement: ['배에 힘을 주고 허리를 중립으로 유지합니다.', '오른팔과 왼다리를 천천히 뻗습니다.', '몸통이 흔들리지 않게 1~2초 유지합니다.', '천천히 돌아와 반대쪽도 진행합니다.'], breathing: '뻗을 때 숨을 내쉬고, 돌아올 때 들이마십니다.', target: '허리 안정화, 코어 조절, 골반 흔들림 감소', commonMistakes: ['허리가 꺾임', '다리를 높이 차올림'], stopCriteria: ['허리가 꺾이면 팔 또는 다리만 따로 진행하세요.', '다리를 높이 차올리지 마세요.', '다리 저림이 있으면 중단하세요.'], keyPoint: '높이보다 몸통이 흔들리지 않는 것이 중요합니다.' },
  '힙브릿지': { summary: '엉덩이 근육을 깨워 허리 부담을 줄이는 운동', purpose: '엉덩이 근육 활성화, 허리 부담 감소, 골반 안정화', setup: ['바닥에 누워 무릎을 세웁니다.', '발은 골반 너비로 벌리고 발바닥을 바닥에 둡니다.'], movement: ['배에 힘을 주고 엉덩이를 조입니다.', '허리를 꺾지 않고 엉덩이를 천천히 들어 올립니다.', '위에서 1초 멈춘 뒤 천천히 내려옵니다.'], breathing: '올릴 때 숨을 내쉬고 내려오며 들이마십니다.', target: '둔근, 골반 안정성', commonMistakes: ['허리로 들어 올림', '무릎이 안쪽으로 모임'], stopCriteria: ['허리로 들어 올리지 말고 엉덩이 힘으로 올리세요.', '허리가 뻐근하면 높이를 낮추세요.', '무릎이 안쪽으로 모이지 않게 하세요.'], keyPoint: '허리가 아니라 엉덩이 힘으로 들어 올립니다.' },
  '데드버그': { summary: '누운 자세에서 복부 안정성을 회복하는 운동', purpose: '복부 안정화, 허리 중립 유지, 코어 조절', setup: ['바닥에 누워 양팔을 천장으로 올립니다.', '무릎을 90도로 들어 올립니다.'], movement: ['허리가 바닥에서 과하게 뜨지 않게 복부에 힘을 줍니다.', '오른팔과 왼다리를 천천히 멀리 뻗습니다.', '허리가 뜨기 전 범위까지만 움직입니다.', '천천히 돌아와 반대쪽도 진행합니다.'], breathing: '팔다리를 뻗을 때 숨을 내쉽니다.', target: '복부 안정화, 허리 중립 유지', commonMistakes: ['허리가 뜸', '빠르게 움직임'], stopCriteria: ['허리가 뜨면 다리를 멀리 뻗지 마세요.', '빠르게 하지 마세요.', '허리 통증이 있으면 팔만 움직이세요.'], keyPoint: '허리가 뜨기 전까지만 작게 움직입니다.' },
  '무릎 사이드 플랭크': { summary: '옆구리와 골반 안정성을 낮은 강도로 키우는 운동', purpose: '옆구리 코어, 골반 안정화, 허리 부담 감소', setup: ['무릎을 굽힌 옆으로 누운 자세를 만듭니다.', '팔꿈치는 어깨 아래에 둡니다.'], movement: ['배에 힘을 주고 골반을 천천히 들어 올립니다.', '몸통이 앞뒤로 흔들리지 않게 유지합니다.', '정해진 시간 후 천천히 내려옵니다.'], breathing: '버티는 동안 짧게 숨을 참지 말고 천천히 호흡합니다.', target: '옆구리 코어와 골반 안정성', commonMistakes: ['어깨가 귀 쪽으로 올라감', '골반이 뒤로 빠짐'], stopCriteria: ['허리 통증이 있으면 즉시 중단하세요.', '어깨 통증이 있으면 시간을 줄이세요.', '몸통이 무너지면 쉬었다가 진행하세요.'], keyPoint: '짧게 하더라도 몸통을 일직선에 가깝게 유지합니다.' },
  'AB 슬라이더 준비 자세': { summary: 'AB 슬라이더 전 복부 힘과 허리 안정성을 확인', purpose: 'AB 슬라이더를 하기 전 복부 힘과 허리 안정성을 확인합니다.', setup: ['무릎을 바닥에 대고 AB 슬라이더를 양손으로 잡습니다.', '배에 힘을 주고 갈비뼈가 들리지 않게 합니다.'], movement: ['허리가 아래로 꺾이지 않게 중립을 유지합니다.', '1~2주차에는 앞으로 밀지 않고 시작 자세만 5초 유지합니다.', '통증이 없을 때만 3~4주차부터 10~20cm 짧게 밀 수 있습니다.'], breathing: '버티는 동안 숨을 참지 말고 짧게 내쉽니다.', target: '복부 힘, 허리 안정성', commonMistakes: ['처음부터 멀리 밈', '복부 힘이 풀림'], stopCriteria: ['허리 통증 또는 다리 저림이 있으면 즉시 중단하세요.', '처음부터 멀리 밀지 마세요.', '복부 힘이 풀리면 중단하세요.'], keyPoint: '준비 자세가 안정적일 때만 짧게 진행합니다.' },
  '운동 후 슬라이딩보드 마무리': { summary: '운동 후 몸을 정리하는 가벼운 유산소', purpose: '운동 후 가벼운 유산소로 감량을 보조하고 몸을 정리합니다.', setup: ['근력운동이 끝난 뒤 호흡이 안정된 상태에서 시작합니다.'], movement: ['근력운동이 끝난 뒤 아주 가볍게 시작합니다.', '숨이 편한 정도로 좌우 이동합니다.', '허리나 무릎에 부담이 없으면 5분 진행합니다.', '피곤하거나 통증이 있으면 생략합니다.'], breathing: '편한 호흡을 유지하고 숨이 차면 바로 줄입니다.', target: '가벼운 유산소, 몸 정리, 감량 보조', commonMistakes: ['운동 후 속도를 올림', '피곤한데 억지로 진행함'], stopCriteria: ['운동 후에는 속도를 올리지 마세요.', '다리에 힘이 풀린 느낌이 있으면 하지 마세요.', '허리나 무릎 통증이 있으면 즉시 중단하세요.'], keyPoint: '마무리는 선택이며 피곤하면 생략해도 됩니다.' },
  '폼롤러 회복': { summary: '운동 후 긴장을 줄이고 회복을 돕는 폼롤러', purpose: '운동 후 종아리, 허벅지, 엉덩이, 등 위쪽 긴장을 줄이고 회복을 돕습니다.', setup: ['통증 없는 압력으로 폼롤러 위에 몸을 올립니다.'], movement: ['종아리 좌우 30초', '허벅지 앞 좌우 30초', '허벅지 바깥쪽 좌우 20~30초', '엉덩이 좌우 30초', '등 위쪽 1분'], breathing: '긴장을 풀며 천천히 내쉽니다.', target: '하체와 등 위쪽 회복', commonMistakes: ['허리 아래쪽을 직접 굴림', '멍들 정도로 세게 누름'], stopCriteria: ['허리 아래쪽을 직접 굴리지 마세요.', '멍들 정도로 세게 하지 마세요.', '찌릿한 저림이 있으면 중단하세요.'], keyPoint: '강하게 누르는 것보다 회복 가능한 압력이 중요합니다.' },
  '턱걸이 초기자세': { summary: '문틀 철봉 적응과 어깨 안정화 준비', purpose: '문틀 철봉 적응, 어깨 안정화, 턱걸이 준비', setup: ['철봉을 양손으로 잡고 발은 바닥에 둡니다.'], movement: ['어깨를 귀에서 멀어지게 살짝 내립니다.', '팔로 매달리기보다 등과 어깨 주변에 힘을 느납니다.', '발로 체중을 보조하면서 짧게 버팁니다.', '통증이 없으면 3~5분 안에서 여러 번 나누어 진행합니다.'], breathing: '버틸 때 숨을 참지 말고 짧게 내쉽니다.', target: '어깨 안정화, 등 활성화, 턱걸이 준비', commonMistakes: ['완전 매달리기를 무리함', '허리를 과하게 젖힘'], stopCriteria: ['어깨 통증이 있으면 중단하세요.', '완전 매달리기를 무리해서 하지 마세요.', '허리가 과하게 젖혀지지 않게 하세요.'], keyPoint: '발 보조를 사용해 안전하게 철봉에 적응합니다.' },
  '덤벨 고블릿 스쿼트': { summary: '가벼운 덤벨로 하체와 엉덩이를 강화', purpose: '하체 근력, 엉덩이 활성화, 무릎/골반 안정화', setup: ['덤벨을 가슴 앞에 세워 잡습니다.', '발은 어깨너비로 두고 발끝은 약간 바깥을 향합니다.'], movement: ['엉덩이를 뒤로 보내며 천천히 앉습니다.', '무릎이 안쪽으로 모이지 않게 합니다.', '발바닥 전체로 밀어 올라옵니다.'], breathing: '내려갈 때 들이마시고 올라올 때 내쉽니다.', target: '허벅지, 엉덩이, 코어', commonMistakes: ['무릎이 안으로 모임', '허리가 말림'], stopCriteria: ['무릎 통증이 있으면 범위를 줄이세요.', '허리가 불편하면 무게를 낮추세요.', '자세가 무너지면 중단하세요.'], keyPoint: '5~7kg부터 시작하고 자세가 먼저입니다.' },
  '덤벨 플로어프레스': { summary: '바닥에서 안전하게 진행하는 가슴/상체 운동', purpose: '가슴과 팔 힘 회복, 어깨 부담 감소', setup: ['바닥에 누워 무릎을 세웁니다.', '덤벨을 양손에 들고 팔꿈치를 바닥 가까이에 둡니다.'], movement: ['덤벨을 천천히 위로 밀어 올립니다.', '팔꿈치를 완전히 잠그지 않고 멈춥니다.', '천천히 내려옵니다.'], breathing: '밀어 올릴 때 숨을 내쉽니다.', target: '가슴, 삼두, 어깨 안정성', commonMistakes: ['허리를 과하게 꺾음', '덤벨을 빠르게 떨어뜨림'], stopCriteria: ['어깨 통증이 있으면 중단하세요.', '허리가 뜨면 무게를 낮추세요.', '손목이 꺾이지 않게 하세요.'], keyPoint: '한 손 3~5kg부터 천천히 진행합니다.' },
  '의자/테이블 지지 원암 덤벨 로우': { summary: '집의 의자나 테이블을 지지해 등 운동을 진행', purpose: '등 근육 활성화, 자세 안정성, 좌우 균형 개선', setup: ['안정적인 의자나 테이블에 한 손을 짚습니다.', '허리를 중립으로 유지하고 덤벨은 5~7kg부터 잡습니다.'], movement: ['팔꿈치를 옆구리 쪽으로 당깁니다.', '어깨를 으쓱하지 않고 등을 조입니다.', '천천히 내려놓고 좌우를 바꿉니다.'], breathing: '당길 때 숨을 내쉬고 내릴 때 들이마십니다.', target: '광배근, 등 중부, 후면 어깨', commonMistakes: ['몸통을 비틀어 반동 사용', '불안정한 받침대 사용'], stopCriteria: ['받침대가 불안정하면 밴드 로우로 대체하세요.', '허리가 불편하면 덤벨 로우를 하지 말고 밴드 로우를 선택하세요.', '어깨 통증이 있으면 중단하세요.'], alternatives: ['밴드 로우'], keyPoint: '집에서는 받침대 안정성이 가장 중요합니다.' },
  '밴드 로우': { summary: '밴드로 안전하게 등을 당기는 운동', purpose: '등 근육 활성화와 자세 안정성 향상', setup: ['밴드를 단단히 고정하거나 발에 걸고 앉거나 섭니다.', '가슴을 세우고 어깨를 낮춥니다.'], movement: ['팔꿈치를 뒤로 당겨 등을 조입니다.', '어깨가 올라가지 않게 합니다.', '천천히 시작 자세로 돌아갑니다.'], breathing: '당길 때 내쉽니다.', target: '등 중부, 광배근', commonMistakes: ['허리를 젖힘', '어깨를 으쓱함'], stopCriteria: ['밴드 고정이 불안하면 중단하세요.', '허리 통증이 있으면 앉아서 진행하세요.', '반동을 쓰지 마세요.'], keyPoint: '밴드를 당기는 것보다 등을 조이는 느낌을 우선합니다.' },
  '롱밴드 랫풀다운': { summary: '롱밴드로 광배근과 턱걸이 패턴을 준비', purpose: '광배근 활성화, 어깨 안정화, 턱걸이 준비', setup: ['롱밴드를 높은 곳에 안정적으로 고정합니다.', '무릎을 살짝 굽히고 갈비뼈가 들리지 않게 합니다.'], movement: ['팔꿈치를 아래로 끌어내립니다.', '등 옆에 힘이 들어오는지 느낍니다.', '천천히 위로 돌아갑니다.'], breathing: '내릴 때 숨을 내쉽니다.', target: '광배근, 등, 어깨 안정성', commonMistakes: ['허리를 젖힘', '목에 힘이 들어감'], stopCriteria: ['고정 지점이 불안하면 중단하세요.', '어깨 통증이 있으면 범위를 줄이세요.', '허리가 젖혀지면 복부에 힘을 주세요.'], keyPoint: '팔보다 팔꿈치를 아래로 내리는 느낌으로 진행합니다.' },
  '롱밴드 페이스풀': { summary: '등 위쪽과 후면 어깨를 깨우는 밴드 운동', purpose: '어깨 안정화, 등 위쪽 활성화, 자세 개선', setup: ['밴드를 얼굴 높이에 고정합니다.', '팔을 앞으로 뻗고 어깨를 낮춥니다.'], movement: ['밴드를 얼굴 쪽으로 당깁니다.', '팔꿈치를 바깥으로 벌리고 등 위쪽을 조입니다.', '천천히 돌아갑니다.'], breathing: '당길 때 숨을 내쉽니다.', target: '후면 어깨, 등 위쪽', commonMistakes: ['목을 앞으로 뺌', '허리를 젖힘'], stopCriteria: ['어깨 통증이 있으면 중단하세요.', '목에 힘이 들어가면 강도를 낮추세요.', '밴드 고정이 불안하면 하지 마세요.'], keyPoint: '목이 아니라 등 위쪽으로 당깁니다.' },
  '밴드 풀어파트': { summary: '밴드를 벌려 어깨 뒤쪽과 등 위쪽 활성화', purpose: '굽은 어깨 완화, 등 위쪽 활성화, 어깨 안정화', setup: ['밴드를 양손으로 잡고 가슴 높이에 둡니다.', '어깨를 낮추고 팔꿈치를 살짝 부드럽게 유지합니다.'], movement: ['밴드를 좌우로 천천히 벌립니다.', '가슴을 과하게 내밀지 않습니다.', '천천히 되돌립니다.'], breathing: '벌릴 때 숨을 내쉽니다.', target: '등 위쪽, 후면 어깨', commonMistakes: ['허리를 젖힘', '반동으로 벌림'], stopCriteria: ['어깨 앞쪽 통증이 있으면 중단하세요.', '목이 뻐근하면 밴드 장력을 낮추세요.', '빠르게 튕기지 마세요.'], keyPoint: '작은 범위라도 등 위쪽을 느끼며 천천히 합니다.' },
  '루프밴드 사이드워크': { summary: '루프밴드로 엉덩이 옆 근육과 골반 안정화', purpose: '엉덩이 옆 근육 활성화, 골반 안정화, 무릎 정렬 개선', setup: ['루프밴드를 무릎 위 또는 발목 위에 겁니다.', '무릎을 살짝 굽히고 엉덩이를 뒤로 보냅니다.'], movement: ['옆으로 한 걸음 이동합니다.', '반대발이 끌려오지 않게 천천히 따라옵니다.', '좌우 같은 횟수로 진행합니다.'], breathing: '이동할 때 자연스럽게 호흡합니다.', target: '중둔근, 골반 안정성', commonMistakes: ['무릎이 안쪽으로 모임', '상체가 좌우로 크게 흔들림'], stopCriteria: ['무릎 통증이 있으면 밴드 장력을 낮추세요.', '허리 통증이 있으면 자세를 세우세요.', '발목이 불편하면 밴드 위치를 무릎 위로 올리세요.'], keyPoint: '작게 이동해도 무릎 정렬을 유지합니다.' },
  '루프밴드 몬스터워크': { summary: '앞뒤 이동으로 엉덩이와 골반 안정성을 강화', purpose: '엉덩이 근육 활성화, 골반 안정성, 하체 워밍업', setup: ['루프밴드를 무릎 위 또는 발목 위에 겁니다.', '무릎을 살짝 굽힌 반스쿼트 자세를 만듭니다.'], movement: ['대각선 앞으로 한 걸음씩 이동합니다.', '무릎이 안쪽으로 모이지 않게 합니다.', '뒤로 돌아올 때도 천천히 진행합니다.'], breathing: '이동 중 편하게 호흡합니다.', target: '엉덩이, 골반 안정성', commonMistakes: ['발을 끌며 이동', '상체 반동 사용'], stopCriteria: ['무릎 통증이 있으면 중단하세요.', '허리가 불편하면 자세를 높이세요.', '밴드 장력이 과하면 약한 밴드로 바꾸세요.'], keyPoint: '천천히 걸으며 엉덩이 옆 자극을 확인합니다.' },
};


const exerciseIdByName: Record<string, string> = {
  '폼롤러 준비': 'foam-roller-prep',
  '기본 몸풀기': 'basic-warmup',
  '운동 전 묵주기도 슬라이딩보드': 'pre-rosary-sliding-board',
  '묵주기도 슬라이딩보드': 'rosary-sliding-board',
  '버드독': 'bird-dog',
  '힙브릿지': 'hip-bridge',
  '데드버그': 'dead-bug',
  '캣카우': 'cat-cow',
  '골반 기울이기': 'pelvic-tilt',
  '슬라이딩보드': 'sliding-board-cardio',
  '실내 걷기': 'indoor-walk',
  '야외 산책': 'outdoor-walk',
  '무릎 사이드 플랭크': 'knee-side-plank',
  'AB 슬라이더 준비 자세': 'ab-slider-ready-position',
  '운동 후 슬라이딩보드 마무리': 'post-sliding-board',
  '기본 정리운동': 'basic-cooldown',
  '폼롤러 회복': 'foam-roller-recovery',
  '턱걸이 초기자세': 'pullup-basic-posture',
  '덤벨 고블릿 스쿼트': 'dumbbell-goblet-squat',
  '덤벨 플로어프레스': 'dumbbell-floor-press',
  '의자/테이블 지지 원암 덤벨 로우': 'one-arm-dumbbell-row-supported',
  '밴드 로우': 'band-row',
  '롱밴드 랫풀다운': 'longband-lat-pulldown',
  '롱밴드 페이스풀': 'longband-face-pull',
  '밴드 풀어파트': 'band-pull-apart',
  '루프밴드 사이드워크': 'loopband-sidewalk',
  '루프밴드 몬스터워크': 'loopband-monster-walk',
};

for (const [name, id] of Object.entries(exerciseIdByName)) {
  const source = exerciseGuides[name] || exerciseGuides[id];
  if (source) {
    exerciseGuides[id] = { ...source, name, id, category: source.category || 'strength', steps: source.movement, cautions: source.stopCriteria } as ExerciseGuideEntry;
    exerciseGuides[name] = exerciseGuides[id];
  }
}


const videoSearchQueries: Record<string, string> = {
  'foam-roller-prep': '폼롤러 사용법 초보자 종아리 허벅지 엉덩이 등',
  'basic-warmup': '운동 전 준비운동 전신 스트레칭 초보자',
  'pre-rosary-sliding-board': '슬라이딩보드 운동 초보자 자세',
  'bird-dog': '버드독 운동 자세 허리 안정화',
  'hip-bridge': '힙브릿지 운동 자세 초보자',
  'dead-bug': '데드버그 운동 자세 허리 코어',
  'cat-cow': '캣카우 스트레칭 자세 허리',
  'pelvic-tilt': '골반 기울이기 운동 허리 안정화',
  'pullup-basic-posture': '턱걸이 초보자 견갑 하강 연습',
  'post-sliding-board': '슬라이딩보드 운동 초보자 유산소',
  'basic-cooldown': '운동 후 정리운동 스트레칭 초보자',
  'foam-roller-recovery': '폼롤러 회복 운동 종아리 허벅지 엉덩이 등',
  'knee-side-plank': '무릎 사이드 플랭크 자세 초보자',
  'ab-slider-ready-position': 'ab 슬라이더 초보자 자세 무릎',
  'ab-slider-ready': 'ab 슬라이더 초보자 자세 무릎',
  'dumbbell-goblet-squat': '덤벨 고블릿 스쿼트 자세 초보자',
  'dumbbell-floor-press': '덤벨 플로어프레스 자세',
  'one-arm-dumbbell-row-supported': '원암 덤벨 로우 집에서 의자 지지 자세',
  'home-one-arm-dumbbell-row': '원암 덤벨 로우 집에서 의자 지지 자세',
  'band-row': '밴드 로우 운동 자세',
  'longband-lat-pulldown': '밴드 랫풀다운 운동 자세',
  'long-band-lat-pulldown': '밴드 랫풀다운 운동 자세',
  'longband-face-pull': '밴드 페이스풀 운동 자세',
  'long-band-face-pull': '밴드 페이스풀 운동 자세',
  'band-pull-apart': '밴드 풀어파트 자세',
  'loopband-sidewalk': '루프밴드 사이드워크 자세',
  'loop-band-side-walk': '루프밴드 사이드워크 자세',
  'loopband-monster-walk': '루프밴드 몬스터워크 자세',
  'loop-band-monster-walk': '루프밴드 몬스터워크 자세',
};

for (const [id, videoSearchQuery] of Object.entries(videoSearchQueries)) {
  const guide = exerciseGuides[id];
  if (guide) guide.videoSearchQuery = videoSearchQuery;
}

const exerciseIdAliases: Record<string, string> = {
  'ab-slider-ready': 'ab-slider-ready-position',
  'home-one-arm-dumbbell-row': 'one-arm-dumbbell-row-supported',
  'long-band-lat-pulldown': 'longband-lat-pulldown',
  'long-band-face-pull': 'longband-face-pull',
  'loop-band-side-walk': 'loopband-sidewalk',
  'loop-band-monster-walk': 'loopband-monster-walk',
};

for (const [alias, sourceId] of Object.entries(exerciseIdAliases)) {
  const source = exerciseGuides[sourceId];
  if (source) exerciseGuides[alias] = { ...source, id: alias, videoSearchQuery: videoSearchQueries[alias] || source.videoSearchQuery } as ExerciseGuideEntry;
}

for (const guide of Object.values(exerciseGuides)) {
  if (!guide.videoUrl && !guide.videoSearchQuery) guide.videoSearchQuery = `${guide.name || guide.summary} 운동 자세`;
}

export const getExerciseGuide = (exerciseId: string, fallbackName?: string, summary?: string) =>
  exerciseGuides[exerciseId] || fallbackExerciseGuide(fallbackName || exerciseId, summary);

export const missingVideoExercises = Object.values(exerciseGuides)
  .filter((exercise, index, list) => list.findIndex((item) => (item.id || item.name || item.summary) === (exercise.id || exercise.name || exercise.summary)) === index)
  .filter((exercise) => !exercise.videoUrl && !exercise.videoSearchQuery);

if (process.env.NODE_ENV === 'development') {
  console.log('영상 링크 누락 운동:', missingVideoExercises.map((exercise) => exercise.name || exercise.summary));
}
