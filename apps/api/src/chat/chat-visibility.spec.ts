import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { unreadSeqExpr, visibleFromSeqColumn, visibleFromSeqScalar } from "./chat-visibility";

/**
 * S7-CHAT-BE-GATE-2 — vị từ "lịch sử trước khi tham gia" (SPEC-15 §13.4).
 *
 * ⚠️ VÌ SAO SUITE NÀY KIỂM SQL ĐÃ RENDER, KHÔNG KIỂM HÀNH VI: `visible_from_seq` LUÔN NULL ở v1
 * (CHAT-DEC-008), nên MỌI test hành vi trên dữ liệu v1 đều XANH dù vị từ có mặt hay không — đúng cái
 * bẫy đã để 5 đường đọc trôi qua cả BE-1 lẫn BE-2 mà không ai thấy. Kiểm chuỗi SQL là cách duy nhất
 * làm ĐỎ được một đường đọc bị gỡ vị từ, ở tầng chạy-trong-CI (int-spec bị skip khi thiếu `LANE_DB`).
 * Hành vi khi cột KHÁC NULL do `chat-be-gate2-visible-from-seq.int-spec.ts` phủ trên Postgres thật.
 */

const dialect = new PgDialect();
const render = (fragment: SQL): string => dialect.sqlToQuery(fragment).sql;

describe("visibleFromSeqScalar — dạng scalar (caller đã cầm membership)", () => {
  it("cột NULL (v1) → undefined, KHÔNG sinh mệnh đề thừa", () => {
    // undefined chứ không phải `TRUE`: drizzle bỏ hẳn khỏi and(), kế hoạch truy vấn giữ nguyên
    // như trước GATE-2 ⇒ v1 không trả giá hiệu năng nào cho lời hứa của phase sau.
    expect(visibleFromSeqScalar(null)).toBeUndefined();
  });

  it("cột có giá trị → so với `room_seq`, tham số bind (không nội suy chuỗi)", () => {
    const q = dialect.sqlToQuery(visibleFromSeqScalar(7) as SQL);
    expect(q.sql).toBe('"chat_messages"."room_seq" >= $1');
    expect(q.params).toEqual([7]);
  });

  it("KHÔNG BAO GIỜ so với `chat_messages.seq` (identity CẤP BẢNG)", () => {
    // SPEC-15 §13.4 và mig 0538:245 viết `msg.seq` — câu đó có TRƯỚC mig 0539. `seq` tăng xuyên mọi
    // phòng và mọi tenant; so một mốc per-room với nó là cắt lịch sử ở điểm ngẫu nhiên. Ca này khoá
    // hệ quy chiếu lại để không ai "sửa cho khớp SPEC" mà làm hỏng.
    const sqlText = render(visibleFromSeqScalar(7) as SQL);
    expect(sqlText).toContain("room_seq");
    expect(sqlText).not.toMatch(/"chat_messages"\."seq"/);
  });
});

describe("visibleFromSeqColumn — dạng cột (truy vấn tự join chat_room_members)", () => {
  const sqlText = render(visibleFromSeqColumn());

  it("mang ĐỦ vế `IS NULL OR` — không rút gọn thành COALESCE(...,0)", () => {
    // Mốc hợp lệ nhỏ nhất là 1 (room_seq liên tục từ 1 — mig 0539), nên COALESCE(...,0) "tình cờ"
    // tương đương NULL hôm nay và NGỪNG tương đương nếu gốc đánh số đổi.
    expect(sqlText).toBe(
      '("chat_room_members"."visible_from_seq" IS NULL OR "chat_messages"."room_seq" >= "chat_room_members"."visible_from_seq")',
    );
  });

  it("0 tham số bind — vế so sánh là CỘT, không phải giá trị từ JS", () => {
    expect(dialect.sqlToQuery(visibleFromSeqColumn()).params).toEqual([]);
  });
});

describe("unreadSeqExpr — công thức đếm chưa đọc DÙNG CHUNG (CHAT-API-001 + 016)", () => {
  const sqlText = render(unreadSeqExpr());

  it("khoá LITERAL công thức — đổi nó phải là hành động cố ý", () => {
    expect(sqlText).toBe(
      'greatest(0, coalesce("chat_rooms"."last_message_seq", 0) - greatest("chat_room_members"."last_read_seq", coalesce("chat_room_members"."visible_from_seq", 0) - 1))',
    );
  });

  it("sàn hiển thị nằm TRONG SQL, không ở JS", () => {
    // Bài học `clamp-must-be-sql-not-js`: kẹp ở JS = đọc-rồi-ghi, hai request song song thì bên ghi
    // sau thắng kể cả khi mang số nhỏ hơn.
    expect(sqlText).toContain("visible_from_seq");
    expect(sqlText).toContain("greatest");
  });

  it("v1 (cột NULL) rút về đúng công thức cũ: sàn = -1 ⇒ greatest(last_read_seq, -1) = last_read_seq", () => {
    // `chk_chat_members_read_seq` ép last_read_seq >= 0 ⇒ -1 không bao giờ thắng. Đây là lý do
    // GATE-2 KHÔNG đổi một con số nào của badge ở v1.
    expect(sqlText).toContain('coalesce("chat_room_members"."visible_from_seq", 0) - 1');
  });
});

