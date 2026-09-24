import { ConflictException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import {
  IDEA_STATUS_LABEL,
  IDEA_TRANSITIONS,
  type IdeaTransition,
  assertIdeaTransition,
} from "./social-idea-fsm";
import { SOCIAL_ERR } from "./social.errors";

/**
 * S16-SOCIAL-BE-2B-2 · **I-1** — ma trận FSM sáng kiến VÉT CẠN 4×4 (plan §5.2).
 *
 * ┌─ VÌ SAO VÉT CẠN, VÀ VÌ SAO Ở TẦNG UNIT ────────────────────────────────────────────────────────┐
 * │ Luật chuyển trạng thái KHÔNG có lưới nào ở tầng DB: `chk_feed_ideas_status` chỉ ép TẬP giá trị,│
 * │ nó không đọc được trạng thái CŨ. Nghĩa là mọi ô sai của ma trận này, nếu lọt, sẽ ghi được vào  │
 * │ DB **không lỗi gì cả** — sáng kiến nhảy thẳng `submitted → accepted` bỏ qua xét duyệt.         │
 * │                                                                                                 │
 * │ 🔴 **4 ô cột `to='submitted'` KHÔNG tới được qua HTTP** — DTO của `046`                         │
 * │ (`reviewFeedIdeaSchema`) chỉ nhận `under_review|accepted|rejected`, nên Zod chặn trước ở 400.   │
 * │ Chúng vẫn phải có mặt ở đây: FSM là hàm CÔNG KHAI, và một đường gọi nội bộ sau này (job, import,│
 * │ backfill) không đi qua DTO. Kê rõ để không ai đọc bảng này thành "16 ca HTTP".                  │
 * └────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Neo dương đặt TRƯỚC mọi assert phủ định (luật §5 của plan): `IDEA_TRANSITIONS.length === 3`. Không
 * có nó, một bảng cạnh RỖNG làm 16/16 ô "ném đúng" và cả spec này xanh trong khi FSM chặn mọi thứ.
 */

const ALL_STATUSES = ["submitted", "under_review", "accepted", "rejected"] as const;

/** 3 cạnh hợp lệ theo SPEC-16 §13.3 — gõ TAY, không suy từ `IDEA_TRANSITIONS`. */
const EXPECTED_VALID = [
  ["submitted", "under_review"],
  ["under_review", "accepted"],
  ["under_review", "rejected"],
] as const;

const isExpectedValid = (from: string, to: string): boolean =>
  EXPECTED_VALID.some(([f, t]) => f === from && t === to);

describe("S16-SOCIAL-BE-2B-2 · I-1 · FSM sáng kiến (ma trận 4×4 vét cạn)", () => {
  it("neo dương: bảng cạnh có ĐÚNG 3 cạnh (bảng rỗng ⇒ mọi assert phủ định dưới đây vacuous)", () => {
    expect(IDEA_TRANSITIONS.length).toBe(3);
    // Và đúng BA cạnh đó — không phải ba cạnh bất kỳ.
    expect(IDEA_TRANSITIONS.map((t) => `${t.from}->${t.to}`).sort()).toEqual(
      EXPECTED_VALID.map(([f, t]) => `${f}->${t}`).sort(),
    );
  });

  it("neo dương: 3 cạnh hợp lệ KHÔNG ném", () => {
    for (const [from, to] of EXPECTED_VALID) {
      expect(() => assertIdeaTransition(from, to), `${from} → ${to} phải đi qua`).not.toThrow();
    }
  });

  it("ma trận 4×4: đúng 3 ô đi qua, 13 ô còn lại ném 409 SOCIAL-ERR-019", () => {
    const passed: string[] = [];
    const rejected: string[] = [];

    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        const cell = `${from}->${to}`;
        try {
          assertIdeaTransition(from, to);
          passed.push(cell);
        } catch (e) {
          // Ném đúng LOẠI và đúng CHUỖI — 409 của một lớp khác đọc y hệt ở tầng HTTP.
          expect(e, `${cell}: phải là ConflictException`).toBeInstanceOf(ConflictException);
          expect((e as ConflictException).message, `${cell}: phải mang SOCIAL-ERR-019`).toBe(
            SOCIAL_ERR.IDEA_TRANSITION,
          );
          rejected.push(cell);
        }
      }
    }

    expect(passed.length + rejected.length, "ma trận phải phủ đủ 16 ô").toBe(16);
    expect(passed.sort()).toEqual(EXPECTED_VALID.map(([f, t]) => `${f}->${t}`).sort());
    expect(rejected.length).toBe(13);
    // Mọi ô ném phải đúng là ô KHÔNG nằm trong danh sách hợp lệ gõ tay (không tự xác nhận qua bảng).
    for (const cell of rejected) {
      const [from, to] = cell.split("->");
      expect(isExpectedValid(from, to), `${cell} bị ném nhưng lại nằm trong danh sách hợp lệ`).toBe(
        false,
      );
    }
  });

  it("terminal: KHÔNG cạnh nào RỜI `accepted`/`rejected` (không reopen)", () => {
    // 🔴 Nới kiểu về `IdeaTransition[]` CÓ CHỦ ĐÍCH. Đọc trực tiếp `IDEA_TRANSITIONS` (`as const`) thì
    // TS thu hẹp `t.from` thành `"submitted" | "under_review"` và báo **TS2367** "so sánh vô nghĩa" —
    // đúng về kiểu (hôm nay bảng không có cạnh nào như thế) nhưng nó biến ca này thành hằng-đúng lúc
    // biên dịch, tức là lưới biến mất đúng vào lúc ai đó THÊM một cạnh reopen. Nới kiểu giữ phép đo ở
    // RUNTIME: thêm `{from:'accepted', …}` vào bảng ⇒ ca này ĐỎ (còn bản narrow thì lại xanh, vì lúc
    // đó so sánh trở nên "có nghĩa" và filter trả về đúng cạnh mới... nhưng chỉ sau khi ai đó sửa
    // TS2367 bằng cách xoá dòng assert).
    const edges: readonly IdeaTransition[] = IDEA_TRANSITIONS;
    expect(edges.filter((t) => t.from === "accepted" || t.from === "rejected")).toEqual([]);
  });

  it("không nhảy cóc: `submitted → accepted|rejected` đều ném", () => {
    for (const to of ["accepted", "rejected"] as const) {
      expect(() => assertIdeaTransition("submitted", to)).toThrow(SOCIAL_ERR.IDEA_TRANSITION);
    }
  });

  it("nhãn trạng thái: đủ 4 giá trị, có CHỮ, không rò tên enum thô", () => {
    for (const s of ALL_STATUSES) {
      const label = IDEA_STATUS_LABEL[s];
      expect(label, `nhãn của ${s}`).toBeTruthy();
      expect(label.trim().length).toBeGreaterThan(0);
      // Nhãn là tiếng Việt cho người đọc — không được bằng chính chuỗi enum.
      expect(label).not.toBe(s);
    }
    expect(Object.keys(IDEA_STATUS_LABEL).sort()).toEqual([...ALL_STATUSES].sort());
  });
});
