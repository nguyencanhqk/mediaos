import { describe, expect, it, vi } from "vitest";
import { ChatCallRoomExitService } from "./chat-call-room-exit.service";
import { CHAT_AUDIT } from "./chat.errors";

/**
 * S7-CALL-RT-FIX-2 — detector TẤT ĐỊNH cho `ChatCallRoomExitService`.
 *
 * ┌─ VÌ SAO UNIT SPEC CHỨ KHÔNG PHẢI CA ĐUA Ở INT-SPEC ─────────────────────────────────────────────┐
 * │ Nhánh `if (!ok) continue` chỉ chạy khi hàng participant CÒN MỞ lúc `SELECT` nhưng ĐÃ ĐÓNG lúc    │
 * │ `UPDATE`, mà cuộc gọi VẪN sống. Trạng thái đó **không tới được bằng kịch bản tuần tự**:          │
 * │ `hangup`/`reject`/`cancel`/`expireStaleRinging` đều đóng hàng participant VÀ chuyển              │
 * │ `chat_calls.status` sang trạng thái kết thúc trong CÙNG tx. Mà `findOpenParticipantCallsInRoom`  │
 * │ lọc `status IN ('ringing','active')` ⇒ chạy "hangup rồi gỡ" thì nó trả 0 hàng và                 │
 * │ `setParticipantOutcome` không hề được gọi ⇒ ca XANH **kể cả khi nhánh `continue` bị gỡ bỏ**.     │
 * │ Trạng thái thật chỉ tới được bằng giao thoa hai transaction commit đúng khe giữa hai câu lệnh —  │
 * │ không có seam nào để ghim, và một ca bắn song song sẽ là ca XÁC SUẤT.                            │
 * │ ⇒ Stub hai phép của repo là cách DUY NHẤT đo được nhánh đó một cách tất định.                    │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Ca "kết cục theo TỪNG HÀNG" cũng nằm ở đây vì đó là chỗ ghi dữ liệu SAI VĨNH VIỄN nếu sai (kết cục
 * hấp thụ + bảng không có DELETE) — nó được đo lại lần nữa trên DB thật ở int-spec.
 */

const COMPANY = "c0000000-0000-0000-0000-00000000000a";
const ROOM = "11111111-1111-4111-8111-111111111111";
/** Người BỊ đóng phần tham gia. */
const VICTIM = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
/** Người BẤM gỡ — khác `VICTIM` ở cửa `removeMember`, và dòng audit phải phân biệt được hai vai. */
const ACTOR = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const CALL = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const NOW = new Date("2026-08-13T03:00:00.000Z");

/** Cuộc gọi ĐÃ TỪNG nối máy — vế thứ hai của vị từ kép (`chat_calls.accepted_at`). */
const ACCEPTED_AT = new Date("2026-08-13T02:58:00.000Z");
const JOINED_AT = new Date("2026-08-13T02:59:00.000Z");

function build(opts: {
  open?: { callId: string; joinedAt: Date | null; acceptedAt: Date | null }[];
  outcomeWritten?: boolean;
}) {
  const calls = {
    findOpenParticipantCallsInRoom: vi.fn(async () => opts.open ?? []),
    setParticipantOutcome: vi.fn(async () => opts.outcomeWritten ?? true),
  };
  const audit = { record: vi.fn() };
  const svc = new ChatCallRoomExitService(calls as never, audit as never);
  const run = () =>
    svc.closeCallParticipationOnRoomExit({} as never, COMPANY, ROOM, VICTIM, ACTOR, NOW);
  return { svc, calls, audit, run };
}

describe("closeCallParticipationOnRoomExit — kết cục theo TỪNG HÀNG", () => {
  it("người ĐÃ vào cuộc gọi (`joined_at` có) ⇒ `left` + `left_at` được đặt", async () => {
    const t = build({ open: [{ callId: CALL, joinedAt: JOINED_AT, acceptedAt: ACCEPTED_AT }] });
    await t.run();

    expect(t.calls.setParticipantOutcome).toHaveBeenCalledTimes(1);
    const args = t.calls.setParticipantOutcome.mock.calls[0] as unknown[];
    expect(args[4]).toBe("left");
    expect(args[5]).toEqual({ leftAt: NOW });
  });

  /**
   * 🔴 Ca QUAN TRỌNG NHẤT của file. `'left'` nghĩa là "đã VÀO rồi rời" — gán nó cho người chưa bấm nhận
   * là đóng dấu "đã nghe máy rồi cúp" lên một người CHƯA BAO GIỜ nhấc máy, và kết cục là HẤP THỤ nên
   * KHÔNG SỬA LẠI ĐƯỢC (bảng không có DELETE). Ghi cứng `'left'` cho mọi hàng làm ca này ĐỎ.
   */
  it("người ĐANG ĐỔ CHUÔNG (`joined_at IS NULL`) ⇒ `missed`, và `left_at` KHÔNG được đặt", async () => {
    const t = build({ open: [{ callId: CALL, joinedAt: null, acceptedAt: null }] });
    await t.run();

    const args = t.calls.setParticipantOutcome.mock.calls[0] as unknown[];
    expect(args[4]).toBe("missed");
    // `{}` chứ không phải `{ leftAt: … }`: một hàng "cuộc gọi nhỡ" có mốc rời là sự không nhất quán
    // đối xứng với "hàng `left` mà `left_at IS NULL`" mà repo đã cấm.
    expect(args[5]).toEqual({});
  });

  /**
   * 🔴 **Detector của HIGH-1 (FULL gate `security-reviewer`, 13/08).**
   *
   * `insertParticipants` đặt `joined_at = now` cho **NGƯỜI KHỞI TẠO ngay lúc MỜI** — họ "tự vào cuộc gọi
   * của chính mình" trước khi ai kịp nhấc máy. Nên trên một cuộc gọi còn `ringing` LUÔN có sẵn một hàng
   * `joined_at` khác NULL.
   *
   * Ca tới được, không cần quyền gì: A mời → `ringing` → A bấm `POST /rooms/:id/leave` (tự phục vụ).
   * Với vị từ MỘT VẾ (`joinedAt !== null`), hàng A bị ghi `'left'` + `left_at` — đóng dấu "đã nghe máy
   * rồi cúp" lên người **chưa hề nói chuyện với ai**, và kết cục là HẤP THỤ nên SAI VĨNH VIỄN.
   *
   * Bỏ vế `row.acceptedAt !== null` làm ca này ĐỎ. Đây là **đột biến `j`** của bảng §5.4.
   */
  it("NGƯỜI KHỞI TẠO trên cuộc gọi còn `ringing` (`joined_at` có, `accepted_at` NULL) ⇒ `missed`", async () => {
    const t = build({ open: [{ callId: CALL, joinedAt: JOINED_AT, acceptedAt: null }] });
    await t.run();

    const args = t.calls.setParticipantOutcome.mock.calls[0] as unknown[];
    expect(args[4], "chưa ai nhấc máy thì KHÔNG có ai 'đã vào rồi rời'").toBe("missed");
    expect(args[5], "…và không có mốc rời").toEqual({});
  });

  it("hai cuộc gọi, hai kết cục KHÁC nhau — không có một hằng nào cho cả lô", async () => {
    const CALL_2 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const t = build({
      open: [
        { callId: CALL, joinedAt: JOINED_AT, acceptedAt: ACCEPTED_AT },
        { callId: CALL_2, joinedAt: null, acceptedAt: null },
      ],
    });
    const closed = await t.run();

    expect(t.calls.setParticipantOutcome.mock.calls.map((c) => (c as unknown[])[4])).toEqual([
      "left",
      "missed",
    ]);
    expect(closed).toEqual([{ callId: CALL }, { callId: CALL_2 }]);
  });
});

