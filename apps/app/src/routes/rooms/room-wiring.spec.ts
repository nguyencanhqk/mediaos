/**
 * S11-ROOM-FE-1 — neo phần WIRING của module ROOM (registry · route · sidebar · gate · migration).
 *
 * Bốn nhóm ca, mỗi nhóm chặn một kiểu trôi đã có tiền lệ trong repo:
 *
 *  1. **Pair-drift** — mã dotted phải trỏ đúng cặp engine mà CONTROLLER thật enforce. Neo theo cặp
 *     đọc từ controller, KHÔNG theo bảng SPEC-14 §11.
 *  2. **Gate màn ≠ gate đường tải** — mọi lối vào ROOM đòi ĐỦ CẢ HAI `access:room` + `view:room`
 *     (`read-path-gate-pair-must-match-download-pair`).
 *  3. **Route đã lắp vào cây** — khai `createRoute` mà quên nhét vào `rootRoute.addChildren` là một
 *     trang tồn tại trong code nhưng 404 khi bấm.
 *  4. **Ba việc của WO bật module đi CÙNG commit** (memory `module-enable-guard-blocks-next-wo`):
 *     migration 0557 + journal · gỡ pin `EXTENSION_INACTIVE_MODULES` · **nới guard (e) của 0554**.
 *     Ca thứ ba là ca đắt nhất: thiếu nó thì mọi lưới FE vẫn xanh, chỉ CI đỏ ở int-spec H1.
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
import { ROOM_SIDEBAR, SIDEBAR_REGISTRY } from "@/layouts/workspace/sidebar-registry";
import { ROOM_ENGINE_PAIRS } from "./constants";

/** 5 cặp seed 0554 — đọc từ controller thật (rooms · room-bookings · me-room-bookings). */
const EXPECTED_PAIRS: Record<string, string> = {
  "ROOM.ACCESS": "access:room",
  "ROOM.ROOM.VIEW": "view:room",
  "ROOM.BOOKING.CREATE": "book:room",
  "ROOM.BOOKING.CANCEL": "cancel:room-booking",
  "ROOM.ROOM.MANAGE": "manage:room",
};

const ENTRY_GATE = ["access:room", "view:room"];
const repoRoot = path.resolve(__dirname, "../../../../..");

describe("ROOM wiring — PERMISSION_CODE_TO_PAIR", () => {
  it("đủ 5 mã dotted, trỏ đúng cặp engine", () => {
    for (const [code, pair] of Object.entries(EXPECTED_PAIRS)) {
      expect(PERMISSION_CODE_TO_PAIR[code], `thiếu/sai mã ${code}`).toBe(pair);
    }
  });

  it("không thừa mã ROOM.* nào ngoài 5 mã đã chốt", () => {
    const actual = Object.keys(PERMISSION_CODE_TO_PAIR).filter((c) => c.startsWith("ROOM."));
    expect(actual.sort()).toEqual(Object.keys(EXPECTED_PAIRS).sort());
  });

  it("ROOM_ENGINE_PAIRS (dùng trong page) khớp đúng bảng dotted — một nguồn, hai hình", () => {
    const fromConstants = Object.values(ROOM_ENGINE_PAIRS)
      .map((p) => `${p.action}:${p.resourceType}`)
      .sort();
    expect(fromConstants).toEqual(Object.values(EXPECTED_PAIRS).sort());
  });

  it("cặp huỷ có resource `room-booking`, KHÔNG phải `room` — cặp DUY NHẤT lệch resource", () => {
    // Gõ nhầm thành `cancel:room` sẽ làm `useCan` trả false cho MỌI người ⇒ nút Huỷ biến mất hoàn
    // toàn, và không lưới nào khác bắt được vì nút chỉ "im lặng không hiện".
    expect(ROOM_ENGINE_PAIRS.CANCEL.resourceType).toBe("room-booking");
    expect(ROOM_ENGINE_PAIRS.CANCEL.action).toBe("cancel");
  });
});

