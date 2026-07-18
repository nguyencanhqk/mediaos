import "reflect-metadata";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MeAvatarFileResolver } from "./me-avatar-file.resolver";
import { FilePolicyAction, type FilePermissionInput } from "../foundation/files/file-policy.types";

/**
 * S5-ME-BE-5 (security) — MeAvatarFileResolver.canLinkFile: gắn ME/avatar đòi CHỦ SỞ HỮU CẢ entity (employee
 * của mình) LẪN file (owner_user_id === caller). Đóng vector FORGE link: holder link:foundation-file
 * (company-admin) gắn file NGƯỜI KHÁC làm avatar employee mình. fileId vắng → deny (fail-closed).
 */

function makeResolver(over: { ownsEntity?: boolean; ownsFile?: boolean } = {}) {
  const isOwnEmployeeTx = vi.fn().mockResolvedValue(over.ownsEntity ?? true);
  const isFileOwnedByTx = vi.fn().mockResolvedValue(over.ownsFile ?? true);
  const db = { withTenant: vi.fn((_c: string, fn: (tx: unknown) => unknown) => fn({})) };
  const repo = { isOwnEmployeeTx, isFileOwnedByTx };
  const resolver = new MeAvatarFileResolver(db as never, repo as never);
  return { resolver, isOwnEmployeeTx, isFileOwnedByTx };
}

const INPUT: FilePermissionInput = {
  companyId: "c1",
  userId: "u1",
  fileId: "f1",
  moduleCode: "ME",
  entityType: "avatar",
  entityId: "e1",
  action: FilePolicyAction.Link,
};

beforeEach(() => vi.clearAllMocks());

describe("canLinkFile", () => {
  it("chủ CẢ entity + file → ALLOW", async () => {
    const { resolver } = makeResolver({ ownsEntity: true, ownsFile: true });
    expect(await resolver.canLinkFile(INPUT)).toBe(true);
  });

  it("chủ entity nhưng KHÔNG chủ file (FORGE) → DENY, không hỏi tiếp", async () => {
    const { resolver } = makeResolver({ ownsEntity: true, ownsFile: false });
    expect(await resolver.canLinkFile(INPUT)).toBe(false);
  });

  it("KHÔNG chủ entity → DENY TRƯỚC (không kiểm file)", async () => {
    const { resolver, isFileOwnedByTx } = makeResolver({ ownsEntity: false, ownsFile: true });
    expect(await resolver.canLinkFile(INPUT)).toBe(false);
    expect(isFileOwnedByTx).not.toHaveBeenCalled();
  });

  it("fileId vắng (pre-link) → DENY fail-closed, không chạm DB", async () => {
    const { resolver, isOwnEmployeeTx } = makeResolver();
    expect(await resolver.canLinkFile({ ...INPUT, fileId: undefined })).toBe(false);
    expect(isOwnEmployeeTx).not.toHaveBeenCalled();
  });
});
