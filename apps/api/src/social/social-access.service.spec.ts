import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { DataScope } from "@mediaos/contracts";
import type { DataScopeService } from "../permission/data-scope.service";
import { SocialAccessService } from "./social-access.service";
import type { SocialGroupAccessService } from "./social-group-access.service";
import { SOCIAL_ERR } from "./social.errors";
import type { SocialRequestUser, SocialViewerContext } from "./social.types";

/**
 * S16-SOCIAL-BE-1 — unit cho **file crown-jewel**. Đây là cổng coverage THẬT của module (per-file
 * threshold ở `vitest.config.ts`), nên nó nhắm vào các NHÁNH QUYẾT ĐỊNH chứ không vào SQL:
 * SQL đã được int-spec chạy thật trên Postgres (`social-be1-visibility`).
 *
 * `DataScopeService` bị mock vì ba câu hỏi scope là ĐẦU VÀO của mọi quyết định ở đây — mock chúng là
 * cách duy nhất dựng được các tổ hợp (thiếu cặp · scope hẹp hơn Company · có/không hai cờ phụ) mà
 * một fixture DB phải tốn cả một tenant mới tạo ra được.
 */

const USER: SocialRequestUser = {
  id: "11111111-1111-4111-8111-111111111111",
  companyId: "22222222-2222-4222-8222-222222222222",
};

function makeService(opts: {
  group?: { visible?: boolean; membershipStatus?: "active" | "pending" | null };
  scopes: (DataScope | null)[];
  orgUnitId?: string | null;
  headed?: string[];
}): SocialAccessService {
  const dataScope = {
    resolveManyOrNull: vi.fn().mockResolvedValue(opts.scopes),
    resolveContext: vi.fn().mockResolvedValue({
      userId: USER.id,
      companyId: USER.companyId,
      orgUnitId: opts.orgUnitId ?? null,
      managedUserIds: [],
      headedOrgUnitIds: opts.headed ?? [],
    }),
    departmentOrgUnitIds: (ctx: { orgUnitId: string | null; headedOrgUnitIds?: string[] }) => {
      const ids = new Set<string>();
      if (ctx.orgUnitId) ids.add(ctx.orgUnitId);
      for (const id of ctx.headedOrgUnitIds ?? []) ids.add(id);
      return [...ids];
    },
  } as unknown as DataScopeService;
  return new SocialAccessService(dataScope, makeGroups(opts.group));
}

/**
 * Cổng quyền nhóm giả — đúng hai câu hỏi mà `assertWriteAudience` hỏi nó (D4):
 *   • `assertGroupVisibleTx` — ném khi nhóm không thấy được (không tồn tại · xoá mềm · private mà
 *     mình không thuộc). Ở tầng UNIT ta chỉ cần biết nó ĐƯỢC GỌI và lỗi của nó LEO LÊN nguyên vẹn.
 *   • `getMembershipTx` — trả hàng membership hoặc `null`.
 * Hành vi THẬT của hai hàm này được đo trên DB ở `social-group-access.int.spec.ts`.
 */
function makeGroups(opts?: {
  visible?: boolean;
  membershipStatus?: "active" | "pending" | null;
}): SocialGroupAccessService {
  return {
    assertGroupVisibleTx: vi.fn(async () => {
      if (opts?.visible === false) throw new NotFoundException(SOCIAL_ERR.GROUP_NOT_FOUND);
      return { id: "g1", name: "N", visibility: "private", membership: null };
    }),
    getMembershipTx: vi.fn(async () =>
      opts?.membershipStatus == null ? null : { role: "member", status: opts.membershipStatus },
    ),
  } as unknown as SocialGroupAccessService;
}

