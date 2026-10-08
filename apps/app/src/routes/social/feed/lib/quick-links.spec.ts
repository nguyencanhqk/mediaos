/**
 * S16-SOCIAL-FE-3C (L6) — hằng + bộ chọn của «dải ô liên kết nhanh» (plan §4 hàng Q5 · Q6, và vế THUẦN của
 * Q1 · Q2 · Q3 — vế vẽ ra màn nằm ở `components/QuickLinkStrip.spec.tsx`).
 *
 * `pickQuickLinkApps` nhận registry làm THAM SỐ ⇒ ca Q6 đưa BẢN SAO có một app ở trạng thái khác `active` vào
 * mà không phải sửa hằng `APP_REGISTRY` thật (đo 07/10/2026: cả 7 app của dải đều `active`). Cũng nhờ đó khối
 * «cổng … đọc từ registry TRUYỀN VÀO» đổi được CỔNG của từng app trong một bản sao — vế «không hard-code» của
 * `done_when`, thứ mà Q1–Q3 (đo bằng giá trị registry hôm nay) không phân biệt được.
 *
 * Quyền trong file này là chuỗi CẶP ENGINE viết tay (đúng thứ `/auth/me` trả) — fixture của ca, không phải mã
 * sản phẩm: `quick-links.ts` không nêu một cặp nào, cổng của từng ô đọc từ registry.
 */
import { describe, expect, it } from "vitest";
import {
  APP_REGISTRY,
  createPermissionChecker,
  getVisibleApps,
  type AppRegistryItem,
  type ModuleStatus,
  type SessionContext,
} from "@mediaos/web-core";
import { FEED_QUICK_LINK_APP_KEYS, pickQuickLinkApps } from "./quick-links";

/** Thứ tự SC-14, VIẾT TAY: Công việc · Nghỉ phép · Chấm công · Phòng họp · Mục tiêu · Đào tạo · Đăng bài Facebook. */
const SC14_ORDER = ["tasks", "leave", "attendance", "rooms", "goals", "lms", "fbpost"];

/** Đủ quyền cho CẢ 7 ô — mỗi ô đúng (các) cặp registry đòi; `rooms` cần HAI. */
const EVERY_PAIR = [
  "read:task",
  "view-own:leave",
  "view-own:attendance",
  "access:room",
  "view:room",
  "access:goal",
  "access:lms",
  "view:social-post",
];

/** Phiên như portal dựng hôm nay (`modules: []`); ca Q6 truyền `modules` để đo trạng thái HIỆU LỰC. */
function sessionWith(modules: SessionContext["modules"] = []): SessionContext {
  return {
    status: "authenticated",
    user: { id: "u1", email: "t@demo.local", status: "Active", companyId: "co1" },
    company: null,
    modules,
  };
}

/** Checker THẬT của web-core (khớp ĐÚNG-BẰNG), dựng từ danh sách cặp — đúng cách portal dựng từ `capabilities`. */
const checkerOf = (...pairs: string[]) =>
  createPermissionChecker(pairs.map((permission) => ({ permission, scopes: [] })));

const pick = (
  pairs: string[],
  apps: readonly AppRegistryItem[] = APP_REGISTRY,
  session: SessionContext = sessionWith(),
): string[] => pickQuickLinkApps(apps, session, checkerOf(...pairs)).map((app) => app.appKey);

const registryApp = (appKey: string): AppRegistryItem | undefined =>
  APP_REGISTRY.find((app) => app.appKey === appKey);

/** BẢN SAO registry với đúng một app đổi trạng thái — không đụng hằng thật. */
const withStatus = (appKey: string, status: ModuleStatus): AppRegistryItem[] =>
  APP_REGISTRY.map((app) => (app.appKey === appKey ? { ...app, status } : app));

/** Cổng của một app = đúng hai trường này của registry. */
type Gate = Pick<AppRegistryItem, "requiredPermissions" | "requiredAnyPermissions">;

/** BẢN SAO registry với đúng một app đổi CỔNG: gỡ CẢ HAI trường cũ rồi mới đặt cổng mới — không đụng hằng thật. */
const withGate = (appKey: string, gate: Gate): AppRegistryItem[] =>
  APP_REGISTRY.map((app) => {
    if (app.appKey !== appKey) return app;
    const { requiredPermissions: _all, requiredAnyPermissions: _any, ...ungated } = app;
    return { ...ungated, ...gate };
  });

/** Hai cặp KHÔNG app nào của registry thật khai ⇒ ô chỉ hiện được khi cổng được đọc từ bản sao. */
const NEW_PAIR = "zz:quick-link-a";
const SECOND_NEW_PAIR = "zz:quick-link-b";

