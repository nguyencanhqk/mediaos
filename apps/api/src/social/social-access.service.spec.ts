import { ForbiddenException, UnprocessableEntityException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { DataScope } from "@mediaos/contracts";
import type { DataScopeService } from "../permission/data-scope.service";
import { SocialAccessService } from "./social-access.service";
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
  return new SocialAccessService(dataScope);
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
      resolveManyOrNull: vi.fn().mockResolvedValue(["Company", null, null]),
      resolveContext: vi.fn().mockResolvedValue({ orgUnitId: null, headedOrgUnitIds: [] }),
      departmentOrgUnitIds: () => [],
    } as unknown as DataScopeService;
    const svc = new SocialAccessService(dataScope);
    await svc.resolveActor(USER, "postCreate");

    const requests = (dataScope.resolveManyOrNull as ReturnType<typeof vi.fn>).mock.calls[0][2];
    expect(requests[0]).toEqual({
      action: "create",
      resourceType: "feed-post",
      isSensitive: false,
    });
    // Hai cờ phụ khai `isSensitive` TƯỜNG MINH — quên cờ thì wildcard `*:*` mở khoá chúng.
    expect(requests[1].isSensitive).toBe(false);
    expect(requests[2].isSensitive).toBe(false);
  });
});

describe("assertWriteAudience — nhánh GHI (403 `ERR-002` chỉ ở đây)", () => {
  const svc = makeService({ scopes: ["Company", null, null] });
  const actor = (orgUnitIds: string[]): SocialViewerContext => ({
    actorUserId: USER.id,
    companyId: USER.companyId,
    canManagePosts: false,
    orgUnitIds,
  });

  it("`company` luôn hợp lệ", () => {
    expect(() => svc.assertWriteAudience(actor([]) as never, "company", null)).not.toThrow();
  });

  it("`group` ⇒ 422 SOCIAL-ERR-008 (D1 — chưa mở)", () => {
    try {
      svc.assertWriteAudience(actor([]) as never, "group", null);
      expect.unreachable("phải ném");
    } catch (e) {
      expect(e).toBeInstanceOf(UnprocessableEntityException);
      expect((e as Error).message).toBe(SOCIAL_ERR.AUDIENCE_GROUP_NOT_AVAILABLE);
    }
  });

  it("`org_unit` thiếu khoá ⇒ 422 SOCIAL-ERR-008", () => {
    try {
      svc.assertWriteAudience(actor(["u1"]) as never, "org_unit", null);
      expect.unreachable("phải ném");
    } catch (e) {
      expect(e).toBeInstanceOf(UnprocessableEntityException);
      expect((e as Error).message).toBe(SOCIAL_ERR.AUDIENCE_KEY_MISSING);
    }
  });

  it("`org_unit` mà actor KHÔNG thuộc ⇒ 403 SOCIAL-ERR-002", () => {
    try {
      svc.assertWriteAudience(actor(["u1"]) as never, "org_unit", "u2");
      expect.unreachable("phải ném");
    } catch (e) {
      expect(e).toBeInstanceOf(ForbiddenException);
      expect((e as Error).message).toBe(SOCIAL_ERR.WRITE_OUT_OF_AUDIENCE);
    }
  });

  it("`org_unit` mà actor THUỘC ⇒ hợp lệ", () => {
    expect(() =>
      svc.assertWriteAudience(actor(["u1", "u2"]) as never, "org_unit", "u2"),
    ).not.toThrow();
  });

  it("tập org_unit RỖNG ⇒ MỌI đơn vị bị từ chối (fail-closed)", () => {
    expect(() => svc.assertWriteAudience(actor([]) as never, "org_unit", "u1")).toThrowError(
      ForbiddenException,
    );
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
