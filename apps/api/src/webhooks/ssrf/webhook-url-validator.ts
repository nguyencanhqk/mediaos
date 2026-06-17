import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

/**
 * WebhookUrlValidator (AC-6 — PRD §4 N5b) — chống SSRF cho URL giao webhook.
 *
 * KHÔNG chỉ regex string: hostname public có thể phân giải về IP nội bộ (DNS-rebinding). Cách an toàn =
 * RESOLVE-THEN-PIN: parse URL → require https → chặn host *.internal/bare → DNS resolve TẤT CẢ A/AAAA →
 * validate MỌI IP (reject RFC1918/169.254/loopback) → PIN 1 IP đã validate trả về cho caller connect
 * CHÍNH IP đó (không re-resolve giữa validate và connect → chống TOCTOU). Re-validate mỗi redirect hop, cap ≤3.
 *
 * Pure + injectable resolver (`DnsResolver`) để unit test mô phỏng rebinding mà KHÔNG đụng DNS thật.
 */

/** Lỗi SSRF — generic message, KHÔNG lộ IP nội bộ resolve được (tránh dò mạng nội bộ qua message). */
export class WebhookSsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookSsrfError";
  }
}

/** Phân giải hostname → danh sách IP (string). Mặc định dùng node:dns; test inject resolver giả. */
export type DnsResolver = (host: string) => Promise<string[]>;

export interface ValidatedTarget {
  /** Host gốc (để set header Host khi connect bằng IP đã pin). */
  host: string;
  /** IP đã validate — caller PHẢI connect CHÍNH IP này (chống DNS-rebinding TOCTOU). */
  pinnedIp: string;
}

export interface ValidateOptions {
  resolve?: DnsResolver;
}

/** Cap số redirect hop được phép theo (PRD §4 N5b). */
export const MAX_REDIRECT_HOPS = 3;

/** Resolver mặc định: node:dns lookup all (A + AAAA). */
const defaultResolver: DnsResolver = async (host) => {
  const records = await lookup(host, { all: true });
  return records.map((r) => r.address);
};

/**
 * IP có thuộc dải BỊ CHẶN không (RFC1918 + link-local/metadata + loopback + unspecified + IPv6 nội bộ).
 * Pure — dùng cho mọi IP đã resolve. Chống bypass kiểu literal hoặc rebinding (validate IP THẬT, không string).
 */
export function isBlockedIp(ip: string): boolean {
  const fam = isIP(ip);
  if (fam === 4) return isBlockedIpv4(ip);
  if (fam === 6) return isBlockedIpv6(ip);
  // Không phải IP hợp lệ → chặn (fail-closed).
  return true;
}

function isBlockedIpv4(ip: string): boolean {
  const parts = ip.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    return true; // malformed → fail-closed
  }
  const [a, b] = parts;
  if (a === 10) return true; // 10.0.0.0/8 (RFC1918)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 (RFC1918)
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 (RFC1918)
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local + cloud metadata 169.254.169.254
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 0) return true; // 0.0.0.0/8 "this host"
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  return false;
}

function isBlockedIpv6(ip: string): boolean {
  const norm = ip.toLowerCase();
  if (norm === "::1" || norm === "::") return true; // loopback + unspecified
  if (norm.startsWith("fc") || norm.startsWith("fd")) return true; // fc00::/7 unique-local
  if (norm.startsWith("fe80")) return true; // fe80::/10 link-local
  // IPv4-mapped (::ffff:a.b.c.d) → validate phần v4 nhúng.
  const mapped = norm.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) return isBlockedIpv4(mapped[1]);
  return false;
}

/** Host dạng *.internal hoặc bare hostname (không có dấu chấm → không FQDN) → chặn. */
function isBlockedHostname(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h.endsWith(".internal") || h.endsWith(".local")) return true;
  if (!h.includes(".")) return true; // bare hostname (không FQDN) — chặn
  return false;
}

/** Ép cap redirect hop — throw nếu vượt MAX_REDIRECT_HOPS. */
export function assertRedirectHopWithinCap(hop: number): void {
  if (hop > MAX_REDIRECT_HOPS) {
    throw new WebhookSsrfError("Webhook redirect vượt số hop cho phép.");
  }
}

/**
 * Validate 1 URL webhook (1 hop). Trả {host, pinnedIp} để caller connect đúng IP đã validate.
 * @throws WebhookSsrfError nếu non-https / host nội bộ / resolve về IP nội bộ.
 */
export async function validateWebhookUrl(
  rawUrl: string,
  options: ValidateOptions = {},
): Promise<ValidatedTarget> {
  const resolve = options.resolve ?? defaultResolver;

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new WebhookSsrfError("Webhook URL không hợp lệ.");
  }

  if (parsed.protocol !== "https:") {
    throw new WebhookSsrfError("Webhook URL phải dùng https.");
  }

  const host = parsed.hostname;

  // Nếu host vốn là IP literal → validate trực tiếp (không resolve).
  if (isIP(host)) {
    if (isBlockedIp(host)) {
      throw new WebhookSsrfError("Webhook URL trỏ tới địa chỉ IP nội bộ/cấm.");
    }
    return { host, pinnedIp: host };
  }

  if (isBlockedHostname(host)) {
    throw new WebhookSsrfError("Webhook host không được phép.");
  }

  let addresses: string[];
  try {
    addresses = await resolve(host);
  } catch {
    throw new WebhookSsrfError("Không phân giải được hostname webhook.");
  }
  if (addresses.length === 0) {
    throw new WebhookSsrfError("Hostname webhook không có bản ghi A/AAAA.");
  }

  // BẤT KỲ IP nào nội bộ → chặn toàn bộ (chống multi-A record có 1 IP nội bộ lách qua).
  for (const ip of addresses) {
    if (isBlockedIp(ip)) {
      throw new WebhookSsrfError("Hostname webhook phân giải về IP nội bộ/cấm.");
    }
  }

  // Pin IP đầu tiên (đã validate). Caller connect CHÍNH IP này (chống rebinding giữa validate↔connect).
  return { host, pinnedIp: addresses[0] };
}
