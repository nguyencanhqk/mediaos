import "reflect-metadata";
import { describe, expect, it, vi } from "vitest";
import { FilePolicyAction, type FilePermissionInput } from "../files/file-policy.types";
import { BRANDING_RULES } from "./branding.constants";
import { CompanyBrandingFileResolver } from "./company-branding-file.resolver";

/**
 * S5-BRAND-BE-1 (security-review BLOCK #1) — CompanyBrandingFileResolver UNIT.
 *
 * Resolver này là TẦNG PHÂN QUYỀN của mọi file branding: thiếu nó thì `FilePolicyService` fail-closed
 * `deny-no-resolver` (tính năng chết); sai nó thì file nhạy cảm trong tenant bị ký cho mọi người đọc.
 * Vì vậy test ở đây soi ĐÚNG 3 chốt:
 *   1. cặp quyền dùng đúng (view cho đọc · update cho ghi) — KHÔNG tự chế cặp mới;
 *   2. `entityId` PHẢI là chính companyId (không cho mượn kênh branding trỏ entity khác);
 *   3. LINK/DELETE đòi THÊM owner-check file — chốt chặn holder `link:foundation-file` gắn file người khác.
 */

const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const FILE_ID = "33333333-3333-4333-8333-333333333333";

function makeResolver(opts: { allow?: boolean; fileOwner?: string | null } = {}) {
  const can = vi.fn(async () => ({ allow: opts.allow ?? true }));
  const findByIdTx = vi.fn(async () =>
    opts.fileOwner === null ? null : { id: FILE_ID, ownerUserId: opts.fileOwner ?? USER_ID },
  );
  const db = { withTenant: vi.fn((_c: string, fn: (tx: unknown) => unknown) => fn({})) };
  const resolver = new CompanyBrandingFileResolver(
    db as never,
    { can } as never,
    { findByIdTx } as never,
  );
  return { resolver, can, findByIdTx };
}

function input(over: Partial<FilePermissionInput> = {}): FilePermissionInput {
  return {
    companyId: COMPANY_ID,
    userId: USER_ID,
    fileId: FILE_ID,
    moduleCode: "FOUNDATION",
    entityType: BRANDING_RULES.logo.entityType,
    entityId: COMPANY_ID,
    action: FilePolicyAction.Download,
    ...over,
  };
}

describe("CompanyBrandingFileResolver — đăng ký đúng cặp dispatch", () => {
  it("moduleCode=FOUNDATION và phủ CẢ entityType logo lẫn favicon", () => {
    const { resolver } = makeResolver();
    expect(resolver.moduleCode).toBe("FOUNDATION");
    expect(resolver.entityTypes).toEqual(
      expect.arrayContaining([BRANDING_RULES.logo.entityType, BRANDING_RULES.favicon.entityType]),
    );
  });
});

describe("CompanyBrandingFileResolver — READ ⇐ view:foundation-company", () => {
  it.each([
    ["canViewFile" as const],
    ["canDownloadFile" as const],
  ])("%s dùng ĐÚNG cặp view:foundation-company", async (method) => {
    const { resolver, can } = makeResolver();
    await expect(resolver[method](input())).resolves.toBe(true);
    expect(can).toHaveBeenCalledWith(
      expect.objectContaining({ action: "view", resourceType: "foundation-company" }),
    );
  });

  it("thiếu quyền view → false (fail-closed)", async () => {
    const { resolver } = makeResolver({ allow: false });
    await expect(resolver.canDownloadFile(input())).resolves.toBe(false);
  });

  it("entityId KHÁC companyId → false, KHÔNG hỏi quyền (không cho mượn kênh branding)", async () => {
    const { resolver, can } = makeResolver();
    await expect(resolver.canDownloadFile(input({ entityId: "entity-lạ" }))).resolves.toBe(false);
    expect(can).not.toHaveBeenCalled();
  });
});

describe("CompanyBrandingFileResolver — WRITE ⇐ update:foundation-company + owner-check", () => {
  it("canLinkFile dùng cặp update và ĐÒI file do chính caller upload", async () => {
    const { resolver, can, findByIdTx } = makeResolver();
    await expect(resolver.canLinkFile(input({ action: FilePolicyAction.Link }))).resolves.toBe(true);
    expect(can).toHaveBeenCalledWith(
      expect.objectContaining({ action: "update", resourceType: "foundation-company" }),
    );
    expect(findByIdTx).toHaveBeenCalled();
  });

  it("có update nhưng file của NGƯỜI KHÁC → false (chặn holder link:foundation-file gắn file người khác)", async () => {
    const { resolver } = makeResolver({ fileOwner: "kẻ-khác" });
    await expect(resolver.canLinkFile(input({ action: FilePolicyAction.Link }))).resolves.toBe(
      false,
    );
  });

  it("file không tồn tại / cross-tenant 0-row → false", async () => {
    const { resolver } = makeResolver({ fileOwner: null });
    await expect(resolver.canLinkFile(input({ action: FilePolicyAction.Link }))).resolves.toBe(
      false,
    );
  });

  it("fileId vắng (pre-link check) → false (fail-closed, mirror ME avatar)", async () => {
    const { resolver } = makeResolver();
    await expect(
      resolver.canLinkFile(input({ action: FilePolicyAction.Link, fileId: undefined })),
    ).resolves.toBe(false);
  });

  it("thiếu quyền update → false kể cả khi sở hữu file", async () => {
    const { resolver, findByIdTx } = makeResolver({ allow: false });
    await expect(resolver.canLinkFile(input({ action: FilePolicyAction.Link }))).resolves.toBe(
      false,
    );
    // Deny ở tầng quyền chạy TRƯỚC, không tốn query file.
    expect(findByIdTx).not.toHaveBeenCalled();
  });

  it("canDeleteFile cũng đòi owner-check", async () => {
    const { resolver } = makeResolver({ fileOwner: "kẻ-khác" });
    await expect(resolver.canDeleteFile(input({ action: FilePolicyAction.Delete }))).resolves.toBe(
      false,
    );
  });

  it("canUnlinkFile KHÔNG đòi owner-check (gỡ logo cũ do admin trước upload vẫn hợp lệ)", async () => {
    const { resolver, findByIdTx } = makeResolver({ fileOwner: "admin-trước" });
    await expect(resolver.canUnlinkFile(input({ action: FilePolicyAction.Unlink }))).resolves.toBe(
      true,
    );
    expect(findByIdTx).not.toHaveBeenCalled();
  });
});
