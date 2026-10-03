/**
 * S18-FE-LEAVEDRAFTCAST-1 — mapper form nghỉ phép → body API khai kiểu trả về = DTO HỢP ĐỒNG.
 *
 * Hai lưới:
 *  1. COMPILE-TIME (`expectTypeOf`): vitest chạy nó là no-op — người ép là `tsc` của
 *     `pnpm --filter @mediaos/app typecheck` (tsconfig include `src` ⇒ spec cũng bị soát). Trước WO này
 *     mapper tự khai `durationType: string` / `halfDaySession?: string` (NỚI enum mà form schema đã hẹp) ⇒
 *     LeaveRequestForm phải ép `as Parameters<typeof leaveApi.createDraft|updateDraft>` — và cú ép đó nuốt
 *     MỌI lệch: khoá lạ trong kiểu tự khai, giá trị enum sai (cùng khuôn đã che lỗi 400 ở mã FE mạng xã hội).
 *     Khoá kiểu trả về = DTO ⇒ literal trong mapper bị tsc soát: khoá lạ ⇒ TS2353, enum sai ⇒ TS2322.
 *     Khoá ở đây bằng `toEqualTypeOf` (BẰNG, không chỉ gán được): kiểu tự khai rộng hơn DTO một khoá vẫn
 *     GÁN ĐƯỢC cho tham số leaveApi (không có excess-property check với biến) ⇒ chỉ phép BẰNG mới bắt.
 *  2. RUNTIME: body mapper sinh ra phải qua CHÍNH schema hợp đồng (`safeParse`) — server validate bằng
 *     đúng schema đó. Có ca đối chứng âm để chứng minh phép parse có răng.
 */
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  createLeaveRequestDraftSchema,
  updateLeaveRequestDraftSchema,
  type CreateLeaveRequestDraft,
  type LeaveCalculateRequest,
  type UpdateLeaveRequestDraft,
} from "@mediaos/contracts";
import { LEAVE_DURATION_TYPE, LEAVE_HALF_DAY_SESSION } from "./constants";
import {
  EMPTY_LEAVE_FORM,
  toCalculateBody,
  toCreateDraftBody,
  toUpdateDraftBody,
  type LeaveFormValues,
} from "./leave-form-schema";

// UUID entropy thấp — đủ qua z.string().uuid() của hợp đồng.
const LEAVE_TYPE_ID = "00000000-0000-4000-8000-000000000001";

const HALF_DAY_VALUES: LeaveFormValues = {
  ...EMPTY_LEAVE_FORM,
  leaveTypeId: LEAVE_TYPE_ID,
  durationType: LEAVE_DURATION_TYPE.HALF_DAY,
  startDate: "2026-10-05",
  endDate: "2026-10-05",
  halfDaySession: LEAVE_HALF_DAY_SESSION.MORNING,
  submitNow: true,
};

const HOURLY_VALUES: LeaveFormValues = {
  ...EMPTY_LEAVE_FORM,
  leaveTypeId: LEAVE_TYPE_ID,
  durationType: LEAVE_DURATION_TYPE.HOURLY,
  startDate: "2026-10-06",
  endDate: "2026-10-06",
  startTime: "09:00",
  endTime: "11:30",
  reason: "Khám sức khoẻ",
};

describe("leave-form-schema — mapper body nháp khớp DTO hợp đồng", () => {
  it("kiểu trả về của mapper BẰNG đúng DTO hợp đồng (ép bởi tsc, không ép kiểu ở call-site)", () => {
    expectTypeOf(toCreateDraftBody).returns.toEqualTypeOf<CreateLeaveRequestDraft>();
    expectTypeOf(toUpdateDraftBody).returns.toEqualTypeOf<UpdateLeaveRequestDraft>();
    expectTypeOf(toCalculateBody).returns.toEqualTypeOf<LeaveCalculateRequest>();
  });

  it("toCreateDraftBody: body qua schema create-draft, chuỗi rỗng → undefined, giữ submitNow", () => {
    const body = toCreateDraftBody(HALF_DAY_VALUES);

    expect(createLeaveRequestDraftSchema.safeParse(body).success).toBe(true);
    expect(body).toMatchObject({
      leaveTypeId: LEAVE_TYPE_ID,
      durationType: "HalfDay",
      halfDaySession: "Morning",
      submitNow: true,
    });
    expect(body.reason).toBeUndefined();
    expect(body.handoverNote).toBeUndefined();
    expect(body.contactDuringLeave).toBeUndefined();
  });

  it("đối chứng âm: HalfDay thiếu buổi ⇒ schema hợp đồng TỪ CHỐI (phép parse có răng)", () => {
    const body = toCreateDraftBody({ ...HALF_DAY_VALUES, halfDaySession: undefined });

    const result = createLeaveRequestDraftSchema.safeParse(body);
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.path.join("."))).toContain("halfDaySession");
  });

  it("toUpdateDraftBody: body qua schema update-draft và KHÔNG mang submitNow (create thì có)", () => {
    const updateBody = toUpdateDraftBody({ ...HOURLY_VALUES, submitNow: true });
    const createBody = toCreateDraftBody({ ...HOURLY_VALUES, submitNow: true });

    expect(updateLeaveRequestDraftSchema.safeParse(updateBody).success).toBe(true);
    expect(updateBody).toMatchObject({
      durationType: "Hourly",
      startTime: "09:00",
      endTime: "11:30",
      reason: "Khám sức khoẻ",
    });
    expect(updateBody).not.toHaveProperty("submitNow");
    // Đối chứng dương: cùng giá trị form, mapper create CÓ mang submitNow.
    expect(createBody).toHaveProperty("submitNow", true);
  });
});
