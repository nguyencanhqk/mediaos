import { ForbiddenException } from "@nestjs/common";
import { getTableName, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import { users } from "../db/schema";
import type { DatabaseService } from "../db/db.service";
import type { AuditService } from "../events/audit.service";
import type { PermissionService } from "./permission.service";
import type { DataScopeService } from "./data-scope.service";
import type { RoleAdminRepository } from "./role-admin.repository";
import { basisOf, type IdentityGrant } from "./identity-projection";
import { RoleAdminService } from "./role-admin.service";

/**
 * S10-SEC-ROLEMEMBERROW-1 (KI-071) — tầng KHÔNG-CẦN-POSTGRES của bản vá bound HÀNG cho
 * `GET /auth/roles/:id/members`.
 *
 * VÌ SAO file này tồn tại tách khỏi int-spec: bằng chứng deny/allow thật sống ở
 * `test/integration/identity-projection-scope.int-spec.ts`, nhưng file đó `describe.skipIf(!hasLaneDb)`
 * ⇒ trên máy/CI không có Postgres nó **bị SKIP, không FAIL**. Hai đột biến nguy hiểm nhất của WO này
 * lại KHÔNG cần DB để bắt:
 *   • **M-B** — `idCol: users.id` → `users.companyId`. `rowScopeSql` **không** bắt được (nó chỉ assert
 *     TÊN BẢNG, mà hai cột CÙNG thuộc `users`) ⇒ vị từ `Own` thành `company_id = <uuid người dùng>`:
 *     0 hàng, HTTP 200, im lặng.
 *   • **M-Q** — `ctx.userId` nhận nhầm `actor.companyId`. Cả hai đều `uuid` ⇒ TypeScript im.
 *
 * ⚠️ KHUÔN CỦA KI-072 KHÔNG BÊ NGUYÊN ĐƯỢC SANG ĐÂY (plan §3.3, ⟲R2). `audit.service.ts` gọi
 * `buildUserScopeConditionOn` **một lần**; route này gọi **HAI lần với tham số giống hệt** — một cho
 * tầng HÀNG (`rowScopeFor`), một cho tầng CỘT (`identity-gated`, KI-053). Hệ quả: capture kiểu ghi-đè
 * (`captured.target = target`) chỉ giữ lời gọi THỨ HAI, và `toHaveBeenCalledWith` xanh nếu **BẤT KỲ**
 * lời gọi nào khớp ⇒ một đột biến chỉ sửa cột ở tầng HÀNG vẫn **XANH**. Vì thế các ca dưới đây:
 *   1. thu **MỌI** lời gọi rồi assert trên TẤT CẢ (không phải trên lời gọi cuối);
 *   2. cho mock trả **SQL sentinel KHÁC NHAU mỗi lời gọi**, rồi assert `grants.rowScope.cond` **chính
 *      là** giá trị trả về của lời gọi mang `idCol === users.id` — mệnh đề này sống sót refactor;
 *   3. giữ bộ đếm `2` làm lớp phụ (xem U1b), vì mệnh đề "mọi lời gọi đều đúng cột" được thoả **rỗng**
 *      nếu tầng HÀNG bỏ hẳn lattice mà tự viết `eq(users.id, actor.id)`.
 */

const ACTOR = {
  id: "11111111-1111-4111-8111-111111111111",
  companyId: "22222222-2222-4222-8222-222222222222",
};
const ROLE_ID = "33333333-3333-4333-8333-333333333333";

type Call = {
  scope: unknown;
  ctx: { userId: string; companyId: string };
  target: { idCol: PgColumn; companyIdCol: PgColumn };
  returned: SQL;
};

function makeService(scopeValue: "Own" | "Company" | null) {
  const calls: Call[] = [];
  const dataScope = {
    resolveOrNull: vi.fn(async () => scopeValue),
    buildUserScopeConditionOn: vi.fn(
      (
        scope: unknown,
        ctx: { userId: string; companyId: string },
        target: { idCol: PgColumn; companyIdCol: PgColumn },
      ): SQL => {
        // Sentinel KHÁC NHAU mỗi lời gọi ⇒ phân biệt được vị từ của tầng HÀNG với tầng CỘT. Một
        // `sql\`true\`` dùng chung làm hai tầng không phân biệt được và ca (2) mất hiệu lực.
        const returned = sql.raw(`MINT_${calls.length}`);
        calls.push({ scope, ctx, target, returned });
        return returned;
      },
    ),
  } as unknown as DataScopeService;

  const repo = {
    findRoleByIdTx: vi.fn(async () => ({ id: ROLE_ID })),
    listRoleMembersTx: vi.fn(async () => []),
  } as unknown as RoleAdminRepository;

  const db = {
    withTenant: vi.fn(async (_companyId: string, fn: (tx: unknown) => Promise<unknown>) => fn({})),
  } as unknown as DatabaseService;

  const permissionService = {
    can: vi.fn(async () => ({ allow: true })),
  } as unknown as PermissionService;

  const svc = new RoleAdminService(
    db,
    permissionService,
    {} as unknown as AuditService,
    repo,
    dataScope,
  );
  return { svc, repo, dataScope, permissionService, calls };
}

/** Grant tầng HÀNG mà service đã truyền xuống repo. Đọc TRƯỚC mọi restore (`mockrestore-wipes-mock-calls`). */
function grantsPassedToRepo(repo: RoleAdminRepository): {
  rowScope: IdentityGrant;
  identity: IdentityGrant;
} {
  const call = vi.mocked(repo.listRoleMembersTx).mock.calls[0];
  expect(call, "listRoleMembersTx chưa được gọi — ca dưới sẽ xanh-RỖNG").toBeDefined();
  return call![3];
}

describe("KI-071 · U1 — vị từ HÀNG dựng trên CỘT NGƯỜI (`users.id`), không phải cột tenant", () => {
  it("MỌI lời gọi `buildUserScopeConditionOn` mang đúng cặp cột + đúng scope — bắt M-B và M-S", async () => {
    const expectedScope = "Own";
    const { svc, calls } = makeService(expectedScope);
    await svc.listMembers(ACTOR, ROLE_ID);

    expect(calls.length, "không lời gọi nào ⇒ mọi assert dưới đây rỗng nghĩa").toBeGreaterThan(0);
    for (const [i, c] of calls.entries()) {
      // So bằng CHÍNH object cột (neo ĐỊNH NGHĨA, không neo tên — `index-ratchet-must-pin-definition-not-name`).
      // `toEqual` ở đây vừa đắt vừa mong manh: cột drizzle có tham chiếu vòng `col.table → columns`.
      // ⟲ FULL gate (security-reviewer 2026-08-22) — assert CẢ `scope`. Thiếu dòng này thì đột biến
      // **M-S** (`this.rowScopeFor("Company", actor)` — VỨT scope vừa phân giải, hard-code hằng) cho
      // **7/7 XANH** trong khi vai `@Own` lặng lẽ đọc TRỌN tenant: U1/U2 chỉ soi cột và ctx; U1b đếm
      // đúng 2; U1c truy vết `rowScope.cond` nhưng CẢ HAI lời gọi đều mang `idCol === users.id` nên
      // vẫn khớp; U4 chỉ so basis/table. Đây là đột biến RẺ NHẤT của cả bản vá, và trước dòng này nó
      // chỉ bị bắt bởi int-spec — tức bởi đúng tầng mà file này tồn tại để dự phòng.
      expect(c.scope, `lời gọi #${i}: KHÔNG dùng scope vừa phân giải (M-S)`).toBe(expectedScope);
      expect(c.target.idCol, `lời gọi #${i} dùng sai cột NGƯỜI`).toBe(users.id);
      expect(c.target.companyIdCol, `lời gọi #${i} dùng sai cột TENANT`).toBe(users.companyId);
      expect(getTableName(c.target.idCol.table)).toBe("users");
    }
  });

  it("U1b — ĐÚNG 2 lời gọi (tầng HÀNG + tầng CỘT): bắt ca tầng HÀNG bỏ hẳn lattice", async () => {
    // Mệnh đề "mọi lời gọi đều đúng cột" được thoả RỖNG bởi riêng lời gọi tầng CỘT nếu tầng HÀNG tự
    // viết `eq(users.id, actor.id)` hoặc gọi biến thể không-target `buildUserScopeCondition` (một khoá
    // mock KHÁC). Chỉ bộ đếm bắt được chiều đó.
    // ⚠️ Nếu một WO sau này trích `rowScopeFor` thành helper dùng chung (nợ §7 của plan) thì con số này
    // ĐỔI — sửa nó một cách CÓ CHỦ ĐÍCH qua FULL gate, đừng xoá ca.
    const { svc, dataScope } = makeService("Own");
    await svc.listMembers(ACTOR, ROLE_ID);
    expect(vi.mocked(dataScope.buildUserScopeConditionOn)).toHaveBeenCalledTimes(2);
  });

  it("U1c — `rowScope.cond` CHÍNH LÀ vị từ của lời gọi mang `idCol === users.id`", async () => {
    // Mệnh đề chịu lực nhất, và là mệnh đề sống sót refactor: nó không đếm lời gọi, nó truy vết GIÁ TRỊ.
    const { svc, repo, calls } = makeService("Own");
    await svc.listMembers(ACTOR, ROLE_ID);

    const { rowScope } = grantsPassedToRepo(repo);
    const minted = calls.filter((c) => c.target.idCol === users.id);
    expect(minted.length).toBeGreaterThan(0);
    expect(
      minted.some((c) => c.returned === rowScope.cond),
      "vị từ đi vào WHERE KHÔNG phải thứ lattice vừa dựng trên `users.id`",
    ).toBe(true);
  });
});

describe("KI-071 · U2 — `ctx` mang `actor.id`, KHÔNG phải `actor.companyId`", () => {
  it("MỌI lời gọi nhận đúng `ctx` — bắt M-Q, đột biến mà ca soi `target` KHÔNG thấy", async () => {
    const { svc, calls } = makeService("Own");
    await svc.listMembers(ACTOR, ROLE_ID);

    expect(calls.length).toBeGreaterThan(0);
    for (const [i, c] of calls.entries()) {
      expect(c.ctx.userId, `lời gọi #${i}: ctx.userId sai`).toBe(ACTOR.id);
      expect(c.ctx.companyId, `lời gọi #${i}: ctx.companyId sai`).toBe(ACTOR.companyId);
      // Chặt hơn "bằng ACTOR.id": hai giá trị phải KHÁC nhau, nếu không ca xanh cả khi đột biến đúng
      // vì fixture vô tình cho id === companyId.
      expect(c.ctx.userId).not.toBe(c.ctx.companyId);
    }
  });
});

describe("KI-071 · U3 — fail-closed: `scope === null` ⇒ 403, KHÔNG chạm repo", () => {
  it("ném ForbiddenException, có logger.error, và `listRoleMembersTx` không được gọi lần nào", async () => {
    const { svc, repo, dataScope, permissionService } = makeService(null);
    // ⚠️ `can()` PHẢI trả `{allow:true}` — nếu không, 403 đến từ `assertCan` (cổng THỨ NHẤT) và ca này
    // XANH cả khi nhánh scope mới KHÔNG TỒN TẠI. Đây là điều kiện tồn tại của ca, không phải chi tiết.
    const logError = vi
      .spyOn((svc as unknown as { logger: { error: (...a: unknown[]) => void } }).logger, "error")
      .mockImplementation(() => undefined);

    await expect(svc.listMembers(ACTOR, ROLE_ID)).rejects.toBeInstanceOf(ForbiddenException);

    // Đọc mọi `mock.calls` TRƯỚC restore (`mockrestore-wipes-mock-calls`).
    expect(vi.mocked(permissionService.can)).toHaveBeenCalled();
    // Bằng chứng đã qua cổng THỨ NHẤT rồi mới chết ở cổng scope — thứ duy nhất phân biệt hai nguồn 403
    // ngoài `logger.error`.
    expect(vi.mocked(dataScope.resolveOrNull)).toHaveBeenCalled();
    expect(vi.mocked(repo.listRoleMembersTx)).not.toHaveBeenCalled();
    expect(logError, "403 im lặng ⇒ K2/K3/K4 không chẩn được khi trực ca").toHaveBeenCalled();
    logError.mockRestore();
  });

  it("403 giữ NGUYÊN VĂN chuỗi của `resolveAndAssert` — không giàu thông tin hơn", async () => {
    const { svc } = makeService(null);
    vi.spyOn(
      (svc as unknown as { logger: { error: (...a: unknown[]) => void } }).logger,
      "error",
    ).mockImplementation(() => undefined);
    await expect(svc.listMembers(ACTOR, ROLE_ID)).rejects.toThrow(
      "AUTH-ERR-FORBIDDEN: out of permission scope",
    );
  });
});

describe("KI-071 · U4 — HAI grant, đúng basis mỗi cái (bắt cú hoán đổi của D5)", () => {
  it("`rowScope` là scoped-predicate, `identity` là identity-gated, cả hai nói về `users`", async () => {
    const { svc, repo, calls } = makeService("Company");
    await svc.listMembers(ACTOR, ROLE_ID);

    // Chiều thứ hai của M-S: với scope `Company` thì MỌI lời gọi phải nhận `Company`, không phải một
    // hằng khác. Hai ca (`Own` ở U1, `Company` ở đây) chặn cả hai chiều hard-code.
    for (const c of calls) expect(c.scope).toBe("Company");

    const { rowScope, identity } = grantsPassedToRepo(repo);
    expect(basisOf(rowScope)).toBe("scoped-predicate");
    expect(basisOf(identity)).toBe("identity-gated");
    expect(rowScope.table).toBe("users");
    expect(identity.table).toBe("users");
    // Hoán đổi hai grant còn bị `rowScopeSql` ném (basis sai) — nhưng đó là hàng rào THỨ HAI. Ca này là
    // hàng rào thứ nhất, và nó chạy KHÔNG CẦN chạm DB.
    expect(rowScope.cond).not.toBe(identity.cond);
  });
});