// ─── census: không đường đọc nào được sinh ra mà thiếu vị từ ───────────────────

/** Bỏ comment TRƯỚC khi grep — `guard-immutability-matches-comments`: comment nhắc tên hàm là PASS oan. */
function codeOf(file: string): string {
  return readFileSync(join(__dirname, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/** Tách thân từng method của một class (đủ dùng cho grep — không cần parser thật). */
function methodsOf(src: string): ReadonlyArray<{ name: string; block: string }> {
  return src
    .split(/\n {2}(?:private )?(?:async )?(?=\w+\()/)
    .slice(1)
    .map((block) => ({ name: block.slice(0, block.indexOf("(")), block }));
}

/**
 * Hai đường đọc CỐ Ý đứng ngoài — lý do đầy đủ ở `chat-visibility.ts`. Danh sách này là NƠI DUY NHẤT
 * miễn trừ: thêm tên vào đây là một quyết định phải giải trình, còn quên vị từ thì suite ĐỎ.
 */
const DOCUMENTED_EXCEPTIONS = new Set(["countPinned", "findByClientMessageId"]);

describe("census — MỌI truy vấn đọc `chat_messages` mang vị từ §13.4", () => {
  it("chat-messages.repository.ts: mỗi hàm SELECT trên chat_messages đều GỌI `visibleFromSeqScalar()`", () => {
    // ⚠️ Soi LỜI GỌI, không soi tham số. Bản đầu của ca này kiểm `includes("visibleFromSeq")` và đã
    // PASS OAN khi thử gỡ vị từ khỏi `listPinned`: tham số vẫn còn trong chữ ký, chỉ thân hàm không
    // dùng nữa. Đúng lớp "test đóng đinh lỗ hổng" (`tests-can-pin-a-hole-open`) — đã đo, không phải lo xa.
    const offenders = methodsOf(codeOf("chat-messages.repository.ts"))
      .filter((m) => m.block.includes(".from(chatMessages)"))
      .filter((m) => !DOCUMENTED_EXCEPTIONS.has(m.name))
      .filter((m) => !m.block.includes("visibleFromSeqScalar("))
      .map((m) => m.name);
    expect(offenders, `đường đọc thiếu vị từ SPEC-15 §13.4: ${offenders.join(", ")}`).toEqual([]);
  });

  it("chat-attachments.repository.ts: mỗi hàm SELECT trên chat_messages đều GỌI `visibleFromSeqScalar()`", () => {
    // S7-CHAT-BE-3 mở đường đọc `chat_messages` ở một file THỨ HAI (tab "Tệp" — CHAT-API-017). Census
    // chỉ soi `chat-messages.repository.ts` sẽ bỏ lọt nó hoàn toàn: đúng lớp "đường đọc mới sinh ra ở
    // chỗ khác" mà GATE-2 đã bắt trên `/pinned`, chỉ đổi file. `listAttachmentsForMessages` KHÔNG có
    // trong danh sách vì nó đọc `file_links`, không đọc `chat_messages`.
    const offenders = methodsOf(codeOf("chat-attachments.repository.ts"))
      .filter((m) => m.block.includes(".from(chatMessages)"))
      .filter((m) => !DOCUMENTED_EXCEPTIONS.has(m.name))
      .filter((m) => !m.block.includes("visibleFromSeqScalar("))
      .map((m) => m.name);
    expect(offenders, `đường đọc thiếu vị từ SPEC-15 §13.4: ${offenders.join(", ")}`).toEqual([]);
  });

  it("chat-access.service.ts: `assertMessageAccess` gọi `visibleFromSeqColumn()`", () => {
    const code = codeOf("chat-access.service.ts");
    const method = methodsOf(code).find((m) => m.name === "assertMessageAccess");
    expect(method).toBeDefined();
    expect(method?.block).toContain("visibleFromSeqColumn()");
  });

  it("hai truy vấn unread dùng CHUNG `unreadSeqExpr()`, không chép tay công thức", () => {
    const messagesRepo = codeOf("chat-messages.repository.ts");
    const roomsRepo = codeOf("chat-rooms.repository.ts");
    expect(messagesRepo).toContain("unreadSeqExpr()");
    expect(roomsRepo).toContain("unreadSeqExpr()");
    // Không còn bản chép tay nào của phép trừ (dấu vân tay: `- ${chatRoomMembers.lastReadSeq}`).
    for (const src of [messagesRepo, roomsRepo]) {
      expect(src).not.toContain("- ${chatRoomMembers.lastReadSeq}");
    }
  });

  it("vị từ chỉ có MỘT nguồn: không file chat nào tự viết `visible_from_seq` trong SQL thô", () => {
    const offenders = [
      "chat-messages.repository.ts",
      "chat-rooms.repository.ts",
      "chat-attachments.repository.ts",
    ].filter((f) => codeOf(f).includes("visible_from_seq"));
    expect(offenders, `bản sao thứ hai của luật §13.4 ở: ${offenders.join(", ")}`).toEqual([]);
  });
});
