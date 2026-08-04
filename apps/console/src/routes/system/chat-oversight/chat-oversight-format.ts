/**
 * S7-CHAT-FE-5 🔒 — hàm THUẦN của hai màn quản trị đọc-vượt (CHAT-SCREEN-007/008).
 *
 * Tách khỏi component để test bằng gọi hàm (không dựng DOM). Không import React, không đụng store.
 *
 * ⚠️ `formatBytes`/`formatDateTime` trông giống `apps/app/src/components/chat/chat-format.ts` nhưng
 * KHÔNG dùng chung được: hai app là hai bundle riêng và console CỐ Ý không import gì từ `apps/app`
 * (`docs/plans/S7-CHAT-FE-5.md` §2 — ranh giới package là thứ giữ cho màn này không bao giờ mọc ra ô
 * soạn tin). Hai bản sao ngắn, thuần, có test riêng — rẻ hơn một package chung chỉ để chứa 20 dòng.
 */
import type { ChatOversightAuditEntryDto } from "@mediaos/contracts";

/** `dd/MM/yyyy HH:mm:ss` giờ máy. Mốc hỏng ⇒ chuỗi rỗng (không hiện "Invalid Date" cho người dùng). */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
}

/** `dd/MM/yyyy HH:mm` — dùng cho cột "tin cuối" ở bảng tra cứu (không cần tới giây). */
export function formatDateTimeShort(iso: string): string {
  const full = formatDateTime(iso);
  return full === "" ? "" : full.slice(0, full.length - 3);
}

/**
 * Khoá ngày `YYYY-MM-DD` theo giờ **ĐỊA PHƯƠNG**.
 *
 * KHÔNG dùng `toISOString().slice(0,10)`: nó đổi sang UTC ⇒ một dòng audit lúc 06:30 sáng giờ VN rơi
 * sang ngày HÔM TRƯỚC, và bộ lọc "từ ngày…đến ngày" bỏ sót đúng những dòng người dùng đang tìm.
 */
export function dayKeyOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

const SIZE_UNITS = ["B", "KB", "MB", "GB"] as const;

/** Cỡ tệp người đọc được (1024, 1 chữ số thập phân từ KB). Giá trị lạ ⇒ chuỗi rỗng. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < SIZE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${SIZE_UNITS[unit]}`;
}

/**
 * Nhãn hiển thị của một phòng ở màn quản trị.
 *
 * Phòng `direct` KHÔNG có `name` (mig `0538` DROP NOT NULL) ⇒ rơi về **mã phòng**, KHÔNG bịa tên từ danh
 * sách thành viên: ở màn đọc-vượt, một cái tên đoán sai dẫn người quản trị mở nhầm hộp thư của người khác.
 */
export function roomLabel(room: { name: string | null; roomCode: string }): string {
  const name = room.name?.trim() ?? "";
  return name === "" ? room.roomCode : name;
}

/**
 * Tóm tắt `criteria` của một dòng audit thành một dòng chữ (`q: abc · roomType: group`).
 *
 * `criteria` là `jsonb` tự do do mapper backend lọc sẵn — hiển thị dạng `khoá: giá trị` thay vì JSON thô
 * để cột này đọc được trên bảng. Giá trị object/array ⇒ `JSON.stringify` (không nuốt: một tiêu chí không
 * hiện ra là một phần bằng chứng bị mất).
 */
export function formatCriteria(criteria: Record<string, unknown> | null): string {
  if (criteria === null) return "";
  const parts: string[] = [];
  for (const [key, value] of Object.entries(criteria)) {
    if (value === null || value === undefined) continue;
    const rendered = typeof value === "object" ? JSON.stringify(value) : String(value);
    parts.push(`${key}: ${rendered}`);
  }
  return parts.join(" · ");
}

/** Bộ lọc CLIENT-SIDE của CHAT-SCREEN-008 — xem `filterAuditEntries`. */
export interface AuditFilterInput {
  /** `""` = mọi người. So khớp theo `actorUserId` (id ổn định), KHÔNG theo tên (tên trùng nhau được). */
  actorUserId: string;
  /** `YYYY-MM-DD` giờ địa phương, BAO GỒM cả ngày này. `""` = không giới hạn. */
  from: string;
  /** `YYYY-MM-DD` giờ địa phương, BAO GỒM cả ngày này. `""` = không giới hạn. */
  to: string;
}

/**
 * Lọc nhật ký **trên các dòng ĐÃ TẢI**.
 *
 * ⚠️ Đây KHÔNG phải lọc toàn cục, và giao diện BẮT BUỘC phải nói ra điều đó. CHAT-API-019 chỉ nhận
 * `cursor` + `limit` (đo trên `chatOversightAuditQuerySchema`, 04/08/2026) — không có tham số lọc theo
 * người hay khoảng thời gian ở server. Lọc im lặng trên một tập con làm người đọc kết luận "không có
 * lần truy cập nào" trong khi bằng chứng nằm ở trang chưa tải — đúng thứ SPEC-15 §18 gọi là audit
 * không dùng được làm kiểm soát. Nới CHAT-API-019 là việc của WO backend tiếp theo.
 */
export function filterAuditEntries(
  rows: readonly ChatOversightAuditEntryDto[],
  filter: AuditFilterInput,
): ChatOversightAuditEntryDto[] {
  return rows.filter((row) => {
    if (filter.actorUserId !== "" && row.actorUserId !== filter.actorUserId) return false;
    const key = dayKeyOf(row.createdAt);
    // Mốc hỏng (`key === ""`) KHÔNG bị lọc bỏ khi người dùng có đặt khoảng ngày: một dòng audit không
    // đọc được ngày vẫn là bằng chứng, giấu nó đi là tệ hơn hiện nó ngoài khoảng.
    if (key === "") return true;
    if (filter.from !== "" && key < filter.from) return false;
    if (filter.to !== "" && key > filter.to) return false;
    return true;
  });
}

/** Danh sách người thực hiện RÚT TỪ các dòng đã tải (dựng option cho bộ lọc), sắp theo tên. */
export function distinctActors(
  rows: readonly ChatOversightAuditEntryDto[],
): { userId: string; name: string | null }[] {
  const byId = new Map<string, string | null>();
  for (const row of rows) {
    if (row.actorUserId === null) continue;
    // Giữ tên KHÔNG rỗng đầu tiên gặp được: cùng một actor có thể có dòng thiếu tên (user đã xoá).
    const current = byId.get(row.actorUserId);
    if (current === undefined || (current === null && row.actorName !== null)) {
      byId.set(row.actorUserId, row.actorName);
    }
  }
  return [...byId.entries()]
    .map(([userId, name]) => ({ userId, name }))
    .sort((a, b) => (a.name ?? a.userId).localeCompare(b.name ?? b.userId, "vi"));
}

/**
 * Con trỏ trang kế khi cuộn NGƯỢC trong phòng chỉ đọc (CHAT-API-018c).
 *
 * `beforeSeq` LOẠI TRỪ và repo luôn trả TĂNG DẦN theo `roomSeq` ⇒ con trỏ = `roomSeq` NHỎ NHẤT của trang
 * hiện tại = phần tử đầu mảng. `null` khi trang rỗng (đã hết lịch sử).
 */
export function olderCursorOf(page: readonly { roomSeq: number }[]): number | null {
  if (page.length === 0) return null;
  return page.reduce((min, m) => (m.roomSeq < min ? m.roomSeq : min), page[0].roomSeq);
}
