import { PAYSLIP_PDF_BATCH_STALE_SEC } from "@mediaos/contracts";
import { describe, expect, it } from "vitest";
import {
  decideBatch,
  toBatchFailure,
  type BatchCandidate,
} from "./payroll-payslip-pdf-batch.decision";

const NOW = new Date("2026-09-17T10:00:00Z");
const FP = "fp-1";
const ago = (sec: number) => new Date(NOW.getTime() - sec * 1000);
const lot = (over: Partial<BatchCandidate> = {}): BatchCandidate => ({
  uploadStatus: "Pending",
  createdAt: ago(10),
  metadata: { fingerprint: FP, payslipCount: 3 },
  ...over,
});

describe("decideBatch — bảng lấy-hoặc-tạo của 085 (owner O-4)", () => {
  it.each([false, true])("không có lô ⇒ create (retry=%s)", (retry) => {
    expect(decideBatch(null, FP, retry, NOW)).toEqual({ kind: "create" });
  });

  it("vân tay khác (phiếu sinh lại/thêm) ⇒ create kể cả lô đã Uploaded", () => {
    expect(decideBatch(lot({ uploadStatus: "Uploaded" }), "fp-2", false, NOW)).toEqual({
      kind: "create",
    });
  });

  it("thiếu vân tay trong metadata ⇒ create (không coi là khớp)", () => {
    expect(decideBatch(lot({ metadata: {} }), FP, false, NOW)).toEqual({ kind: "create" });
  });

  it.each([false, true])("Uploaded ⇒ uploaded (retry=%s không sinh lại lô tốt)", (retry) => {
    expect(decideBatch(lot({ uploadStatus: "Uploaded" }), FP, retry, NOW)).toEqual({
      kind: "uploaded",
    });
  });

  it("Pending đúng mốc STALE ⇒ vẫn pending (biên ≤)", () => {
    const at = lot({ createdAt: ago(PAYSLIP_PDF_BATCH_STALE_SEC) });
    expect(decideBatch(at, FP, true, NOW)).toEqual({ kind: "pending" });
  });

  it("Pending quá STALE ⇒ failed stale; retry ⇒ create", () => {
    const old = lot({ createdAt: ago(PAYSLIP_PDF_BATCH_STALE_SEC + 1) });
    expect(decideBatch(old, FP, false, NOW)).toEqual({ kind: "failed", failure: "stale" });
    expect(decideBatch(old, FP, true, NOW)).toEqual({ kind: "create" });
  });

  it("Failed ⇒ failed với lý do đã lưu; retry ⇒ create", () => {
    const failed = lot({
      uploadStatus: "Failed",
      metadata: { fingerprint: FP, failure: "forbidden" },
    });
    expect(decideBatch(failed, FP, false, NOW)).toEqual({ kind: "failed", failure: "forbidden" });
    expect(decideBatch(failed, FP, true, NOW)).toEqual({ kind: "create" });
  });

  it("trạng thái lạ ⇒ create", () => {
    expect(decideBatch(lot({ uploadStatus: "Deleted" }), FP, false, NOW)).toEqual({
      kind: "create",
    });
  });
});

describe("toBatchFailure — danh sách đóng, không lộ chuỗi nội bộ", () => {
  it.each(["generation-failed", "forbidden", "timeout", "stale"])("%s giữ nguyên", (v) => {
    expect(toBatchFailure(v)).toBe(v);
  });

  it.each([undefined, null, 42, "confirmFailure: ENOENT /tmp/x", ""])(
    "%j ⇒ generation-failed",
    (v) => {
      expect(toBatchFailure(v)).toBe("generation-failed");
    },
  );
});
