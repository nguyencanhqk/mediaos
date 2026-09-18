import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import type { TenantTx } from "../db/db.service";
import { PayrollPayslipsRepository } from "./payroll-payslips.repository";

/**
 * S15-PAYROLL-QA-1 (P2) — bộ lọc Own của phiếu lương (031 · 032 · 084) FAIL-CLOSED ở tầng repository.
 *
 * Khuôn cũ `opts.ownerUserId ? <lọc chủ + kỳ đã phát hành> : sql\`\`` là truthy-guard: `""`/`undefined` (JWT thiếu
 * `sub`) làm vế lọc BIẾN MẤT ⇒ route Own thành đọc phiếu TOÀN CÔNG TY (có tiền), kể cả phiếu kỳ chưa phát hành. Đúng
 * lớp lỗi BE-4B đã vá cho tạm ứng 065 (`payroll-advances.repository.spec.ts`). Hiện `resolveActor` chặn trước ở
 * service — vá này là phòng thủ chiều sâu để một caller mới (job/bridge) không mở lại lỗ.
 *
 * Hợp đồng mới: `ownerUserId` BẮT BUỘC khai (`string | null`). `null` = đường quản trị (029/030/083, KHÔNG lọc chủ);
 * mọi giá trị khác `null` là ý định Own ⇒ phải là chuỗi khác rỗng, nếu không NÉM trước khi chạm `tx`.
 */
const COMPANY = "22222222-2222-4222-8222-222222222222";
const OWNER = "33333333-3333-4333-8333-333333333333";
const PAYSLIP = "44444444-4444-4444-8444-444444444444";
const dialect = new PgDialect();

function txSpy() {
  const execute = vi.fn(async (_q: SQL) => ({ rows: [] }));
  return { tx: { execute } as unknown as TenantTx, execute };
}
const renderedSql = (execute: ReturnType<typeof txSpy>["execute"]): string =>
  dialect.sqlToQuery(execute.mock.calls[0][0]).sql.replace(/\s+/g, " ");

const BAD_OWNERS: ReadonlyArray<[unknown, string]> = [
  ["", "rỗng"],
  ["   ", "toàn khoảng trắng"],
  [undefined, "undefined (JWT thiếu sub)"],
];

describe("S15-PAYROLL-QA-1 · phiếu lương Own fail-closed — ownerUserId khác null phải là chuỗi khác rỗng", () => {
  const repo = new PayrollPayslipsRepository();

  it.each(BAD_OWNERS)(
    "listTx/countTx/findTx với ownerUserId %j (%s) ⇒ NÉM, không chạm tx",
    async (owner) => {
      const { tx, execute } = txSpy();
      const ownerUserId = owner as string;
      await expect(repo.listTx(tx, COMPANY, { ownerUserId }, 10, 0)).rejects.toThrow(/ownerUserId/);
      await expect(repo.countTx(tx, COMPANY, { ownerUserId })).rejects.toThrow(/ownerUserId/);
      await expect(repo.findTx(tx, COMPANY, PAYSLIP, ownerUserId)).rejects.toThrow(/ownerUserId/);
      expect(execute).not.toHaveBeenCalled();
    },
  );

  it("ALLOW đối chứng Own: owner hợp lệ ⇒ câu SQL CÓ vế lọc chủ + kỳ đã phát hành", async () => {
    const { tx, execute } = txSpy();
    await repo.findTx(tx, COMPANY, PAYSLIP, OWNER);
    expect(execute).toHaveBeenCalledTimes(1);
    const q = renderedSql(execute);
    expect(q).toContain("and ps.user_id = $");
    expect(q).toContain("and pp.status = any(");
  });

  it("ALLOW đối chứng quản trị: `null` tường minh ⇒ chạy, KHÔNG có vế lọc chủ", async () => {
    const { tx, execute } = txSpy();
    await repo.listTx(tx, COMPANY, { ownerUserId: null }, 10, 0);
    expect(execute).toHaveBeenCalledTimes(1);
    const q = renderedSql(execute);
    expect(q).not.toContain("ps.user_id = $");
    expect(q).not.toContain("pp.status = any(");
  });

  it.each(["", "  ", undefined])(
    "findTx với payslipId %j ⇒ NÉM (không thành «phiếu bất kỳ, limit 1»), không chạm tx",
    async (id) => {
      const { tx, execute } = txSpy();
      await expect(repo.findTx(tx, COMPANY, id as string, null)).rejects.toThrow(/payslipId/);
      expect(execute).not.toHaveBeenCalled();
    },
  );

  it("ALLOW đối chứng findTx quản trị: id hợp lệ ⇒ câu SQL CÓ vế `ps.id`", async () => {
    const { tx, execute } = txSpy();
    await repo.findTx(tx, COMPANY, PAYSLIP, null);
    expect(renderedSql(execute)).toContain("and ps.id = $");
  });
});
