/**
 * S16-SOCIAL-DASH-1 — ca đơn vị cho `DashboardWidgetSocialHandlers` (plan `docs/plans/S16-SOCIAL-DASH-1.md`
 * §5.3, U1–U8). KHÔNG DB.
 *
 * Nguồn SOCIAL là stub; CẶP gate · SÀN scope · TTL · mục catalog là HẰNG THẬT — stub cả hằng là tự viết ra
 * một thế giới khác rồi test nó.
 *
 * Vì sao cần ca đơn vị dù đã có `test/integration/dashboard-social-widgets.int-spec.ts`:
 *   • identity cache per-user (U1 · U2) KHÔNG quan sát được qua HTTP dưới TTL 0 (không bao giờ có lượt hit);
 *   • `unackedCount === null` (U7) không tái hiện được trên đường thật — `list()` luôn trả số khi `countOnly`;
 *   • scope `System` (U3 · U4) không gieo được bằng fixture vai thường;
 *   • cổng CHỒNG: nguồn SOCIAL cũng 403 khi thiếu cặp / dưới sàn, nên trên đường thật chỉ THÔNG ĐIỆP phân
 *     biệt được «cổng DASH chặn» với «nguồn chặn». Ở đây nguồn là stub ⇒ U3 · U4 · U5 đo riêng cổng DASH.
 */
import { ForbiddenException, HttpException } from "@nestjs/common";
import type { DataScope, FeedEngagementWeekDto, FeedNewsPageDto } from "@mediaos/contracts";
import { describe, expect, it, vi } from "vitest";
import type { DataScopeService } from "../permission/data-scope.service";
import type { PermissionService } from "../permission/permission.service";
import type { SocialNewsService } from "../social/social-news.service";
import type { SocialStatsService } from "../social/social-stats.service";
import {
  DASH_DEFAULT_CONFIG,
  DASH_WIDGET_CATALOG,
  DASH_WIDGET_GATE_PAIR,
  DASH_WIDGET_MIN_DATA_SCOPE,
} from "./dashboard-widget-catalog.const";
import { DASH_WIDGET_TTL_SECONDS, ttlSecondsFor } from "./dashboard-widget-data.const";
import type { WidgetHandlerContext, WidgetRequestUser } from "./dashboard-widget-data.types";
import { DashboardWidgetSocialHandlers } from "./dashboard-widget-social.handlers";

const CODE_1 = "SOCIAL_ENGAGEMENT_WEEK";
const CODE_2 = "SOCIAL_NEWS_UNACKED";
type SocialCode = typeof CODE_1 | typeof CODE_2;

const DENY_PAIR_1 = "AUTH-ERR-FORBIDDEN: thiếu quyền view:feed-report";
const DENY_FLOOR_1 = "AUTH-ERR-FORBIDDEN: thiếu quyền view:feed-report ở phạm vi đủ rộng";
const DENY_PAIR_2 = "AUTH-ERR-FORBIDDEN: thiếu quyền view:feed";
const DENY_FLOOR_2 = "AUTH-ERR-FORBIDDEN: thiếu quyền view:feed ở phạm vi đủ rộng";

const EMPTY_1 = "Tuần này chưa có tương tác nào trong phạm vi của bạn";
const EMPTY_2 = "Bạn đã xác nhận hết các tin cần đọc";

const user: WidgetRequestUser = { id: "u-viewer", companyId: "co-1", viaApiKey: undefined };

const WEEK: FeedEngagementWeekDto = {
  weekStart: "2026-10-12",
  posts: 7,
  comments: 5,
  reactions: 11,
  activeMembers: 4,
};
const ZERO_WEEK: FeedEngagementWeekDto = {
  weekStart: "2026-10-12",
  posts: 0,
  comments: 0,
  reactions: 0,
  activeMembers: 0,
};

const pageOf = (unackedCount: number | null): FeedNewsPageDto => ({
  data: [],
  nextCursor: null,
  unackedCount,
});

