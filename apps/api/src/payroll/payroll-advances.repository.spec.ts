import { describe, expect, it, vi } from "vitest";

import type { TenantTx } from "../db/db.service";
import { PayrollAdvancesRepository } from "./payroll-advances.repository";

/**
 * S15-PAYROLL-BE-4B (plan BE-4 §11b, security L4) — Own 065 «Tạm ứng của tôi» FAIL-CLOSED ở tầng repository.
 * Khuôn cũ `if (f.userId) conds.push(eq(user_id, f.userId))` là truthy-guard: `userId` rỗng/undefined ⇒ vế lọc BIẾN MẤT
 * ⇒ danh sách TOÀN CÔNG TY (có `amount`) trả cho nhân viên. Đường Own giờ có hàm riêng `listOwnTx`/`countOwnTx` với
 * `ownerUserId` bắt buộc — rỗng ⇒ NÉM trước khi chạm `tx` (không có nhánh «rơi về không lọc»).
 */
const COMPANY = "22222222-2222-4222-8222-222222222222";
const txSpy = () => {
  const select = vi.fn();
  return { tx: { select, execute: vi.fn() } as unknown as TenantTx, select };
};

describe("S15-PAYROLL-BE-4B · Own 065 fail-closed — ownerUserId bắt buộc, KHÔNG truthy-guard", () => {
  it.each([
    ["", "rỗng"],
    [undefined as unknown as string, "undefined"],
    ["   ", "toàn khoảng trắng"],
  ])(
    "listOwnTx/countOwnTx với ownerUserId %j (%s) ⇒ NÉM TRƯỚC khi chạm tx (không rơi về danh sách toàn công ty)",
    async (owner) => {
      const repo = new PayrollAdvancesRepository();
      const { tx, select } = txSpy();
      await expect(repo.listOwnTx(tx, COMPANY, { ownerUserId: owner }, 10, 0)).rejects.toThrow(
        /ownerUserId/,
      );
      await expect(repo.countOwnTx(tx, COMPANY, { ownerUserId: owner })).rejects.toThrow(
        /ownerUserId/,
      );
      expect(select).not.toHaveBeenCalled();
    },
  );
});
