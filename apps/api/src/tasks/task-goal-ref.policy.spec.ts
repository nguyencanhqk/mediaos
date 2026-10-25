import { describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { DataScope } from "@mediaos/contracts";
import { DataScopeService } from "../permission/data-scope.service";
import { GoalAccessService } from "../goals/goal-access.service";
import { GoalsRepository } from "../goals/goals.repository";
import { TaskGoalRefPolicy, type GoalRefViewer } from "./task-goal-ref.policy";

/**
 * S20-SEC-GOALNAMEDTO-1 (plan §4 U2 · U2b · U4) — quyết định đọc mục tiêu theo lô cho dữ liệu việc.
 * Bất biến: cùng dữ liệu, cùng quyết định — policy dựng CÙNG câu SQL với đường đọc mục tiêu chuẩn
 * (`GoalAccessService.resolveActorScope` → `GoalsRepository.isInReadScopeTx`) ở mọi phạm vi; số truy vấn
 * theo lô; không nuốt lỗi engine.
 */

const USER = {
  id: "11111111-1111-4111-8111-111111111111",
  companyId: "c0c0c0c0-0000-4000-8000-000000000001",
};
const EMP = {
  id: "e0e0e0e0-0000-4000-8000-000000000001",
  userId: USER.id,
  status: "active",
  orgUnitId: "ou-1",
};
const G1 = "90000000-0000-4000-8000-000000000001";
const G2 = "90000000-0000-4000-8000-000000000002";
const dialect = new PgDialect();

/** tx giả: ghi lại mọi WHERE của truy vấn lô; `execute` trả hàng nhân viên active của actor. */
function mockTx() {
  const wheres: SQL[] = [];
  const tx = {
    execute: vi.fn(async () => ({ rows: [EMP] })),
    select: vi.fn(() => ({
      from: () => ({
        where: (w: SQL) => {
          wheres.push(w);
          return Promise.resolve([{ id: G1 }]);
        },
      }),
    })),
  };
  return { tx, wheres };
}

/** DataScopeService THẬT (hàm dựng vị từ thuần) + engine giả trả `scope` cho mọi cặp. */
function makeDataScope(scope: DataScope | null) {
  const permission = { resolveStrongestScope: vi.fn(async () => scope) };
  const repo = {
    getRequesterScopeContext: vi.fn(async () => ({
      orgUnitId: "ou-1",
      managedUserIds: ["22222222-2222-4222-8222-222222222222"],
      headedOrgUnitIds: ["ou-2"],
    })),
  };
  return { dataScope: new DataScopeService(permission as never, repo as never), permission, repo };
}

function makePolicy(scope: DataScope | null, tx?: unknown) {
  const ds = makeDataScope(scope);
  const db = { withTenant: vi.fn(async (_c: string, fn: (t: unknown) => unknown) => fn(tx)) };
  return { policy: new TaskGoalRefPolicy(db as never, ds.dataScope), db, ...ds };
}

describe("TaskGoalRefPolicy — truy vấn theo lô (U2 · U2b)", () => {
  it("U2a không có ứng viên ⇒ không gọi engine quyền, không mở tx", async () => {
    const { policy, permission, db } = makePolicy("Department");
    expect(await policy.visibleGoalIds(USER, [])).toEqual(new Set());
    expect(permission.resolveStrongestScope).not.toHaveBeenCalled();
    expect(db.withTenant).not.toHaveBeenCalled();
  });

  it("U2b N hàng / K mục tiêu ⇒ đúng MỘT truy vấn lô (ứng viên khử trùng)", async () => {
    const { tx, wheres } = mockTx();
    const { policy } = makePolicy("Department", tx);
    const out = await policy.visibleGoalIds(USER, [G1, G2, G1, G2, G1]);
    expect(out).toEqual(new Set([G1]));
    expect(tx.select).toHaveBeenCalledTimes(1);
    expect(dialect.sqlToQuery(wheres[0]).params.filter((p) => p === G1 || p === G2)).toEqual([
      G1,
      G2,
    ]);
  });

  it("U2c không có cặp đọc mục tiêu ⇒ tập rỗng, 0 truy vấn", async () => {
    const { tx } = mockTx();
    const { policy, db } = makePolicy(null, tx);
    expect(await policy.visibleGoalIds(USER, [G1])).toEqual(new Set());
    expect(db.withTenant).not.toHaveBeenCalled();
    expect(tx.select).not.toHaveBeenCalled();
  });

  it("U2d engine quyền ném ⇒ ném tiếp (không biến thành «che hết» câm)", async () => {
    const { policy, dataScope } = makePolicy("Company");
    vi.spyOn(dataScope, "resolveOrNull").mockRejectedValueOnce(new Error("engine down"));
    await expect(policy.resolveViewer(USER)).rejects.toThrow("engine down");
  });

  it("U2e request mang cờ khoá API ⇒ che hết, không gọi engine quyền", async () => {
    const { tx } = mockTx();
    const { policy, permission } = makePolicy("Company", tx);
    const viewer = await policy.resolveViewer({ ...USER, viaApiKey: true });
    expect(viewer.scope).toBeNull();
    expect(await policy.visibleGoalIdsTx(tx as never, viewer, [G1])).toEqual(new Set());
    expect(permission.resolveStrongestScope).not.toHaveBeenCalled();
    expect(tx.select).not.toHaveBeenCalled();
  });
});

describe("TaskGoalRefPolicy — cùng SQL với đường đọc mục tiêu chuẩn (U4)", () => {
  const scopes: DataScope[] = ["Own", "Team", "Department", "Company", "System"];

  it.each(scopes)(
    "U4 phạm vi %s ⇒ câu lô = câu của đường chuẩn, luôn có vế company_id",
    async (scope) => {
      const canonical = mockTx();
      const ds = makeDataScope(scope);
      const access = new GoalAccessService(new GoalsRepository(), ds.dataScope, {} as never);
      const actor = await access.resolveActorScope(canonical.tx as never, USER, "view");

      const viaPolicy = mockTx();
      const { policy } = makePolicy(scope, viaPolicy.tx);
      const viewer: GoalRefViewer = await policy.resolveViewer(USER);
      await policy.visibleGoalIdsTx(viaPolicy.tx as never, viewer, [G1]);
      const policyQuery = dialect.sqlToQuery(viaPolicy.wheres[0]);

      if (scope === "Company" || scope === "System") {
        expect(actor.readScopeExists).toBeUndefined();
        expect(policyQuery.sql).not.toContain("exists");
      } else {
        await new GoalsRepository().isInReadScopeTx(
          canonical.tx as never,
          USER.companyId,
          G1,
          actor.readScopeExists as SQL,
        );
        const canonicalQuery = dialect.sqlToQuery(canonical.wheres[0]);
        expect(policyQuery.sql).toBe(canonicalQuery.sql);
        expect(policyQuery.params).toEqual(canonicalQuery.params);
      }
      expect(policyQuery.sql).toContain('"goals"."company_id" = ');
      expect(policyQuery.sql).toContain('"goals"."deleted_at" is null');
    },
  );
});
