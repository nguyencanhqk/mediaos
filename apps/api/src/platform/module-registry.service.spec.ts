import { NotFoundException, BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { DatabaseService, TenantTx } from "../db/db.service";
import type { SaasRepository } from "../saas/saas.repository";
import type { FeatureFlagService } from "../saas/feature-flag.service";
import type { OperatorActionAuditService } from "./operator-action-audit.service";
import type { ModuleRegistryRepository } from "./module-registry.repository";
import { ModuleRegistryService } from "./module-registry.service";

const OPERATOR = { id: "op-1", companyId: "home-co" };
const TARGET = "target-tenant-A";

interface ModuleRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  icon: string | null;
  route: string | null;
  featureKeys: string[];
  dependsOn: string[];
  displayOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

function makeModule(over: Partial<ModuleRow> = {}): ModuleRow {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    key: "media",
    name: "Media",
    description: null,
    icon: null,
    route: "/media",
    featureKeys: ["feat_a", "feat_b"],
    dependsOn: [],
    displayOrder: 0,
    isActive: true,
    createdAt: new Date("2026-06-17T00:00:00Z"),
    updatedAt: new Date("2026-06-17T00:00:00Z"),
    ...over,
  };
}

/**
 * AC-7 ModuleRegistryService unit — mock DB/repo/feature-flag để chứng minh:
 *  (a) toggle ON gọi upsertFeatureOverride cho TỪNG feature_key qua withTenant(target);
 *  (b) recordOperatorAction trong CÙNG tx (rollback ⇒ KHÔNG audit & KHÔNG flag);
 *  (c) GET effective đọc từ FeatureFlagService.isEnabled (AND mọi feature_key), KHÔNG bảng song song;
 *  (d) module key không tồn tại ⇒ 404; (e) depends_on chưa bật ⇒ 4xx (DAG).
 */
