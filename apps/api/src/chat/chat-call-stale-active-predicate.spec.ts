import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { noLiveParticipantSql, staleActiveWhereSql } from "./chat-calls.repository";

/**
 * S10-CHAT-CALLSWEEP-1 (KI-063) — ghim **TƯƠNG QUAN** của vị từ "cuộc gọi không còn ai ở trong".
 *
 * ┌─ VÌ SAO CA NÀY TỒN TẠI, VÀ VÌ SAO NÓ ĐỌC CHUỖI SQL CHỨ KHÔNG ĐỌC HÀNH VI ───────────────────────┐
 * │ Drizzle render cột trong `sql``` **KHÔNG kèm tên bảng**. Nếu subquery tương quan được dựng bằng  │
 * │ `${chatCalls.id}` thì nó ra một `id` trần, và bên trong `SELECT ... FROM chat_call_participants`  │
 * │ cái `id` đó resolve về **bảng bên trong** ⇒ tương quan ĐỨT ⇒ `NOT EXISTS` luôn đúng ⇒ job gặt     │
 * │ **MỌI cuộc gọi `active`, kể cả cuộc đang nói chuyện**.                                            │
 * │                                                                                                   │
 * │ Hỏng đó **trông y hệt thành công**: job chạy, không lỗi, phòng mở khoá, ca "R1 mở khoá được       │
 * │ phòng" vẫn XANH. Thứ duy nhất sai là những cuộc gọi KHÔNG đáng bị gặt cũng chết — và ca âm (R2)   │
 * │ bắt được điều đó chỉ khi nó chạy trên DB thật, tức chỉ khi có `LANE_DB`. Ca NÀY sống ở glob       │
 * │ colocated `src/**` nên **LUÔN chạy** (memory `src-green-is-not-integration-green`), và nó đo đúng │
 * │ thứ dễ hỏng nhất bằng cách rẻ nhất: đọc chuỗi SQL sinh ra.                                        │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ Ca này KHÔNG thay ca hành vi. Nó chứng minh "tương quan còn nguyên", không chứng minh "vị từ đúng
 * nghiệp vụ" — việc đó là của R1/R2/R3/R4 trên lane DB.
 */
describe("noLiveParticipantSql — tương quan với bảng NGOÀI", () => {
  const rendered = (): string => new PgDialect().sqlToQuery(noLiveParticipantSql()).sql;

  it("tham chiếu CHÉO phải mang tên bảng ngoài đầy đủ (`chat_calls.id`), không phải cột trần", () => {
    const text = rendered().replace(/\s+/g, " ");

    expect(text).toContain("chat_call_participants.call_id = chat_calls.id");
    expect(text).toContain("chat_call_participants.company_id = chat_calls.company_id");
  });

  it("vế 'chưa ngã ngũ' lấy từ bản sao DUY NHẤT — cả hai giá trị KHÔNG-hấp-thụ đều có mặt", () => {
    const text = rendered().replace(/\s+/g, " ");

    // `outcome IS NULL` (đang đổ chuông) HOẶC `'accepted'` (đang nói chuyện). Bốn kết cục còn lại là
    // HẤP THỤ và KHÔNG được xuất hiện ở đây — có mặt nghĩa là ai đó đã viết bản sao thứ hai của vị từ.
    expect(text).toContain("is null");
    expect(text).toMatch(/"?outcome"?\s*=\s*\$\d+/);
    for (const absorbed of ["rejected", "cancelled", "missed", "left"]) {
      expect(text).not.toContain(absorbed);
    }
  });

  it("là NOT EXISTS trên đúng bảng participants (không phải bảng khác bị đổi nhầm)", () => {
    const text = rendered().replace(/\s+/g, " ").toLowerCase();

    expect(text).toContain("not exists");
    expect(text).toContain("from chat_call_participants");
  });
});

