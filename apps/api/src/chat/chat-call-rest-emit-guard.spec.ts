import { Logger } from "@nestjs/common";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatCallCooldownService } from "./chat-call-cooldown.service";
import { ChatCallsService } from "./chat-calls.service";
import type { ChatCallDto } from "@mediaos/contracts";
import type { RealtimeEmitterService } from "../realtime/realtime-emitter.service";

/**
 * S10-CHAT-EMITGUARD-2 (KI-076) — vế **REST** của cùng hợp đồng mà `chat-call-emit-guard.spec.ts` ghim
 * cho vế **JOB**. NĂM route CALL phát `chat:call` **SAU COMMIT** qua `emitLifecycle`:
 *
 *   `invite` → `chat-calls.service.ts:203` (`ringing`)
 *   `accept` · `reject` · `cancel` · `hangup` → `:558` trong `lifecycleTx` (dùng CHUNG một điểm phát)
 *
 * ┌─ MỨC ĐỘ — ĐỌC ĐÚNG, ĐỪNG THỔI ──────────────────────────────────────────────────────────────────┐
 * │ `RealtimeEmitterService.emitChatCall` **hôm nay** tự nuốt mọi lỗi ⇒ nhánh `catch` được ghim ở    │
 * │ đây là đường CHẾT, và bất biến đó **ĐÃ có ca ghim** (`realtime/realtime-emitter.call.spec.ts`,   │
 * │ S10-CHAT-EMITGUARD-1, có kiểm chứng đột biến). Đây là nợ PHÒNG THỦ THEO CHIỀU SÂU, KHÔNG phải   │
 * │ lỗ đang chảy máu — rủi ro tồn dư THẤP HƠN KI-075 lúc mở. Đừng chép giọng KI-075 sang đây.        │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ **VÌ SAO vẫn đáng ghim, và vì sao 3/5 route nặng hơn hai route kia.** Lời gọi phát nằm SAU commit ⇒
 * hàng `chat_calls` đã đổi trạng thái THẬT. Emit ném ⇒ route trả **500 cho một giao dịch ĐÃ commit**;
 * actor tưởng thất bại, thử lại và ăn **422 CALL_NOT_ACTIONABLE** (`mustTransition` từ trạng thái đã
 * đổi). Với PEER thì WS là kênh DUY NHẤT — họ không có response POST nào để đọc:
 *
 *   • `ringing` (`invite`) → job ring-timeout 45s + bước dọn-trước-khi-mời  ⇒ **tự lành**
 *   • `active`  (`accept`) → job stale-active-sweep (grace 2 phút / 12h)    ⇒ **tự lành CHẬM**
 *   • `rejected` · `cancelled` · `ended` → **trạng thái CUỐI, KHÔNG job nào quét**, và CALL không có
 *     route ĐỌC để poll bù ⇒ peer giữ khung gọi CHẾT tới khi reload/reconnect — đúng lớp hậu quả KI-075.
 *
 * ⚠️ Dựng `ChatCallsService` **THẬT**, không fake `emitLifecycle`: guard sống TRONG helper, fake nó đi là
 * đo một cái vỏ ([[same-builder-twice-makes-unit-spec-vacuous]]).
 *
 * ⚠️ Bảng ca chạy qua `describe.each` cho **cả 5 route**. Vá lẻ một route rồi quên bốn route kia là ĐỎ,
 * không phải một khoảng trống im lặng — đó chính là thứ `lifecycleTx` được dựng ra để chống.
 */

const CO = "11111111-1111-4111-8111-111111111111";
const ROOM = "44444444-4444-4444-8444-444444444444";
const CALL = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const STALE_CALL = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const INITIATOR = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PEER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const STARTED_AT = new Date("2026-08-25T09:00:00.000Z");

const ROOM_ROW = {
  id: ROOM,
  companyId: CO,
  refId: null,
  roomType: "group" as const,
  name: "Phòng A",
  roomCode: "ROOM-0001",
  description: null,
  lastMessageAt: null,
  lastMessageSeq: 5,
  isArchived: false,
  syncSource: "manual",
  deletedAt: null,
  directKey: null,
  createdAt: STARTED_AT,
};
const MEMBERSHIP = { id: "m1", role: "admin" as const, lastReadSeq: 2, visibleFromSeq: null };
const ACCESS = { room: ROOM_ROW, membership: MEMBERSHIP };

