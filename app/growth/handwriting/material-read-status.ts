// A hidden/private object may also be reported as not found: do not infer registration state.
export function materialReadNotice(error: unknown, stage: 'registration' | 'page') {
 const value=error && typeof error==='object' ? error as {status?:unknown;statusCode?:unknown} : {};
 const status=Number(value.status ?? value.statusCode);
 if(status===401||status===403)return '교재 접근 권한을 확인하지 못했어요. 로그인 상태를 확인한 뒤 다시 불러와 주세요. 다시 등록할 필요는 없어요.';
 if(status===404)return stage==='registration'
  ? '이 계정에서 교재를 찾지 못했어요. 처음이라면 아래에서 교재 묶음을 등록해 주세요. 이미 등록했다면 다시 등록하기 전에 로그인 상태와 접근 권한을 확인해 주세요.'
  : '이 연습지를 찾지 못했어요. 교재 등록이 끝났는지 확인해 주세요. 기존 교재는 덮어쓰지 않아요.';
 return '교재를 불러오지 못했어요. 연결을 확인하고 다시 불러와 주세요. 이 오류만으로 교재가 미등록된 것은 아니에요.';
}
