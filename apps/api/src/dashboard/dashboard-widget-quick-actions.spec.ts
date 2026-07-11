import { describe, it, expect } from "vitest";
import {
  DASH_WIDGET_QUICK_ACTIONS,
  quickActionDefsFor,
  buildQuickAction,
} from "./dashboard-widget-quick-actions.const";
import { DASH_WIDGET_CATALOG } from "./dashboard-widget-catalog.const";
import { DashboardWidgetDataService } from "./dashboard-widget-data.service";
import type { PermissionService } from "../permission/permission.service";
import type { DashboardResolverService } from "./dashboard-resolver.service";
import type { DashboardWidgetRegistryService } from "./dashboard-widget-registry.service";
import type { DashboardWidgetHandlersService } from "./dashboard-widget-handlers.service";
import type { DashboardWidgetCacheService } from "./dashboard-widget-cache.service";
import type { WidgetCacheIdentity, WidgetFetchResult } from "./dashboard-widget-data.types";

/**
 * S4-DASH-BE-2-FIX-2 — unit RED→GREEN cho quick-action metadata (API-08 §8.4 + BACKEND-10 §20).
 * Chứng: (1) mọi widget in-sprint có quick_actions; (2) buildQuickAction thuần đúng; (3) runner tính
 * enabled/disabled_reason TỪ permission NGƯỜI XEM (approve:leave ≠ view:leave gate widget); (4) quick_actions
 * KHÔNG bao giờ vào cache (upsert.data không chứa nó); (5) catalog đính quick_actions + memo dedupe can().
 */

const USER = { id: "u-1", companyId: "co-1" };

interface CanCall {
  action: string;
  resourceType: string;
}

/** Fake PermissionService: allow khi cặp nằm trong allowed set; ghi log số lần gọi (kiểm memo). */
function fakePermission(allowed: Set<string>, log: CanCall[]): PermissionService {
  return {
    can: async (input: { action: string; resourceType: string }) => {
      log.push({ action: input.action, resourceType: input.resourceType });
      return {
        allow: allowed.has(`${input.action}:${input.resourceType}`),
        reason: "test",
        auditRequired: false,
      };
    },
  } as unknown as PermissionService;
}

const IDENTITY: WidgetCacheIdentity = {
  shareScope: "user",
  cacheScope: "Own",
  keyDiscriminator: null,
  scopeReferenceId: USER.id,
  ttlSeconds: 120,
};

/** Fake handlers registry cho 1 slug với gate + fetch cho trước. */
function fakeHandlers(
  slug: string,
  widgetCode: string,
  fetchImpl: () => Promise<WidgetFetchResult>,
): DashboardWidgetHandlersService {
  return {
    get: (s: string) =>
      s === slug
        ? { slug, widgetCode, gateAndResolve: async () => IDENTITY, fetch: fetchImpl }
        : undefined,
  } as unknown as DashboardWidgetHandlersService;
}

function fakeCache(
  upsertLog: Array<{ data: Record<string, unknown> }>,
): DashboardWidgetCacheService {
  return {
    buildCacheKey: () => "ck",
    getServable: async () => null, // luôn miss ⇒ đi nhánh regen
    resolveWidgetId: async () => "wid",
    upsert: async (input: { data: Record<string, unknown> }) => {
      upsertLog.push({ data: input.data });
      return { expiresAt: new Date(Date.now() + 120_000) };
    },
  } as unknown as DashboardWidgetCacheService;
}

function makeService(
  permission: PermissionService,
  handlers: DashboardWidgetHandlersService,
  cache: DashboardWidgetCacheService,
  registry?: DashboardWidgetRegistryService,
  resolver?: DashboardResolverService,
): DashboardWidgetDataService {
  return new DashboardWidgetDataService(
    (resolver ?? {}) as DashboardResolverService,
    (registry ?? {}) as DashboardWidgetRegistryService,
    handlers,
    cache,
    permission,
  );
}