describe("ROOM wiring — gate lối vào đòi ĐỦ CẢ HAI cặp", () => {
  const entryRoutes = ["room.calendar", "room.manage", "me.roomBookings"];

  it.each(entryRoutes)("ROUTE_REGISTRY '%s' đòi access:room + view:room", (routeKey) => {
    const meta = ROUTE_REGISTRY.find((r: RouteMeta) => r.routeKey === routeKey);
    expect(meta, `thiếu route meta ${routeKey}`).toBeTruthy();
    expect(meta?.requiredPermissions).toEqual(ENTRY_GATE);
    // KHÔNG được dùng requiredAnyPermissions: "any" cho phép vào bằng mình access:room.
    expect(meta?.requiredAnyPermissions).toBeUndefined();
  });

  it("'/rooms/manage' gate bằng cặp ĐỌC, KHÔNG phải manage:room", () => {
    // Tab «Lịch sử sử dụng» của màn đó chạy trên `view:room` (GET /rooms/usage-summary). Gate cả màn
    // bằng cặp GHI sẽ giấu luôn phần đọc khỏi role chỉ có quyền xem — nút tạo/sửa/xoá đã ẩn riêng
    // trong page qua useCan(manage:room).
    const meta = ROUTE_REGISTRY.find((r: RouteMeta) => r.routeKey === "room.manage");
    expect(meta?.requiredPermissions).not.toContain("manage:room");
  });

  it("thẻ App Switcher 'rooms' cũng đòi ĐỦ CẢ HAI", () => {
    const app = APP_REGISTRY.find((a) => a.appKey === "rooms");
    expect(app, "thiếu APP_REGISTRY 'rooms'").toBeTruthy();
    expect(app?.moduleCode).toBe("ROOM");
    expect(app?.requiredPermissions).toEqual(ENTRY_GATE);
    expect(app?.requiredAnyPermissions).toBeUndefined();
  });

  it("mọi mục ROOM_SIDEBAR đòi ĐỦ CẢ HAI", () => {
    expect(ROOM_SIDEBAR.length).toBeGreaterThan(0);
    for (const item of ROOM_SIDEBAR) {
      expect(item.requiredPermissions, `mục ${item.sidebarKey}`).toEqual(ENTRY_GATE);
      expect(item.requiredAnyPermissions).toBeUndefined();
    }
  });

  it("mục ME «Đặt phòng của tôi» gate bằng cặp ROOM, KHÔNG phải access:me", () => {
    const meItem = (SIDEBAR_REGISTRY.ME ?? []).find((i) => i.sidebarKey === "me.roomBookings");
    expect(meItem, "thiếu mục sidebar me.roomBookings").toBeTruthy();
    expect(meItem?.requiredPermissions).toEqual(ENTRY_GATE);
  });

  it("SIDEBAR_REGISTRY có khoá ROOM (thiếu ⇒ workspace không render mục nào)", () => {
    expect(SIDEBAR_REGISTRY.ROOM).toBe(ROOM_SIDEBAR);
  });

  it("mọi icon sidebar ROOM có trong ICON_MAP (thiếu ⇒ rơi về Circle vô nghĩa)", () => {
    const iconSrc = fs.readFileSync(
      path.resolve(__dirname, "../../layouts/workspace/DynamicIcon.tsx"),
      "utf8",
    );
    for (const item of ROOM_SIDEBAR) {
      expect(iconSrc, `icon '${item.icon}' chưa khai trong ICON_MAP`).toContain(`"${item.icon}":`);
    }
  });
});