describe("Q5 — hằng `FEED_QUICK_LINK_APP_KEYS`", () => {
  it("ĐÚNG 7 khoá theo thứ tự SC-14 (viết tay)", () => {
    expect([...FEED_QUICK_LINK_APP_KEYS]).toEqual(SC14_ORDER);
  });

  it("mọi khoá là `appKey` CÓ THẬT trong APP_REGISTRY và không lặp", () => {
    expect(FEED_QUICK_LINK_APP_KEYS.length).toBeGreaterThan(0);
    const known = new Set(APP_REGISTRY.map((app) => app.appKey));
    expect(FEED_QUICK_LINK_APP_KEYS.filter((key) => !known.has(key))).toEqual([]);
    expect(new Set(FEED_QUICK_LINK_APP_KEYS).size).toBe(FEED_QUICK_LINK_APP_KEYS.length);
  });

  it("đủ quyền ⇒ ĐỦ 7 ô theo thứ tự HẰNG, không theo `order` của registry; app ngoài hằng không lọt", () => {
    // Thêm ba cặp mở các app NGOÀI dải (Mạng xã hội · Dashboard · Nhân sự) để vế «không lọt» có thứ để lọt.
    expect(pick([...EVERY_PAIR, "view:feed", "read:dashboard", "read:employee"])).toEqual(
      SC14_ORDER,
    );

    // Đối chứng: thứ tự theo `order` của registry là một thứ tự KHÁC — không thì ca trên không phân biệt được.
    const byRegistryOrder = getVisibleApps(APP_REGISTRY, sessionWith(), checkerOf(...EVERY_PAIR))
      .map((app) => app.appKey)
      .filter((key) => SC14_ORDER.includes(key));
    expect(byRegistryOrder).toEqual([
      "attendance",
      "leave",
      "tasks",
      "goals",
      "lms",
      "fbpost",
      "rooms",
    ]);
  });
});

describe("Q1 — ô chỉ hiện khi có quyền registry đòi (vế thuần)", () => {
  it("DENY: chỉ `view:feed` ⇒ 0 ô", () => {
    expect(pick(["view:feed"])).toEqual([]);
  });

  it("ALLOW: thêm `access:goal` ⇒ đúng 1 ô `goals`", () => {
    expect(pick(["view:feed", "access:goal"])).toEqual(["goals"]);
  });

  it("any-of: MỘT trong các cặp registry liệt kê cho `tasks` là đủ", () => {
    expect(pick(["read:project"])).toEqual(["tasks"]);
  });
});

describe("Q2 — ô `fbpost` gác đúng MỘT cặp của registry", () => {
  it("DENY: có hai cặp `social-*` KHÁC, thiếu `view:social-post` ⇒ KHÔNG ô fbpost (ô khác vẫn có)", () => {
    expect(pick(["access:goal", "create:social-post", "manage:social-account"])).toEqual(["goals"]);
  });

  it("ALLOW: có `view:social-post` ⇒ CÓ ô fbpost, dù registry đánh dấu `switcherOnly`", () => {
    // Tiền đề của ca: mất cờ này thì ca không còn đo được «dải KHÔNG dùng bộ lọc của lưới Home».
    expect(registryApp("fbpost")?.switcherOnly).toBe(true);
    expect(registryApp("fbpost")?.requiredAnyPermissions).toEqual(["view:social-post"]);

    expect(
      pick(["access:goal", "create:social-post", "manage:social-account", "view:social-post"]),
    ).toEqual(["goals", "fbpost"]);
  });
});

describe("Q3 — ô `rooms` cần ĐỦ hai cặp", () => {
  it.each([
    ["chỉ `access:room`", "access:room"],
    ["chỉ `view:room`", "view:room"],
  ])("DENY: %s ⇒ KHÔNG ô phòng họp (ô khác vẫn có)", (_label, onlyPair) => {
    expect(pick(["access:goal", onlyPair])).toEqual(["goals"]);
  });

  it("ALLOW: đủ `access:room` + `view:room` ⇒ CÓ ô phòng họp", () => {
    expect(registryApp("rooms")?.requiredPermissions).toEqual(["access:room", "view:room"]);
    expect(pick(["access:goal", "access:room", "view:room"])).toEqual(["rooms", "goals"]);
  });
});