/** Ngữ cảnh với mục catalog THẬT của widget — `ttlSecondsFor` đọc `entry.moduleCode`, không stub được. */
function ctxOf(code: SocialCode): WidgetHandlerContext {
  const entry = DASH_WIDGET_CATALOG.find((e) => e.widgetCode === code);
  if (!entry) throw new Error(`DASH_WIDGET_CATALOG chưa có mục ${code}`);
  return { user, dashboardType: "Employee", entry, query: {} };
}

interface Wiring {
  /** Kết quả `PermissionService.can()` — mặc định cho qua. */
  allow?: boolean;
  /** Scope mà `DataScopeService.resolveAndAssert` trả — mặc định `Company`. */
  scope?: DataScope;
  week?: () => Promise<FeedEngagementWeekDto>;
  page?: () => Promise<FeedNewsPageDto>;
}

function wire(opts: Wiring = {}) {
  const allow = opts.allow ?? true;
  const can = vi.fn(async () => ({
    allow,
    reason: allow ? ("allow" as const) : ("deny-default" as const),
    auditRequired: false,
  }));
  const resolveAndAssert = vi.fn(async (): Promise<DataScope> => opts.scope ?? "Company");
  const weeklyEngagementForWidget = vi.fn(opts.week ?? (async () => WEEK));
  const list = vi.fn(opts.page ?? (async () => pageOf(3)));
  const handlers = new DashboardWidgetSocialHandlers(
    { can } as unknown as PermissionService,
    { resolveAndAssert } as unknown as DataScopeService,
    { weeklyEngagementForWidget } as unknown as SocialStatsService,
    { list } as unknown as SocialNewsService,
  );
  return { handlers, can, resolveAndAssert, weeklyEngagementForWidget, list };
}

/**
 * Lỗi mà một lời gọi NÉM. Dùng thay `rejects.toThrowError(chuỗi)`: phép đó so «chứa chuỗi con», mà thông
 * điệp «thiếu cặp» lại là TIỀN TỐ của thông điệp «dưới sàn» ⇒ hai tầng 403 sẽ không phân biệt được.
 */
async function rejectionOf(call: Promise<unknown>): Promise<unknown> {
  try {
    await call;
  } catch (err) {
    return err;
  }
  throw new Error("lời gọi KHÔNG ném — kỳ vọng reject");
}

function expectForbidden(err: unknown, message: string): void {
  expect(err).toBeInstanceOf(ForbiddenException);
  expect((err as Error).message).toBe(message);
}

describe("S16-SOCIAL-DASH-1 · hằng catalog của 2 widget SOCIAL (bảng §0 của plan)", () => {
  it("U0 · hai mục catalog · cặp gate · sàn scope đúng bảng §0 (migration 0592 + FE chép CÙNG bảng)", () => {
    expect(DASH_WIDGET_CATALOG.filter((e) => e.widgetCode.startsWith("SOCIAL_"))).toEqual([
      {
        widgetCode: CODE_1,
        moduleCode: "SOCIAL",
        name: "Tương tác tuần",
        requiredPermissionCode: "DASH.WIDGET.VIEW_SOCIAL_ENGAGEMENT_WEEK",
        defaultDataScope: "Department",
        widgetType: "Summary",
        dataSourceKey: "social-engagement-week",
        componentKey: "SocialEngagementWeekWidget",
      },
      {
        widgetCode: CODE_2,
        moduleCode: "SOCIAL",
        name: "Tin tức chưa đọc",
        requiredPermissionCode: "DASH.WIDGET.VIEW_SOCIAL_NEWS_UNACKED",
        defaultDataScope: "Own",
        widgetType: "Summary",
        dataSourceKey: "social-news-unacked",
        componentKey: "SocialNewsUnackedWidget",
      },
    ]);
    // Mỗi widget mượn ĐÚNG cặp của route nguồn (052 → view:feed-report · 020 → view:feed), không mượn chéo.
    expect(DASH_WIDGET_GATE_PAIR[CODE_1]).toEqual({ action: "view", resourceType: "feed-report" });
    expect(DASH_WIDGET_GATE_PAIR[CODE_2]).toEqual({ action: "view", resourceType: "feed" });
    // Hai sàn KHÁC nhau và khác lý do: 001 = Own/Team nhận số 0 từ nguồn; 002 = `companyFloor` của route 020.
    expect(DASH_WIDGET_MIN_DATA_SCOPE[CODE_1]).toBe("Department");
    expect(DASH_WIDGET_MIN_DATA_SCOPE[CODE_2]).toBe("Company");
  });

  it("U0b · default config: 2 mã × 4 loại dashboard, @130 / @140 (lọc bằng cặp + sàn, không bằng vắng config)", () => {
    const social = DASH_DEFAULT_CONFIG.filter((e) => e.widgetCode.startsWith("SOCIAL_"));
    const types = ["Employee", "Manager", "HR", "Admin"];
    expect(social).toEqual([
      ...types.map((dashboardType) => ({ dashboardType, widgetCode: CODE_1, sortOrder: 130 })),
      ...types.map((dashboardType) => ({ dashboardType, widgetCode: CODE_2, sortOrder: 140 })),
    ]);
  });

  it("U8 · TTL 0 cho CẢ module SOCIAL (SOC-DEC-010: thống kê không cache) — đọc qua `ttlSecondsFor`", () => {
    const ttlByModule: Readonly<Record<string, number>> = DASH_WIDGET_TTL_SECONDS;
    expect(ttlByModule.SOCIAL).toBe(0);
    expect(ttlSecondsFor(ctxOf(CODE_1).entry)).toBe(0);
    expect(ttlSecondsFor(ctxOf(CODE_2).entry)).toBe(0);
  });
});

