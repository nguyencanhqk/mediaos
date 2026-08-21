import { Logger } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatCallsService } from "./chat-calls.service";
import { CHAT_AUDIT } from "./chat.errors";
import type { ChatAccessService } from "./chat-access.service";
import type { ChatCallCooldownService } from "./chat-call-cooldown.service";
import type { ChatCallsRepository } from "./chat-calls.repository";
import type { AuditService } from "../events/audit.service";
import type { DatabaseService } from "../db/db.service";
import type { RealtimeEmitterService } from "../realtime/realtime-emitter.service";

/**
 * S10-CHAT-CALLSWEEP-1 (KI-063) — detector TẤT ĐỊNH cho nhánh `!ok` của `expireStaleActiveTx`.
 *
 * ┌─ VÌ SAO UNIT SPEC, VÀ VÌ SAO NÓ ĐO CÁI LOGGER ──────────────────────────────────────────────────┐
 * │ `setParticipantOutcome` trả `false` = `UPDATE` khớp 0 hàng, tức hàng participant CÒN mở lúc      │
 * │ `listParticipants` nhưng ĐÃ hấp thụ lúc ghi. Trạng thái đó chỉ tới được bằng giao thoa HAI       │
 * │ transaction commit đúng khe giữa hai câu lệnh — không có seam nào để ghim trên DB thật, và một   │
 * │ ca bắn song song sẽ là ca XÁC SUẤT (cùng lý lẽ đã viết ở `chat-call-room-exit.service.spec.ts`). │
 * │                                                                                                   │
 * │ Bản thân giá trị `false` KHÔNG phải lỗ dữ liệu: `WHERE` của `setParticipantOutcome` khoá đường   │
 * │ ghi đè ở tầng SQL ⇒ không ghi kép, không ghi đè. Thứ bị mất là **quan sát được**: nếu giả định   │
 * │ "hiếm" sai thì ở mức không thu ở production sẽ KHÔNG AI BIẾT. Nên ca này đo đúng thứ bản vá tạo  │
 * │ ra — MỘT dòng `warn` — chứ không giả vờ đo một hậu quả dữ liệu không tồn tại.                     │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ Ca ÂM ("mọi hàng ghi được ⇒ KHÔNG warn") bắt buộc phải có: một mình ca dương thì đột biến
 * "warn VÔ ĐIỀU KIỆN" vẫn xanh, và cảnh báo kêu mọi nhịp scheduler là cảnh báo bị tắt trong một tuần
 * (memory `deny-cases-vacuous-without-allow-case`).
 */

const CO = "11111111-1111-4111-8111-111111111111";
const CALL = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ROOM = "44444444-4444-4444-8444-444444444444";
/** Người ĐANG nói chuyện (`accepted` + `joined_at`) — hàng thua đua trong ca dương. */
const TALKER = "22222222-2222-4222-8222-222222222222";
/** Người được mời mà chưa bấm gì (`outcome IS NULL`, chưa `joined`) ⇒ kết cục `missed`. */
const INVITEE = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-08-21T10:00:00.000Z");
const STARTED_AT = new Date("2026-08-21T09:00:00.000Z");

const EXPIRED_ROW = {
  id: CALL,
  roomId: ROOM,
  kind: "audio" as const,
  initiatorUserId: TALKER,
  startedAt: STARTED_AT,
};

const PARTICIPANTS = [
  { userId: TALKER, invitedAt: STARTED_AT, joinedAt: STARTED_AT, leftAt: null, outcome: "accepted" },
  { userId: INVITEE, invitedAt: STARTED_AT, joinedAt: null, leftAt: null, outcome: null },
];

/**
 * `expireStaleActive` được gọi HAI lần (một cho `max_duration`, một cho `orphan`). Trả hàng chỉ ở nhánh
 * `orphan` để cuộc gọi không bị xử lý hai lượt — đúng như DB thật cư xử (hàng đã `ended` không còn khớp).
 */
