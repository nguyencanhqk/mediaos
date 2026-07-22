/**
 * S2-FND-FILE-2 — đối chiếu extension ↔ MIME (chống MIME-spoof) cho register-upload.
 *
 * BỐI CẢNH: server KHÔNG tin `declaredMimeType` client mù quáng (BẤT BIẾN #2.3). Ngoài allowlist MIME
 * (system_settings `file.allowed_mime_types`) + blocklist extension (`file.blocked_extensions`), ta ép
 * thêm: nếu MIME nằm trong MAP dưới đây (các loại được phép của MVP) thì extension (đã sanitize, lowercase,
 * không dấu chấm) PHẢI thuộc tập hợp lệ của MIME đó — nếu KHÔNG → coi là spoof (vd `report.pdf` khai
 * `image/png`, hoặc `x.html` khai `application/pdf`).
 *
 * PURE (no I/O) → unit-test được không cần DB/mạng.
 */

/**
 * MIME → tập extension hợp lệ. Chỉ phủ các MIME thuộc allowlist MVP (setting-defaults `file.allowed_mime_types`)
 * — nếu allowlist company mở rộng thêm MIME KHÔNG có ở đây, đối chiếu extension↔MIME được BỎ QUA (lenient,
 * không chặn) vì không có tri thức để đối chiếu; allowlist + blocklist vẫn là hàng rào.
 */
export const MIME_TO_EXTENSIONS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "image/png": ["png"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/webp": ["webp"],
  "application/pdf": ["pdf"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ["docx"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ["xlsx"],
  "text/csv": ["csv"],
  "text/plain": ["txt"],
  // S5-BRAND-BE-1 (append): favicon .ico — hai MIME cho cùng định dạng (x-icon = de-facto, vnd.microsoft = IANA).
  "image/x-icon": ["ico"],
  "image/vnd.microsoft.icon": ["ico"],
});

/**
 * True nếu extension NHẤT QUÁN với MIME (hoặc không đủ tri thức để bác bỏ → lenient true).
 *
 *  - MIME KHÔNG có trong MAP → true (không đối chiếu; allowlist/blocklist lo phần còn lại).
 *  - `extension` null (file không có phần mở rộng) → true: KHÔNG có extension để spoof; blocklist + allowlist
 *    vẫn gác. Đối chiếu extension↔MIME chỉ nhắm spoof CÓ extension lệch (vd report.pdf khai image/png).
 *  - MIME có trong MAP + extension present ∈ tập hợp lệ → true; extension present ngoài tập → false (spoof).
 */
export function isExtensionConsistentWithMime(extension: string | null, mimeType: string): boolean {
  if (extension === null) return true; // không có extension → không có gì để đối chiếu
  const allowed = MIME_TO_EXTENSIONS[mimeType];
  if (!allowed) return true; // MIME ngoài MAP → không đối chiếu (lenient)
  return allowed.includes(extension.toLowerCase());
}
