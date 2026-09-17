/**
 * S15-PAYROLL-QA-1 (lane D, NOTI-027) — `PayrollNotiBridgeRegistrar.dedupeKeyOf` cho cả 8 mapping. CHẠY
 * KHÔNG CẦN DB (fake bridge bắt `registerSource`, mirror `hr-pcr-noti-bridge.registrar.spec.ts`).
 *
 * Trọng tâm 027 (`PAYROLL_EVENT_PAYMENT_BATCH_COMPLETED`, SPEC-11 dòng 1409): khoá dedupe là ĐÚNG
 * `periodId` — CỐ Ý, để một kỳ NHIỀU ĐỢT chi trả vẫn chỉ báo «đã chi» MỘT lần dù có N đợt hoàn tất trước
 * đợt cuối cùng đẩy kỳ sang `Paid` (khoá theo `batchId` sẽ vỡ bất biến "once-ever mỗi KỲ", không phải
 * mỗi ĐỢT — plan §0 đính chính backlog). Đột biến khoá 027 sang `batchId` PHẢI làm ca 1 dưới đây ĐỎ ở cả
 * hai nhánh (hai batchId cùng kỳ sẽ RA HAI khoá khác nhau thay vì MỘT) — xác nhận bằng ĐỌC code, không
 * commit đột biến (rule của WO: không sửa `src/**` ngoài spec).
 */
import { describe, expect, it } from "vitest";
import {
  PAYROLL_EVENT_ADVANCE_APPROVED,
  PAYROLL_EVENT_ADVANCE_REJECTED,
  PAYROLL_EVENT_ADVANCE_SUBMITTED,
  PAYROLL_EVENT_PAYMENT_BATCH_COMPLETED,
  PAYROLL_EVENT_PAYSLIP_PUBLISHED,
  PAYROLL_EVENT_PERIOD_APPROVED,
  PAYROLL_EVENT_PERIOD_REJECTED,
  PAYROLL_EVENT_PERIOD_SUBMITTED,
} from "../payroll/payroll-noti.payload";
import { PayrollNotiBridgeRegistrar } from "./payroll-noti-bridge.registrar";

interface Registered {
  eventType: string;
  eventCode: string;
  sourceModule: string;
  sourceEntityType: string;
  dedupeKeyOf?: (ctx: unknown) => string | undefined;
}

const COMPANY_ID = "9e6e9a1e-9b1d-4a6b-8f9e-1a2b3c4d5e6f";

function ctxOf(payload: Record<string, unknown>) {
  return { companyId: COMPANY_ID, eventId: "evt-1", eventType: "x", payload };
}

