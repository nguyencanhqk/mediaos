/**
 * S16-SOCIAL-FE-2C — ca KD · KE(lý do) · KR của các hàm thuần vinh danh (plan §4 + §8).
 * Ca KM (tháng theo giờ công ty) ở `kudos-month.spec.ts` — nó cần mock `room-time` riêng.
 */
import { describe, expect, it } from "vitest";
import { defaultParseSearch } from "@tanstack/react-router";
import {
  FEED_BODY_MAX,
  SOCIAL_ERROR_CODES,
  createFeedPostSchema,
  type KudosRecipientCandidateDto,
} from "@mediaos/contracts";
import { ApiError } from "@mediaos/web-core";
import {
  EMPTY_KUDOS_DRAFT,
  addKudosRecipient,
  removeKudosRecipient,
  validateKudosDraft,
  type KudosDraft,
} from "./kudos-draft";
import { kudosErrorReason } from "./kudos-errors";
import { validateKudosRouteSearch } from "./kudos-route-search";
import { shiftKudosMonth } from "./kudos-month";

const person = (n: number, name = `Người ${n}`): KudosRecipientCandidateDto => ({
  employeeId: `${String(n).padStart(8, "0")}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`,
  fullName: name,
  avatarUrl: "https://x.invalid/p.png",
});

describe("KD — nháp vinh danh", () => {
  it("thêm trùng (khác hoa-thường) ⇒ giữ NGUYÊN tham chiếu", () => {
    const d1 = addKudosRecipient(EMPTY_KUDOS_DRAFT, person(1));
    const upper = { ...person(1), employeeId: person(1).employeeId.toUpperCase() };
    expect(addKudosRecipient(d1, upper)).toBe(d1);
    expect(d1.recipients).toHaveLength(1);
  });

  it("đủ 10 ⇒ người thứ 11 bị bỏ qua (nháp NGUYÊN tham chiếu)", () => {
    let d: KudosDraft = EMPTY_KUDOS_DRAFT;
    for (let i = 1; i <= 10; i += 1) d = addKudosRecipient(d, person(i));
    expect(d.recipients).toHaveLength(10);
    expect(addKudosRecipient(d, person(11))).toBe(d);
  });

  it("bỏ người nhận; id không có ⇒ nguyên tham chiếu", () => {
    const d = addKudosRecipient(addKudosRecipient(EMPTY_KUDOS_DRAFT, person(1)), person(2));
    expect(removeKudosRecipient(d, person(1).employeeId.toUpperCase()).recipients).toEqual([
      person(2),
    ]);
    expect(removeKudosRecipient(d, person(9).employeeId)).toBe(d);
  });

  it("thứ tự lỗi: người nhận trước lời nhắn", () => {
    expect(validateKudosDraft(EMPTY_KUDOS_DRAFT, "", false)).toEqual({
      ok: false,
      error: "recipientsRequired",
    });
    const d = addKudosRecipient(EMPTY_KUDOS_DRAFT, person(1));
    expect(validateKudosDraft(d, "   ", false)).toEqual({ ok: false, error: "messageRequired" });
    expect(validateKudosDraft(d, "x".repeat(FEED_BODY_MAX + 1), false)).toEqual({
      ok: false,
      error: "messageTooLong",
    });
  });

  it("nháp >10 (dựng tay) ⇒ recipientsTooMany", () => {
    const d: KudosDraft = {
      ...EMPTY_KUDOS_DRAFT,
      recipients: Array.from({ length: 11 }, (_, i) => person(i + 1)),
    };
    expect(validateKudosDraft(d, "hi", false)).toEqual({ ok: false, error: "recipientsTooMany" });
  });

  it("payload: id lowercase + SẮP XẾP (chọn B rồi A ⇒ [a,b]) — khoá idempotency ổn định", () => {
    const b = { ...person(2), employeeId: person(2).employeeId.toUpperCase() };
    const d = addKudosRecipient(addKudosRecipient(EMPTY_KUDOS_DRAFT, b), person(1));
    const r = validateKudosDraft(d, "  Cảm ơn!  ", false);
    expect(r.ok && r.kudos.recipientEmployeeIds).toEqual([person(1).employeeId, person(2).employeeId]);
    expect(r.ok && r.kudos.message).toBe("Cảm ơn!");
  });

  it("badgeId null ⇒ VẮNG khoá; có ⇒ gửi", () => {
    const d = addKudosRecipient(EMPTY_KUDOS_DRAFT, person(1));
    const none = validateKudosDraft(d, "hi", false);
    expect(none.ok && "badgeId" in none.kudos).toBe(false);
    const badge = "55555555-5555-4555-8555-555555555555";
    const withBadge = validateKudosDraft({ ...d, badgeId: badge }, "hi", false);
    expect(withBadge.ok && withBadge.kudos.badgeId).toBe(badge);
  });

  it("isOfficial chỉ true khi CÒN quyền (DENY: nháp true + !canOfficial ⇒ false · ALLOW ⇒ true)", () => {
    const d = { ...addKudosRecipient(EMPTY_KUDOS_DRAFT, person(1)), isOfficial: true };
    const deny = validateKudosDraft(d, "hi", false);
    const allow = validateKudosDraft(d, "hi", true);
    expect(deny.ok && deny.kudos.isOfficial).toBe(false);
    expect(allow.ok && allow.kudos.isOfficial).toBe(true);
  });

  it("payload ĐẦY ĐỦ qua `createFeedPostSchema` (không so object tay)", () => {
    const d = { ...addKudosRecipient(EMPTY_KUDOS_DRAFT, person(1)), badgeId: null };
    const r = validateKudosDraft(d, "Giỏi lắm", true);
    if (!r.ok) throw new Error("nháp phải hợp lệ");
    const dto = { type: "kudos", audience: "company", requiresAck: false, kudos: r.kudos };
    expect(createFeedPostSchema.safeParse(dto).success).toBe(true);
  });
});

