import { describe, expect, it, vi } from "vitest";
import { allowedLinkerCtx, assertRecheckOk, decidePointerFile } from "./file-pointer-guard";

const ctx = { live: [], everLinked: false };

describe("allowedLinkerCtx — từ chối mặc định", () => {
  it("allow ⇒ trả ảnh chụp", () => {
    expect(allowedLinkerCtx({ kind: "allow", row: {}, ctx } as never)).toBe(ctx);
  });
  it.each([
    [{ kind: "missing" }],
    [{ kind: "forbidden", reason: "deny", action: "Read" }],
    [{ kind: "unlinkable", row: { scanStatus: "Infected" } }],
    [{ kind: "la" }],
  ])("%j ⇒ ném", (outcome) => {
    expect(() => allowedLinkerCtx(outcome as never)).toThrow();
  });
});

describe("assertRecheckOk", () => {
  it("ok ⇒ qua", () => {
    expect(() => assertRecheckOk({ kind: "ok", row: {} } as never)).not.toThrow();
  });
  it.each([[{ kind: "missing" }], [{ kind: "unlinkable", row: {} }], [{ kind: "la" }]])(
    "%j ⇒ ném",
    (outcome) => {
      expect(() => assertRecheckOk(outcome as never)).toThrow();
    },
  );
});

describe("decidePointerFile", () => {
  it("chuyển đúng đích cho quyết định và trả ảnh chụp khi allow", async () => {
    const files = { preflightLinkerView: vi.fn().mockResolvedValue({ kind: "allow", row: {}, ctx }) };
    const target = { moduleCode: "ATT", entityType: "x" };
    await expect(decidePointerFile(files, { id: "u", companyId: "c" }, "f", target)).resolves.toBe(ctx);
    expect(files.preflightLinkerView).toHaveBeenCalledWith({ id: "u", companyId: "c" }, "f", target);
  });
});
