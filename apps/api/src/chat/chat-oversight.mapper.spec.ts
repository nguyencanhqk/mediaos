/**
 * S7-CHAT-CLEAN-2 — `toOversightAuditEntryDto` phải nói ĐÚNG LOẠI SỰ KIỆN (CHAT-SCREEN-008).
 *
 * ┌─ VÌ SAO CA NÀY TỒN TẠI ───────────────────────────────────────────────────────────────────────────┐
 * │ `audit_logs.result_status` là enum BỐN giá trị (`audit.service.ts:61` —                            │
 * │ `Success · Failure · Denied · Error`), nhưng bản đầu của mapper gộp bằng một biểu thức ba ngôi:     │
 * │     resultStatus === 'Success' ? 'Success' : 'Denied'                                              │
 * │ ⇒ một dòng `Failure` (thu hồi tin HỎNG — `chat.errors.ts:206`) hoặc `Error` (lỗi hạ tầng) hiện lên  │
 * │ nhật ký như **"đã bị TỪ CHỐI"**. Không có gì đỏ: HTTP 200, schema hợp lệ, dòng vẫn có mặt — audit   │
 * │ chỉ nói SAI chuyện gì đã xảy ra, và audit nói sai thì tệ hơn audit thiếu.                            │
 * │                                                                                                     │
 * │ Hôm nay CHAT-API-019 lọc `action = OVERSIGHT_READ` nên chỉ hai writer (guard `Denied` · service     │
 * │ `Success`) đẻ ra dòng ⇒ chưa ai thấy lỗi. Đó chính là lý do phải khoá bằng test: cái bẫy chỉ bung   │
 * │ khi WO sau thêm writer thứ ba trên cùng `action`, và lúc đó không ai nhớ dòng ba-ngôi này.          │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ Bất biến GIỮ NGUYÊN từ bản đầu: giá trị LẠ/NULL **KHÔNG BAO GIỜ** được hiện thành `Success`. Bản đầu
 * đạt điều đó bằng cách quy hết về `Denied` (nói sai loại); bản này đạt bằng nhãn riêng `Unknown` (không
 * khẳng định gì). Ca "NULL không ra Success" ở dưới là ca canh chính bất biến đó.
 */
import { describe, expect, it } from "vitest";
import { toOversightAuditEntryDto } from "./chat-oversight.mapper";
import type { ChatOversightAuditRow } from "./chat-oversight.repository";

const AT = new Date("2026-08-04T03:00:00.000Z");

function row(overrides: Partial<ChatOversightAuditRow> = {}): ChatOversightAuditRow {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    actorUserId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    actorName: "Người tra",
    roomId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
    roomCode: "ROOM-0001",
    roomName: "Phòng A",
    resultStatus: "Success",
    metadata: { endpoint: "018b", criteria: { q: "abc" } },
    createdAt: AT,
    sortAt: AT,
    ...overrides,
  };
}

describe("toOversightAuditEntryDto — result_status (S7-CHAT-CLEAN-2)", () => {
  it.each(["Success", "Failure", "Denied", "Error"])(
    "giữ NGUYÊN `%s` — đủ 4 giá trị của AUDIT_RESULT_STATUSES",
    (status) => {
      expect(toOversightAuditEntryDto(row({ resultStatus: status })).resultStatus).toBe(status);
    },
  );

  it.each([
    ["NULL", null],
    ["chuỗi rỗng", ""],
    ["giá trị lạ", "Pending"],
    ["sai kiểu hoa/thường", "success"],
  ])("%s ⇒ nhãn riêng `Unknown`, KHÔNG mượn nhãn `Denied`", (_label, status) => {
    // Quy về `Denied` là khẳng định "đã có một lần bị chặn" — một sự kiện KHÔNG hề xảy ra. `Unknown` nói
    // đúng thứ ta biết: dòng này hỏng, đừng đếm nó vào thống kê từ chối.
    expect(toOversightAuditEntryDto(row({ resultStatus: status })).resultStatus).toBe("Unknown");
  });

  it("BẤT BIẾN: giá trị lạ KHÔNG BAO GIỜ hiện thành `Success`", () => {
    for (const bad of [null, "", "Pending", "success", "SUCCESS", "Succeeded"]) {
      expect(toOversightAuditEntryDto(row({ resultStatus: bad })).resultStatus).not.toBe("Success");
    }
  });

  it("chỉ phơi `endpoint` + `criteria` của metadata (hợp đồng đóng, không trả nguyên jsonb)", () => {
    const dto = toOversightAuditEntryDto(
      row({ metadata: { endpoint: "018c", criteria: { q: "x" }, secretLeak: "KHÔNG được ra" } }),
    );
    expect(dto.endpoint).toBe("018c");
    expect(dto.criteria).toEqual({ q: "x" });
    expect(Object.keys(dto)).not.toContain("secretLeak");
  });

  it("metadata rác (không phải object) ⇒ endpoint/criteria null, không ném", () => {
    const dto = toOversightAuditEntryDto(row({ metadata: "not-an-object" }));
    expect(dto.endpoint).toBeNull();
    expect(dto.criteria).toBeNull();
  });
});