describe("DASH_WIDGET_QUICK_ACTIONS registry (§8.4/§20)", () => {
  it("mọi widget CÓ khai quick action thì entry ≥1 def, và key trỏ widgetCode THẬT trong catalog", () => {
    // S4-DASH-CATALOG-2: quick action là opt-in per-widget ("[] ⇒ không có" theo const). 9 widget "glance"
    // đợt 2 (count/list) CHƯA có quick action (ngoài phạm vi WO) ⇒ KHÔNG ép mọi catalog widget có ≥1. Thay vào
    // đó: mỗi ENTRY đã khai phải non-rỗng + trỏ widgetCode tồn tại trong catalog (chống phantom/drift).
    const catalogCodes = new Set(DASH_WIDGET_CATALOG.map((w) => w.widgetCode));
    for (const code of Object.keys(DASH_WIDGET_QUICK_ACTIONS)) {
      expect(catalogCodes.has(code), `quick-action key ${code} phải là widget catalog THẬT`).toBe(
        true,
      );
      expect(quickActionDefsFor(code).length, `${code} entry phải ≥1 def`).toBeGreaterThan(0);
    }
    // 7 widget in-sprint gốc vẫn CÓ quick action (không bị mất do append catalog).
    for (const code of [
      "ATTENDANCE_TODAY",
      "MY_TASKS",
      "TASK_ALERTS",
      "NOTIFICATIONS",
      "PENDING_LEAVE",
    ]) {
      expect(quickActionDefsFor(code).length, `${code} phải giữ quick action`).toBeGreaterThan(0);
    }
  });

  it("PENDING_LEAVE gate=approve:leave (KHÁC view:leave gate widget) — enabled theo quyền DUYỆT", () => {
    const defs = DASH_WIDGET_QUICK_ACTIONS.PENDING_LEAVE;
    const approve = defs.find((d) => d.actionCode === "OPEN_PENDING_LEAVE_APPROVAL");
    expect(approve?.gate).toEqual({ action: "approve", resourceType: "leave" });
  });

  it("NAVIGATE có target_url + api_endpoint null; API_CALL có api_endpoint + target_url null", () => {
    for (const defs of Object.values(DASH_WIDGET_QUICK_ACTIONS)) {
      for (const d of defs) {
        if (d.method === "NAVIGATE") {
          expect(d.targetUrl).toBeTruthy();
          expect(d.apiEndpoint).toBeNull();
        }
        if (d.method === "API_CALL") {
          expect(d.apiEndpoint).toBeTruthy();
          expect(d.targetUrl).toBeNull();
        }
      }
    }
  });
});

describe("buildQuickAction (pure)", () => {
  const def = DASH_WIDGET_QUICK_ACTIONS.PENDING_LEAVE[0];

  it("allowed ⇒ enabled=true, disabled_reason=null", () => {
    const a = buildQuickAction(def, true);
    expect(a.enabled).toBe(true);
    expect(a.disabled_reason).toBeNull();
  });

  it("denied ⇒ enabled=false, disabled_reason nêu cặp quyền thiếu", () => {
    const a = buildQuickAction(def, false);
    expect(a.enabled).toBe(false);
    expect(a.disabled_reason).toContain("approve:leave");
  });

  it("projectScoped + projectId ⇒ target_url deep-link; thiếu projectId ⇒ base", () => {
    const pDef = DASH_WIDGET_QUICK_ACTIONS.PROJECT_PROGRESS[0];
    expect(buildQuickAction(pDef, true, "proj-9").target_url).toBe("/projects/proj-9");
    expect(buildQuickAction(pDef, true).target_url).toBe("/projects");
  });
});

describe("DashboardWidgetDataService.getWidget — quick_actions per-viewer (runner)", () => {
  const fetchImpl = async (): Promise<WidgetFetchResult> => ({
    status: "Active",
    data: { items: [{ id: "l-1" }], summary: { total: 1 } },
    emptyState: null,
  });

  it("viewer CÓ approve:leave ⇒ OPEN_PENDING_LEAVE_APPROVAL enabled=true", async () => {
    const log: CanCall[] = [];
    const svc = makeService(
      fakePermission(new Set(["approve:leave"]), log),
      fakeHandlers("pending-leave", "PENDING_LEAVE", fetchImpl),
      fakeCache([]),
    );
    const dto = await svc.getWidget(USER, "pending-leave", {});
    const action = dto.quick_actions.find((a) => a.action_code === "OPEN_PENDING_LEAVE_APPROVAL");
    expect(action?.enabled).toBe(true);
    expect(action?.disabled_reason).toBeNull();
  });

  it("viewer THIẾU approve:leave ⇒ enabled=false + disabled_reason (quyền duyệt tách khỏi xem widget)", async () => {
    const log: CanCall[] = [];
    const svc = makeService(
      fakePermission(new Set([]), log),
      fakeHandlers("pending-leave", "PENDING_LEAVE", fetchImpl),
      fakeCache([]),
    );
    const dto = await svc.getWidget(USER, "pending-leave", {});
    const action = dto.quick_actions.find((a) => a.action_code === "OPEN_PENDING_LEAVE_APPROVAL");
    expect(action?.enabled).toBe(false);
    expect(action?.disabled_reason).toContain("approve:leave");
  });

  it("quick_actions KHÔNG bao giờ vào cache (upsert.data không chứa quick_actions)", async () => {
    const upsertLog: Array<{ data: Record<string, unknown> }> = [];
    const svc = makeService(
      fakePermission(new Set(["approve:leave"]), []),
      fakeHandlers("pending-leave", "PENDING_LEAVE", fetchImpl),
      fakeCache(upsertLog),
    );
    const dto = await svc.getWidget(USER, "pending-leave", {});
    expect(dto.quick_actions.length).toBeGreaterThan(0); // response CÓ
    expect(upsertLog).toHaveLength(1);
    expect(upsertLog[0].data).not.toHaveProperty("quick_actions"); // cache KHÔNG có
  });

  it("source lỗi ⇒ Degraded VẪN kèm quick_actions (metadata điều hướng độc lập data)", async () => {
    const failing = async (): Promise<WidgetFetchResult> => {
      throw new Error("source down");
    };
    const svc = makeService(
      fakePermission(new Set(["approve:leave"]), []),
      fakeHandlers("pending-leave", "PENDING_LEAVE", failing),
      fakeCache([]),
    );
    const dto = await svc.getWidget(USER, "pending-leave", {});
    expect(dto.status).toBe("Degraded");
    expect(dto.data).toBeNull();
    expect(dto.quick_actions.length).toBeGreaterThan(0);
  });
});