const CALL_ROW = {
  id: CALL,
  companyId: CO,
  roomId: ROOM,
  initiatorUserId: INITIATOR,
  kind: "audio" as const,
  status: "ringing" as const,
  startedAt: STARTED_AT,
  acceptedAt: null,
  endedAt: null,
};

const PARTICIPANTS = [
  { userId: INITIATOR, invitedAt: STARTED_AT, joinedAt: STARTED_AT, leftAt: null, outcome: null },
  { userId: PEER, invitedAt: STARTED_AT, joinedAt: null, leftAt: null, outcome: null },
];

interface BuildOpts {
  /** Lời gọi `emitChatCall` thứ mấy (0-based) sẽ ném. `null` = đường xanh. */
  readonly throwAt?: number | null;
  /** Trạng thái hàng `chat_calls` sau `transition` — DTO trả về phải mang đúng nó. */
  readonly toStatus?: "active" | "rejected" | "cancelled" | "ended";
  /** Cuộc gọi treo mà bước dọn-trước-khi-mời của `invite` tìm thấy. */
  readonly staleRinging?: readonly string[];
}

function build({ throwAt = null, toStatus = "ended", staleRinging = [] }: BuildOpts = {}) {
  let seen = 0;
  // Tham số khai TƯỜNG MINH (dù không dùng) để `mock.calls` có kiểu tuple đọc được — `vi.fn(() => …)`
  // cho `[]` và mọi assert trên đối số thành lỗi biên dịch.
  const emitChatCall = vi.fn(
    (_companyId: string, _targets: readonly string[], _payload: Record<string, unknown>) => {
      if (seen++ === throwAt) throw new Error("adapter Valkey rớt giữa emit");
    },
  );
  const realtime = { emitChatCall } as unknown as RealtimeEmitterService;

  const repo = {
    activeMemberIds: vi.fn(async () => [INITIATOR, PEER]),
    insertCall: vi.fn(async () => CALL_ROW),
    insertParticipants: vi.fn(async () => undefined),
    listParticipants: vi.fn(async () => PARTICIPANTS),
    expireStaleRinging: vi.fn(async () =>
      staleRinging.map((id) => ({
        id,
        roomId: ROOM,
        kind: "audio" as const,
        initiatorUserId: PEER,
        startedAt: STARTED_AT,
      })),
    ),
    transition: vi.fn(async () => ({
      ...CALL_ROW,
      status: toStatus,
      acceptedAt: toStatus === "active" ? STARTED_AT : null,
      endedAt: toStatus === "active" ? null : STARTED_AT,
    })),
    setParticipantOutcome: vi.fn(async () => true),
    closeOpenParticipants: vi.fn(async () => 0),
    findParticipant: vi.fn(async () => PARTICIPANTS[1]),
  };

  const chatAccess = {
    assertMember: vi.fn(async () => ACCESS),
    assertCallAccess: vi.fn(async () => ({ ...ACCESS, call: CALL_ROW })),
  };

  // `withTenant` chạy HẾT thân rồi "commit" — ở đây ta đo ĐÚNG cái xảy ra SAU commit. Bất biến
  // "emit NGOÀI transaction" có ca riêng ở `chat-realtime-after-commit.spec.ts`, không lặp lại ở đây.
  const db = {
    withTenant: vi.fn(async (_co: string, fn: (tx: unknown) => Promise<unknown>) => fn({})),
  };

  const svc = new ChatCallsService(
    db as never,
    repo as never,
    chatAccess as never,
    { record: vi.fn() } as never,
    // Cooldown THẬT nhưng luôn cho qua ở quy mô này (trần mặc định 10/phút, mỗi ca gọi 1 lần).
    new ChatCallCooldownService() as never,
    realtime,
  );

  return { svc, emitChatCall, repo };
}

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  errorSpy = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, "debug").mockImplementation(() => undefined);
});

afterEach(() => {
  // ⚠️ Đọc `mock.calls` TRƯỚC dòng này — `mockRestore()` xoá sạch nó ([[mockrestore-wipes-mock-calls]]).
  vi.restoreAllMocks();
});

function errorMessages(): string[] {
  return errorSpy.mock.calls.map((c) => String(c[0]));
}

