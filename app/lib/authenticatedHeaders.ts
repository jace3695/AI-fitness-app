import { supabase } from "./supabase";

export async function authenticatedJsonHeaders() {
  const { data } = await supabase?.auth.getSession() ?? { data: { session: null } };
  const token = data.session?.access_token;
  if (!token) throw new Error("로그인이 필요합니다.");
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}
