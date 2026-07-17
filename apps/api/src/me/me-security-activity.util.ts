/**
 * S5-ME-BE-3 — util THUẦN cho Hoạt động bảo mật (SPEC-09 §10.6 IP mask · §17.1 không lộ nhạy cảm).
 *
 * Nguyên tắc FAIL-CLOSED: không parse được → null (thà mất hiển thị còn hơn lộ raw). Output của
 * summarizeUserAgent là NHÃN CỐ ĐỊNH từ allowlist — không bao giờ nối chuỗi con của input tự do
 * (chống rò fragment fingerprint qua field `device`).
 */

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/;

/**
 * Mask IP server-side (§10.6): IPv4 giữ 2 octet đầu → `a.b.*.*`; IPv6 giữ tối đa 2 hextet đầu →
 * `xxxx:yyyy::*` (IPv4-mapped `::ffff:...` → `::*` — KHÔNG lộ IPv4 nhúng). Không parse được → null.
 * KHÔNG BAO GIỜ trả nguyên trạng input.
 */
export function maskIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const trimmed = ip.trim();
  if (!trimmed) return null;

  const v4 = IPV4_RE.exec(trimmed);
  if (v4) return `${v4[1]}.${v4[2]}.*.*`;

  if (trimmed.includes(":")) {
    // IPv6: lấy các hextet HEX thuần đứng đầu (dừng ngay khi gặp '::' rỗng hoặc đoạn chứa '.' —
    // IPv4-mapped). Tối đa 2 nhóm để không lộ quá /32.
    const head: string[] = [];
    for (const part of trimmed.split(":")) {
      if (head.length === 2) break;
      if (!/^[0-9a-fA-F]{1,4}$/.test(part)) break;
      head.push(part.toLowerCase());
    }
    return head.length ? `${head.join(":")}::*` : "::*";
  }

  return null;
}

/** Cặp [pattern, nhãn] — thứ tự QUAN TRỌNG (Edg trước Chrome; Chrome trước Safari). */
const BROWSER_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bEdg(?:e|A|iOS)?\//, "Edge"],
  [/\bOPR\/|\bOpera\b/, "Opera"],
  [/\bFirefox\//, "Firefox"],
  [/\bChrome\//, "Chrome"],
  [/\bSafari\//, "Safari"],
];

/** iOS/Android trước (UA mobile chứa cả token desktop-like); Mac sau iPhone/iPad. */
const OS_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/iPhone|iPad|iPod/, "iOS"],
  [/Android/, "Android"],
  [/Windows/, "Windows"],
  [/Mac OS X|Macintosh/, "macOS"],
  [/Linux|X11/, "Linux"],
];

/**
 * Rút gọn UA → nhãn cố định "Browser trên OS" (vd "Chrome trên Windows"). Chỉ nhận diện qua
 * allowlist; UA lạ/không match browser lẫn OS → null. Match 1 vế → trả riêng vế đó.
 */
export function summarizeUserAgent(ua: string | null | undefined): string | null {
  if (!ua) return null;
  const trimmed = ua.trim();
  if (!trimmed) return null;

  const browser = BROWSER_RULES.find(([re]) => re.test(trimmed))?.[1] ?? null;
  const os = OS_RULES.find(([re]) => re.test(trimmed))?.[1] ?? null;

  if (browser && os) return `${browser} trên ${os}`;
  return browser ?? os;
}
