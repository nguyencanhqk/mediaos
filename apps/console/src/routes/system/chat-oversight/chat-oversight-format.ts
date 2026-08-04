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

/*
 * ⚠️ `dayKeyOf` đã bị GỠ ở `S7-CHAT-BE-9` — cùng lúc với `filterAuditEntries`.
 *
 * Nó quy đổi mốc audit sang ngày theo giờ **MÁY NGƯỜI DÙNG**. Từ khi CHAT-API-019 lọc ở server theo
 * `company.timezone`, một hàm quy đổi ngày ở client là **nguồn sự thật thứ hai** cho cùng câu hỏi — và
 * hai người ngồi hai múi giờ sẽ đọc ra hai kết quả. Đừng dựng lại nó để "lọc nhanh phía client".
 */

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

/**
 * Bộ lọc của CHAT-SCREEN-008 — **gửi lên SERVER** (`S7-CHAT-BE-9`), không còn lọc trên dòng đã tải.
 *
 * `""` = không giới hạn (ô trống). Trường rỗng bị BỎ khỏi query string chứ không gửi chuỗi rỗng:
 * `chatOversightAuditQuerySchema` khai `.uuid()`/`YYYY-MM-DD` nên `""` là **400**, không phải "bỏ lọc".
 */
export interface AuditFilterInput {
  /** `""` = mọi người. So khớp theo `actorUserId` (id ổn định), KHÔNG theo tên (tên trùng nhau được). */
  actorUserId: string;
  /** `YYYY-MM-DD` — NGÀY theo lịch công ty; server quy đổi theo `company.timezone`. BAO GỒM ngày này. */
  from: string;
  /** `YYYY-MM-DD` — như trên, BAO GỒM ngày này. */
  to: string;
}

/** Tham số gửi lên CHAT-API-019: chỉ những ô người dùng ĐÃ điền. */
export function auditFilterParams(filter: AuditFilterInput): {
  actorUserId?: string;
  from?: string;
  to?: string;
} {
  return {
    ...(filter.actorUserId === "" ? {} : { actorUserId: filter.actorUserId }),
    ...(filter.from === "" ? {} : { from: filter.from }),
    ...(filter.to === "" ? {} : { to: filter.to }),
  };
}

export interface ActorOption {
  userId: string;
  name: string | null;
}

/** Danh sách người thực hiện RÚT TỪ các dòng đã tải (dựng option cho bộ lọc), sắp theo tên. */
export function distinctActors(rows: readonly ChatOversightAuditEntryDto[]): ActorOption[] {
  const byId = new Map<string, string | null>();
  for (const row of rows) {
    if (row.actorUserId === null) continue;
    // Giữ tên KHÔNG rỗng đầu tiên gặp được: cùng một actor có thể có dòng thiếu tên (user đã xoá).
    const current = byId.get(row.actorUserId);
    if (current === undefined || (current === null && row.actorName !== null)) {
      byId.set(row.actorUserId, row.actorName);
    }
  }
  return sortActors([...byId.entries()].map(([userId, name]) => ({ userId, name })));
}

/**
 * Gộp ĐƠN ĐIỆU danh sách option người thực hiện.
 *
 * ┌─ VÌ SAO PHẢI TÍCH LUỸ, KHÔNG DỰNG LẠI TỪ TRANG HIỆN TẠI ────────────────────────────────────────┐
 * │ Từ khi lọc chạy ở SERVER, chọn "Trần Thị B" làm mọi dòng trả về đều của B ⇒ nếu option dựng lại  │
 * │ từ dữ liệu vừa nhận thì mọi người khác **biến mất khỏi ô chọn** và người dùng kẹt: không có đường │
 * │ quay lại A ngoài nút Đặt lại. Tích luỹ giữ nguyên những ai đã từng thấy.                          │
 * └───────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Trả về CHÍNH `prev` khi không có gì mới — để `setState` bail-out và effect không tự kích lại vòng lặp.
 */
export function mergeActorOptions(
  prev: readonly ActorOption[],
  next: readonly ActorOption[],
): ActorOption[] {
  const byId = new Map(prev.map((a) => [a.userId, a]));
  let changed = false;
  for (const actor of next) {
    const current = byId.get(actor.userId);
    if (current === undefined) {
      byId.set(actor.userId, actor);
      changed = true;
      continue;
    }
    // Tên đến muộn (dòng đầu thiếu tên vì user đã xoá) vẫn được nhận — nhưng không xoá tên đã có.
    if (current.name === null && actor.name !== null) {
      byId.set(actor.userId, actor);
      changed = true;
    }
  }
  return changed ? sortActors([...byId.values()]) : (prev as ActorOption[]);
}

function sortActors(actors: ActorOption[]): ActorOption[] {
  return [...actors].sort((a, b) => (a.name ?? a.userId).localeCompare(b.name ?? b.userId, "vi"));
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