describe("resolveActor — tầng guard THỨ HAI", () => {
  it("thiếu cặp của route ⇒ 403 AUTH-ERR-FORBIDDEN (độc lập với decorator)", async () => {
    const svc = makeService({ scopes: [null, null, null] });
    await expect(svc.resolveActor(USER, "feedList")).rejects.toThrowError(ForbiddenException);
    await expect(svc.resolveActor(USER, "feedList")).rejects.toThrowError(/AUTH-ERR-FORBIDDEN/);
  });

  it("SÀN SCOPE: có cặp nhưng scope HẸP HƠN Company ⇒ 403, KHÔNG 'coi như' Company", async () => {
    // Một lần đổi `data_scope` per-pair sau này không được âm thầm NỚI thành toàn công ty — đây là
    // nhánh chặn điều đó (khuôn `dash-widget-gate-needs-scope-floor`).
    for (const narrow of ["Department", "Team", "Own"] as DataScope[]) {
      const svc = makeService({ scopes: [narrow, null, null] });
      await expect(svc.resolveActor(USER, "feedList")).rejects.toThrowError(
        /AUTH-ERR-SCOPE-DENIED/,
      );
    }
  });

  it("scope `System` được chấp nhận như `Company`", async () => {
    const svc = makeService({ scopes: ["System", null, null] });
    const actor = await svc.resolveActor(USER, "feedList");
    expect(actor.routeScope).toBe("System");
  });

  it("hai cờ phụ đọc THEO CHỈ SỐ — không cờ nào bật khi grant tương ứng là null", async () => {
    const svc = makeService({ scopes: ["Company", null, null] });
    const actor = await svc.resolveActor(USER, "feedList");
    expect(actor.canManagePosts).toBe(false);
    expect(actor.canManageNews).toBe(false);
  });

  it("cờ bật ĐỘC LẬP: chỉ `manage:feed-post`, chỉ `manage:feed-news`, hoặc cả hai", async () => {
    const onlyPost = await makeService({ scopes: ["Company", "Company", null] }).resolveActor(
      USER,
      "feedList",
    );
    expect([onlyPost.canManagePosts, onlyPost.canManageNews]).toEqual([true, false]);

    const onlyNews = await makeService({ scopes: ["Company", null, "Company"] }).resolveActor(
      USER,
      "feedList",
    );
    expect([onlyNews.canManagePosts, onlyNews.canManageNews]).toEqual([false, true]);

    const both = await makeService({ scopes: ["Company", "Company", "Company"] }).resolveActor(
      USER,
      "feedList",
    );
    expect([both.canManagePosts, both.canManageNews]).toEqual([true, true]);
  });

  it("D13 — `orgUnitIds` = đơn vị của mình ∪ đơn vị mình ĐỨNG ĐẦU, KHÔNG cây con", async () => {
    const svc = makeService({
      scopes: ["Company", null, null],
      orgUnitId: "unit-own",
      headed: ["unit-headed", "unit-own"],
    });
    const actor = await svc.resolveActor(USER, "feedList");
    expect([...actor.orgUnitIds].sort()).toEqual(["unit-headed", "unit-own"]);
  });

  it("không thuộc đơn vị nào và không đứng đầu đơn vị nào ⇒ tập RỖNG (fail-closed, không match-all)", async () => {
    const svc = makeService({ scopes: ["Company", null, null], orgUnitId: null, headed: [] });
    expect((await svc.resolveActor(USER, "feedList")).orgUnitIds).toEqual([]);
  });

  it("cặp của route được hỏi kèm cờ `isSensitive` lấy TỪ BẢNG (không gõ lại literal)", async () => {
    const dataScope = {
      resolveManyOrNull: vi.fn().mockResolvedValue(["Company", null, null, null]),
      resolveContext: vi.fn().mockResolvedValue({ orgUnitId: null, headedOrgUnitIds: [] }),
      departmentOrgUnitIds: () => [],
    } as unknown as DataScopeService;
    const svc = new SocialAccessService(dataScope, makeGroups());
    await svc.resolveActor(USER, "postCreate");

    const requests = (dataScope.resolveManyOrNull as ReturnType<typeof vi.fn>).mock.calls[0][2];
    expect(requests[0]).toEqual({
      action: "create",
      resourceType: "feed-post",
      isSensitive: false,
    });
    // BA cờ phụ khai `isSensitive` TƯỜNG MINH — quên cờ thì wildcard `*:*` mở khoá chúng.
    expect(requests[1].isSensitive).toBe(false);
    expect(requests[2].isSensitive).toBe(false);
    // S16-SOCIAL-BE-2A (D9): cặp thứ tư là `manage:feed-group`, và CỐ Ý **không** có
    // `create:feed-group` (nó đã là cặp của route `031` ở [0] — hỏi hai lần là hai vai đè nhau).
    expect(requests[3]).toEqual({
      action: "manage",
      resourceType: "feed-group",
      isSensitive: false,
    });
    expect(requests).toHaveLength(4);
  });
});

