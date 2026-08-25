export const PASSWORD_POLICY_HINT = "8자 이상 · 영문 대문자·소문자·숫자·특수문자 포함";

export function strongPasswordError(password: string) {
  if (password.length < 8) return "비밀번호는 8자 이상으로 입력해 주세요.";
  if (!/[a-z]/.test(password)) return "비밀번호에 영문 소문자를 포함해 주세요.";
  if (!/[A-Z]/.test(password)) return "비밀번호에 영문 대문자를 포함해 주세요.";
  if (!/\d/.test(password)) return "비밀번호에 숫자를 포함해 주세요.";
  if (!/[^A-Za-z0-9]/.test(password)) return "비밀번호에 특수문자를 포함해 주세요.";
  return null;
}