describe("PayrollNotiBridgeRegistrar", () => {
  const registered: Registered[] = [];
  const bridge = { registerSource: (s: Registered) => registered.push(s) };
  const registrar = new PayrollNotiBridgeRegistrar(bridge as never);
  registrar.onModuleInit();

  const find = (eventType: string) => registered.find((r) => r.eventType === eventType)!;

  it("đăng ký đủ 8 mapping (4 track B 020–023 + 4 track C 024–027) đúng eventCode catalog", () => {
    expect(registered).toHaveLength(8);
    expect(find(PAYROLL_EVENT_PERIOD_SUBMITTED).eventCode).toBe("PAYROLL_PERIOD_SUBMITTED");
    expect(find(PAYROLL_EVENT_PERIOD_APPROVED).eventCode).toBe("PAYROLL_PERIOD_APPROVED");
    expect(find(PAYROLL_EVENT_PERIOD_REJECTED).eventCode).toBe("PAYROLL_PERIOD_REJECTED");
    expect(find(PAYROLL_EVENT_PAYSLIP_PUBLISHED).eventCode).toBe("PAYSLIP_PUBLISHED");
    expect(find(PAYROLL_EVENT_ADVANCE_SUBMITTED).eventCode).toBe("PAYROLL_ADVANCE_SUBMITTED");
    expect(find(PAYROLL_EVENT_ADVANCE_APPROVED).eventCode).toBe("PAYROLL_ADVANCE_APPROVED");
    expect(find(PAYROLL_EVENT_ADVANCE_REJECTED).eventCode).toBe("PAYROLL_ADVANCE_REJECTED");
    expect(find(PAYROLL_EVENT_PAYMENT_BATCH_COMPLETED).eventCode).toBe(
      "PAYROLL_PAYMENT_BATCH_COMPLETED",
    );
  });

  // ── 027 — trọng tâm NOTI-027 ─────────────────────────────────────────────────────────────────────
  describe("027 PAYROLL_PAYMENT_BATCH_COMPLETED — khoá dedupe ĐÚNG periodId (BY DESIGN)", () => {
    const dedupeKeyOf = find(PAYROLL_EVENT_PAYMENT_BATCH_COMPLETED).dedupeKeyOf!;

    it("khoá == periodId (không lẫn batchId dù payload MANG batchId)", () => {
      const key = dedupeKeyOf(
        ctxOf({ periodId: "period-1", batchId: "batch-A", recipientUserIds: ["u1"] }),
      );
      expect(key).toBe("period-1");
    });

    it("HAI batchId KHÁC nhau của CÙNG một kỳ ⇒ CÙNG một khoá (once-ever mỗi KỲ, không phải mỗi ĐỢT)", () => {
      const keyBatchA = dedupeKeyOf(ctxOf({ periodId: "period-1", batchId: "batch-A" }));
      const keyBatchB = dedupeKeyOf(ctxOf({ periodId: "period-1", batchId: "batch-B" }));
      expect(keyBatchA).toBe(keyBatchB);
      expect(keyBatchA).toBe("period-1");
    });

    it("HAI kỳ KHÁC nhau ⇒ khoá KHÁC nhau", () => {
      const keyPeriod1 = dedupeKeyOf(ctxOf({ periodId: "period-1", batchId: "batch-A" }));
      const keyPeriod2 = dedupeKeyOf(ctxOf({ periodId: "period-2", batchId: "batch-A" }));
      expect(keyPeriod1).not.toBe(keyPeriod2);
    });

    it("thiếu periodId ⇒ NÉM (requireField, không âm thầm rơi về undefined/ctx.eventId)", () => {
      expect(() => dedupeKeyOf(ctxOf({ batchId: "batch-A" }))).toThrow(
        /thiếu khoá bắt buộc 'periodId'/,
      );
    });
  });

  // ── 7 mapping còn lại — pin CHÍNH XÁC cấu trúc khoá của TỪNG mapping ────────────────────────────
  describe("khoá dedupe của 7 mapping còn lại — cấu trúc CHÍNH XÁC", () => {
    it.each([
      [PAYROLL_EVENT_PERIOD_SUBMITTED, "periodId", "submittedAtIso"],
      [PAYROLL_EVENT_PERIOD_APPROVED, "periodId", "approvedAtIso"],
      [PAYROLL_EVENT_PERIOD_REJECTED, "periodId", "updatedAtIso"],
      [PAYROLL_EVENT_ADVANCE_SUBMITTED, "advanceId", "createdAtIso"],
      [PAYROLL_EVENT_ADVANCE_APPROVED, "advanceId", "decidedAtIso"],
      [PAYROLL_EVENT_ADVANCE_REJECTED, "advanceId", "decidedAtIso"],
    ])("%s — khoá == `${%s}:${%s}`", (eventType, idField, timeField) => {
      const dedupeKeyOf = find(eventType).dedupeKeyOf!;
      const key = dedupeKeyOf(
        ctxOf({ [idField]: "id-1", [timeField]: "2026-09-17T00:00:00.000Z" }),
      );
      expect(key).toBe("id-1:2026-09-17T00:00:00.000Z");

      // Cùng id, mốc thời gian KHÁC nhau (gửi lại sau reject→submit) ⇒ khoá KHÁC — "mỗi LẦN gửi là một sự kiện".
      const key2 = dedupeKeyOf(
        ctxOf({ [idField]: "id-1", [timeField]: "2026-09-18T00:00:00.000Z" }),
      );
      expect(key2).not.toBe(key);

      // Thiếu trường thời gian ⇒ NÉM.
      expect(() => dedupeKeyOf(ctxOf({ [idField]: "id-1" }))).toThrow();
    });

    it("023 PAYSLIP_PUBLISHED — khoá == payslipId ĐƠN (once-ever, không có vế thời gian)", () => {
      const dedupeKeyOf = find(PAYROLL_EVENT_PAYSLIP_PUBLISHED).dedupeKeyOf!;
      expect(dedupeKeyOf(ctxOf({ payslipId: "slip-1" }))).toBe("slip-1");
      expect(() => dedupeKeyOf(ctxOf({}))).toThrow(/payslipId/);
    });
  });
});

// ── Mutation-red — KHÔNG commit đột biến (rule WO: không sửa `src/**` ngoài spec) ────────────────
//
// Nguồn thật (`payroll-noti-bridge.registrar.ts`, `registerPaymentBatchCompleted`):
//   dedupeKeyOf: (ctx) => requireField(ctx.payload, "periodId")
// — không đọc `batchId` ở đâu cả. Ca "HAI batchId KHÁC nhau của CÙNG một kỳ ⇒ CÙNG một khoá" ở trên đã
// CHẠY THẬT qua registrar thật (không mock `dedupeKeyOf`), nên nếu ai đổi khoá 027 sang dạng
// `${periodId}:${batchId}` (hoặc chỉ `batchId`), đúng ca đó quay đầu ĐỎ ngay: `keyBatchA` (khoá của
// batch-A) sẽ khác `keyBatchB` (khoá của batch-B) thay vì bằng nhau, và cả hai sẽ khác chuỗi kỳ vọng
// `"period-1"`. Đây là bằng chứng suy luận trên code đã đọc, không phải một khối test riêng thêm vào
// (thêm một `it` chỉ để "chứng minh bằng đọc code" mà không có assertion mới là test giả — CLAUDE.md §6).
