/**
 * S16-SOCIAL-FE-2B D19 — vế «cắt THẬT» của `pruneUnbuiltScreens`, tách khỏi dữ liệu module.
 *
 * Trước lát B, ca `social-wiring` «V2 khai 6, bản đăng ký còn 5» là vế đối chứng duy nhất của SOCIAL.
 * Khi mọi màn SOCIAL đã dựng, ca đó thành V2 = registered và KHÔNG còn đo được gì về hàm cắt: vô hiệu
 * hoá `pruneUnbuiltScreens` mà nó vẫn xanh. Ca ở đây dùng mục GIẢ trỏ đường chắc chắn không tồn tại.
 */
import { describe, expect, it } from "vitest";
import type { SidebarItemMeta } from "@mediaos/web-core";
import { pruneUnbuiltScreens } from "./prune-unbuilt";

const item = (sidebarKey: string, path?: string, children?: SidebarItemMeta[]): SidebarItemMeta =>
  ({
    sidebarKey,
    moduleCode: "SOCIAL",
    label: sidebarKey,
    ...(path ? { path } : {}),
    icon: "users",
    group: "operation",
    order: 1,
    requiredAnyPermissions: ["view:feed"],
    ...(children ? { children } : {}),
  }) as SidebarItemMeta;

describe("pruneUnbuiltScreens", () => {
  it("DENY: lá trỏ đường CHƯA dựng bị cắt; ALLOW: lá trỏ route có thật được giữ", () => {
    const out = pruneUnbuiltScreens([
      item("x.built", "/feed/groups"),
      item("x.dead", "/feed/khong-ton-tai-bao-gio"),
    ]);
    expect(out.map((i) => i.sidebarKey)).toEqual(["x.built"]);
  });

  it("hàng nhóm mất hết con ⇒ bị bỏ; còn con đã dựng ⇒ giữ, chỉ con đã dựng", () => {
    const out = pruneUnbuiltScreens([
      item("g.empty", undefined, [item("g.empty.a", "/khong-co")]),
      item("g.live", undefined, [item("g.live.a", "/feed/polls"), item("g.live.b", "/khong-co")]),
    ]);
    expect(out.map((i) => i.sidebarKey)).toEqual(["g.live"]);
    expect(out[0]?.children?.map((c) => c.sidebarKey)).toEqual(["g.live.a"]);
  });

  it("node lai (path chưa dựng + con đã dựng) HẠ thành hàng nhóm, không nuốt cả nhánh", () => {
    const out = pruneUnbuiltScreens([item("h", "/khong-co", [item("h.a", "/feed/ideas")])]);
    expect(out).toHaveLength(1);
    expect(out[0]?.path).toBeUndefined();
    expect(out[0]?.children?.map((c) => c.sidebarKey)).toEqual(["h.a"]);
  });
});
