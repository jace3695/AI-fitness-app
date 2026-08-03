const PIN_KEY_PREFIX = "fitness-device-pin-v1:";
const PIN_SESSION_PREFIX = "fitness-device-pin-unlocked-v1:";
const ITERATIONS = 210_000;

export const PIN_LENGTH = 6;
export const MAX_PIN_FAILURES = 5;
export const PIN_LOCK_MS = 30_000;

interface DevicePinRecord {
  version: 1;
  salt: string;
  hash: string;
  attempts: number;
  lockedUntil: number;
}

function storageKey(userId: string) {
  return `${PIN_KEY_PREFIX}${userId}`;
}

function sessionKey(userId: string) {
  return `${PIN_SESSION_PREFIX}${userId}`;
}

function bytesToBase64(bytes: Uint8Array) {
  let value = "";
  bytes.forEach((byte) => { value += String.fromCharCode(byte); });
  return btoa(value);
}

function base64ToBytes(value: string) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function readRecord(userId: string): DevicePinRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey(userId)) || "null") as Partial<DevicePinRecord> | null;
    if (!parsed || parsed.version !== 1 || typeof parsed.salt !== "string" || typeof parsed.hash !== "string") return null;
    return {
      version: 1,
      salt: parsed.salt,
      hash: parsed.hash,
      attempts: typeof parsed.attempts === "number" ? parsed.attempts : 0,
      lockedUntil: typeof parsed.lockedUntil === "number" ? parsed.lockedUntil : 0,
    };
  } catch {
    return null;
  }
}

function writeRecord(userId: string, record: DevicePinRecord) {
  localStorage.setItem(storageKey(userId), JSON.stringify(record));
}

async function derivePin(pin: string, salt: Uint8Array) {
  const saltBuffer = new Uint8Array(salt).buffer;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pin),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: saltBuffer, iterations: ITERATIONS },
    key,
    256,
  );
  return bytesToBase64(new Uint8Array(bits));
}

export function isValidPin(pin: string) {
  return new RegExp(`^\\d{${PIN_LENGTH}}$`).test(pin);
}

export function hasDevicePin(userId: string) {
  return Boolean(readRecord(userId));
}

export function isPinSessionUnlocked(userId: string) {
  return sessionStorage.getItem(sessionKey(userId)) === "1";
}

export function lockPinSession(userId: string) {
  sessionStorage.removeItem(sessionKey(userId));
}

export async function setDevicePin(userId: string, pin: string) {
  if (!isValidPin(pin)) throw new Error(`${PIN_LENGTH}자리 숫자를 입력해 주세요.`);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  writeRecord(userId, {
    version: 1,
    salt: bytesToBase64(salt),
    hash: await derivePin(pin, salt),
    attempts: 0,
    lockedUntil: 0,
  });
  sessionStorage.setItem(sessionKey(userId), "1");
}

export function removeDevicePin(userId: string) {
  localStorage.removeItem(storageKey(userId));
  sessionStorage.removeItem(sessionKey(userId));
}

export type VerifyPinResult =
  | { ok: true }
  | { ok: false; reason: "invalid"; remaining: number }
  | { ok: false; reason: "locked"; retryAt: number };

export async function verifyDevicePin(userId: string, pin: string): Promise<VerifyPinResult> {
  const record = readRecord(userId);
  if (!record) return { ok: true };
  const now = Date.now();
  if (record.lockedUntil > now) return { ok: false, reason: "locked", retryAt: record.lockedUntil };

  const hash = await derivePin(pin, base64ToBytes(record.salt));
  if (hash === record.hash) {
    writeRecord(userId, { ...record, attempts: 0, lockedUntil: 0 });
    sessionStorage.setItem(sessionKey(userId), "1");
    return { ok: true };
  }

  const attempts = record.attempts + 1;
  if (attempts >= MAX_PIN_FAILURES) {
    const retryAt = now + PIN_LOCK_MS;
    writeRecord(userId, { ...record, attempts: 0, lockedUntil: retryAt });
    return { ok: false, reason: "locked", retryAt };
  }
  writeRecord(userId, { ...record, attempts, lockedUntil: 0 });
  return { ok: false, reason: "invalid", remaining: MAX_PIN_FAILURES - attempts };
}
