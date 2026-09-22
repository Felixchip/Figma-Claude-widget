// Shared-password sign-in for the Library and Settings pages.
//
// Deliberately minimal: one password for everyone, plus a name so we know who
// signed in. The session is a signed, HttpOnly cookie — no server-side state, no
// extra dependencies.
//
// Enabled only when APP_PASSWORD is set, so local development and any
// deployment that hasn't configured it behave exactly as before.

import { createHmac, timingSafeEqual } from "crypto";

const COOKIE = "gsa_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

function signingKey(): string | null {
  const key = process.env.SESSION_SECRET || process.env.APP_PASSWORD;
  return key && key.length ? key : null;
}

export function authEnabled(): boolean {
  return !!process.env.APP_PASSWORD;
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
  const expected = process.env.APP_PASSWORD ?? "";
  if (!expected) return false;
  const a = Buffer.from(input);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// Only allow same-site redirects after sign-in.
export function safeNext(value: unknown): string {
  const next = typeof value === "string" ? value : "";
  if (!next.startsWith("/") || next.startsWith("//")) return "/";
  return next;
}