// Q1–Q3 đo bằng giá trị HÔM NAY của registry: chép tay cổng của cả bảy app vào `quick-links.ts` cho ra đúng những
// kết quả đó (đo 07/10/2026 — 46 ca của dải vẫn xanh). Khối này đổi CỔNG của từng app trong một bản sao registry,
// nên chỉ một bộ chọn ĐỌC cổng từ registry được truyền vào mới qua. Ca ALLOW không mang cặp cũ nào: một vế của
// cổng cũ còn dính lại (cổng chép tay đứng THÊM vào cổng registry) cũng đỏ.
describe.each(SC14_ORDER)("cổng của ô `%s` đọc từ registry TRUYỀN VÀO, không chép tay", (key) => {
  const others = SC14_ORDER.filter((candidate) => candidate !== key);
  const oneNewPair = withGate(key, { requiredAnyPermissions: [NEW_PAIR] });
  const twoNewPairs = withGate(key, { requiredPermissions: [NEW_PAIR, SECOND_NEW_PAIR] });

  it("DENY: registry đổi cổng sang MỘT cặp mới ⇒ đủ mọi cặp cũ vẫn KHÔNG có ô (sáu ô kia vẫn có)", () => {
    expect(pick(EVERY_PAIR, oneNewPair)).toEqual(others);
  });

  it("ALLOW: cùng bản sao đó ⇒ cặp mới MỘT MÌNH là đủ, không cần cặp cũ nào", () => {
    expect(pick([NEW_PAIR], oneNewPair)).toEqual([key]);
  });

  it.each([NEW_PAIR, SECOND_NEW_PAIR])(
    "DENY: registry đổi sang cổng ĐỦ-CẢ-HAI ⇒ mọi cặp cũ + riêng `%s` vẫn KHÔNG có ô",
    (onlyPair) => {
      expect(pick([...EVERY_PAIR, onlyPair], twoNewPairs)).toEqual(others);
    },
  );

  it("ALLOW: cùng bản sao đó ⇒ đủ hai cặp mới là có ô, không cần cặp cũ nào", () => {
    expect(pick([NEW_PAIR, SECOND_NEW_PAIR], twoNewPairs)).toEqual([key]);
  });
});

describe("Q6 — chỉ app đang `active` mới thành ô", () => {
  it.each<ModuleStatus>(["coming_soon", "locked", "maintenance"])(
    "DENY: bản sao registry có `goals` ở `%s` + KHÔNG quyền nào ⇒ 0 ô",
    (status) => {
      const copy = withStatus("goals", status);
      // Tiền đề — lý do bộ lọc tồn tại: app khác `active` đi QUA `getVisibleApps` mà không cần quyền.
      const visible = getVisibleApps(copy, sessionWith(), checkerOf()).map((app) => app.appKey);
      expect(visible).toContain("goals");

      expect(pick([], copy)).toEqual([]);
    },
  );

  it("ĐỐI CHỨNG ALLOW: cùng app đó `active` + đủ quyền ⇒ đúng 1 ô", () => {
    expect(pick(["access:goal"], withStatus("goals", "active"))).toEqual(["goals"]);
  });

  it("app chưa `active` thì CÓ quyền cũng không thành ô (ô khác vẫn có)", () => {
    expect(pick(["access:goal", "access:lms"], withStatus("goals", "coming_soon"))).toEqual([
      "lms",
    ]);
  });

  it("app `hidden` không bao giờ thành ô", () => {
    expect(pick(EVERY_PAIR, withStatus("goals", "hidden"))).toEqual(
      SC14_ORDER.filter((key) => key !== "goals"),
    );
  });

  it("module bị khoá ở PHIÊN dù registry `active` ⇒ không ô, có quyền hay không cũng vậy", () => {
    const locked = sessionWith([{ moduleCode: "GOAL", status: "locked" }]);
    // Tiền đề: với phiên này `getVisibleApps` trả `goals` mà KHÔNG kiểm quyền.
    const visible = getVisibleApps(APP_REGISTRY, locked, checkerOf()).map((app) => app.appKey);
    expect(visible).toContain("goals");

    expect(pick([], APP_REGISTRY, locked)).toEqual([]);
    expect(pick(["access:goal", "access:lms"], APP_REGISTRY, locked)).toEqual(["lms"]);
  });

  it("ĐỐI CHỨNG ALLOW: phiên báo module `active` + đủ quyền ⇒ có ô", () => {
    const active = sessionWith([{ moduleCode: "GOAL", status: "active" }]);
    expect(pick(["access:goal"], APP_REGISTRY, active)).toEqual(["goals"]);
  });

  it("registry chưa `active` mà phiên báo module `active` ⇒ vẫn không ô (FE chưa có màn dùng được)", () => {
    const active = sessionWith([{ moduleCode: "GOAL", status: "active" }]);
    expect(pick(["access:goal", "access:lms"], withStatus("goals", "coming_soon"), active)).toEqual(
      ["lms"],
    );
  });
});