describe("assertWriteAudience — nhánh GHI (403 `ERR-002` chỉ ở đây)", () => {
  // ⟲ S16-SOCIAL-BE-2A (D4): hàm ĐÃ thành `async` và nhận `(tx, actor, audience, orgUnitId, groupId)`.
  // `tx` ở tầng unit là placeholder — nhánh `org_unit` không chạm DB, nhánh `group` chỉ chuyển `tx`
  // thẳng cho `SocialGroupAccessService` (đã giả lập).
  const TX = {} as never;
  const actor = (orgUnitIds: string[]): SocialViewerContext => ({
    actorUserId: USER.id,
    companyId: USER.companyId,
    canManagePosts: false,
    orgUnitIds,
  });

  it("`company` luôn hợp lệ", async () => {
    const svc = makeService({ scopes: ["Company", null, null, null] });
    await expect(
      svc.assertWriteAudience(TX, actor([]) as never, "company", null, null),
    ).resolves.toBeUndefined();
  });

  it("`group` + thành viên `active` ⇒ hợp lệ (cửa đã MỞ từ BE-2A)", async () => {
    const svc = makeService({
      scopes: ["Company", null, null, null],
      group: { membershipStatus: "active" },
    });
    await expect(
      svc.assertWriteAudience(TX, actor([]) as never, "group", null, "g1"),
    ).resolves.toBeUndefined();
  });

  it("`group` + hàng `pending` ⇒ 403 SOCIAL-ERR-002 (xin vào KHÔNG phải là thành viên)", async () => {
    const svc = makeService({
      scopes: ["Company", null, null, null],
      group: { membershipStatus: "pending" },
    });
    await expect(
      svc.assertWriteAudience(TX, actor([]) as never, "group", null, "g1"),
    ).rejects.toThrowError(SOCIAL_ERR.WRITE_OUT_OF_AUDIENCE);
  });

  it("`group` + KHÔNG có hàng membership ⇒ 403 SOCIAL-ERR-002 (kể cả nhóm public)", async () => {
    const svc = makeService({
      scopes: ["Company", null, null, null],
      group: { membershipStatus: null },
    });
    await expect(
      svc.assertWriteAudience(TX, actor([]) as never, "group", null, "g1"),
    ).rejects.toThrowError(SOCIAL_ERR.WRITE_OUT_OF_AUDIENCE);
  });

  it("🔴 `group` KHÔNG thấy được ⇒ 404 ERR-012 LEO LÊN nguyên vẹn, KHÔNG bị nuốt thành 403", async () => {
    const svc = makeService({
      scopes: ["Company", null, null, null],
      group: { visible: false, membershipStatus: "active" },
    });
    // 404 TRƯỚC 403: một nhóm kín (hoặc đã xoá mềm) không được lộ ra qua việc đổi mã lỗi.
    await expect(
      svc.assertWriteAudience(TX, actor([]) as never, "group", null, "g1"),
    ).rejects.toThrowError(SOCIAL_ERR.GROUP_NOT_FOUND);
  });

  it("`org_unit` thiếu khoá ⇒ 422 SOCIAL-ERR-008", async () => {
    const svc = makeService({ scopes: ["Company", null, null, null] });
    await expect(
      svc.assertWriteAudience(TX, actor(["u1"]) as never, "org_unit", null, null),
    ).rejects.toThrowError(SOCIAL_ERR.AUDIENCE_KEY_MISSING);
  });

  it("`org_unit` mà actor KHÔNG thuộc ⇒ 403 SOCIAL-ERR-002", async () => {
    const svc = makeService({ scopes: ["Company", null, null, null] });
    await expect(
      svc.assertWriteAudience(TX, actor(["u1"]) as never, "org_unit", "u2", null),
    ).rejects.toThrowError(SOCIAL_ERR.WRITE_OUT_OF_AUDIENCE);
  });

  it("`org_unit` mà actor THUỘC ⇒ hợp lệ", async () => {
    const svc = makeService({ scopes: ["Company", null, null, null] });
    await expect(
      svc.assertWriteAudience(TX, actor(["u1", "u2"]) as never, "org_unit", "u2", null),
    ).resolves.toBeUndefined();
  });

  it("tập org_unit RỖNG ⇒ MỌI đơn vị bị từ chối (fail-closed)", async () => {
    const svc = makeService({ scopes: ["Company", null, null, null] });
    await expect(
      svc.assertWriteAudience(TX, actor([]) as never, "org_unit", "u1", null),
    ).rejects.toThrowError(ForbiddenException);
  });
});

