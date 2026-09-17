import { describe, expect, it } from "vitest";
import { FilePolicyService } from "../foundation/files/file-policy.service";
import type { FilePermissionInput } from "../foundation/files/file-policy.types";
import type { PermissionService } from "../permission/permission.service";
import { PayrollExportFileResolver } from "./payroll-export-file.resolver";

const input = {
  userId: "u1",
  companyId: "c1",
  fileId: "f1",
  moduleCode: "PAYROLL",
  entityType: "payslip-pdf",
  entityId: "e1",
} as unknown as FilePermissionInput;

describe("PayrollExportFileResolver — từ chối MỌI thao tác trên route file chung", () => {
  const resolver = new PayrollExportFileResolver();

  it("moduleCode PAYROLL, đúng 2 entity (PDF lẻ + ZIP)", () => {
    expect(resolver.moduleCode).toBe("PAYROLL");
    expect([...resolver.entityTypes]).toEqual(["payslip-pdf", "payslip-pdf-batch"]);
  });

  it.each([
    "canViewFile",
    "canDownloadFile",
    "canLinkFile",
    "canUnlinkFile",
    "canDeleteFile",
  ] as const)("%s ⇒ false", async (method) => {
    await expect(resolver[method](input)).resolves.toBe(false);
  });

  it("đăng ký vào FilePolicyService được đúng một lần (lần hai NÉM — không ghi đè im lặng)", () => {
    const policy = new FilePolicyService({} as PermissionService);
    policy.registerResolver(resolver);
    expect(() => policy.registerResolver(new PayrollExportFileResolver())).toThrow(/duplicate/);
  });
});
