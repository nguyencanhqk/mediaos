/**
 * S17-CHAT-UX2-FE-3 — logic `@mention` của ô soạn (SPEC-15 §22c **CHAT-DEC-027** · §10 CHAT-FUNC-024).
 *
 * File này cố ý **KHÔNG có JSX**: mọi luật khó (dò trigger, lọc roster, chèn chữ, suy `mentions[]`) là
 * hàm THUẦN, test được bằng ca bảng thay vì phải dựng cả composer cho từng ca lọc chuỗi.
 *
 * ⚠️ BẤT BIẾN của khối này — `mentions[]` gửi lên server được **SUY TỪ CHÍNH CHUỖI NHÁP**, không phải
 * từ một danh sách rời tích luỹ theo lượt chọn. Giữ danh sách rời thì người dùng chọn `@Nam`, xoá chữ
 * đó đi, rồi gửi — và Nam vẫn nhận thông báo về một tin nhắn KHÔNG hề nhắc tên mình. Server không cứu
 * được ca này: nó chỉ lọc người ngoài phòng (CHAT-ERR-010), còn Nam thì vẫn ở trong phòng.
 */
import { useMemo, useState, type KeyboardEvent } from "react";
import type { ChatRoomMemberDto } from "@mediaos/contracts";

/** Một người có thể được gợi ý — đã rút gọn khỏi `ChatRoomMemberDto` để test không phải dựng DTO đủ. */
export interface MentionCandidate {
  userId: string;
  name: string;
  avatarUrl: string | null;
}

/** Một lượt chèn mention đã xảy ra: `label` là ĐÚNG chuỗi đã ghi vào nháp (gồm cả dấu `@`). */
export interface MentionEntry {
  userId: string;
  label: string;
}

export interface MentionTrigger {
  /** Chỉ số của dấu `@` trong nháp. */
  start: number;
  /** Phần đã gõ SAU dấu `@` (chưa chuẩn hoá). */
  query: string;
}

/**
 * Truy vấn dài hơn ngần này thì chắc chắn người dùng đang gõ văn xuôi có dấu `@` chứ không tìm ai —
 * đóng popover thay vì lọc một chuỗi 200 ký tự trên mỗi phím.
 */
const MAX_MENTION_QUERY_LENGTH = 32;

/** Số dòng gợi ý tối đa. Dài hơn thì popover che mất chính ô soạn trên màn hình thấp. */
export const MENTION_SUGGESTION_LIMIT = 8;

/**
 * So khớp tiếng Việt không phân biệt hoa-thường + dấu (gõ `nguyen` khớp `Nguyễn`).
 *
 * Bản sao cục bộ của `normalizeSearchText` ở `routes/tasks/workspace-constants.ts` — CÓ CHỦ ĐÍCH:
 * kéo một util từ module TASK sang module CHAT là nối hai domain bằng một sợi dây mà không ai
 * nhìn thấy khi sửa bên kia. Khi có util chung ở `packages/ui`/`web-core` thì gộp cả hai về đó.
 */
