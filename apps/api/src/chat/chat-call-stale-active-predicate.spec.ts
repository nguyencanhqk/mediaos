import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { noLiveParticipantSql } from "./chat-calls.repository";

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
