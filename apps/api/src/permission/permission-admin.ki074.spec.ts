/**
 * S10-SEC-ROLEMEMBERDEL-1 (KI-074) — RED-before-GREEN cho hướng (b) trên `revokeRole`.
 *
 * CHỦ TRƯƠNG ĐÃ KÝ 2026-08-24 (`docs/DECISIONS/DECISIONS-10_Role_Membership_Absence_Signal.md`):
 * `DELETE /permissions/users/:userId/roles/:roleId` GIỮ **404** cho actor có `view:user` ở scope
 * `Company`/`System`; **204** (im lặng, 0 ghi) cho phần còn lại. Đóng câu trả lời ÂM MIỄN PHÍ
 * ("x KHÔNG phải thành viên của role r" với 0 hàng forensic) — gương của KI-073 ở chiều `POST`.
 *
 * TẦNG NÀY ghim phần WIRING (mock được, không cần DB): nhánh nào chạy, cái gì KHÔNG được gọi, và
 * `resolveStrongestScope` được gọi ĐÚNG cách. Vế ENGINE (4 hình dạng wildcard, exact-thắng-wildcard,
 * `is_sensitive` của catalog) KHÔNG kiểm được ở đây vì resolver bị mock —
 * xem `test/integration/role-member-del-oracle.int-spec.ts` ca D-W1..W4 / D-S1.
 *
 * RED trước GREEN: trên code cũ, U2/U3/U4/U6 ném 404 thay vì resolve (nhánh 204 chưa tồn tại);
 * U5/U9 đỏ vì `hasCompanyWideDirectory`/`findAssignableRole` chưa được gọi ở `revokeRole`.
 */

import { NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DataScope } from "@mediaos/contracts";
import { PermissionAdminService } from "./permission-admin.service";

const COMPANY = "11111111-1111-1111-1111-111111111111";
const ACTOR = "22222222-2222-2222-2222-222222222222";
const TARGET = "33333333-3333-3333-3333-333333333333";
const ROLE = "44444444-4444-4444-4444-444444444444";
const UR_ACTIVE = "55555555-5555-5555-5555-555555555555";

type FakeTx = { __tx: true };
const FAKE_TX: FakeTx = { __tx: true };

/** Hàng `user_roles` active mà `findUserRole` trả về ở nhánh DƯƠNG. */
const ACTIVE_ROW = { id: UR_ACTIVE, roleId: ROLE, grantedBy: "granter", expiresAt: null };