function build(outcomeResults: boolean[]) {
  const setParticipantOutcome = vi.fn<() => Promise<boolean>>();
  for (const r of outcomeResults) setParticipantOutcome.mockResolvedValueOnce(r);

  const repo = {
    expireStaleActive: vi.fn(
      async (
        _tx: unknown,
        _companyId: string,
        _cutoff: Date,
        _now: Date,
        reason: "orphan" | "max_duration",
      ) => (reason === "orphan" ? [EXPIRED_ROW] : []),
    ),
    listParticipants: vi.fn(async () => PARTICIPANTS),
    setParticipantOutcome,
  };
  const audit = { record: vi.fn() };

  const svc = new ChatCallsService(
    {} as unknown as DatabaseService,
    repo as unknown as ChatCallsRepository,
    {} as unknown as ChatAccessService,
    audit as unknown as AuditService,
    {} as unknown as ChatCallCooldownService,
    {} as unknown as RealtimeEmitterService,
  );

  const warn = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
  const run = () => svc.expireStaleActiveTx({} as never, CO, NOW);
  return { repo, audit, warn, run };
}

describe("expireStaleActiveTx — hàng participant thua đua (`setParticipantOutcome` trả FALSE)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("ghi MỘT dòng `warn` mang đủ callId·userId·reason để lần lại được", async () => {
    // Hàng đầu (`TALKER`) thua đua, hàng sau ghi được.
    const t = build([false, true]);
    await t.run();

    expect(t.warn).toHaveBeenCalledTimes(1);
    // ⚠️ Đọc `mock.calls` TRƯỚC bất kỳ `restore` nào (memory `mockrestore-wipes-mock-calls`).
    const msg = String((t.warn.mock.calls[0] as unknown[])[0]);
    expect(msg).toContain(CALL);
    expect(msg).toContain(TALKER);
    expect(msg).toContain("orphan");
  });

  it("KHÔNG chặn phần còn lại: người thứ hai vẫn được ghi kết cục", async () => {
    const t = build([false, true]);
    await t.run();

    expect(t.repo.setParticipantOutcome).toHaveBeenCalledTimes(2);
    const second = t.repo.setParticipantOutcome.mock.calls[1] as unknown[];
    expect(second[3]).toBe(INVITEE);
    // Người chưa `joined` ⇒ `missed`, và KHÔNG kèm `left_at` ("cuộc gọi nhỡ" có mốc rời là tự mâu thuẫn).
    expect(second[4]).toBe("missed");
    expect(second[5]).toEqual({});
  });

  it("cuộc gọi VẪN được audit `ended` và người thua đua VẪN nằm trong danh sách báo WS", async () => {
    // Khác `closeCallParticipationOnRoomExit` — ở đó `closed` lái `peer-left` nên hàng thua đua bị loại.
    // Ở đây hàng `chat_calls` ĐÃ chuyển `ended` THẬT, nên `call:auto-ended` là sự thật cho MỌI người
    // trong cuộc gọi; giấu nó đi = máy họ giữ khung gọi của một cuộc gọi đã chết.
    const t = build([false, true]);
    const expiries = await t.run();

    expect(t.audit.record).toHaveBeenCalledTimes(1);
    const entry = (t.audit.record.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
    expect(entry.action).toBe(CHAT_AUDIT.CALL_AUTO_ENDED);
    expect(entry.actorType).toBe("Job");
    expect(entry.newValues).toEqual({ status: "ended", reason: "orphan", thresholdMs: 120_000 });

    expect(expiries).toHaveLength(1);
    expect(expiries[0].participantUserIds).toEqual([TALKER, INVITEE]);
  });

  it("CA ÂM — mọi hàng ghi được ⇒ KHÔNG `warn` nào (cảnh báo kêu mỗi nhịp là cảnh báo bị tắt)", async () => {
    const t = build([true, true]);
    await t.run();

    expect(t.repo.setParticipantOutcome).toHaveBeenCalledTimes(2);
    expect(t.warn).not.toHaveBeenCalled();
  });
});
