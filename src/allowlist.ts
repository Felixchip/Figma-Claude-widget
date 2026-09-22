// Restrict access to recognised traffic: OpenAI's published ChatGPT connector
// ranges, plus any additional networks you list (corporate/VPN, other AI
// vendors).
//
// Two things to know before enabling this:
//
// 1. An IP allowlist identifies a *network*, not a user. It is not a substitute
//    for authentication — anyone on an allowed network gets in.
// 2. Agents that run on a user's machine (Codex CLI, Claude Code, Cursor)
//    connect from the user's own network, not from an AI vendor. Include the
//    corporate/VPN ranges or those clients will be blocked. Only ChatGPT (and
//    claude.ai) call us from vendor infrastructure.

import ipaddr from "ipaddr.js";

type Cidr = [ipaddr.IPv4 | ipaddr.IPv6, number];

const OPENAI_URL = "https://openai.com/chatgpt-connectors.json";
const REFRESH_MS = 12 * 60 * 60 * 1000;

let ranges: Cidr[] = [];
let stats = { openai: 0, manual: 0, openaiFetchedAt: "" };

export function parseCidrs(list: string[]): Cidr[] {
  const out: Cidr[] = [];
  for (const raw of list) {
    const value = raw.trim();
    if (!value) continue;
    try {
      out.push(ipaddr.parseCIDR(value));
    } catch {
      console.warn(`[allowlist] ignoring invalid CIDR: ${value}`);
    }
  }
  return out;
}

export function isAllowed(ip: string, list: Cidr[]): boolean {
  let addr: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    addr = ipaddr.parse(ip);
  } catch {
    return false;
  }
  if (addr.kind() === "ipv6" && (addr as ipaddr.IPv6).isIPv4MappedAddress()) {
    addr = (addr as ipaddr.IPv6).toIPv4Address();
  }
  return list.some((range) => {
    try {
      // ipaddr's overloads don't union cleanly; the runtime match is safe.
      return (addr.match as (r: Cidr) => boolean)(range);
    } catch {
      return false;
    }
  });
}

async function fetchOpenAiRanges(): Promise<Cidr[]> {
  const res = await fetch(OPENAI_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data: any = await res.json();
  const prefixes: string[] = (data.prefixes ?? [])
    .map((p: any) => p.ipv4Prefix ?? p.ipv6Prefix)
    .filter((p: unknown): p is string => typeof p === "string");
  stats.openaiFetchedAt = String(data.creationTime ?? "");
  return parseCidrs(prefixes);
}

export async function initAllowlist(opts: { manual: string[]; includeOpenAi: boolean }): Promise<void> {
  const manual = parseCidrs(opts.manual);
  stats.manual = manual.length;
  let openai: Cidr[] = [];

  if (opts.includeOpenAi) {
    try {
      openai = await fetchOpenAiRanges();
    } catch (err) {
      console.error(`[allowlist] could not fetch OpenAI ranges: ${(err as Error).message}`);
    }
    // OpenAI's ranges change; refresh on a timer rather than pinning them.
    const timer = setInterval(() => {
      fetchOpenAiRanges()
        .then((next) => {
          openai = next;
          rebuild(manual, openai);
        })
        .catch((err) => console.error(`[allowlist] refresh failed: ${(err as Error).message}`));
    }, REFRESH_MS);
    timer.unref?.();
  }

  rebuild(manual, openai);
}

function rebuild(manual: Cidr[], openai: Cidr[]): void {
  stats.openai = openai.length;
  ranges = [...openai, ...manual];
  console.log(`[allowlist] ${ranges.length} ranges (${stats.openai} OpenAI, ${stats.manual} manual)`);
}

export function allowlistEnabled(): boolean {
  return ranges.length > 0;
}

export function allowlistStats() {
  return { enabled: allowlistEnabled(), ranges: ranges.length, ...stats };
}

export function ipAllowed(ip: string): boolean {
  return isAllowed(ip, ranges);
}

// The real client IP, as seen by the edge proxy. A client can forge earlier
// entries of X-Forwarded-For, but the proxy appends the true address last, so
// the last entry is the trustworthy one.
export function clientIp(headers: Record<string, unknown>, remoteAddress?: string): string {
  const raw = headers["x-forwarded-for"];
  const joined = Array.isArray(raw) ? raw.join(",") : typeof raw === "string" ? raw : "";
  const parts = joined.split(",").map((s) => s.trim()).filter(Boolean);
  const ip = parts.length ? parts[parts.length - 1] : remoteAddress ?? "";
  return ip.replace(/^::ffff:/, "");
}