describe("assertCanMutateContent — chủ sở hữu HOẶC `manage:feed-post`", () => {
  const svc = makeService({ scopes: ["Company", null, null] });
  const viewer = (canManagePosts: boolean): SocialViewerContext => ({
    actorUserId: USER.id,
    companyId: USER.companyId,
    canManagePosts,
    orgUnitIds: [],
  });

  it("TÁC GIẢ ⇒ cho phép, và trả `false` (không hành động với tư cách quản lý ⇒ KHÔNG audit)", () => {
    expect(svc.assertCanMutateContent(viewer(false), USER.id)).toBe(false);
  });

  it("người khác + `manage:feed-post` ⇒ cho phép, trả `true` (⇒ CÓ audit)", () => {
    expect(svc.assertCanMutateContent(viewer(true), "someone-else")).toBe(true);
  });

  it("người khác + KHÔNG manage ⇒ 403 SOCIAL-ERR-003", () => {
    try {
      svc.assertCanMutateContent(viewer(false), "someone-else");
      expect.unreachable("phải ném");
    } catch (e) {
      expect(e).toBeInstanceOf(ForbiddenException);
      expect((e as Error).message).toBe(SOCIAL_ERR.NOT_CONTENT_OWNER);
    }
  });

  it("TÁC GIẢ có manage vẫn trả `false` (sửa bài CỦA MÌNH không phải hành động quản lý)", () => {
    expect(svc.assertCanMutateContent(viewer(true), USER.id)).toBe(false);
  });
});

describe("isCompany", () => {
  it("chỉ `Company`/`System` là sàn hợp lệ", () => {
    expect(SocialAccessService.isCompany("Company")).toBe(true);
    expect(SocialAccessService.isCompany("System")).toBe(true);
    for (const s of ["Department", "Team", "Own", null] as (DataScope | null)[]) {
      expect(SocialAccessService.isCompany(s)).toBe(false);
    }
  });
});

describe("resolveViewerContext — đường cho `FilePolicyService` (không có routeKey)", () => {
  it("KHÔNG assert cặp nào, chỉ trả nguyên liệu dựng vị từ", async () => {
    const svc = makeService({ scopes: [null], orgUnitId: "u1", headed: [] });
    const viewer = await svc.resolveViewerContext(USER.id, USER.companyId);
    expect(viewer.actorUserId).toBe(USER.id);
    expect(viewer.canManagePosts).toBe(false);
    expect(viewer.orgUnitIds).toEqual(["u1"]);
  });

  it("có `manage:feed-post` ⇒ cờ bật", async () => {
    const svc = makeService({ scopes: ["Company"], orgUnitId: null, headed: ["u9"] });
    const viewer = await svc.resolveViewerContext(USER.id, USER.companyId);
    expect(viewer.canManagePosts).toBe(true);
    expect(viewer.orgUnitIds).toEqual(["u9"]);
  });
});