describe("closeCallParticipationOnRoomExit — hàng đã bị đóng bởi tx khác (đua)", () => {
  /**
   * Detector của đột biến "bỏ vế `if (!ok) continue`". `setParticipantOutcome` trả `false` = khớp 0 hàng
   * (nạn nhân tự `hangup` đúng khe giữa `SELECT` và `UPDATE`). Không có gì xảy ra ⇒ không được ghi audit
   * (nói dối về một hành động không diễn ra) và không được phát `peer-left` (nói dối về nguyên nhân).
   */
  it("`setParticipantOutcome` trả FALSE ⇒ 0 hàng audit VÀ mảng trả về RỖNG", async () => {
    const t = build({
      open: [{ callId: CALL, joinedAt: null, acceptedAt: null }],
      outcomeWritten: false,
    });
    const closed = await t.run();

    expect(t.audit.record).not.toHaveBeenCalled();
    expect(closed).toEqual([]);
  });

  it("một hàng THÀNH CÔNG + một hàng THUA ĐUA ⇒ chỉ hàng thành công vào audit và vào kết quả", async () => {
    const CALL_2 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const calls = {
      findOpenParticipantCallsInRoom: vi.fn(async () => [
        { callId: CALL, joinedAt: null, acceptedAt: null },
        { callId: CALL_2, joinedAt: null, acceptedAt: null },
      ]),
      // Hàng đầu thua đua, hàng sau ghi được.
      setParticipantOutcome: vi
        .fn<() => Promise<boolean>>()
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true),
    };
    const audit = { record: vi.fn() };
    const svc = new ChatCallRoomExitService(calls as never, audit as never);

    const closed = await svc.closeCallParticipationOnRoomExit(
      {} as never,
      COMPANY,
      ROOM,
      VICTIM,
      ACTOR,
      NOW,
    );

    expect(closed).toEqual([{ callId: CALL_2 }]);
    expect(audit.record).toHaveBeenCalledTimes(1);
  });
});

describe("closeCallParticipationOnRoomExit — không có cuộc gọi nào", () => {
  it("0 hàng mở ⇒ KHÔNG ghi `chat_call_participants`, KHÔNG audit, trả rỗng", async () => {
    const t = build({ open: [] });
    const closed = await t.run();

    expect(t.calls.setParticipantOutcome).not.toHaveBeenCalled();
    expect(t.audit.record).not.toHaveBeenCalled();
    expect(closed).toEqual([]);
  });
});

describe("closeCallParticipationOnRoomExit — hàng audit", () => {
  it("nói rõ AI làm (`actorUserId`) và LÀM LÊN AI (`newValues.userId`) — hai vai khác nhau", async () => {
    const t = build({ open: [{ callId: CALL, joinedAt: null, acceptedAt: null }] });
    await t.run();

    expect(t.audit.record).toHaveBeenCalledTimes(1);
    const entry = (t.audit.record.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
    expect(entry.action).toBe(CHAT_AUDIT.CALL_PARTICIPANT_CLOSED);
    expect(entry.objectType).toBe("chat_call");
    expect(entry.objectId).toBe(CALL);
    // Người BẤM gỡ — KHÔNG phải nạn nhân. Ghi nhầm ở đây làm sổ audit trả lời sai câu "ai đã làm".
    expect(entry.actorUserId).toBe(ACTOR);
    expect(entry.actorType).toBe("User");
    expect(entry.moduleCode).toBe("CHAT");
    expect(entry.resultStatus).toBe("Success");
    expect(entry.newValues).toEqual({
      userId: VICTIM,
      roomId: ROOM,
      outcome: "missed",
      reason: "room_exit",
    });
  });
});
