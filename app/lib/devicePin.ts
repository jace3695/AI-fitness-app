import { authenticatedFetch } from "@/lib/supabase";

const PIN_SESSION_PREFIX = "jace-hub-pin-unlocked-v1:";

export const PIN_LENGTH = 6;
export const MAX_PIN_FAILURES = 5;

function sessionKey(userId: string) { return `${PIN_SESSION_PREFIX}${userId}`; }
async function callPinApi(payload: Record<string, string>) {
  const response = await authenticatedFetch("/api/pin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}
export function isValidPin(pin: string) { return /^\d{6}$/.test(pin); }
export async function hasDevicePin(_userId: string) {
  const { response, data } = await callPinApi({ action: "status" });
  return response.ok && Boolean(data.configured);
}
export function isPinSessionUnlocked(userId: string) { return sessionStorage.getItem(sessionKey(userId)) === "1"; }
export function lockPinSession(userId: string) { sessionStorage.removeItem(sessionKey(userId)); }
export function unlockPinSession(userId: string) { sessionStorage.setItem(sessionKey(userId), "1"); }
export async function setDevicePin(userId: string, pin: string, currentPin = "") {
  if (!isValidPin(pin)) throw new Error("6자리 숫자를 입력해 주세요.");
  const { response, data } = await callPinApi({ action: "set", currentPin, newPin: pin });
  if (!response.ok) throw new Error(data.error || "공통 PIN을 저장하지 못했습니다.");
  unlockPinSession(userId);
}
export async function removeDevicePin(userId: string, currentPin: string) {
  const { response, data } = await callPinApi({ action: "disable", currentPin });
  if (!response.ok) throw new Error(data.error || "공통 PIN을 해제하지 못했습니다.");
  sessionStorage.removeItem(sessionKey(userId));
}
export type VerifyPinResult =
  | { ok: true }
  | { ok: false; reason: "invalid"; remaining: number }
  | { ok: false; reason: "locked" };
export async function verifyDevicePin(userId: string, pin: string): Promise<VerifyPinResult> {
  const { response, data } = await callPinApi({ action: "verify", pin });
  if (response.ok) { unlockPinSession(userId); return { ok: true }; }
  if (response.status === 423) return { ok: false, reason: "locked" };
  return { ok: false, reason: "invalid", remaining: Number(data.attemptsRemaining ?? 0) };
}

export async function reauthenticateDevicePin(userId: string, accountPassword: string) {
  const { response, data } = await callPinApi({ action: "reauthenticate", accountPassword });
  if (!response.ok) throw new Error(data.error || "계정 비밀번호를 확인하지 못했습니다.");
  unlockPinSession(userId);
}