export function normalizeMentionText(value: string): string {
  return value
    .toLocaleLowerCase("vi")
    .replace(/đ/g, "d")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

/**
 * Roster → ứng viên gợi ý.
 *
 * ⚠️ LỌC `leftAt` — roster GỒM CẢ người đã rời phòng (docblock `use-room-roster.ts`: thiếu họ thì tin
 * cũ mất avatar). Nhưng gợi ý mention một người đã rời là **hứa rồi nuốt**: server lọc bỏ id đó im
 * lặng (CHAT-ERR-010), người dùng thấy tên trong tin mà người kia không bao giờ nhận thông báo.
 *
 * Người không có `userName` cũng bị loại: không có gì để chèn vào chữ, và chèn UUID thì vô nghĩa.
 */
export function rosterToMentionCandidates(
  members: readonly ChatRoomMemberDto[],
): MentionCandidate[] {
  const out: MentionCandidate[] = [];
  for (const m of members) {
    if (m.leftAt) continue;
    const name = m.userName?.trim();
    if (!name) continue;
    out.push({ userId: m.userId, name, avatarUrl: m.avatarUrl ?? null });
  }
  return out;
}

/**
 * Dò xem con trỏ có đang ở trong một mention đang gõ dở hay không.
 *
 * Luật huỷ (mỗi luật đóng một ca thật, đừng gỡ luật nào mà không thay bằng ca test):
 *  - trước `@` là chữ/số ⇒ đó là **email** (`ten@congty.vn`) hoặc phần đuôi của một từ, không phải mention;
 *  - giữa `@` và con trỏ có **xuống dòng** ⇒ đã sang ý khác;
 *  - truy vấn quá `MAX_MENTION_QUERY_LENGTH`.
 *
 * Truy vấn ĐƯỢC PHÉP chứa dấu cách — tên người Việt có nhiều âm tiết (`@Nguyễn Văn Nam`). Cái giữ cho
 * popover không mở lì trong lúc gõ văn xuôi là **số kết quả**: 0 ứng viên khớp ⇒ component đóng popover.
 */
export function detectMentionTrigger(text: string, caret: number): MentionTrigger | null {
  const at = text.lastIndexOf("@", Math.max(0, caret - 1));
  if (at < 0) return null;

  const query = text.slice(at + 1, caret);
  if (query.length > MAX_MENTION_QUERY_LENGTH) return null;
  if (query.includes("\n")) return null;

  const before = at > 0 ? text[at - 1] : "";
  if (before !== "" && /[\p{L}\p{N}]/u.test(before)) return null;

  return { start: at, query };
}

/** Lọc + xếp: khớp từ ĐẦU tên lên trước khớp giữa chuỗi (gõ "na" thì "Nam" trên "Trần Na"). */
export function filterMentionCandidates(
  candidates: readonly MentionCandidate[],
  query: string,
  limit: number = MENTION_SUGGESTION_LIMIT,
): MentionCandidate[] {
  const q = normalizeMentionText(query.trim());
  if (q === "") return candidates.slice(0, limit);

  const prefix: MentionCandidate[] = [];
  const infix: MentionCandidate[] = [];
  for (const c of candidates) {
    const n = normalizeMentionText(c.name);
    if (n.startsWith(q)) prefix.push(c);
    else if (n.includes(q)) infix.push(c);
  }
  return [...prefix, ...infix].slice(0, limit);
}

/** Chuỗi ghi vào nháp cho một người. Dấu `@` là phần CỦA nhãn — `collectMentionIds` dò theo nó. */
export function mentionLabel(name: string): string {
  return `@${name}`;
}

/**
 * Chèn lựa chọn vào nháp: thay `@query` bằng `@Tên ` (kèm MỘT dấu cách) và trả vị trí con trỏ mới.
 *
 * Dấu cách không phải trang trí: thiếu nó thì phím tiếp theo lại rơi vào truy vấn của chính mention
 * vừa chọn và popover mở lại ngay lập tức.
 */
export function applyMention(
  text: string,
  trigger: MentionTrigger,
  candidate: MentionCandidate,
): { text: string; caret: number } {
  const label = mentionLabel(candidate.name);
  const head = text.slice(0, trigger.start);
  const tail = text.slice(trigger.start + 1 + trigger.query.length);
  const inserted = `${label} `;
  return { text: `${head}${inserted}${tail}`, caret: head.length + inserted.length };
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle === "") return 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const i = haystack.indexOf(needle, from);
    if (i < 0) return count;
    count += 1;
    from = i + needle.length;
  }
}

/**
 * `mentions[]` thật sự gửi lên: chỉ những lượt chèn mà nhãn của nó CÒN nằm trong nháp.
 *
 * Đếm theo **số lần xuất hiện** chứ không chỉ `includes`: hai người trùng tên (`@Nam` × 2) mà người
 * dùng xoá một cái thì chỉ MỘT id được tính. `includes` sẽ giữ cả hai — đúng cái lỗi mà cả khối này
 * sinh ra để chặn, chỉ khác quy mô.
 *
 * Trùng `userId` bị gộp: nhắc một người hai lần trong cùng tin không phải hai lượt nhắc.
 */
export function collectMentionIds(
  body: string,
  entries: readonly MentionEntry[],
  max: number,
): string[] {
  const remaining = new Map<string, number>();
  for (const e of entries) {
    if (!remaining.has(e.label)) remaining.set(e.label, countOccurrences(body, e.label));
  }

  const out: string[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    const left = remaining.get(e.label) ?? 0;
    if (left <= 0) continue;
    remaining.set(e.label, left - 1);
    if (seen.has(e.userId)) continue;
    seen.add(e.userId);
    out.push(e.userId);
    if (out.length >= max) break;
  }
  return out;
}

