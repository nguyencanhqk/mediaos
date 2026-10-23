/**
 * S16-SOCIAL-FILEOPENUX-1 (D2) — đọc cách phục vụ mà SERVER đã ký vào URL GET của storage.
 *
 * Server quyết định `inline`/`attachment` theo MIME đã đăng ký (`resolveServeDirectives` ở API) và LUÔN ghim
 * quyết định đó vào tham số `response-content-disposition` của URL ký; trước khi trả URL, server tự kiểm tham số
 * có mặt đúng MỘT lần, đúng tên chữ thường, đúng giá trị (fail-closed). Storage trả đúng giá trị đó làm header
 * `Content-Disposition`, và sửa tham số làm chữ ký hỏng.
 *
 * Bộ đọc chỉ nhận đúng hình dạng server phát; mọi lệch (vắng · trùng · tên khác hoa-thường · token lạ) ⇒
 * `unknown` để caller giữ hành vi cũ. KHÔNG nhìn đường dẫn, đuôi tệp hay `response-content-type`.
 *
 * ⚠️ Chỉ gọi SAU khi đã kiểm scheme `http(s)`: URL scheme không đặc biệt (`javascript:` · `data:`) vẫn có phần
 * query đọc được.
 */
export type SignedUrlDisposition = "inline" | "attachment" | "unknown";

const DISPOSITION_PARAM = "response-content-disposition";

export function signedUrlDisposition(url: URL): SignedUrlDisposition {
  let occurrences = 0;
  let value: string | null = null;
  for (const [key, raw] of url.searchParams) {
    if (key.toLowerCase() !== DISPOSITION_PARAM) continue;
    // Biến thể hoa-thường khác của tên ⇒ không phải URL server phát.
    if (key !== DISPOSITION_PARAM) return "unknown";
    occurrences += 1;
    value = raw;
  }
  if (occurrences !== 1 || value === null) return "unknown";

  const [token = ""] = value.split(";");
  const normalized = token.trim().toLowerCase();
  return normalized === "inline" || normalized === "attachment" ? normalized : "unknown";
}

/**
 * Như {@link signedUrlDisposition} nhưng nhận chuỗi `href` (CHAT gắn URL ký lúc render). Không phải URL tuyệt đối
 * hoặc scheme khác `http(s)` ⇒ `unknown`. Chỉ dùng để chọn NHÃN hiển thị — KHÔNG quyết định điều hướng.
 */
export function hrefDisposition(href: string): SignedUrlDisposition {
  let parsed: URL;
  try {
    parsed = new URL(href);
  } catch {
    // Chuỗi không phải URL tuyệt đối: không có tham số đã ký để đọc.
    return "unknown";
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "unknown";
  return signedUrlDisposition(parsed);
}