describe("ROOM wiring — router", () => {
  const routerSrc = fs.readFileSync(path.resolve(__dirname, "../../router.tsx"), "utf8");
  const tree = routerSrc.slice(routerSrc.indexOf("rootRoute.addChildren(["));

  const treeIndex = (name: string) => {
    const i = tree.indexOf(`  ${name},`);
    expect(i, `route '${name}' chưa được lắp vào cây`).toBeGreaterThan(-1);
    return i;
  };

  it("cả 3 route ROOM/ME đều đã lắp vào cây", () => {
    for (const r of ["roomsCalendarRoute", "roomsManageRoute", "meRoomBookingsRoute"]) {
      expect(treeIndex(r)).toBeGreaterThan(-1);
    }
  });

  it("'/rooms/manage' đứng TRƯỚC '/rooms' trong cây", () => {
    expect(treeIndex("roomsManageRoute")).toBeLessThan(treeIndex("roomsCalendarRoute"));
  });
});

describe("ROOM wiring — BA việc của WO bật module đi CÙNG commit", () => {
  const migrationsDir = path.join(repoRoot, "apps/api/migrations");

  it("(1) migration 0557 tồn tại và có trong _journal.json", () => {
    const tag = "0557_s11roomfe1_enable_room_module";
    expect(fs.existsSync(path.join(migrationsDir, `${tag}.sql`)), `thiếu ${tag}.sql`).toBe(true);
    // Thiếu dòng journal ⇒ migration bị BỎ QUA TRONG IM LẶNG (drizzle chạy theo journal, không theo
    // thư mục) — memory `migration-not-in-journal-is-silently-skipped`.
    const journal = JSON.parse(
      fs.readFileSync(path.join(migrationsDir, "meta/_journal.json"), "utf8"),
    ) as { entries: { tag: string }[] };
    expect(
      journal.entries.some((e) => e.tag === tag),
      `${tag} chưa vào journal`,
    ).toBe(true);
  });

  it("(1b) 0557 dùng UPDATE, KHÔNG phải INSERT (hàng modules.ROOM có sẵn từ 0435)", () => {
    // `INSERT … ON CONFLICT DO NOTHING` ở đây là NO-OP im lặng và module vẫn tắt — memory
    // `phase-modules-preseeded-inactive-in-0435`.
    const sql = fs.readFileSync(
      path.join(migrationsDir, "0557_s11roomfe1_enable_room_module.sql"),
      "utf8",
    );
    expect(sql).toContain("UPDATE modules");
    expect(sql).not.toContain("INSERT INTO modules");
  });

  it("(2) pin smoke KHÔNG còn liệt ROOM là inactive", () => {
    const smoke = fs.readFileSync(
      path.join(repoRoot, "apps/api/test/integration/migration-smoke.int-spec.ts"),
      "utf8",
    );
    const line = smoke.split("\n").find((l) => l.startsWith("const EXTENSION_INACTIVE_MODULES"));
    expect(line, "không tìm thấy khai báo EXTENSION_INACTIVE_MODULES").toBeTruthy();
    expect(line).not.toContain('"ROOM"');
  });

  it("(3) guard verify của 0554 KHÔNG còn assert modules.ROOM is_active = false", () => {
    // Ca ĐẮT NHẤT của file này. Guard đó nằm trong migration ĐÃ LAND; ca H1 của
    // `s11-room-db1-invariants.int-spec.ts` replay NGUYÊN file 0554 để chứng minh idempotency, nên
    // sau khi 0557 bật cờ, một guard `is_active = false` vô điều kiện ném P0001 ⇒ CI đỏ trong khi
    // MỌI lưới FE vẫn xanh (memory `module-enable-guard-blocks-next-wo`).
    const sql = fs.readFileSync(
      path.join(migrationsDir, "0554_s11roomdb1_seed_role_perms_audit.sql"),
      "utf8",
    );
    // Bỏ dòng comment trước khi soi: bản vá CÓ nhắc `is_active = false` trong phần giải thích, và
    // một phép grep thô sẽ đỏ oan ở đúng chỗ vừa được vá.
    const code = sql
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("--"))
      .join("\n");
    expect(code).not.toMatch(/module_code\s*=\s*'ROOM'[^;]*is_active\s*=\s*false/);
  });
});
