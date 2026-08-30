/**
 * S11-ASSET-FE-1 — neo phần WIRING của module ASSET (registry · route · sidebar · gate).
 *
 * Ba nhóm ca, mỗi nhóm chặn một kiểu trôi đã có tiền lệ trong repo:
 *
 *  1. **Pair-drift** — mã dotted phải trỏ đúng cặp engine mà CONTROLLER thật enforce. Bảng SPEC-13 §11
 *     đã lệch bản ship một lần (3 `kind` không tồn tại), nên neo theo cặp, không theo bảng.
 *  2. **Gate màn ≠ gate đường tải** — mọi lối vào ASSET phải đòi ĐỦ CẢ HAI `access:asset` +
 *     `view:asset` (`read-path-gate-pair-must-match-download-pair`). Chỉ `access:asset` là dựng lại
 *     đúng lỗ đã vá ở CHAT/social: menu hiện ra rồi bấm vào ăn lỗi.
 *  3. **Thứ tự route tĩnh/động** — `/assets/new` và `/assets/inventories` phải đứng TRƯỚC
 *     `/assets/$assetId` trong cây, nếu không TanStack coi chúng là assetId (bẫy `/goals/new`).
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  PERMISSION_CODE_TO_PAIR,
  ROUTE_REGISTRY,
  APP_REGISTRY,
  type RouteMeta,
} from "@mediaos/web-core";
import { ASSET_SIDEBAR, SIDEBAR_REGISTRY } from "@/layouts/workspace/sidebar-registry";
import { ASSET_ENGINE_PAIRS } from "./constants";

/** 11 cặp seed 0550 — đọc từ controller thật, KHÔNG chép bảng spec. */
const EXPECTED_PAIRS: Record<string, string> = {
  "ASSET.ACCESS": "access:asset",
  "ASSET.ASSET.VIEW": "view:asset",
  "ASSET.ASSET.CREATE": "create:asset",
  "ASSET.ASSET.UPDATE": "update:asset",
  "ASSET.ASSET.DELETE": "delete:asset",
  "ASSET.ASSIGNMENT.CREATE": "assign:asset",
  "ASSET.ASSIGNMENT.REVOKE": "revoke:asset",
  "ASSET.ASSET.DISPOSE": "dispose:asset",
  "ASSET.CATEGORY.MANAGE": "manage:asset-category",
  "ASSET.MAINTENANCE.MANAGE": "manage:asset-maintenance",
  "ASSET.INVENTORY.MANAGE": "manage:asset-inventory",
};

const ENTRY_GATE = ["access:asset", "view:asset"];

describe("ASSET wiring — PERMISSION_CODE_TO_PAIR", () => {
  it("đủ 11 mã dotted, trỏ đúng cặp engine", () => {
    for (const [code, pair] of Object.entries(EXPECTED_PAIRS)) {
      expect(PERMISSION_CODE_TO_PAIR[code], `thiếu/sai mã ${code}`).toBe(pair);
    }
  });

  it("không thừa mã ASSET.* nào ngoài 11 mã đã chốt", () => {
    const actual = Object.keys(PERMISSION_CODE_TO_PAIR).filter((c) => c.startsWith("ASSET."));
    expect(actual.sort()).toEqual(Object.keys(EXPECTED_PAIRS).sort());
  });

  it("ASSET_ENGINE_PAIRS (dùng trong page) khớp đúng bảng dotted — một nguồn, hai hình", () => {
    const fromConstants = Object.values(ASSET_ENGINE_PAIRS)
      .map((p) => `${p.action}:${p.resourceType}`)
      .sort();
    expect(fromConstants).toEqual(Object.values(EXPECTED_PAIRS).sort());
  });
});