export interface MentionAutocomplete {
  /** `null` = popover đóng. */
  trigger: MentionTrigger | null;
  suggestions: MentionCandidate[];
  activeIndex: number;
  /** Popover chỉ MỞ khi có trigger **và** có ít nhất một ứng viên khớp. */
  isOpen: boolean;
  /**
   * Gọi mỗi lần **nháp đổi** (gõ phím). CỐ Ý không gọi khi con trỏ di chuyển mà chữ không đổi.
   *
   * Vì sao không đồng bộ theo `onSelect`: bước chèn mention gọi `setSelectionRange` để đặt con trỏ
   * ngay sau `@Tên `, mà `setSelectionRange` CŨNG bắn sự kiện `select` — dò lại tại đó sẽ mở LẠI đúng
   * cái popover người dùng vừa chọn xong, thành một vòng không thoát được. Cách chữa duy nhất là một
   * cờ "nuốt một lần", mà cờ đó im lặng nuốt nhầm thao tác THẬT nếu trình duyệt không bắn `select`
   * (đúng lớp bẫy `ismounted-ref-stuck-false-under-strictmode`: một cờ kẹt sai trạng thái vĩnh viễn).
   *
   * Hệ quả chấp nhận: bấm chuột vào giữa chữ khi popover đang mở thì nó giữ nguyên tới phím kế tiếp.
   * Rời hẳn tiêu điểm thì `onBlur` ở ô soạn gọi `close()`.
   */
  sync: (text: string, caret: number) => void;
  close: () => void;
  moveActive: (delta: number) => void;
  /**
   * Bàn phím KHI popover đang mở. Trả `true` = **đã nuốt phím**, caller phải `return` ngay.
   *
   * ⚠️ Enter là phím đắt nhất ở đây: popover mở thì Enter **CHỌN gợi ý**, tuyệt đối không gửi tin —
   * gửi ở đây là gửi một tin còn dở với `@ng` chưa thành tên ai. Vì vậy hàm này phải được gọi
   * TRƯỚC nhánh "Enter ⇒ gửi" của ô soạn, và caller phải tôn trọng giá trị trả về.
   */
  handleKeyDown: (
    e: KeyboardEvent<HTMLTextAreaElement>,
    onPick: (candidate: MentionCandidate) => void,
  ) => boolean;
}

/**
 * Trạng thái popover. KHÔNG giữ nháp — nháp là của `MessageComposer` (một nguồn sự thật duy nhất);
 * hook này chỉ nhớ "đang gõ mention nào" và "đang trỏ vào dòng nào".
 *
 * ⚠️ Object trả về CỐ Ý không bọc `useMemo` — khác `useAttachmentPreviews` (ở đó có bọc). Lý do: mọi
 * trường của nó (`trigger` · `suggestions` · `activeIndex` · `isOpen`) đổi theo ĐÚNG những render mà
 * ta quan tâm, và `pickMention` ở phía gọi vốn đã phụ thuộc `draft` — thứ đổi mỗi phím gõ. Bọc memo ở
 * đây chỉ thêm bốn `useCallback` nữa mà không làm tham chiếu nào ổn định thêm một render nào.
 */
export function useMentionAutocomplete(
  candidates: readonly MentionCandidate[],
): MentionAutocomplete {
  const [trigger, setTrigger] = useState<MentionTrigger | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const suggestions = useMemo(
    () => (trigger === null ? [] : filterMentionCandidates(candidates, trigger.query)),
    [candidates, trigger],
  );

  const isOpen = trigger !== null && suggestions.length > 0;
  // Kẹp về biên: gõ thêm một chữ làm danh sách ngắn lại thì con trỏ cũ có thể trỏ ra ngoài mảng.
  const safeIndex = suggestions.length === 0 ? 0 : Math.min(activeIndex, suggestions.length - 1);

  const close = () => setTrigger(null);

  const moveActive = (delta: number) => {
    setActiveIndex((i) => {
      const n = suggestions.length;
      if (n === 0) return 0;
      const base = Math.min(i, n - 1);
      return (base + delta + n) % n;
    });
  };

  const handleKeyDown = (
    e: KeyboardEvent<HTMLTextAreaElement>,
    onPick: (candidate: MentionCandidate) => void,
  ): boolean => {
    if (!isOpen) return false;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        moveActive(1);
        return true;
      case "ArrowUp":
        e.preventDefault();
        moveActive(-1);
        return true;
      case "Enter":
      case "Tab": {
        e.preventDefault();
        const picked = suggestions[safeIndex];
        if (picked !== undefined) onPick(picked);
        return true;
      }
      case "Escape":
        e.preventDefault();
        close();
        return true;
      default:
        return false;
    }
  };

  return {
    trigger,
    suggestions,
    activeIndex: safeIndex,
    isOpen,
    sync: (text: string, caret: number) => {
      const next = detectMentionTrigger(text, caret);
      setTrigger(next);
      if (next === null || next.start !== trigger?.start) setActiveIndex(0);
    },
    close,
    moveActive,
    handleKeyDown,
  };
}
