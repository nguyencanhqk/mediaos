import { describe, expect, it } from "vitest";
import { Column, SQL } from "drizzle-orm";
import { AuthUsersRepository } from "./auth-users.repository";
import { userRoles } from "../db/schema";

/**
 * S2-AUTH-DB-3 Lane C — RED-first (kiểm chứng CẤU TRÚC WHERE, không cần Postgres). `getTwoFactorStateTx`
 * (nguồn requiredByRole cho GET /auth/users/:id) đọc user_roles ⋈ roles; PHẢI lọc
 * `isNull(userRoles.deletedAt)` để assignment đã soft-delete KHÔNG còn ép 2FA. Duyệt `queryChunks` đệ quy
 * tìm Column `deleted_at` THUỘC ĐÚNG bảng — phân biệt userRoles.deleted_at với roles.deleted_at (reader CŨ
 * chỉ lọc roles ⇒ RED; sau fix lọc CẢ HAI ⇒ GREEN).
 */
function whereFiltersSoftDelete(where: unknown, table: unknown): boolean {
  let found = false;
  const walk = (node: unknown): void => {
    if (node instanceof Column) {
      if (node.table === table && node.name === "deleted_at") found = true;
      return;
    }
    if (node instanceof SQL) {
      for (const chunk of node.queryChunks) walk(chunk);
      return;
    }
    if (Array.isArray(node)) for (const item of node) walk(item);
  };
  walk(where);
  return found;
}

/**
 * tx giả: getTwoFactorStateTx chạy 2 SELECT — (1) from(userTotp).where().limit() (2)
 * from(userRoles).innerJoin(roles).where().limit(). Bắt WHERE của nhánh userRoles để assert lọc soft-delete.
 * Cả hai trả [] ⇒ enabled=false, requiredByRole=false (không load-bearing cho assert cấu trúc).
 */
function makeTx() {
  const captures: { userRolesWhere?: unknown } = {};
  const tx = {
    select: (_cols?: unknown) => ({
      from: (table: unknown) => {
        const whereChain = {
          where: (cond?: unknown) => {
            if (table === userRoles) captures.userRolesWhere = cond;
            return { limit: () => Promise.resolve([] as unknown[]) };
          },
        };
        return { ...whereChain, innerJoin: () => whereChain };
      },
    }),
  };
  return { tx, captures };
}

describe("AuthUsersRepository.getTwoFactorStateTx — lọc soft-delete user_roles (S2-AUTH-DB-3 Lane C)", () => {
  it("WHERE nhánh requiredByRole có isNull(userRoles.deletedAt) — RED nếu chỉ lọc roles.deletedAt", async () => {
    const { tx, captures } = makeTx();
    const repo = new AuthUsersRepository();
    const state = await repo.getTwoFactorStateTx(
      tx as never,
      "33333333-3333-3333-3333-333333333333",
    );
    expect(state.requiredByRole).toBe(false);
    expect(captures.userRolesWhere).toBeDefined();
    expect(whereFiltersSoftDelete(captures.userRolesWhere, userRoles)).toBe(true);
  });
});