describe("KE — lý do lỗi vinh danh đọc theo MÃ", () => {
  const err = (status: number, code: string) => new ApiError(status, code, `${code}: x`);
  const C = SOCIAL_ERROR_CODES;

  it.each([
    [403, C.KUDOS_CREATE_REQUIRED, "kudosCreateDenied"],
    [403, C.KUDOS_OFFICIAL_DENIED, "kudosOfficialDenied"],
    [422, C.KUDOS_SELF_RECIPIENT, "kudosSelf"],
    [422, C.KUDOS_RECIPIENT_LIMIT, "kudosRecipientLimit"],
    [422, C.KUDOS_RECIPIENT_INVALID, "kudosRecipientInvalid"],
    [422, C.KUDOS_BADGE_INVALID, "kudosBadgeInvalid"],
  ])("%i %s ⇒ %s", (status, code, reason) => {
    expect(kudosErrorReason(err(status, code))).toBe(reason);
  });

  it("mã SOCIAL khác (ERR-012) / lỗi không phải ApiError ⇒ null", () => {
    expect(kudosErrorReason(err(404, C.GROUP_NOT_FOUND))).toBeNull();
    expect(kudosErrorReason(new Error("x"))).toBeNull();
  });
});

describe("KR — `validateKudosRouteSearch` ăn ĐẦU RA parser thật", () => {
  const parse = (qs: string) => defaultParseSearch(qs) as Record<string, unknown>;

  it("?month=2026-09 (chuỗi) ⇒ giữ", () => {
    expect(validateKudosRouteSearch(parse("?month=2026-09"))).toEqual({ month: "2026-09" });
  });

  it("?month=202609 tới đây là SỐ ⇒ bỏ; ?month=2026-13 ⇒ bỏ; KHÔNG ném", () => {
    const raw = parse("?month=202609");
    expect(raw.month).toBe(202609); // đo tiền đề: parser biến chữ số thành số
    expect(validateKudosRouteSearch(raw)).toEqual({});
    expect(validateKudosRouteSearch(parse("?month=2026-13"))).toEqual({});
    expect(validateKudosRouteSearch(parse("?month=0000-01"))).toEqual({});
  });

  it("?page=2 (SỐ) ⇒ 2; ?page=1 (mặc định) và rác ⇒ bỏ", () => {
    expect(validateKudosRouteSearch(parse("?page=2"))).toEqual({ page: 2 });
    expect(validateKudosRouteSearch(parse("?page=1"))).toEqual({});
    expect(validateKudosRouteSearch(parse("?page=abc"))).toEqual({});
    expect(validateKudosRouteSearch(parse("?page=10001"))).toEqual({});
  });
});

describe("KM — dịch tháng (số học chuỗi)", () => {
  it("qua biên năm và chặn ngoài 1900-01..2099-12", () => {
    expect(shiftKudosMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftKudosMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftKudosMonth("2026-09", 0)).toBe("2026-09");
    expect(shiftKudosMonth("1900-01", -1)).toBeNull();
    expect(shiftKudosMonth("2099-12", 1)).toBeNull();
    expect(shiftKudosMonth("rác", 1)).toBeNull();
  });
});