function build(opts: { scope?: DataScope | null; roleAssignable?: boolean } = {}) {
  const repo = {
    findAssignableRole: vi
      .fn()
      .mockResolvedValue((opts.roleAssignable ?? true) ? { id: ROLE } : undefined),
    findUserInTenant: vi.fn().mockResolvedValue({ id: TARGET }),
    findUserRole: vi.fn().mockResolvedValue(undefined),
    insertUserRole: vi.fn(),
    deleteUserRole: vi.fn().mockResolvedValue(UR_ACTIVE),
    findUserIdsWithRole: vi.fn().mockResolvedValue([]),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const outbox = { enqueue: vi.fn().mockResolvedValue(undefined) };
  const securityEvents = { record: vi.fn().mockResolvedValue(undefined) };
  const permissionService = {
    can: vi.fn().mockResolvedValue({ allow: true, reason: "allow", auditRequired: false }),
    // `scope` mặc định `"Company"` = hình dạng PROD của người trực ca (đo 24/08: 0 vai hẹp hơn).
    resolveStrongestScope: vi
      .fn()
      .mockResolvedValue(opts.scope === undefined ? "Company" : opts.scope),
  };
  const db = {
    withTenant: vi.fn(async (_companyId: string, fn: (tx: FakeTx) => Promise<unknown>) =>
      fn(FAKE_TX),
    ),
  };
  const service = new PermissionAdminService(
    db as never,
    permissionService as never,
    audit as never,
    outbox as never,
    repo as never,
    securityEvents as never,
  );
  return { service, repo, audit, outbox, securityEvents, permissionService, db };
}

const actor = { id: ACTOR, companyId: COMPANY };

/** Không một đường GHI nào được chạm — ranh (3) của hướng (b): nhánh 204-ÂM là 0 ghi. */
function expectNoWrites(ctx: ReturnType<typeof build>) {
  expect(ctx.repo.deleteUserRole, "soft-delete").not.toHaveBeenCalled();
  expect(ctx.audit.record, "audit_logs").not.toHaveBeenCalled();
  expect(ctx.securityEvents.record, "user_security_events").not.toHaveBeenCalled();
  expect(ctx.outbox.enqueue, "outbox permission.changed").not.toHaveBeenCalled();
}

describe("PermissionAdminService.revokeRole — tín hiệu VẮNG MẶT theo hướng (b) (KI-074)", () => {
  describe("nhánh ÂM: user KHÔNG giữ role, role assignable trong tenant", () => {
    it("U1 — `view:user@Company` ⇒ GIỮ 404 (tín hiệu vận hành mà auth-users-api.ts:136 dựa vào)", async () => {
      const ctx = build({ scope: "Company" });
      await expect(ctx.service.revokeRole(actor, TARGET, ROLE)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expectNoWrites(ctx);
    });

    it("U8 — `view:user@System` ⇒ 404 (nhánh System KHÔNG bị bỏ quên)", async () => {
      const ctx = build({ scope: "System" });
      await expect(ctx.service.revokeRole(actor, TARGET, ROLE)).rejects.toMatchObject({
        status: 404,
      });
    });

    it("U2 — `view:user@Own` ⇒ 204 im lặng, và KHÔNG ghi gì (ranh 3)", async () => {
      const ctx = build({ scope: "Own" });
      await expect(ctx.service.revokeRole(actor, TARGET, ROLE)).resolves.toBeUndefined();
      expectNoWrites(ctx);
    });

    it("U3 — scope `null` ⇒ 204, KHÔNG 404 (ranh 1: null là 'KHÔNG có thẩm quyền', không phải Company)", async () => {
      const ctx = build({ scope: null });
      await expect(ctx.service.revokeRole(actor, TARGET, ROLE)).resolves.toBeUndefined();
      expectNoWrites(ctx);
    });

    // ⚠️ KHÔNG có "U4 — exact thắng wildcard" ở tầng này, CÓ CHỦ Ý. Bản đầu có, và nó là bản sao
    // TỪNG BYTE của U2 (`build({ scope: "Own" })` + cùng assert): resolver bị MOCK nên không có cách
    // nào để "*:*@Company + view:user@Own" khác với "view:user@Own" — hai lời gọi cùng builder cho ca
    // xanh-RỖNG ([[same-builder-twice-makes-unit-spec-vacuous]]). Mệnh đề đó chỉ chứng minh được
    // trên ENGINE thật: `role-member-del-oracle.int-spec.ts` ca **D-W4**.

    it("U6 — role KHÔNG assignable trong tenant này ⇒ 404 kể cả actor hẹp (ranh 2, BẤT BIẾN #1)", async () => {
      const ctx = build({ scope: "Own", roleAssignable: false });
      await expect(ctx.service.revokeRole(actor, TARGET, ROLE)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expectNoWrites(ctx);
    });
  });

  describe("cách gọi resolver — D5, dòng dễ copy sai nhất", () => {
    it("U5 — `resolveStrongestScope` gọi ĐÚNG 1 lần với ĐÚNG 4 đối số (KHÔNG `opts`)", async () => {
      const ctx = build({ scope: "Company" });
      await expect(ctx.service.revokeRole(actor, TARGET, ROLE)).rejects.toMatchObject({
        status: 404,
      });

      const spy = ctx.permissionService.resolveStrongestScope;
      expect(spy).toHaveBeenCalledTimes(1);
      // ⚠️ Ba assert, không phải một. `toHaveBeenCalledWith(..., "user", undefined)` là ca CHẾT: nó
      // pass cả khi ai đó truyền `opts` rồi lại xoá. Độ dài mảng đối số mới ghim được "KHÔNG opts".
      // Vì sao quan trọng: `{ isSensitive: true }` ép nhánh exact-only ⇒ mọi vai chỉ giữ `*:*` tụt
      // `null` ⇒ 204 ⇒ MẤT tín hiệu 404 trong im lặng (đúng hồi quy mà hướng (a) bị loại vì gây ra).
      expect(spy.mock.calls[0]).toHaveLength(4);
      expect(spy).toHaveBeenCalledWith(ACTOR, COMPANY, "view", "user");
    });
  });

  describe("nhánh DƯƠNG: user ĐANG giữ role — chặn mọi ca trên khỏi xanh-RỖNG", () => {
    it("U7 — actor hẹp (`@Own`) vẫn GỠ THẬT: soft-delete + RoleRevoked + ROLE_REMOVED + emit", async () => {
      const ctx = build({ scope: "Own" });
      ctx.repo.findUserRole.mockResolvedValue(ACTIVE_ROW);

      await expect(ctx.service.revokeRole(actor, TARGET, ROLE)).resolves.toBeUndefined();

      expect(ctx.repo.deleteUserRole).toHaveBeenCalledWith(FAKE_TX, COMPANY, TARGET, ROLE, ACTOR);
      expect(ctx.audit.record).toHaveBeenCalledWith(
        FAKE_TX,
        expect.objectContaining({ action: "RoleRevoked", objectId: UR_ACTIVE }),
      );
      expect(ctx.securityEvents.record).toHaveBeenCalledWith(
        FAKE_TX,
        expect.objectContaining({ eventType: "ROLE_REMOVED", userId: TARGET }),
      );
      expect(ctx.outbox.enqueue).toHaveBeenCalledWith(
        FAKE_TX,
        expect.objectContaining({ eventType: "permission.changed" }),
      );
    });

    it("U9 — role đã SOFT-DELETE vẫn gỡ được vai: `findAssignableRole` KHÔNG được gọi ở nhánh dương", async () => {
      // Vị trí của `findAssignableRole` là BẮT BUỘC, không phải phong cách. Nó lọc
      // `deleted_at IS NULL` + `notOperatorRole()`; nâng nó lên đầu hàm cho "gọn" sẽ KHOÁ VĨNH VIỄN
      // việc gỡ vai của một role vừa bị soft-delete ⇒ user giữ quyền tồn đọng mà không ai gỡ được.
      // Hôm nay gỡ được, và ca này là thứ DUY NHẤT giữ cho nó gỡ được.
      const ctx = build({ scope: "Own", roleAssignable: false });
      ctx.repo.findUserRole.mockResolvedValue(ACTIVE_ROW);

      await expect(ctx.service.revokeRole(actor, TARGET, ROLE)).resolves.toBeUndefined();

      expect(ctx.repo.deleteUserRole).toHaveBeenCalledTimes(1);
      expect(ctx.repo.findAssignableRole).not.toHaveBeenCalled();
    });
  });
});