describe("S16-SOCIAL-DASH-1 · gate (cặp + SÀN scope, cùng hằng với registry)", () => {
  it.each(["Company", "Department"] as const)(
    "U1 · identity 001 @%s: per-user, `cacheScope` = scope đã resolve, TTL 0",
    async (scope) => {
      const { handlers, can, resolveAndAssert } = wire({ scope });
      await expect(handlers.gateEngagementWeek(ctxOf(CODE_1))).resolves.toEqual({
        shareScope: "user",
        cacheScope: scope,
        keyDiscriminator: null,
        scopeReferenceId: user.id,
        ttlSeconds: 0,
      });
      expect(can).toHaveBeenCalledWith({
        userId: user.id,
        companyId: user.companyId,
        action: "view",
        resourceType: "feed-report",
      });
      expect(resolveAndAssert).toHaveBeenCalledWith(user.id, user.companyId, "view", "feed-report");
    },
  );

  it("U2 · identity 002: per-user `Own` dù grant ở @Company (con số là của CHÍNH người xem), TTL 0", async () => {
    const { handlers, can, resolveAndAssert } = wire({ scope: "Company" });
    await expect(handlers.gateNewsUnacked(ctxOf(CODE_2))).resolves.toEqual({
      shareScope: "user",
      cacheScope: "Own",
      keyDiscriminator: null,
      scopeReferenceId: user.id,
      ttlSeconds: 0,
    });
    expect(can).toHaveBeenCalledWith({
      userId: user.id,
      companyId: user.companyId,
      action: "view",
      resourceType: "feed",
    });
    expect(resolveAndAssert).toHaveBeenCalledWith(user.id, user.companyId, "view", "feed");
  });

  it.each([
    ["Own", false],
    ["Team", false],
    ["Department", true],
    ["Company", true],
    ["System", true],
  ] as const)("U3 · 001 sàn `Department`: grant @%s ⇒ qua = %s", async (scope, passes) => {
    const { handlers, weeklyEngagementForWidget } = wire({ scope });
    const call = handlers.gateEngagementWeek(ctxOf(CODE_1));
    if (passes) {
      await expect(call).resolves.toMatchObject({ shareScope: "user", cacheScope: scope });
    } else {
      expectForbidden(await rejectionOf(call), DENY_FLOOR_1);
    }
    // gate ⊥ fetch: cổng không bao giờ chạm nguồn.
    expect(weeklyEngagementForWidget).not.toHaveBeenCalled();
  });

  it.each([
    ["Own", false],
    ["Team", false],
    ["Department", false],
    ["Company", true],
    ["System", true],
  ] as const)("U4 · 002 sàn `Company`: grant @%s ⇒ qua = %s", async (scope, passes) => {
    const { handlers, list } = wire({ scope });
    const call = handlers.gateNewsUnacked(ctxOf(CODE_2));
    if (passes) {
      await expect(call).resolves.toMatchObject({ shareScope: "user", cacheScope: "Own" });
    } else {
      expectForbidden(await rejectionOf(call), DENY_FLOOR_2);
    }
    expect(list).not.toHaveBeenCalled();
  });

  it("U5 · `can()` từ chối ⇒ 403 «thiếu quyền <cặp>» ở CẢ HAI widget; KHÔNG hỏi scope, KHÔNG chạm nguồn", async () => {
    const one = wire({ allow: false });
    expectForbidden(await rejectionOf(one.handlers.gateEngagementWeek(ctxOf(CODE_1))), DENY_PAIR_1);
    expect(one.resolveAndAssert).not.toHaveBeenCalled();
    expect(one.weeklyEngagementForWidget).not.toHaveBeenCalled();

    const two = wire({ allow: false });
    expectForbidden(await rejectionOf(two.handlers.gateNewsUnacked(ctxOf(CODE_2))), DENY_PAIR_2);
    expect(two.resolveAndAssert).not.toHaveBeenCalled();
    expect(two.list).not.toHaveBeenCalled();
  });
});

