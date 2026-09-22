// Admin sign-in for the Library and Settings pages.
//
// The password *is* the admin token (ADMIN_TOKEN), so the people who can see
// those pages are exactly the people who can change things. One secret, one
// audience.
//
// The session is a signed, HttpOnly cookie — no server-side state, no extra
// dependencies. Enabled only when ADMIN_TOKEN is set, so local development and
// any deployment without a token behave exactly as before.

import { createHmac, timingSafeEqual } from "crypto";

const COOKIE = "gsa_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

function adminToken(): string {
  return process.env.ADMIN_TOKEN ?? "";
}

function signingKey(): string | null {
  const key = process.env.SESSION_SECRET || adminToken();
  return key && key.length ? key : null;
}

export function authEnabled(): boolean {
  return !!adminToken();
}

function sign(payload: string, key: string): string {
  return createHmac("sha256", key).update(payload).digest("base64url");
}

function secureAttribute(): string {
  const https = (process.env.PUBLIC_BASE_URL ?? "").startsWith("https");
  return https || process.env.NODE_ENV === "production" ? "; Secure" : "";
}

export function createSessionCookie(name: string): string | null {
  const key = signingKey();
  if (!key) return null;
  const payload = Buffer.from(
    JSON.stringify({ n: name, e: Date.now() + MAX_AGE_SECONDS * 1000 })
  ).toString("base64url");
  const value = `${payload}.${sign(payload, key)}`;
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_SECONDS}${secureAttribute()}`;
}

export function clearSessionCookie(): string {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureAttribute()}`;
}

export function readSession(cookieHeader?: string): { name: string } | null {
  const key = signingKey();
  if (!key || !cookieHeader) return null;

  const raw = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE}=`));
  if (!raw) return null;

  const [payload, signature] = raw.slice(COOKIE.length + 1).split(".");
  if (!payload || !signature) return null;

  const expected = sign(payload, key);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof data.e !== "number" || data.e < Date.now()) return null;
    if (typeof data.n !== "string" || !data.n.trim()) return null;
    return { name: data.n.trim().slice(0, 60) };
  } catch {
    return null;
  }
}

export function checkPassword(input: string): boolean {
  const expected = adminToken();
  if (!expected) return false;
  const a = Buffer.from(input);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