describe("ASSET wiring — gate lối vào đòi ĐỦ CẢ HAI cặp", () => {
  const entryRoutes = ["asset.list", "asset.inventories", "me.assets"];

  it.each(entryRoutes)("ROUTE_REGISTRY '%s' đòi access:asset + view:asset", (routeKey) => {
    const meta = ROUTE_REGISTRY.find((r: RouteMeta) => r.routeKey === routeKey);
    expect(meta, `thiếu route meta ${routeKey}`).toBeTruthy();
    expect(meta?.requiredPermissions).toEqual(ENTRY_GATE);
    // KHÔNG được dùng requiredAnyPermissions: "any" cho phép vào bằng mình access:asset.
    expect(meta?.requiredAnyPermissions).toBeUndefined();
  });

  it("thẻ App Switcher 'assets' cũng đòi ĐỦ CẢ HAI", () => {
    const app = APP_REGISTRY.find((a) => a.appKey === "assets");
    expect(app, "thiếu APP_REGISTRY 'assets'").toBeTruthy();
    expect(app?.moduleCode).toBe("ASSET");
    expect(app?.requiredPermissions).toEqual(ENTRY_GATE);
    expect(app?.requiredAnyPermissions).toBeUndefined();
  });

  it("mọi mục ASSET_SIDEBAR đòi ĐỦ CẢ HAI", () => {
    expect(ASSET_SIDEBAR.length).toBeGreaterThan(0);
    for (const item of ASSET_SIDEBAR) {
      expect(item.requiredPermissions, `mục ${item.sidebarKey}`).toEqual(ENTRY_GATE);
      expect(item.requiredAnyPermissions).toBeUndefined();
    }
  });

  it("mục ME «Tài sản của tôi» gate bằng cặp ASSET, KHÔNG phải access:me", () => {
    const meItem = (SIDEBAR_REGISTRY.ME ?? []).find((i) => i.sidebarKey === "me.assets");
    expect(meItem, "thiếu mục sidebar me.assets").toBeTruthy();
    expect(meItem?.requiredPermissions).toEqual(ENTRY_GATE);
  });

  it("SIDEBAR_REGISTRY có khoá ASSET (thiếu ⇒ workspace không render mục nào)", () => {
    expect(SIDEBAR_REGISTRY.ASSET).toBe(ASSET_SIDEBAR);
  });
});

describe("ASSET wiring — router: tĩnh TRƯỚC động", () => {
  const routerSrc = fs.readFileSync(
    path.resolve(__dirname, "../../router.tsx"),
    "utf8",
  );

  /** Vị trí của một mục trong MẢNG cây route (rootRoute.addChildren) — không phải nơi khai báo. */
  const treeIndex = (name: string) => {
    const tree = routerSrc.slice(routerSrc.indexOf("rootRoute.addChildren(["));
    const i = tree.indexOf(`  ${name},`);
    expect(i, `route '${name}' chưa được lắp vào cây`).toBeGreaterThan(-1);
    return i;
  };

  it("assetNewRoute đứng TRƯỚC assetDetailRoute", () => {
    expect(treeIndex("assetNewRoute")).toBeLessThan(treeIndex("assetDetailRoute"));
  });

  it("assetInventoriesRoute đứng TRƯỚC assetDetailRoute", () => {
    expect(treeIndex("assetInventoriesRoute")).toBeLessThan(treeIndex("assetDetailRoute"));
  });

  it("assetInventoryDetailRoute đứng TRƯỚC assetDetailRoute", () => {
    // "/assets/inventories/$inventoryId" cũng khớp "/assets/$assetId" nếu xét sau.
    expect(treeIndex("assetInventoryDetailRoute")).toBeLessThan(treeIndex("assetDetailRoute"));
  });

  it("cả 7 route ASSET/ME đều đã lắp vào cây", () => {
    for (const r of [
      "assetsListRoute",
      "assetNewRoute",
      "assetInventoriesRoute",
      "assetInventoryDetailRoute",
      "assetDetailRoute",
      "assetEditRoute",
      "meAssetsRoute",
    ]) {
      expect(treeIndex(r)).toBeGreaterThan(-1);
    }
  });
});

describe("ASSET wiring — migration bật module đi CÙNG commit với lần gỡ pin", () => {
  const repoRoot = path.resolve(__dirname, "../../../../..");

  it("migration 0556 tồn tại và có trong _journal.json", () => {
    const tag = "0556_s11assetfe1_enable_asset_module";
    const sql = path.join(repoRoot, "apps/api/migrations", `${tag}.sql`);
    expect(fs.existsSync(sql), `thiếu ${tag}.sql`).toBe(true);
    // Thiếu dòng journal ⇒ migration bị BỎ QUA TRONG IM LẶNG (drizzle chạy theo journal, không theo thư mục).
    const journal = JSON.parse(
      fs.readFileSync(path.join(repoRoot, "apps/api/migrations/meta/_journal.json"), "utf8"),
    ) as { entries: { tag: string }[] };
    expect(journal.entries.some((e) => e.tag === tag), `${tag} chưa vào journal`).toBe(true);
  });

  it("pin smoke KHÔNG còn liệt ASSET là inactive, nhưng VẪN liệt ROOM (FE ROOM là WO khác)", () => {
    const smoke = fs.readFileSync(
      path.join(repoRoot, "apps/api/test/integration/migration-smoke.int-spec.ts"),
      "utf8",
    );
    const line = smoke
      .split("\n")
      .find((l) => l.startsWith("const EXTENSION_INACTIVE_MODULES"));
    expect(line, "không tìm thấy khai báo EXTENSION_INACTIVE_MODULES").toBeTruthy();
    expect(line).not.toContain('"ASSET"');
    expect(line).toContain('"ROOM"');
  });
});