describe("S16-SOCIAL-DASH-1 · fetch «Tương tác tuần» (U6)", () => {
  it("có số ⇒ `Active` với ĐÚNG 5 khoá, gọi nguồn bằng chính `ctx.user`", async () => {
    const { handlers, weeklyEngagementForWidget, can, resolveAndAssert } = wire();
    const result = await handlers.fetchEngagementWeek(ctxOf(CODE_1));
    expect(result).toEqual({ status: "Active", data: { ...WEEK }, emptyState: null });
    expect(weeklyEngagementForWidget).toHaveBeenCalledTimes(1);
    expect(weeklyEngagementForWidget).toHaveBeenCalledWith(user);
    // gate ⊥ fetch: `fetch` không tự gác lại (cổng đã chạy ở `gateAndResolve`, nguồn tự gác tầng 2).
    expect(can).not.toHaveBeenCalled();
    expect(resolveAndAssert).not.toHaveBeenCalled();
  });

  it("nguồn trả THÊM khoá lạ ⇒ payload vẫn chỉ 5 khoá (liệt kê tường minh, không spread)", async () => {
    const widened = { ...WEEK, authorNames: ["Nguyễn A"], orgUnitId: "ou-1" };
    const { handlers } = wire({ week: async () => widened });
    const result = await handlers.fetchEngagementWeek(ctxOf(CODE_1));
    expect(Object.keys(result.data).sort()).toEqual(
      ["activeMembers", "comments", "posts", "reactions", "weekStart"].sort(),
    );
  });

  it("bài + bình luận + cảm xúc = 0 ⇒ `Empty` + chữ do server gửi", async () => {
    const { handlers } = wire({ week: async () => ZERO_WEEK });
    await expect(handlers.fetchEngagementWeek(ctxOf(CODE_1))).resolves.toEqual({
      status: "Empty",
      data: {},
      emptyState: { message: EMPTY_1 },
    });
  });

  it.each(["posts", "comments", "reactions"] as const)(
    "chỉ MỘT cột dương (%s) ⇒ vẫn `Active` — `Empty` xét TỔNG ba cột, không riêng số bài",
    async (column) => {
      const { handlers } = wire({ week: async () => ({ ...ZERO_WEEK, [column]: 1 }) });
      const result = await handlers.fetchEngagementWeek(ctxOf(CODE_1));
      expect(result.status).toBe("Active");
      expect(result.data).toEqual({ ...ZERO_WEEK, [column]: 1 });
    },
  );

  it("nguồn ném `Error` ⇒ reject bằng CHÍNH lỗi đó (không try/catch, không thành số 0)", async () => {
    const boom = new Error("SocialStatsService: không đọc được múi giờ công ty");
    const { handlers } = wire({
      week: async () => {
        throw boom;
      },
    });
    expect(await rejectionOf(handlers.fetchEngagementWeek(ctxOf(CODE_1)))).toBe(boom);
  });

  it("nguồn ném `ForbiddenException` (mất quyền giữa chừng) ⇒ reject bằng CHÍNH lỗi đó — không hạ thành `Empty`", async () => {
    const denied = new ForbiddenException("AUTH-ERR-FORBIDDEN: thiếu quyền view:feed-report");
    const { handlers } = wire({
      week: async () => {
        throw denied;
      },
    });
    expect(await rejectionOf(handlers.fetchEngagementWeek(ctxOf(CODE_1)))).toBe(denied);
  });
});