/**
 * S10-CHAT-CALLSWEEP-1 — vế THỨ HAI của cùng một lỗ hổng quan sát: **chiều so sánh `cutoff`**.
 *
 * ┌─ VÌ SAO PHẢI GHIM Ở ĐÂY, KHÔNG PHẢI CHỈ Ở INT-SPEC ─────────────────────────────────────────────┐
 * │ `lt(startedAt, cutoff)` = "cuộc gọi bắt đầu TRƯỚC mốc cắt", tức đã đủ già. Đảo thành `gt` cho một │
 * │ vị từ **không bao giờ khớp hàng nào**: job vẫn chạy, không ném lỗi, run-row `Success`,            │
 * │ `callsAutoEnded: 0` — **trông y hệt một hệ thống khoẻ mạnh không có cuộc gọi ma**. Thứ duy nhất   │
 * │ bắt được là ca DƯƠNG (R1/R3) của int-spec, mà int-spec `skipIf(!LANE_DB)` NGỦ trên mọi máy không  │
 * │ có Postgres (memory `src-green-is-not-integration-green`) ⇒ trên máy dev và trên mọi vòng chạy    │
 * │ không lane-db, bản vá KI-063 có thể chết mà bảng điểm vẫn xanh.                                   │
 * │                                                                                                   │
 * │ Ca này sống ở glob colocated `src/**` nên **LUÔN chạy**, và nó đo bằng cách rẻ nhất: render chuỗi │
 * │ SQL của ĐÚNG hàm dựng vị từ.                                                                      │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 */
describe("staleActiveWhereSql — chiều cắt thời gian + hình dạng theo nhánh", () => {
  const COMPANY_ID = "00000000-0000-4000-8000-00000000c0de";
  const ROOM_ID = "00000000-0000-4000-8000-00000000f00d";
  const CUTOFF = new Date("2026-08-21T00:00:00.000Z");

  const render = (reason: "orphan" | "max_duration", roomId?: string) => {
    const where = staleActiveWhereSql(COMPANY_ID, CUTOFF, reason, roomId);
    // KHÔNG dùng `!`: vị từ rỗng LÀ một hỏng hóc thật (`.where(undefined)` = gặt sạch bảng), nên nó phải
    // đỏ ở đây chứ không được lặng lẽ đi qua một non-null assertion.
    if (!where) throw new Error("staleActiveWhereSql trả undefined — vị từ RỖNG, sẽ khớp MỌI hàng");
    const q = new PgDialect().sqlToQuery(where);
    return { text: q.sql.replace(/\s+/g, " "), params: q.params };
  };

  it.each(["orphan", "max_duration"] as const)(
    "nhánh %s: `started_at < cutoff` — đảo chiều là job im lặng KHÔNG BAO GIỜ gặt (0 hàng ≡ khoẻ mạnh)",
    (reason) => {
      const { text } = render(reason);

      expect(text).toMatch(/"chat_calls"\."started_at"\s*<\s*\$\d+/);
      expect(text).not.toMatch(/"chat_calls"\."started_at"\s*>/);
      // `<=` cũng là một đột biến hợp lệ về cú pháp nhưng sai nghiệp vụ ở biên (R4 của int-spec).
      expect(text).not.toMatch(/"chat_calls"\."started_at"\s*<=/);
    },
  );

  it("khoá đúng `status='active'` và đúng tenant — hai vế bị 'dọn cho gọn' là mở rộng phạm vi gặt", () => {
    const { text, params } = render("orphan");

    expect(text).toMatch(/"chat_calls"\."company_id"\s*=\s*\$\d+/);
    expect(text).toMatch(/"chat_calls"\."status"\s*=\s*\$\d+/);
    // Giá trị đi qua tham số, không nằm trong chuỗi SQL ⇒ phải đọc `params` mới thấy `'active'`. Nới sang
    // `'ringing'` sẽ giẫm lên job ring-timeout (hai job cùng gặt một hàng, hai lý do audit mâu thuẫn).
    expect(params).toContain("active");
    expect(params).toContain(COMPANY_ID);
  });

  it("CHỈ nhánh `orphan` mang NOT EXISTS — `max_duration` là trần thọ TUYỆT ĐỐI, không kèm điều kiện", () => {
    expect(render("orphan").text.toLowerCase()).toContain("not exists");
    // Nhánh (D) cố ý gặt cả cuộc gọi CÒN người treo — đó chính là lưới an toàn cho nhánh `!ok` của
    // `closeCallParticipationOnRoomExit`. Thêm NOT EXISTS vào đây làm lỗ chỉ ĐỔI HÌNH DẠNG.
    expect(render("max_duration").text.toLowerCase()).not.toContain("not exists");
  });

  it("`roomId` là vế THU HẸP tuỳ chọn — vắng thì không được đẻ ra vế `room_id` nào", () => {
    expect(render("orphan", ROOM_ID).text).toMatch(/"chat_calls"\."room_id"\s*=\s*\$\d+/);
    expect(render("orphan").text).not.toContain("room_id");
  });
});
