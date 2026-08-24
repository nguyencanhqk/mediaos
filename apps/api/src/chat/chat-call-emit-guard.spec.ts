import { Logger } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatCallsService, CHAT_CALL_RING_TIMEOUT_MS } from "./chat-calls.service";
import type { ChatCallExpiry } from "./chat-calls.service";
import {
  ChatCallRingingTimeoutJobHandler,
  CHAT_CALL_RINGING_TIMEOUT_JOB_CODE,
} from "./chat-call-ringing-timeout.job-handler";
import {
  ChatCallStaleActiveSweepJobHandler,
  CHAT_CALL_STALE_ACTIVE_SWEEP_JOB_CODE,
} from "./chat-call-stale-active-sweep.job-handler";
import type { ChatAccessService } from "./chat-access.service";
import type { ChatCallCooldownService } from "./chat-call-cooldown.service";
import type { ChatCallsRepository } from "./chat-calls.repository";
import type { AuditService } from "../events/audit.service";
import type { DatabaseService } from "../db/db.service";
import type { JobHandler, JobRunResult } from "../scheduler/job-handler";
import type { RealtimeEmitterService } from "../realtime/realtime-emitter.service";

/**
 * S10-CHAT-EMITGUARD-1 (KI-075) — HAI job CHAT gọi đường phát realtime **SAU COMMIT**. Bất biến
 * "`emitChatCall` không ném" sống ở module **KHÁC** (`realtime/`, ghim ở `realtime-emitter.call.spec.ts`);
 * file này ghim **vế bên này của hợp đồng**: nếu bất biến đó vỡ, hai job phải chịu đựng được.
 *
 * ┌─ HAI ĐIỀU KIỆN, KHÔNG PHẢI MỘT ─────────────────────────────────────────────────────────────────┐
 * │ (1) **Lô còn lại không được mất.** Emit nằm trong VÒNG LẶP của `emitExpired`/`emitAutoEnded`;    │
 * │     một `try/catch` bọc cả lời gọi helper ở phía job sẽ cứu được run-row nhưng bỏ rơi N-1 cuộc  │
 * │     gọi sau item hỏng. Guard phải là PER-ITEM.                                                   │
 * │ (2) **Run-row không được nói dối theo chiều nào.** Nuốt thành `success` trọn vẹn ⇒ mất chuông    │
 * │     trở thành im lặng tuyệt đối (try/catch đã che mất trạng thái `'Failed'` — tín hiệu duy nhất  │
 * │     còn lại là `failed`/`metadata.emitFailed`). Để nó reject ⇒ run-row `'Failed'` cho một tx ĐÃ  │
 * │     commit, và vì cả hai job idempotent, nhịp kế khớp 0 hàng ⇒ sự kiện mất VĨNH VIỄN.            │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ **ĐỐI XỨNG LÀ ĐIỀU KIỆN, KHÔNG PHẢI PHONG CÁCH.** `S10-CHAT-CALLSWEEP-1` hoãn món này với đúng lý
 * do "vá một mình job mới sẽ làm hai job lệch chuẩn nhau". Nên bảng ca dưới đây chạy **cùng một danh
 * sách** cho cả hai job qua `describe.each` — thêm ca cho một job mà quên job kia là ĐỎ, không phải là
 * một khoảng trống im lặng.
 *
 * ⚠️ **ĐÍNH CHÍNH tên hàm** (ghi chú bàn giao S10-CHAT-CALLSWEEP-1 viết SAI): job ring-timeout gọi
 * `emitExpired` (`action:"missed"`), job gặt gọi `emitAutoEnded` (`action:"ended"`). Cùng KHUÔN, khác
 * HÀM — grep đúng một tên rồi tưởng đã phủ cả hai là đúng lớp bẫy số hiệu này sinh ra để chống.
 *
 * ⚠️ Dựng `ChatCallsService` **THẬT**, không fake hai helper: guard sống TRONG chúng, fake chúng đi là
 * đo một cái vỏ ([[same-builder-twice-makes-unit-spec-vacuous]]).
 */

const CO = "11111111-1111-4111-8111-111111111111";
const ROOM = "44444444-4444-4444-8444-444444444444";
const STARTED_AT = new Date("2026-08-24T09:00:00.000Z");