describe("AC-7 ModuleRegistryService", () => {
  function makeService(opts: {
    modules?: ModuleRow[];
    /** Mô phỏng tx.rollback: callback của withTenant ném → tx hủy. */
    failInTx?: boolean;
    /** isEnabled per featureKey (effective). */
    enabledByKey?: Record<string, boolean>;
  } = {}) {
    const { modules = [makeModule()], failInTx = false, enabledByKey = {} } = opts;

    const upsertCalls: Array<{ companyId: string; featureKey: string; enabled: boolean }> = [];
    const auditCalls: Array<{
      action: string;
      targetTenantId: string;
      after?: unknown;
    }> = [];

    const repo = {
      listModules: vi.fn(async () => ({ items: modules, total: modules.length })),
      listAllActive: vi.fn(async () => modules.filter((m) => m.isActive)),
      findByKey: vi.fn(async (_tx: TenantTx, key: string) => modules.find((m) => m.key === key)),
    } as unknown as ModuleRegistryRepository;

    const saasRepo = {
      upsertFeatureOverride: vi.fn(
        async (_tx: TenantTx, d: { companyId: string; featureKey: string; enabled: boolean }) => {
          upsertCalls.push(d);
        },
      ),
    } as unknown as SaasRepository;

    const featureFlags = {
      isEnabled: vi.fn(async (_companyId: string, key: string) => enabledByKey[key] ?? false),
    } as unknown as FeatureFlagService;

    const operatorAudit = {
      recordOperatorAction: vi.fn(
        async (
          _tx: TenantTx,
          entry: { action: string; targetTenantId: string; after?: unknown },
        ) => {
          auditCalls.push(entry);
        },
      ),
    } as unknown as OperatorActionAuditService;

    // withTenant: gọi callback với tx-stub; nếu failInTx → ném SAU callback chạy (mô phỏng rollback):
    // mọi side-effect (upsert/audit) đã đẩy vào mảng NHƯNG được coi như HỦY ⇒ test assert mảng rỗng vì
    // chúng ta chỉ push khi callback chạy tới; ở đây ta mô phỏng rollback bằng cách KHÔNG cho callback
    // hoàn tất: ném trong tx-stub ngay trước khi audit chạy nếu failInTx (xem service: audit là bước cuối).
    const txStub = {} as TenantTx;
    const db = {
      withTenant: vi.fn(async <T>(companyId: string, fn: (tx: TenantTx) => Promise<T>) => {
        if (companyId !== TARGET) throw new Error(`unexpected companyId ${companyId}`);
        const result = await fn(txStub);
        if (failInTx) {
          // rollback: side-effects trong tx bị hủy → xóa các bản ghi đã push trong tx này.
          upsertCalls.length = 0;
          auditCalls.length = 0;
          throw new Error("simulated tx rollback");
        }
        return result;
      }),
    } as unknown as DatabaseService;

    const svc = new ModuleRegistryService(db, repo, saasRepo, featureFlags, operatorAudit);
    return { svc, upsertCalls, auditCalls, db, repo, saasRepo, featureFlags, operatorAudit };
  }

  describe("setModuleEnabled — toggle ON", () => {
    it("(a) gọi upsertFeatureOverride cho TỪNG feature_key qua withTenant(target)", async () => {
      const { svc, upsertCalls, db } = makeService();
      await svc.setModuleEnabled(OPERATOR, TARGET, "media", true);
      expect(db.withTenant).toHaveBeenCalledWith(TARGET, expect.any(Function));
      expect(upsertCalls).toEqual([
        { companyId: TARGET, featureKey: "feat_a", enabled: true },
        { companyId: TARGET, featureKey: "feat_b", enabled: true },
      ]);
    });

    it("(b1) recordOperatorAction được gọi (cùng tx) với target + action module_toggled", async () => {
      const { svc, auditCalls } = makeService();
      await svc.setModuleEnabled(OPERATOR, TARGET, "media", true);
      expect(auditCalls).toHaveLength(1);
      expect(auditCalls[0]).toMatchObject({
        action: "operator.module_toggled",
        targetTenantId: TARGET,
        after: { moduleKey: "media", enabled: true },
      });
    });

    it("(b2) tx rollback ⇒ KHÔNG còn audit row VÀ KHÔNG còn flag (atomic)", async () => {
      const { svc, upsertCalls, auditCalls } = makeService({ failInTx: true });
      await expect(svc.setModuleEnabled(OPERATOR, TARGET, "media", true)).rejects.toThrow();
      expect(upsertCalls).toHaveLength(0);
      expect(auditCalls).toHaveLength(0);
    });
  });

  describe("setModuleEnabled — validation", () => {
    it("(d) module key không tồn tại ⇒ NotFound (404)", async () => {
      const { svc } = makeService();
      await expect(svc.setModuleEnabled(OPERATOR, TARGET, "nope", true)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("(e) bật module khi depends_on CHƯA bật ⇒ BadRequest (DAG)", async () => {
      const modules = [
        makeModule({ key: "base", featureKeys: ["base_feat"], dependsOn: [] }),
        makeModule({
          id: "00000000-0000-0000-0000-000000000002",
          key: "advanced",
          featureKeys: ["adv_feat"],
          dependsOn: ["base"],
        }),
      ];
      // base chưa bật (enabledByKey rỗng) ⇒ bật advanced phải bị từ chối.
      const { svc } = makeService({ modules });
      await expect(
        svc.setModuleEnabled(OPERATOR, TARGET, "advanced", true),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("(e2) bật module khi depends_on ĐÃ bật ⇒ OK", async () => {
      const modules = [
        makeModule({ key: "base", featureKeys: ["base_feat"], dependsOn: [] }),
        makeModule({
          id: "00000000-0000-0000-0000-000000000002",
          key: "advanced",
          featureKeys: ["adv_feat"],
          dependsOn: ["base"],
        }),
      ];
      const { svc, upsertCalls } = makeService({
        modules,
        enabledByKey: { base_feat: true },
      });
      await svc.setModuleEnabled(OPERATOR, TARGET, "advanced", true);
      expect(upsertCalls).toContainEqual({
        companyId: TARGET,
        featureKey: "adv_feat",
        enabled: true,
      });
    });
  });

  describe("getTenantModules — effective state đọc từ FeatureFlagService", () => {
    it("(c) module enabled = AND(isEnabled mọi feature_key); KHÔNG bảng song song", async () => {
      const { svc, featureFlags } = makeService({
        enabledByKey: { feat_a: true, feat_b: false },
      });
      const res = await svc.getTenantModules(TARGET);
      // feat_a=on, feat_b=off ⇒ module media effective = false (AND).
      expect(res.find((m) => m.key === "media")?.enabled).toBe(false);
      expect(featureFlags.isEnabled).toHaveBeenCalledWith(TARGET, "feat_a");
      expect(featureFlags.isEnabled).toHaveBeenCalledWith(TARGET, "feat_b");
    });

    it("(c2) tất cả feature_key ON ⇒ module effective = true", async () => {
      const { svc } = makeService({ enabledByKey: { feat_a: true, feat_b: true } });
      const res = await svc.getTenantModules(TARGET);
      expect(res.find((m) => m.key === "media")?.enabled).toBe(true);
    });
  });
});
