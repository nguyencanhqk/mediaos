/**
 * S12-RECRUIT-FE-1 (review-gate patch) — helper thuần đổi qua lại giữa ISO instant (server,
 * `timestamp with time zone`) và giá trị `<input type="datetime-local">` (LUÔN hiển thị theo múi giờ
 * LOCAL của trình duyệt — không có offset trong chuỗi).
 *
 * BUG đã vá: `iso.slice(0,16)` cắt thẳng phần "wall-clock UTC" của chuỗi ISO rồi đổ vào input
 * datetime-local — trình duyệt hiển thị đúng SỐ đó nhưng NGƯỜI DÙNG đọc nó như giờ LOCAL. Khi submit,
 * `new Date(value)` lại parse chuỗi đó NHƯ LOCAL rồi `.toISOString()` — lệch đúng UTC-offset của máy
 * mỗi lần sửa (round-trip không idempotent). Hai hàm dưới đây đối xứng qua LOCAL time — round-trip
 * `localInputToIso(isoToLocalInput(iso))` khớp lại đúng `iso` (trừ phần giây/mili bị cắt, xem spec).
 */

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** ISO instant → `yyyy-MM-ddTHH:mm` theo giờ LOCAL của trình duyệt (giá trị hợp lệ cho input datetime-local). */
export function isoToLocalInput(iso: string): string {
  if (iso === "") return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/**
 * Giá trị input datetime-local (`yyyy-MM-ddTHH:mm`, KHÔNG offset) → ISO instant. `new Date(value)` hiểu
 * chuỗi không-offset là giờ LOCAL (khác `Date.parse` của chuỗi có "Z"/offset) — đây CHÍNH LÀ hành vi ta
 * muốn (người dùng gõ giờ họ thấy trên đồng hồ tường, không phải UTC).
 */
export function localInputToIso(value: string): string {
  if (value === "") return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

/** Đầu ngày (00:00:00.000) theo giờ LOCAL của một mốc `yyyy-MM-dd` → ISO instant. Dùng cho filter "từ ngày". */
export function localDayStartIso(dateOnly: string): string {
  if (dateOnly === "") return "";
  const d = new Date(`${dateOnly}T00:00:00`);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

/**
 * Cuối ngày (23:59:59.999) theo giờ LOCAL của một mốc `yyyy-MM-dd` → ISO instant. Dùng cho filter "đến
 * ngày" — BUG đã vá: `new Date(dateOnly).toISOString()` là NỬA ĐÊM UTC, sớm hơn nửa đêm LOCAL tới 7 giờ
 * (UTC+7) ⇒ loại mất toàn bộ lượt phỏng vấn buổi tối của "ngày cuối" trong bộ lọc.
 */
export function localDayEndIso(dateOnly: string): string {
  if (dateOnly === "") return "";
  const d = new Date(`${dateOnly}T23:59:59.999`);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}