const CALL_IDS = [
  "c1111111-1111-4111-8111-111111111111",
  "c2222222-2222-4222-8222-222222222222",
  "c3333333-3333-4333-8333-333333333333",
] as const;
const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function expiries(n: number): ChatCallExpiry[] {
  return CALL_IDS.slice(0, n).map((id) => ({
    call: {
      id,
      roomId: ROOM,
      kind: "audio" as const,
      initiatorUserId: USER,
      startedAt: STARTED_AT,
    },
    participantUserIds: [USER],
  }));
}

/**
 * `throwAtIndex` = thứ tự lời gọi `emitChatCall` sẽ ném (0-based). Chọn item **GIỮA** lô ở ca chính:
 * item đầu chỉ chứng minh "không sập", item cuối không phân biệt được guard per-item với guard bọc
 * ngoài — chỉ item giữa mới bắt được cả hai vế cùng lúc.
 */
function build(count: number, throwAtIndex: number | null) {
  let seen = 0;
  const emitChatCall = vi.fn(() => {
    if (seen++ === throwAtIndex) throw new Error("adapter Valkey rớt giữa emit");
  });
  const realtime = { emitChatCall } as unknown as RealtimeEmitterService;

  const calls = new ChatCallsService(
    {} as unknown as DatabaseService,
    {} as unknown as ChatCallsRepository,
    {} as unknown as ChatAccessService,
    {} as unknown as AuditService,
    {} as unknown as ChatCallCooldownService,
    realtime,
  );

  // `withTenant` trả thẳng lô — phần DB đã có ca riêng (`chat-calls.stale-active-sweep.spec.ts`); ở đây
  // ta đo ĐÚNG cái xảy ra SAU commit.
  const rows = expiries(count);
  const db = { withTenant: vi.fn(async () => rows) } as unknown as DatabaseService;

  const error = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, "debug").mockImplementation(() => undefined);

  return { calls, db, emitChatCall, error, rows };
}

interface JobUnderTest {
  /** Nhãn hiển thị — cũng là bằng chứng bảng ca phủ ĐÚNG HAI job. */
  readonly label: string;
  readonly jobCode: string;
  /** Khoá đếm riêng của từng job trong `metadata` — hình dạng cũ phải giữ nguyên ở đường xanh. */
  readonly countKey: "callsMissed" | "callsAutoEnded";
  readonly extraMetadata: Record<string, unknown>;
  make(db: DatabaseService, calls: ChatCallsService): JobHandler;
}

const JOBS: JobUnderTest[] = [
  {
    label: "CHAT_CALL_RINGING_TIMEOUT · emitExpired (action 'missed')",
    jobCode: CHAT_CALL_RINGING_TIMEOUT_JOB_CODE,
    countKey: "callsMissed",
    extraMetadata: { ringTimeoutMs: CHAT_CALL_RING_TIMEOUT_MS },
    make: (db, calls) => new ChatCallRingingTimeoutJobHandler(db, calls),
  },
  {
    label: "CHAT_CALL_STALE_ACTIVE_SWEEP · emitAutoEnded (action 'ended')",
    jobCode: CHAT_CALL_STALE_ACTIVE_SWEEP_JOB_CODE,
    countKey: "callsAutoEnded",
    extraMetadata: {},
    make: (db, calls) => new ChatCallStaleActiveSweepJobHandler(db, calls),
  },
];

