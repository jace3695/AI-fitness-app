import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_API_URL = "https://www.googleapis.com/calendar/v3";

export const GOOGLE_CALENDAR_OAUTH_COOKIE = "google-calendar-oauth";
export const GOOGLE_CALENDAR_OAUTH_MAX_AGE = 10 * 60;

type GoogleCalendarConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

type OAuthSession = {
  version: 1;
  state: string;
  verifier: string;
  userId: string;
  supabaseAccessToken: string;
  expiresAt: number;
};

type ConnectionRow = {
  user_id: string;
  google_email: string | null;
  access_token_ciphertext: string | null;
  refresh_token_ciphertext: string | null;
  token_expires_at: string | null;
  scope: string | null;
};

export class GoogleCalendarConnectionError extends Error {
  constructor(message: string, public status = 500) {
    super(message);
  }
}

export function isGoogleCalendarConfigured() {
  return Boolean(
    (process.env.GOOGLE_CALENDAR_CLIENT_ID || process.env.NEXT_PUBLIC_GOOGLE_CALENDAR_CLIENT_ID)
    && process.env.GOOGLE_CALENDAR_CLIENT_SECRET,
  );
}

export function getGoogleCalendarConfig(origin: string): GoogleCalendarConfig {
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID || process.env.NEXT_PUBLIC_GOOGLE_CALENDAR_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new GoogleCalendarConnectionError("Google Calendar 서버 설정이 필요합니다.", 503);
  }
  return {
    clientId,
    clientSecret,
    redirectUri: process.env.GOOGLE_CALENDAR_REDIRECT_URI || `${origin}/api/google-calendar/callback`,
  };
}

function getEncryptionKey(clientSecret: string) {
  return createHash("sha256")
    .update(`jace-google-calendar:${process.env.GOOGLE_TOKEN_ENCRYPTION_SECRET || clientSecret}`)
    .digest();
}

function encrypt(value: string, clientSecret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(clientSecret), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

function decrypt(value: string, clientSecret: string) {
  const [version, ivValue, tagValue, encryptedValue] = value.split(".");
  if (version !== "v1" || !ivValue || !tagValue || !encryptedValue) throw new Error("저장된 Google 연결 정보를 읽을 수 없습니다.");
  const decipher = createDecipheriv("aes-256-gcm", getEncryptionKey(clientSecret), Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedValue, "base64url")), decipher.final()]).toString("utf8");
}

export function encryptGoogleToken(value: string, clientSecret: string) {
  return encrypt(value, clientSecret);
}

export function decryptGoogleToken(value: string, clientSecret: string) {
  return decrypt(value, clientSecret);
}

export function createGoogleOAuthTransaction(config: GoogleCalendarConfig, userId: string, supabaseAccessToken: string) {
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(64).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const session: OAuthSession = {
    version: 1,
    state,
    verifier,
    userId,
    supabaseAccessToken,
    expiresAt: Date.now() + GOOGLE_CALENDAR_OAUTH_MAX_AGE * 1_000,
  };
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    scope: "openid email https://www.googleapis.com/auth/calendar.events",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return {
    authorizationUrl: `${GOOGLE_AUTH_URL}?${params}`,
    sealedSession: encrypt(JSON.stringify(session), config.clientSecret),
  };
}

export function openGoogleOAuthSession(value: string, clientSecret: string) {
  let parsed: OAuthSession;
  try {
    parsed = JSON.parse(decrypt(value, clientSecret)) as OAuthSession;
  } catch {
    throw new GoogleCalendarConnectionError("Google 연결 요청이 만료되었습니다. 다시 시도해주세요.", 400);
  }
  if (
    parsed.version !== 1
    || !parsed.state
    || !parsed.verifier
    || !parsed.userId
    || !parsed.supabaseAccessToken
    || parsed.expiresAt < Date.now()
  ) {
    throw new GoogleCalendarConnectionError("Google 연결 요청이 만료되었습니다. 다시 시도해주세요.", 400);
  }
  return parsed;
}

export async function exchangeGoogleAuthorizationCode(config: GoogleCalendarConfig, code: string, verifier: string) {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      code_verifier: verifier,
      grant_type: "authorization_code",
      redirect_uri: config.redirectUri,
    }),
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || typeof data.access_token !== "string") {
    throw new GoogleCalendarConnectionError("Google 인증을 완료하지 못했습니다. 다시 연결해주세요.", 502);
  }
  return {
    accessToken: data.access_token,
    refreshToken: typeof data.refresh_token === "string" ? data.refresh_token : null,
    expiresIn: typeof data.expires_in === "number" ? data.expires_in : 3_600,
    scope: typeof data.scope === "string" ? data.scope : null,
  };
}

export async function getGoogleAccountEmail(accessToken: string) {
  const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!response.ok) return null;
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  return typeof data.email === "string" ? data.email : null;
}

async function loadConnection(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from("google_calendar_connections")
    .select("user_id,google_email,access_token_ciphertext,refresh_token_ciphertext,token_expires_at,scope")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new GoogleCalendarConnectionError("Google Calendar 연결 정보를 불러오지 못했습니다.");
  if (!data) throw new GoogleCalendarConnectionError("Google Calendar를 먼저 연결해주세요.", 409);
  return data as ConnectionRow;
}

export async function getValidGoogleAccessToken(
  supabase: SupabaseClient,
  userId: string,
  clientSecret: string,
  forceRefresh = false,
) {
  const connection = await loadConnection(supabase, userId);
  const expiresAt = connection.token_expires_at ? new Date(connection.token_expires_at).getTime() : 0;
  if (!forceRefresh && connection.access_token_ciphertext && expiresAt > Date.now() + 60_000) {
    return decrypt(connection.access_token_ciphertext, clientSecret);
  }
  if (!connection.refresh_token_ciphertext) {
    throw new GoogleCalendarConnectionError("Google Calendar 연결이 만료되었습니다. 다시 연결해주세요.", 409);
  }
  const refreshToken = decrypt(connection.refresh_token_ciphertext, clientSecret);
  const config = getGoogleCalendarConfig("http://localhost");
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || typeof data.access_token !== "string") {
    throw new GoogleCalendarConnectionError("Google Calendar 연결이 만료되었습니다. 다시 연결해주세요.", 409);
  }
  const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 3_600;
  const tokenExpiresAt = new Date(Date.now() + expiresIn * 1_000).toISOString();
  const { error } = await supabase
    .from("google_calendar_connections")
    .update({
      access_token_ciphertext: encrypt(data.access_token, clientSecret),
      token_expires_at: tokenExpiresAt,
      scope: typeof data.scope === "string" ? data.scope : connection.scope,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);
  if (error) throw new GoogleCalendarConnectionError("갱신된 Google 연결을 저장하지 못했습니다.");
  return data.access_token;
}

export async function googleCalendarApiRequest(
  supabase: SupabaseClient,
  userId: string,
  clientSecret: string,
  path: string,
  init: RequestInit = {},
) {
  let accessToken = await getValidGoogleAccessToken(supabase, userId, clientSecret);
  const request = (token: string) => fetch(`${GOOGLE_API_URL}${path}`, {
    ...init,
    headers: { ...Object.fromEntries(new Headers(init.headers).entries()), Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  let response = await request(accessToken);
  if (response.status === 401) {
    accessToken = await getValidGoogleAccessToken(supabase, userId, clientSecret, true);
    response = await request(accessToken);
  }
  return response;
}
