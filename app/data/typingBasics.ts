export const TYPING_BASICS_ID = 'typing-position-v1';
export const KEY_ROWS = ['qwertyuiop', 'asdfghjkl;', 'zxcvbnm,./'];
const korean = ['ㅂㅈㄷㄱㅅㅛㅕㅑㅐㅔ', 'ㅁㄴㅇㄹㅎㅗㅓㅏㅣ;', 'ㅋㅌㅊㅍㅠㅜㅡ,./'];
export const FINGERS = ['왼손 새끼', '왼손 약지', '왼손 중지', '왼손 검지', '오른손 검지', '오른손 중지', '오른손 약지', '오른손 새끼', '엄지'];
const fingerRows = [[0,1,2,3,3,4,4,5,6,7],[0,1,2,3,3,4,4,5,6,7],[0,1,2,3,3,4,4,5,6,7]];
type PositionKey = { label:string; korean:string; finger:number; code:string };
export const TYPING_KEYS:Record<string,PositionKey> = Object.fromEntries(KEY_ROWS.flatMap((row, r) => Array.from(row, (key, i):[string,PositionKey] => [key, { label: key.toUpperCase(), korean: korean[r][i], finger: fingerRows[r][i], code: /^[a-z]$/.test(key) ? `Key${key.toUpperCase()}` : ({ ';':'Semicolon', ',':'Comma', '.':'Period', '/':'Slash' }[key])! }])).concat([[' ', {label:'Space', korean:'띄어쓰기', finger:8, code:'Space'}]]));
export const TYPING_LESSONS = [
  { id:'anchors', title:'검지의 집 찾기', goal:'F와 J의 돌기를 느끼고 왼손·오른손 검지를 가볍게 올려요.', keys:'fjfjffjjfjfj' },
  { id:'middle', title:'중지 자리', goal:'왼손 중지는 D, 오른손 중지는 K에 놓아요. 검지는 F·J에 남겨요.', keys:'dkdkddkkfdkj' },
  { id:'ring', title:'약지 자리', goal:'왼손 약지는 S, 오른손 약지는 L이에요. 손 전체를 옮기지 않아요.', keys:'slsldkslfjls' },
  { id:'little', title:'새끼손가락 자리', goal:'왼손 새끼는 A, 오른손 새끼는 ;에 놓아요. 세게 누르지 않아요.', keys:'a;a;asdlk;a;' },
  { id:'centre', title:'검지의 옆자리', goal:'G는 왼손 검지, H는 오른손 검지로 누르고 F·J로 돌아와요.', keys:'fgfjhjghfgjh' },
  { id:'home', title:'기본 자리와 띄어쓰기', goal:'왼손 A S D F, 오른손 J K L ;. Space는 편한 쪽 엄지로 눌러요.', keys:'asdf jkl; asdf jkl;' },
  { id:'upper-middle', title:'중지의 윗자리', goal:'E는 왼손 중지, I는 오른손 중지. 누른 뒤 D·K로 돌아와요.', keys:'ded kik deki edik' },
  { id:'upper-index', title:'검지의 윗자리', goal:'R·T는 왼손 검지, Y·U는 오른손 검지로 눌러요.', keys:'frft jyju rtyu truy' },
  { id:'upper-outer', title:'약지·새끼의 윗자리', goal:'Q·P는 양쪽 새끼, W·O는 양쪽 약지로 눌러요.', keys:'aq sw lo ;p qwop' },
  { id:'lower-middle', title:'중지의 아랫자리', goal:'C는 왼손 중지, 쉼표는 오른손 중지로 누르고 돌아와요.', keys:'dcd k,k c,c, dck,' },
  { id:'lower-index', title:'검지의 아랫자리', goal:'V·B는 왼손 검지, N·M은 오른손 검지예요.', keys:'fvfb jnjm vbnm bvmn' },
  { id:'lower-outer', title:'약지·새끼의 아랫자리', goal:'Z·/는 양쪽 새끼, X·마침표는 양쪽 약지로 눌러요.', keys:'az sx l. ;/ zx./' },
  { id:'words', title:'짧은 영문 단어', goal:'한 글자씩 담당 손가락으로 눌러요. 속도 목표는 없어요.', keys:'sad fall ask jump' },
  { id:'korean-words', title:'한글 단어의 자리', goal:'두벌식으로 나무 → 바다 → 하루의 키 순서를 연습해요. 조합된 글자 대신 누를 자리를 보여줘요.', keys:'skan qkek gkfn' },
];
export type TypingAttempt = { position:number; attempts:number; mistakes:Record<string,number> };
export const emptyTypingAttempt = (): TypingAttempt => ({position:0,attempts:0,mistakes:{}});
export function pressTypingKey(state:TypingAttempt,target:string,code:string):TypingAttempt {
  if(state.position>=target.length || !Object.values(TYPING_KEYS).some(key=>key.code===code)) return state;
  const expected=target[state.position]; const correct=TYPING_KEYS[expected].code===code;
  return { position:state.position+Number(correct), attempts:state.attempts+1, mistakes:correct?state.mistakes:{...state.mistakes,[expected]:(state.mistakes[expected]??0)+1} };
}
export function typingKeyAccuracy(state:TypingAttempt) { return state.attempts ? Math.round(100*state.position/state.attempts) : 0; }
export function completedTypingBasics(rows:{source:string;status:string;metrics:Record<string,unknown>}[]) {
  return new Set(rows.filter(row=>row.source==='typing' && row.status==='completed' && row.metrics.courseId===TYPING_BASICS_ID && row.metrics.lessonCompleted===true && TYPING_LESSONS.some(lesson=>lesson.id===row.metrics.lessonId)).map(row=>String(row.metrics.lessonId)));
}