describe("visiblePostCondition — dựng được vị từ cho mọi tổ hợp actor", () => {
  // Vế HÀNH VI của vị từ này chạy THẬT trên Postgres ở `social-be1-visibility.int-spec.ts`; ở đây
  // chỉ đảm bảo mọi NHÁNH dựng SQL đều chạy được và không ném.
  const svc = makeService({ scopes: ["Company", null, null] });
  const viewer = (canManagePosts: boolean, orgUnitIds: string[]): SocialViewerContext => ({
    actorUserId: USER.id,
    companyId: USER.companyId,
    canManagePosts,
    orgUnitIds,
  });

  it("người thường, KHÔNG đơn vị", () => {
    expect(svc.visiblePostCondition(viewer(false, []))).toBeDefined();
  });

  it("người thường, CÓ đơn vị", () => {
    expect(svc.visiblePostCondition(viewer(false, ["u1", "u2"]))).toBeDefined();
  });

  it("`manage:feed-post`, KHÔNG đơn vị", () => {
    expect(svc.visiblePostCondition(viewer(true, []))).toBeDefined();
  });

  it("`manage:feed-post`, CÓ đơn vị", () => {
    expect(svc.visiblePostCondition(viewer(true, ["u1"]))).toBeDefined();
  });
});
/**
 * S16-SOCIAL-ATTDEBT-1 (F1) — **U1/U2**: ảnh chụp cổng gắn tệp.
 *
 * Từ WO này `resolveAttachNewGate` KHÔNG còn hỏi DB — nó đọc ảnh chụp mà `resolveActor` đã nạp
 * trong CÙNG lượt đọc grant. Hai nhóm ca dưới đây đo hai nửa của bất biến đó: ảnh chụp được DỰNG
 * đúng (U2) và được ĐỌC fail-closed (U1).
 */
