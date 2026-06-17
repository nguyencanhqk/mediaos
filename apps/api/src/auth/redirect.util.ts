/**
 * FS-1a — chống open-redirect (rủi ro #11). `?redirect` CHỈ được điều hướng tới origin nằm trong allowlist
 * (so khớp origin TƯỜNG MINH: scheme+host+port; KHÔNG '*', KHÔNG substring). Server là nguồn allowlist DUY
 * NHẤT; `apps/auth` (1b) gọi /auth/redirect-allowed để kiểm TRƯỚC khi `window.location = target`.
 *
 * Bảo mật: dùng WHATWG `URL` — cùng bộ parser với trình duyệt → KHÔNG có parser-differential (origin server
 * tính == origin trình duyệt sẽ điều hướng). So khớp trên `url.origin` đã chuẩn hoá nên backslash/userinfo/
 * case tricks không vượt được (origin kết quả phải TRÙNG KHỚP một origin allowlist).
 */

/** Chuẩn hoá 1 chuỗi origin → `url.origin` (bỏ path/query/hash). Trả null nếu không parse được. */
function normalizeOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/** Parse env allowlist (chuỗi phẩy) → mảng origin chuẩn hoá. Bỏ entry rỗng/sai định dạng (fail-closed). */
export function parseRedirectAllowlist(raw: string): string[] {
  return raw
    .split(",")
    .map((o) => o.trim())
    .filter((o) => o.length > 0)
    .map(normalizeOrigin)
    .filter((o): o is string => o !== null);
}

/**
 * Validate `target`. Trả URL an toàn (chuỗi đã chuẩn hoá) nếu:
 *   - là absolute URL (relative `/path` `//evil` → ném → null),
 *   - scheme http/https (chống `javascript:`/`data:`/`file:`),
 *   - `url.origin` ∈ allowlist (exact).
 * Ngược lại → null (caller từ chối). Allowlist RỖNG → mọi target → null (fail-closed).
 */
export function validateRedirect(
  target: string | undefined | null,
  allowlist: string[],
): string | null {
  if (!target) return null;
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return null; // relative / malformed → từ chối
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  // Userinfo bypass: `https://evil.com@studio.localhost` có origin = studio.localhost (LỌT allowlist) nhưng
  // toString() vẫn nhúng `evil.com@` (Basic-Auth header tới host thật + chuỗi gây nhầm cho phishing). Từ chối.
  if (url.username || url.password) return null;
  // http chỉ lọt khi origin http ĐƯỢC allowlist TƯỜNG MINH (so khớp origin gồm scheme) — operator tự chịu
  // trách nhiệm; dev *.localhost cần http. Prod chỉ đưa origin https vào allowlist.
  if (!allowlist.includes(url.origin)) return null;
  return url.toString();
}