describe("DashboardWidgetDataService.getCatalog — quick_actions + memo dedupe", () => {
  function summary(widgetCode: string, order: number) {
    return {
      widget_code: widgetCode,
      widget_name: widgetCode,
      widget_type: "List",
      source_modules: ["TASK"],
      data_scope: "Own",
      layout: { order },
      data: null,
      last_updated_at: null,
    };
  }

  it("đính quick_actions per item; can() cặp read:task chỉ gọi 1 lần (memo chia sẻ giữa widget)", async () => {
    const log: CanCall[] = [];
    const registry = {
      listWidgets: async () => [summary("MY_TASKS", 10), summary("TASK_ALERTS", 20)],
    } as unknown as DashboardWidgetRegistryService;
    const resolver = {
      listAllowedTypes: async () => [{ dashboard_type: "Employee", is_default: true }],
    } as unknown as DashboardResolverService;
    const svc = makeService(
      fakePermission(new Set(["read:task", "create:task"]), log),
      {} as DashboardWidgetHandlersService,
      {} as DashboardWidgetCacheService,
      registry,
      resolver,
    );

    const catalog = await svc.getCatalog(USER, {});
    const myTasks = catalog.find((c) => c.widget_code === "MY_TASKS");
    const alerts = catalog.find((c) => c.widget_code === "TASK_ALERTS");
    expect(myTasks?.quick_actions.length).toBeGreaterThan(0);
    expect(alerts?.quick_actions.length).toBeGreaterThan(0);
    // MY_TASKS(create:task+read:task) ∪ TASK_ALERTS(read:task): read:task dedup ⇒ đúng 1 lần.
    const readTaskCalls = log.filter((c) => c.action === "read" && c.resourceType === "task");
    expect(readTaskCalls).toHaveLength(1);
    // enabled phản ánh quyền: OPEN_MY_TASKS (read:task) enabled=true.
    const open = myTasks?.quick_actions.find((a) => a.action_code === "OPEN_MY_TASKS");
    expect(open?.enabled).toBe(true);
  });

  it("include_data=true: quick_actions ĐƯỢC GIỮ qua attachData; 1 source lỗi ⇒ widget Degraded (catalog VẪN 200)", async () => {
    const resolver = {
      listAllowedTypes: async () => [{ dashboard_type: "Employee", is_default: true }],
    } as unknown as DashboardResolverService;
    const registry = {
      listWidgets: async () => [summary("MY_TASKS", 10), summary("TASK_ALERTS", 20)],
    } as unknown as DashboardWidgetRegistryService;
    // handlers: my-tasks OK; task-alerts source throw ⇒ getWidget → Degraded (KHÔNG 500). Slug ánh xạ qua
    // DASH_WIDGET_CATALOG (MY_TASKS→my-tasks, TASK_ALERTS→task-alerts) trong attachData.
    const handlers = {
      get: (slug: string) => {
        if (slug === "my-tasks") {
          return {
            slug,
            widgetCode: "MY_TASKS",
            gateAndResolve: async () => IDENTITY,
            fetch: async (): Promise<WidgetFetchResult> => ({
              status: "Active",
              data: { items: [{ id: "t-1" }], summary: { total: 1 } },
              emptyState: null,
            }),
          };
        }
        if (slug === "task-alerts") {
          return {
            slug,
            widgetCode: "TASK_ALERTS",
            gateAndResolve: async () => IDENTITY,
            fetch: async (): Promise<WidgetFetchResult> => {
              throw new Error("task source down");
            },
          };
        }
        return undefined;
      },
    } as unknown as DashboardWidgetHandlersService;
    const svc = makeService(
      fakePermission(new Set(["read:task", "create:task"]), []),
      handlers,
      fakeCache([]),
      registry,
      resolver,
    );

    const catalog = await svc.getCatalog(USER, { include_data: true });
    const myTasks = catalog.find((c) => c.widget_code === "MY_TASKS");
    const alerts = catalog.find((c) => c.widget_code === "TASK_ALERTS");
    // Widget OK: data đính + quick_actions giữ nguyên.
    expect(myTasks?.status).toBe("Active");
    expect(myTasks?.data).toMatchObject({ summary: { total: 1 } });
    expect(myTasks?.quick_actions.length).toBeGreaterThan(0);
    // Source lỗi: Degraded + error_state; catalog VẪN trả (không 500); quick_actions giữ nguyên.
    expect(alerts?.status).toBe("Degraded");
    expect(alerts?.error_state?.code).toBe("DASH-ERR-SOURCE_MODULE_UNAVAILABLE");
    expect(alerts?.quick_actions.length).toBeGreaterThan(0);
  });
});