describe("S16-SOCIAL-ATTDEBT-1 — ảnh chụp cổng gắn tệp (F1)", () => {
  const FILE_DENIED_POST = SOCIAL_ERR.FILE_TARGET_POST_DENIED;
  const FILE_DENIED_COMMENT = SOCIAL_ERR.FILE_TARGET_COMMENT_DENIED;

  /**
   * U2 — `resolveActor` gửi phần tử thứ 5 CHỈ cho `postUpdate`/`commentUpdate`.
   *
   * 🔴 Ca «48 route còn lại gửi ĐÚNG 4 request» là lưới hồi quy ở mức đơn vị cho đường nóng: nếu ai
   * gộp cặp VÔ ĐIỀU KIỆN (lối (a) đã bị loại), ca đó đỏ ngay mà không cần dựng DB.
   */
  it("U2 — `postUpdate` gửi 5 request, phần tử [4] là `create:feed-post` (bóc tay 3 field)", async () => {
    const svc = makeService({
      scopes: ["Company", null, null, null, "Company"],
    });
    const ds = (svc as unknown as { dataScope: DataScopeService }).dataScope;
    await svc.resolveActor(USER, "postUpdate");
    const requests = (ds.resolveManyOrNull as ReturnType<typeof vi.fn>).mock
      .calls[0][2];
    expect(requests).toHaveLength(5);
    expect(requests[4]).toEqual({
      action: "create",
      resourceType: "feed-post",
      isSensitive: false,
    });
    // [0..3] KHÔNG đổi thứ tự — chèn ở đầu/giữa là leo thang quyền (xem khối 🔴 ở `resolveActor`).
    expect(requests[1]).toEqual({
      action: "manage",
      resourceType: "feed-post",
      isSensitive: false,
    });
  });

  it("U2 — `commentUpdate` gửi `create:feed-comment` ở [4]", async () => {
    const svc = makeService({
      scopes: ["Company", null, null, null, "Company"],
    });
    const ds = (svc as unknown as { dataScope: DataScopeService }).dataScope;
    await svc.resolveActor(USER, "commentUpdate");
    const requests = (ds.resolveManyOrNull as ReturnType<typeof vi.fn>).mock
      .calls[0][2];
    expect(requests[4]).toEqual({
      action: "create",
      resourceType: "feed-comment",
      isSensitive: false,
    });
  });

  it("U2 — route KHÔNG đính kèm gửi ĐÚNG 4 request (hồi quy 48 route)", async () => {
    const svc = makeService({ scopes: ["Company", null, null, null] });
    const ds = (svc as unknown as { dataScope: DataScopeService }).dataScope;
    const actor = await svc.resolveActor(USER, "postCreate");
    const requests = (ds.resolveManyOrNull as ReturnType<typeof vi.fn>).mock
      .calls[0][2];
    expect(requests).toHaveLength(4);
    expect(actor.attachNewGate).toEqual({ resolved: false });
  });

  /**
   * U1 — ma trận fail-CLOSED của `resolveAttachNewGate`.
   *
   * 🔴 Ca `undefined` KHÔNG phải phòng thủ thừa: 2 trong 3 chỗ dựng `SocialActor` dùng
   * `as SocialActor`, và TypeScript chỉ bắt được MỘT trong hai (đo 24/09/2026 — site chỉ có vài
   * thuộc tính thì assertion được chấp nhận, xem `social-news-noti-cap.spec.ts:52`). Hợp đồng ở ca
   * này là **DENY có thông điệp**, KHÔNG phải `TypeError` (một 500 vô danh mô tả sai hoàn toàn).
   */
  const gateCases: Array<
    [string, unknown, "post" | "comment", boolean, string]
  > = [
    [
      "ảnh chụp VẮNG (actor dựng bằng `as` cast)",
      undefined,
      "post",
      false,
      FILE_DENIED_POST,
    ],
    [
      "route KHÔNG pre-resolve",
      { resolved: false },
      "post",
      false,
      FILE_DENIED_POST,
    ],
    [
      "ảnh chụp của target KHÁC (comment hỏi bằng ảnh của post)",
      { resolved: true, target: "post", scope: "Company" },
      "comment",
      false,
      FILE_DENIED_COMMENT,
    ],
    [
      "scope null",
      { resolved: true, target: "post", scope: null },
      "post",
      false,
      FILE_DENIED_POST,
    ],
    [
      "scope hẹp hơn Company (Department)",
      { resolved: true, target: "post", scope: "Department" },
      "post",
      false,
      FILE_DENIED_POST,
    ],
    [
      "scope Company",
      { resolved: true, target: "post", scope: "Company" },
      "post",
      true,
      "",
    ],
    [
      "scope System",
      { resolved: true, target: "comment", scope: "System" },
      "comment",
      true,
      "",
    ],
  ];

  it.each(gateCases)("U1 — %s", async (_name, snap, target, allow, reason) => {
    const svc = makeService({ scopes: ["Company", null, null, null] });
    const actor = {
      actorUserId: USER.id,
      companyId: USER.companyId,
      routeKey: target === "post" ? "postUpdate" : "commentUpdate",
      routeScope: "Company",
      canManagePosts: false,
      canManageNews: false,
      canManageGroups: false,
      orgUnitIds: [],
      attachNewGate: snap,
    } as unknown as Parameters<SocialAccessService["resolveAttachNewGate"]>[0];

    const gate = await svc.resolveAttachNewGate(actor, target);
    expect(gate.allow).toBe(allow);
    if (!allow) {
      // Assert THAM CHIẾU HẰNG, không phải chuỗi gõ tay — hai hằng khác nhau theo target là cả
      // điểm của ảnh chụp mang `target`.
      expect(gate.allow === false && gate.reason).toBe(reason);
    }
  });

  it("U1 — ảnh chụp VẮNG cho DENY, KHÔNG ném TypeError", async () => {
    const svc = makeService({ scopes: ["Company", null, null, null] });
    const actor = {
      actorUserId: USER.id,
      companyId: USER.companyId,
      routeKey: "postUpdate",
    };
    await expect(
      svc.resolveAttachNewGate(
        actor as unknown as Parameters<
          SocialAccessService["resolveAttachNewGate"]
        >[0],
        "post",
      ),
    ).resolves.toEqual({ allow: false, reason: FILE_DENIED_POST });
  });
});