describe.each(JOBS)("$label — emit hỏng SAU COMMIT (KI-075)", (job) => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const run = (
    count: number,
    throwAtIndex: number | null,
  ): [Promise<JobRunResult>, ReturnType<typeof build>] => {
    const t = build(count, throwAtIndex);
    return [job.make(t.db, t.calls).run({ companyId: CO }), t];
  };

  it("item GIỮA lô ném ⇒ `run()` KHÔNG reject và lô CÒN LẠI vẫn được phát đủ", async () => {
    const [p, t] = run(3, 1);
    await expect(p).resolves.toBeTruthy();

    // 3 lần gọi = item hỏng KHÔNG cắt vòng lặp. Guard bọc ngoài lời gọi helper chỉ ra 2.
    expect(t.emitChatCall).toHaveBeenCalledTimes(3);
    const emittedCallIds = t.emitChatCall.mock.calls.map(
      (c) => ((c as unknown[])[2] as { callId: string }).callId,
    );
    expect(emittedCallIds).toEqual([...CALL_IDS]);
  });

  it("run-row KHÔNG nói dối: `failed>0` + `metadata.emitFailed`, đếm DB giữ nguyên sự thật", async () => {
    const [p] = run(3, 1);
    const res = await p;

    // `total` = số hàng DB ĐÃ đổi trạng thái (sự thật nghiệp vụ, không đổi vì chuông hỏng).
    // `success + failed === total` — phân hoạch theo quy ước nhà (attendance-alert-noti.job-handler.ts).
    // `failed>0` + `success>0` ⇒ JobRunner.deriveStatus → 'Partial': "việc xong, chuông mất một phần".
    expect(res).toEqual({
      total: 3,
      success: 2,
      failed: 1,
      metadata: { [job.countKey]: 3, ...job.extraMetadata, emitFailed: 1 },
    });
  });

  it("ghi HAI tầng `error`: per-item mang callId, tổng hợp mang jobCode · companyId · số mất", async () => {
    const [p, t] = run(3, 1);
    await p;

    // Hai tầng CỐ Ý, không phải log kép thừa — chúng trả lời hai câu hỏi khác nhau và câu nào thiếu
    // cũng làm sự cố không lần lại được:
    //   • helper (`chat-calls.service`) biết ĐÚNG cuộc gọi nào mất chuông, không biết mình đang chạy
    //     dưới job nào (nó cũng phục vụ đường REST `invite`);
    //   • job biết `jobCode`/`companyId`/quy mô, không biết callId nào.
    // ⚠️ Đọc `mock.calls` TRƯỚC mọi `restore` ([[mockrestore-wipes-mock-calls]]).
    const msgs = t.error.mock.calls.map((c) => String((c as unknown[])[0]));
    expect(msgs).toHaveLength(2);

    // Tầng per-item: đúng cuộc gọi GIỮA lô, không phải cuộc gọi đầu/cuối.
    const perItem = msgs.filter((m) => m.includes(CALL_IDS[1]));
    expect(perItem).toHaveLength(1);

    // Tầng tổng hợp: đủ để mở một run-row và biết mình đang nhìn job nào của tenant nào.
    const aggregate = msgs.filter((m) => m.includes(job.jobCode));
    expect(aggregate).toHaveLength(1);
    expect(aggregate[0]).toContain(CO);
    expect(aggregate[0]).toContain("1/3");
  });

  it("CẢ LÔ ném ⇒ `success=0` (deriveStatus → 'Failed') nhưng đếm DB vẫn đọc được trong metadata", async () => {
    // Nuốt trọn thành success ở đây là lấy mất tín hiệu CUỐI CÙNG: try/catch đã che run-row khỏi
    // 'Failed', nên `failed`/`emitFailed` là thứ duy nhất còn nói được "chuông đã mất".
    const t = build(2, null);
    t.emitChatCall.mockImplementation(() => {
      throw new Error("gateway /ws chết hẳn");
    });
    const res = await job.make(t.db, t.calls).run({ companyId: CO });

    expect(res.total).toBe(2);
    expect(res.success).toBe(0);
    expect(res.failed).toBe(2);
    expect(res.metadata).toMatchObject({ [job.countKey]: 2, emitFailed: 2 });
  });

  it("ALLOW đường xanh ⇒ phát đủ MỌI cuộc gọi và `JobRunResult` giữ NGUYÊN hình dạng cũ", async () => {
    const [p, t] = run(3, null);
    const res = await p;

    expect(t.emitChatCall).toHaveBeenCalledTimes(3);
    // `toEqual` chứ không `toMatchObject`: khoá `emitFailed` KHÔNG được xuất hiện ở đường xanh —
    // hình dạng cũ của run-row là một phần hợp đồng, và ca này là thứ giữ nó
    // ([[deny-cases-vacuous-without-allow-case]]).
    expect(res).toEqual({
      total: 3,
      success: 3,
      failed: 0,
      metadata: { [job.countKey]: 3, ...job.extraMetadata },
    });
    expect(t.error).not.toHaveBeenCalled();
  });

  it("ALLOW lô RỖNG ⇒ 0 emit, 0 `error`, kết quả rỗng đúng hình dạng cũ", async () => {
    const [p, t] = run(0, null);
    const res = await p;

    expect(t.emitChatCall).not.toHaveBeenCalled();
    expect(res).toEqual({
      total: 0,
      success: 0,
      failed: 0,
      metadata: { [job.countKey]: 0, ...job.extraMetadata },
    });
    expect(t.error).not.toHaveBeenCalled();
  });
});