describe("S16-SOCIAL-DASH-1 · fetch «Tin tức chưa đọc» (U7)", () => {
  it("gọi nguồn 020 với ĐÚNG `{ limit: 1, countOnly: true }`; 3 ⇒ `Active` chỉ có `total`", async () => {
    const { handlers, list, can, resolveAndAssert } = wire({ page: async () => pageOf(3) });
    await expect(handlers.fetchNewsUnacked(ctxOf(CODE_2))).resolves.toEqual({
      status: "Active",
      data: { total: 3 },
      emptyState: null,
    });
    expect(list).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenCalledWith(user, { limit: 1, countOnly: true });
    expect(can).not.toHaveBeenCalled();
    expect(resolveAndAssert).not.toHaveBeenCalled();
  });

  it("0 ⇒ `Empty` + chữ do server gửi", async () => {
    const { handlers } = wire({ page: async () => pageOf(0) });
    await expect(handlers.fetchNewsUnacked(ctxOf(CODE_2))).resolves.toEqual({
      status: "Empty",
      data: {},
      emptyState: { message: EMPTY_2 },
    });
  });

  it("`unackedCount === null` («không hỏi») ⇒ NÉM lỗi thường — không thành 0, không thành 4xx", async () => {
    const { handlers } = wire({ page: async () => pageOf(null) });
    const err = await rejectionOf(handlers.fetchNewsUnacked(ctxOf(CODE_2)));
    expect(err).toBeInstanceOf(Error);
    // Lỗi THƯỜNG ⇒ runner hạ thành `Degraded`; `HttpException` thì đã thành status của client.
    expect(err).not.toBeInstanceOf(HttpException);
    expect((err as Error).message).toContain("unackedCount");
  });

  it("nguồn ném `ForbiddenException` (mất quyền giữa chừng) ⇒ reject bằng CHÍNH lỗi đó", async () => {
    const denied = new ForbiddenException(
      "AUTH-ERR-SCOPE-DENIED: cặp SOCIAL này chỉ hợp lệ ở scope Company",
    );
    const { handlers } = wire({
      page: async () => {
        throw denied;
      },
    });
    expect(await rejectionOf(handlers.fetchNewsUnacked(ctxOf(CODE_2)))).toBe(denied);
  });

  it("nguồn ném `Error` thường (DB lỗi, hết giờ) ⇒ reject bằng CHÍNH lỗi đó — không thành «đã xác nhận hết»", async () => {
    const boom = new Error("SocialNewsService: không đếm được tin chưa xác nhận");
    const { handlers } = wire({
      page: async () => {
        throw boom;
      },
    });
    expect(await rejectionOf(handlers.fetchNewsUnacked(ctxOf(CODE_2)))).toBe(boom);
  });

  it.each([
    ["undefined", undefined],
    ["NaN", Number.NaN],
    ["số âm", -1],
    ["số lẻ", 1.5],
    ["chuỗi số", "3"],
  ])(
    "`unackedCount` là %s (hợp đồng với nguồn vỡ) ⇒ NÉM lỗi thường — không vẽ `Active` với số rác",
    async (_label, bad) => {
      // Ép kiểu CÓ CHỦ Ý: giá trị này vi phạm hợp đồng `number | null` của nguồn — đúng thứ ca đang đo.
      const { handlers } = wire({ page: async () => pageOf(bad as never) });
      const err = await rejectionOf(handlers.fetchNewsUnacked(ctxOf(CODE_2)));
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(HttpException);
      expect((err as Error).message).toContain("unackedCount");
    },
  );
});
