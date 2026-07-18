/**
 * HrPcrNotiBridgeRegistrar — 3 mapping HR profile-change → NOTI (SPEC-08 §15). CHẠY KHÔNG CẦN DB.
 *
 * Vì sao cần: catalog `notification_events` + template IN_APP của 3 mã này đã seed từ lâu, nên nhìn vào DB
 * tưởng như tính năng có sẵn — trong khi KHÔNG có producer phát event và KHÔNG có mapping ở bridge, dẫn
 * tới duyệt xong không ai nhận được thông báo mà chẳng có lỗi nào để lần. Test này khoá phần dễ trôi lại:
 * eventType phải khớp CHÍNH XÁC hằng producer dùng (lệch 1 ký tự ⇒ event rơi vào hư không, im lặng), và
 * người nhận phải đúng vai.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PCR_EVENT_TYPE } from "../employees/profile-change-request.service";
import { HrPcrNotiBridgeRegistrar } from "./hr-pcr-noti-bridge.registrar";

interface Registered {
  eventType: string;
  eventCode: string;
  sourceModule: string;
  sourceEntityType: string;
  sourceEntityIdOf: (ctx: unknown) => string | undefined;
  resolveRecipients: (ctx: unknown) => Promise<string[]>;
}

const REQUEST_ID = "7a4523d2-f95b-45b6-8960-f3ed3f4f50db";
const COMPANY_ID = "401c90a0-dfea-4b0a-986c-4317b798cd7b";
const REQUESTER = "9f8cb280-4f81-413e-b5a8-9a6473bc89d3";
const APPROVERS = ["hr-user-1", "admin-user-2"];

function ctxOf(payload: Record<string, unknown>) {
  return { companyId: COMPANY_ID, eventId: "evt-1", payload };
}

describe("HrPcrNotiBridgeRegistrar", () => {
  let registered: Registered[];
  let registrar: HrPcrNotiBridgeRegistrar;
  const reader = {
    resolveApprovers: vi.fn(async () => APPROVERS),
    resolveRequesterUserId: vi.fn(async () => REQUESTER),
  };

  beforeEach(() => {
    registered = [];
    vi.clearAllMocks();
    // withTenant chỉ mở tx — test không cần DB thật, chạy thẳng callback với tx giả.
    const db = { withTenant: (_c: string, fn: (tx: unknown) => unknown) => fn({}) };
    const bridge = { registerSource: (s: Registered) => registered.push(s) };
    registrar = new HrPcrNotiBridgeRegistrar(db as never, reader as never, bridge as never);
    registrar.onModuleInit();
  });

  const find = (eventType: string) => registered.find((r) => r.eventType === eventType)!;

  it("đăng ký đủ 3 mapping với eventType KHỚP hằng producer + eventCode khớp catalog", () => {
    expect(registered).toHaveLength(3);

    // Dùng chính hằng PCR_EVENT_TYPE (producer import cùng nguồn) — nếu ai đổi 1 bên, test đỏ.
    expect(find(PCR_EVENT_TYPE.SUBMITTED).eventCode).toBe("HR_PROFILE_CHANGE_SUBMITTED");
    expect(find(PCR_EVENT_TYPE.APPROVED).eventCode).toBe("HR_PROFILE_CHANGE_APPROVED");
    expect(find(PCR_EVENT_TYPE.REJECTED).eventCode).toBe("HR_PROFILE_CHANGE_REJECTED");

    for (const r of registered) {
      expect(r.sourceModule).toBe("HR");
      expect(r.sourceEntityType).toBe("profile_change_request");
      expect(r.sourceEntityIdOf(ctxOf({ requestId: REQUEST_ID }))).toBe(REQUEST_ID);
    }
  });

  it("APPROVED → người nhận là CHỦ HỒ SƠ (đọc từ bảng, không tin payload)", async () => {
    const recipients = await find(PCR_EVENT_TYPE.APPROVED).resolveRecipients(
      ctxOf({ requestId: REQUEST_ID, actorUserId: "hr-user-1" }),
    );

    expect(recipients).toEqual([REQUESTER]);
    expect(reader.resolveRequesterUserId).toHaveBeenCalledWith({}, COMPANY_ID, REQUEST_ID);
  });

  it("REJECTED → cũng là chủ hồ sơ", async () => {
    const recipients = await find(PCR_EVENT_TYPE.REJECTED).resolveRecipients(
      ctxOf({ requestId: REQUEST_ID }),
    );

    expect(recipients).toEqual([REQUESTER]);
  });

  it("SUBMITTED → người nhận là nhóm CÓ QUYỀN DUYỆT (không hard-code role)", async () => {
    const recipients = await find(PCR_EVENT_TYPE.SUBMITTED).resolveRecipients(
      ctxOf({ requestId: REQUEST_ID, actorUserId: REQUESTER }),
    );

    expect(recipients).toEqual(APPROVERS);
    expect(reader.resolveApprovers).toHaveBeenCalledWith({}, COMPANY_ID);
  });

  // Fail-soft: dữ liệu hỏng KHÔNG được ném lỗi, nếu không outbox worker sẽ retry/kẹt vì một bản ghi lỗi.
  it("payload thiếu requestId → recipient rỗng, KHÔNG throw, KHÔNG chạm DB", async () => {
    const recipients = await find(PCR_EVENT_TYPE.APPROVED).resolveRecipients(ctxOf({}));

    expect(recipients).toEqual([]);
    expect(reader.resolveRequesterUserId).not.toHaveBeenCalled();
  });

  it("hồ sơ chưa gắn tài khoản (reader trả null) → recipient rỗng, KHÔNG throw", async () => {
    reader.resolveRequesterUserId.mockResolvedValueOnce(null as never);

    const recipients = await find(PCR_EVENT_TYPE.APPROVED).resolveRecipients(
      ctxOf({ requestId: REQUEST_ID }),
    );

    expect(recipients).toEqual([]);
  });
});
