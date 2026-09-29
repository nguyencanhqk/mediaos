/**
 * Ca G1 (plan FE-2B D4) — bảng năng lực vét cạn `myRole × myStatus × visibility × canManage`, chỉ các
 * tổ hợp CHECK DB cho phép (`pending` ⇒ `member`; không hàng ⇒ cả hai null). Kỳ vọng tính ĐỘC LẬP bằng
 * cổng BE viết lại tay ở `expected()` — không gọi lại hàm đang test.
 */
import { describe, expect, it } from "vitest";
import { canOpenGroup, groupCapabilities } from "./group-capabilities";

type Role = "owner" | "admin" | "member";
type Status = "active" | "pending";
type Vis = "public" | "private";

interface Profile {
  myRole: Role | null;
  myStatus: Status | null;
}

const PROFILES: readonly Profile[] = [
  { myRole: null, myStatus: null },
  { myRole: "member", myStatus: "pending" },
  { myRole: "member", myStatus: "active" },
  { myRole: "admin", myStatus: "active" },
  { myRole: "owner", myStatus: "active" },
];

/** Cổng BE (`social-groups.service.ts`) viết lại TAY, từng dòng. */
function expected(p: Profile, vis: Vis, manage: boolean) {
  const active = p.myStatus === "active";
  const owner = active && p.myRole === "owner";
  const admin = active && p.myRole === "admin";
  return {
    canEdit: owner || admin || manage, // :144-148
    canDelete: owner || manage, // :190-191 (admin 403)
    canModerate: owner || admin || manage, // :343-368 · :447-455
    canGrantOwner: owner || manage, // D12 — owner hoặc manage BẤT KỂ vai (S16-SOCIAL-GROUPERR-1)
    canListMembers: active || manage, // :316-317
    canReadPosts: vis === "public" || active, // predicates — manage KHÔNG nới
    canPost: active, // social-access.service.ts:715-731
    canJoin: p.myStatus === null && vis === "public",
    canRequestJoin: p.myStatus === null && vis === "private",
    canCancelRequest: p.myStatus === "pending",
    canLeave: active,
    canCopyInvite: owner || admin || manage,
    isManageViewer: manage && !active && vis === "private",
  };
}

const CASES = PROFILES.flatMap((p) =>
  (["public", "private"] as const).flatMap((vis) =>
    [false, true].map((manage) => ({ p, vis, manage })),
  ),
);

describe("G1 — groupCapabilities khớp cổng BE trên MỌI tổ hợp hợp lệ", () => {
  it.each(CASES)(
    "role=$p.myRole status=$p.myStatus vis=$vis manage=$manage",
    ({ p, vis, manage }) => {
      const { role: _role, ...caps } = groupCapabilities({ visibility: vis, ...p }, manage);
      expect(caps).toEqual(expected(p, vis, manage));
    },
  );
});

describe("G1 — các ca đơn lẻ đã từng là bẫy", () => {
  it("DENY: `pending` mang `myRole:'member'` nhưng KHÔNG có quyền thành viên", () => {
    const c = groupCapabilities({ visibility: "private", myRole: "member", myStatus: "pending" }, false);
    expect(c.role).toBeNull();
    expect(c.canPost).toBe(false);
    expect(c.canListMembers).toBe(false);
    expect(c.canReadPosts).toBe(false);
    expect(c.canLeave).toBe(false);
    expect(c.canCancelRequest).toBe(true);
  });

  it("ALLOW: thành viên `active` đăng/đọc/xem thành viên được, KHÔNG quản trị", () => {
    const c = groupCapabilities({ visibility: "private", myRole: "member", myStatus: "active" }, false);
    expect(c.role).toBe("member");
    expect([c.canPost, c.canReadPosts, c.canListMembers, c.canLeave]).toEqual([true, true, true, true]);
    expect([c.canEdit, c.canModerate, c.canDelete]).toEqual([false, false, false]);
  });

  it("DENY: `manage` KHÔNG mở đọc/đăng bài nhóm KÍN mình không thuộc (thấy nhóm ≠ đọc bài)", () => {
    const c = groupCapabilities({ visibility: "private", myRole: null, myStatus: null }, true);
    expect(c.canReadPosts).toBe(false);
    expect(c.canPost).toBe(false);
    expect(c.isManageViewer).toBe(true);
    // …nhưng quản trị nhóm thì được.
    expect([c.canEdit, c.canDelete, c.canModerate, c.canListMembers]).toEqual([true, true, true, true]);
  });

  it("cấp owner (GROUPERR-1): admin active KIÊM manage ⇒ ALLOW; admin KHÔNG manage ⇒ DENY; manage không thuộc nhóm ⇒ ALLOW", () => {
    expect(
      groupCapabilities({ visibility: "public", myRole: "admin", myStatus: "active" }, true).canGrantOwner,
      "admin + manage — hôm trước là kẽ BE (403 oan), nay BE cấp được",
    ).toBe(true);
    expect(
      groupCapabilities({ visibility: "public", myRole: "admin", myStatus: "active" }, false).canGrantOwner,
      "admin thường KHÔNG tự nâng/cấp owner (D12)",
    ).toBe(false);
    expect(
      groupCapabilities({ visibility: "public", myRole: null, myStatus: null }, true).canGrantOwner,
    ).toBe(true);
    expect(
      groupCapabilities({ visibility: "public", myRole: "owner", myStatus: "active" }, false).canGrantOwner,
    ).toBe(true);
  });

  it("admin xoá nhóm ⇒ DENY; owner ⇒ ALLOW", () => {
    expect(
      groupCapabilities({ visibility: "public", myRole: "admin", myStatus: "active" }, false).canDelete,
    ).toBe(false);
    expect(
      groupCapabilities({ visibility: "public", myRole: "owner", myStatus: "active" }, false).canDelete,
    ).toBe(true);
  });
});

describe("canOpenGroup — link hàng danh sách", () => {
  it("DENY: nhóm kín + pending (không manage) ⇒ không link (032 sẽ 404)", () => {
    expect(canOpenGroup({ visibility: "private", myStatus: "pending" }, false)).toBe(false);
    expect(canOpenGroup({ visibility: "private", myStatus: null }, false)).toBe(false);
  });

  it("ALLOW: public bất kể trạng thái · kín + active · kín + manage", () => {
    expect(canOpenGroup({ visibility: "public", myStatus: null }, false)).toBe(true);
    expect(canOpenGroup({ visibility: "public", myStatus: "pending" }, false)).toBe(true);
    expect(canOpenGroup({ visibility: "private", myStatus: "active" }, false)).toBe(true);
    expect(canOpenGroup({ visibility: "private", myStatus: "pending" }, true)).toBe(true);
  });
});