interface RouteUnderTest {
  readonly label: string;
  /** `action` mà route phát — trường client dùng để phân biệt màn hình. */
  readonly action: string;
  readonly toStatus: BuildOpts["toStatus"];
  run(svc: ChatCallsService): Promise<ChatCallDto>;
}

const ROUTES: RouteUnderTest[] = [
  {
    label: "invite (CHAT-API-026) · :203 · ringing → tự lành",
    action: "ringing",
    toStatus: "ended",
    run: (svc) => svc.invite({ id: INITIATOR, companyId: CO }, ROOM, { kind: "audio" }),
  },
  {
    label: "accept (CHAT-API-027) · :558 · active → tự lành CHẬM",
    action: "accepted",
    toStatus: "active",
    // Người nhận PHẢI khác người khởi tạo (403 nếu không) — xem docblock `accept`.
    run: (svc) => svc.accept({ id: PEER, companyId: CO }, CALL),
  },
  {
    label: "reject (CHAT-API-027) · :558 · TRẠNG THÁI CUỐI → KHÔNG hồi phục",
    action: "rejected",
    toStatus: "rejected",
    run: (svc) => svc.reject({ id: PEER, companyId: CO }, CALL),
  },
  {
    label: "cancel (CHAT-API-028) · :558 · TRẠNG THÁI CUỐI → KHÔNG hồi phục",
    action: "cancelled",
    toStatus: "cancelled",
    // Huỷ là quyền của NGƯỜI GỌI.
    run: (svc) => svc.cancel({ id: INITIATOR, companyId: CO }, CALL),
  },
  {
    label: "hangup (CHAT-API-028) · :558 · TRẠNG THÁI CUỐI → KHÔNG hồi phục",
    action: "ended",
    toStatus: "ended",
    run: (svc) => svc.hangup({ id: INITIATOR, companyId: CO }, CALL),
  },
];

describe.each(ROUTES)("KI-076 — $label", (route) => {
  it("ALLOW: đường xanh phát ĐÚNG 1 sự kiện tới đúng người tham gia, DTO trả về nguyên vẹn", async () => {
    // ⚠️ Ca ALLOW bắt buộc: thiếu nó thì đột biến "`emitLifecycle` return ngay dòng đầu" vẫn xanh cả ba
    // ca DENY bên dưới ([[deny-cases-vacuous-without-allow-case]]).
    const { svc, emitChatCall } = build({ toStatus: route.toStatus });
    const dto = await route.run(svc);

    expect(emitChatCall).toHaveBeenCalledTimes(1);
    const [companyId, targets, payload] = emitChatCall.mock.calls[0] ?? [];
    expect(companyId).toBe(CO);
    // Đích = bảng participants, KHÔNG phải danh sách thành viên phòng.
    expect(targets).toEqual([INITIATOR, PEER]);
    expect(payload).toMatchObject({ callId: CALL, roomId: ROOM, action: route.action });
    expect(dto.id).toBe(CALL);
    expect(errorMessages()).toHaveLength(0);
  });

  it("DENY: emit NÉM → route vẫn trả DTO của đường xanh (không phải 500 cho một tx ĐÃ commit)", async () => {
    const green = build({ toStatus: route.toStatus });
    const expected = await route.run(green.svc);

    const { svc } = build({ toStatus: route.toStatus, throwAt: 0 });
    // Hôm nay dòng này ĐỎ: exception thoát khỏi `emitLifecycle` ⇒ Nest dịch thành 500 cho một giao dịch
    // ĐÃ commit, và lần thử lại của actor ăn 422 CALL_NOT_ACTIONABLE.
    const dto = await route.run(svc);
    expect(dto).toEqual(expected);
  });

  it("DENY: emit NÉM → đúng 1 `logger.error` mang callId + action (tín hiệu DUY NHẤT của đường REST)", async () => {
    const { svc } = build({ toStatus: route.toStatus, throwAt: 0 });
    await route.run(svc);

    const errs = errorMessages().filter((m) => m.includes("emitLifecycle"));
    expect(errs).toHaveLength(1);
    expect(errs[0]).toContain(CALL);
    expect(errs[0]).toContain(route.action);
  });
});

