const BIOMETRIC_KEY_PREFIX = "fitness-device-biometric-v1:";

interface DeviceBiometricRecord {
  version: 1;
  credentialId: string;
}

function storageKey(userId: string) {
  return `${BIOMETRIC_KEY_PREFIX}${userId}`;
}

function bytesToBase64Url(bytes: Uint8Array) {
  let value = "";
  bytes.forEach((byte) => { value += String.fromCharCode(byte); });
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

function readRecord(userId: string): DeviceBiometricRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey(userId)) || "null") as Partial<DeviceBiometricRecord> | null;
    if (!parsed || parsed.version !== 1 || typeof parsed.credentialId !== "string") return null;
    return { version: 1, credentialId: parsed.credentialId };
  } catch {
    return null;
  }
}

export function hasDeviceBiometric(userId: string) {
  return Boolean(readRecord(userId));
}

export function removeDeviceBiometric(userId: string) {
  localStorage.removeItem(storageKey(userId));
}

export async function isPlatformBiometricAvailable() {
  if (typeof window === "undefined" || !window.isSecureContext || !("PublicKeyCredential" in window)) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

export async function registerDeviceBiometric(userId: string, userLabel: string) {
  if (!(await isPlatformBiometricAvailable())) throw new Error("이 기기에서는 생체인증을 사용할 수 없습니다.");
  const credential = await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: "재민님의 운동" },
      user: {
        id: new TextEncoder().encode(userId),
        name: userLabel,
        displayName: userLabel,
      },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        residentKey: "preferred",
        userVerification: "required",
      },
      timeout: 60_000,
      attestation: "none",
    },
  });
  if (!(credential instanceof PublicKeyCredential)) throw new Error("생체인증 등록을 완료하지 못했습니다.");
  localStorage.setItem(storageKey(userId), JSON.stringify({
    version: 1,
    credentialId: bytesToBase64Url(new Uint8Array(credential.rawId)),
  } satisfies DeviceBiometricRecord));
}

export async function verifyDeviceBiometric(userId: string) {
  const record = readRecord(userId);
  if (!record || !(await isPlatformBiometricAvailable())) return false;
  try {
    const credential = await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials: [{
          type: "public-key",
          id: base64UrlToBytes(record.credentialId),
          transports: ["internal"],
        }],
        userVerification: "required",
        timeout: 60_000,
      },
    });
    return credential instanceof PublicKeyCredential
      && bytesToBase64Url(new Uint8Array(credential.rawId)) === record.credentialId;
  } catch {
    return false;
  }
}