describe("KI-076 — `invite` có HAI lối phát: guard của lối này không được cắt lối kia", () => {
  const inviteActor = { id: INITIATOR, companyId: CO };

  it("ALLOW đối chứng: bước dọn tìm thấy cuộc gọi treo → ĐÚNG 2 sự kiện, thứ tự missed → ringing", async () => {
    const { svc, emitChatCall } = build({ staleRinging: [STALE_CALL] });
    await svc.invite(inviteActor, ROOM, { kind: "audio" });

    expect(emitChatCall).toHaveBeenCalledTimes(2);
    expect(emitChatCall.mock.calls[0]?.[2]).toMatchObject({ action: "missed" });
    expect(emitChatCall.mock.calls[1]?.[2]).toMatchObject({ action: "ringing" });
  });

  it("DENY: emit `missed` NÉM → `ringing` VẪN được phát, route vẫn trả DTO", async () => {
    const { svc, emitChatCall } = build({ staleRinging: [STALE_CALL], throwAt: 0 });
    const dto = await svc.invite(inviteActor, ROOM, { kind: "audio" });

    expect(emitChatCall).toHaveBeenCalledTimes(2);
    expect(emitChatCall.mock.calls[1]?.[2]).toMatchObject({ action: "ringing" });
    expect(dto.id).toBe(CALL);
  });

  it("DENY: emit `ringing` NÉM (lối THỨ HAI) → route vẫn trả DTO", async () => {
    const { svc, emitChatCall } = build({ staleRinging: [STALE_CALL], throwAt: 1 });
    const dto = await svc.invite(inviteActor, ROOM, { kind: "audio" });

    expect(emitChatCall).toHaveBeenCalledTimes(2);
    expect(dto.id).toBe(CALL);
  });
});

describe("KI-076 — ratchet cấu trúc", () => {
  const SRC = readFileSync(join(__dirname, "chat-calls.service.ts"), "utf8");
  /** Gỡ chú thích trước khi đếm — docblock nhắc tên hàm không phải một lối phát. */
  const CODE = SRC.replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, "$1");

  it("`emitChatCall(` vẫn ĐÚNG 3 — bọc try/catch KHÔNG được làm tụt trần ratchet", () => {
    // [[index-ratchet-must-pin-definition-not-name]] — hạ trần một ratchet để "cho qua" một bản vá là
    // gỡ đúng thứ nó canh. Guard của WO này bọc lời gọi TẠI CHỖ: không gộp, không thêm lối phát.
    expect(CODE.match(/this\.realtime\.emitChatCall\(/g) ?? []).toHaveLength(3);
  });

  it("guard nằm TRONG `emitLifecycle` — MỘT điểm sửa phủ cả 5 route, không nhân bản ra từng route", () => {
    const fromHelper = CODE.slice(CODE.indexOf("private emitLifecycle("));
    const helper = fromHelper.slice(0, fromHelper.indexOf("emitExpired("));
    expect(helper).toMatch(/try \{/);
    expect(helper).toMatch(/\} catch \(/);

    // Và KHÔNG có bản sao nào ở tầng route: `lifecycleTx` được dựng ra CHÍNH ĐỂ chống "quên ở một
    // route" — nhân bản guard ra ngoài nó là đi ngược thiết kế.
    expect(CODE).not.toMatch(/try \{\s*this\.emitLifecycle\(/);
  });

  it("`emitLifecycle` giữ `: void` — đường REST không có run-row, trả số đếm là KẾ TOÁN GIẢ", () => {
    // Đối lập CÓ CHỦ Ý với `emitExpired`/`emitAutoEnded` (`: number`, ghim ở
    // `chat-realtime-after-commit.spec.ts`) — ở đó job CÓ chỗ tiêu thụ con số.
    expect(CODE).toMatch(/private emitLifecycle\([\s\S]{0,160}?\): void \{/);
  });

  it("`invite` VỨT số đếm của `emitExpired` một cách TƯỜNG MINH (`void`), không im lặng", () => {
    // Helper đã `logger.error` per-item kèm callId; một dòng tổng ở tầng REST chỉ nhân đôi cùng thông
    // tin. Nhưng chỗ vứt phải grep được, nếu không lần review sau mở lại đúng cuộc tranh luận này.
    expect(CODE).toMatch(/void this\.emitExpired\(actor\.companyId, expired\);/);
  });
});
