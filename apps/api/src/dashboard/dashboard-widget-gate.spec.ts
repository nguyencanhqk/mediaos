/**
 * S14-PERF-DASHACTOR-1 — cổng cho `gateWidgetOrThrow`, bản DUY NHẤT thay 4 bản `gateOrThrow` từng
 * chép qua chép lại giữa `dashboard-widget-handlers.service.ts` · `-office` · `-recruit` · `-payroll`.
 *
 * Bản gộp chạy dưới CẢ BỐN nhóm widget, nên một lỗi ở đây hỏng cả bốn cùng lúc — đó là cái giá của
 * việc gộp, và là lý do phải có ca ghim riêng cho nó thay vì dựa vào int-spec của từng widget.
 */
import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { gateWidgetOrThrow } from "./dashboard-widget-gate";
import { PermissionService } from "../permission/permission.service";
import type {
  CompanyRoleGrant,
  IPermissionRepository,
  PermissionCatalogEntry,
} from "../permission/permission.types";
import type { WidgetRequestUser } from "./dashboard-widget-data.types";

const user: WidgetRequestUser = { id: "u1", companyId: "co1" } as unknown as WidgetRequestUser;

/** `can()` cố định — dùng cho ca allow/deny thuần. */
function stubPermission(allow: boolean) {
  const can = vi.fn(async () => ({
    allow,
    reason: allow ? ("allow" as const) : ("deny-default" as const),
    auditRequired: false,
  }));
  return { svc: { can } as unknown as PermissionService, can };
}

/**
 * Catalog thu-nhỏ NHƯNG THẬT: `view-line:payroll-period` là cặp SENSITIVE (mig 0565), `view:candidate`
 * cũng vậy, `read:notification` thì không. Cờ ở đây phải khớp seed thật — sai cờ là tự viết ra một
 * thế giới khác rồi test nó.
 */
const MINI_CATALOG: PermissionCatalogEntry[] = [
  // mig 0565:191
  { id: "p-payroll-line", action: "view-line", resourceType: "payroll-period", isSensitive: true },
  // mig 0560:84
  { id: "p-candidate", action: "view", resourceType: "candidate", isSensitive: true },
  // mig 0554:58 — NON-sensitive: nguồn của ca ĐỐI CHỨNG «wildcard vẫn qua widget thường»
  { id: "p-room", action: "view", resourceType: "room", isSensitive: false },
  // mig 0550:62
  { id: "p-asset", action: "view", resourceType: "asset", isSensitive: false },
];

/**
 * `can()` chạy ENGINE THẬT trên một tập grant cho trước — cần cho ca wildcard, vì ca đó hỏi «engine
 * quyết thế nào», không phải «stub trả gì».
 *
 * ⚠️ S14-SEC-DASHGATE-WILDCARD-1: bản trước gọi THẲNG `decideCan`, tức bỏ qua `PermissionService` —
 * mà chính `PermissionService` mới là chỗ bơm cờ catalog của CẶP ĐÍCH (`pairIsSensitive`). Gọi thẳng
 * hàm thuần thì ca wildcard dưới đây vẫn XANH sau khi lỗ đã được vá: nó đo một đường mà sản phẩm
 * không đi. Nay dựng `PermissionService` THẬT trên stub repo, để catalog tham gia quyết định.
 */
function permissionOverGrants(grants: CompanyRoleGrant[]): PermissionService {
  const repo: IPermissionRepository = {
    getCompanyRoleGrants: async () => grants,
    getCompanyRoleGrantsWithScope: async () => grants.map((g) => ({ ...g, dataScope: "Company" })),
    getObjectGrants: async () => [],
    getObjectGrantsBatch: async () => new Map(),
    getPermissionsByIds: async () => MINI_CATALOG,
    getAllPermissions: async () => MINI_CATALOG,
  };
  return new PermissionService(repo);
}

describe("gateWidgetOrThrow", () => {
  it("allow ⇒ trả ĐÚNG EnginePair của widget (cặp MODULE NGUỒN, không phải cặp DASH)", async () => {
    const { svc, can } = stubPermission(true);
    await expect(gateWidgetOrThrow(svc, user, "PAYROLL_COST")).resolves.toEqual({
      action: "view-line",
      resourceType: "payroll-period",
    });
    // Cặp ĐỌC-TIỀN, KHÔNG phải `view:payroll-period` (cố ý non-sensitive) và KHÔNG phải cặp GHI.
    expect(can).toHaveBeenCalledWith(
      expect.objectContaining({ action: "view-line", resourceType: "payroll-period" }),
    );
  });

  it("deny ⇒ 403 fail-closed, KHÔNG nuốt thành Degraded", async () => {
    const { svc } = stubPermission(false);
    await expect(gateWidgetOrThrow(svc, user, "RECRUIT_FUNNEL")).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(gateWidgetOrThrow(svc, user, "RECRUIT_FUNNEL")).rejects.toThrowError(
      "AUTH-ERR-FORBIDDEN: thiếu quyền view:candidate",
    );
  });

  it("widget thiếu cặp gate ⇒ 403 DASH-ERR, KHÔNG 'cho qua vì không biết gác gì'", async () => {
    const { svc, can } = stubPermission(true);
    await expect(gateWidgetOrThrow(svc, user, "WIDGET_KHONG_TON_TAI")).rejects.toThrowError(
      /widget thiếu cặp gate/,
    );
    expect(can).not.toHaveBeenCalled(); // ném TRƯỚC khi hỏi engine
  });

  it("mọi widget đều đi qua CÙNG một hàm — 4 mã widget của 4 nhóm handler cho 4 cặp khác nhau", async () => {
    const { svc } = stubPermission(true);
    const pairs = await Promise.all(
      ["ROOM_TODAY", "ASSET_SUMMARY", "RECRUIT_FUNNEL", "PAYROLL_COST"].map((code) =>
        gateWidgetOrThrow(svc, user, code),
      ),
    );
    expect(pairs).toEqual([
      { action: "view", resourceType: "room" },
      { action: "view", resourceType: "asset" },
      { action: "view", resourceType: "candidate" },
      { action: "view-line", resourceType: "payroll-period" },
    ]);
  });
});

describe("gateWidgetOrThrow — wildcard KHÔNG mở được cặp SENSITIVE (S14-SEC-DASHGATE-WILDCARD-1)", () => {
  const wildcard = (isSensitive: boolean): CompanyRoleGrant[] => [
    { action: "*", resourceType: "*", isSensitive, effect: "ALLOW", expiresAt: null },
  ];

  /**
   * 🔁 Ca này ĐÃ ĐẢO. Bản trước ghim TRẠNG THÁI («wildcard HIỆN TẠI qua được») như một khoản nợ có
   * chủ ý, để lần siết là CÓ Ý THỨC chứ không phải phụ phẩm im lặng của refactor. WO này là lần siết
   * đó, nên kỳ vọng lật từ `resolves` sang `rejects`.
   *
   * Cơ chế đã vá (ADR `DECISIONS-12`): `decideCan` trước đây tính
   * `effectivelySensitive = input.isSensitive || companyAllows.some(g => g.isSensitive)` — cả hai vế
   * đều đọc cờ của thứ KHÁC cặp đích, nên hàng `*:*` (is_sensitive=false) trượt qua cổng.
   * `PermissionService` nay bơm thêm `pairIsSensitive` = cờ catalog của CẶP ĐÍCH.
   *
   * ⚠️ Ca phải đi qua `PermissionService` THẬT (xem `permissionOverGrants`): gọi thẳng `decideCan`
   * là bỏ qua đúng chỗ bơm cờ ⇒ ca xanh mà lỗ vẫn sống.
   */
  it("grant CHỈ *:* (is_sensitive=false) ⇒ 403 ở gate PAYROLL_COST — cặp đích là cặp SENSITIVE", async () => {
    await expect(
      gateWidgetOrThrow(permissionOverGrants(wildcard(false)), user, "PAYROLL_COST"),
    ).rejects.toThrowError("AUTH-ERR-FORBIDDEN: thiếu quyền view-line:payroll-period");
  });

  it("cùng actor wildcard ⇒ 403 luôn ở RECRUIT_FUNNEL (vá theo BỀ MẶT, không theo một widget)", async () => {
    await expect(
      gateWidgetOrThrow(permissionOverGrants(wildcard(false)), user, "RECRUIT_FUNNEL"),
    ).rejects.toThrowError("AUTH-ERR-FORBIDDEN: thiếu quyền view:candidate");
  });

  it("ĐỐI CHỨNG — CÙNG actor wildcard VẪN qua widget có cặp NON-sensitive (không phải 'deny mọi wildcard')", async () => {
    // Thiếu ca này, hai ca deny ở trên xanh y hệt với một bản vá chặn sạch mọi grant wildcard —
    // tức mất quyền của mọi actor hợp lệ mà spec không kêu (`deny-cases-vacuous-without-allow-case`).
    const svc = permissionOverGrants(wildcard(false));
    await expect(gateWidgetOrThrow(svc, user, "ROOM_TODAY")).resolves.toEqual({
      action: "view",
      resourceType: "room",
    });
    await expect(gateWidgetOrThrow(svc, user, "ASSET_SUMMARY")).resolves.toEqual({
      action: "view",
      resourceType: "asset",
    });
  });

  it("ĐỐI CHỨNG — chính hàng *:* mang is_sensitive=true thì engine CHẶN (cơ chế sensitive vẫn sống)", async () => {
    // Chứng minh ca trên không xanh vì engine "luôn allow": cùng đường code, đổi đúng một cờ ⇒ 403.
    await expect(
      gateWidgetOrThrow(permissionOverGrants(wildcard(true)), user, "PAYROLL_COST"),
    ).rejects.toThrowError("AUTH-ERR-FORBIDDEN: thiếu quyền view-line:payroll-period");
  });

  it("ĐỐI CHỨNG — grant EXACT cho cặp sensitive vẫn qua bình thường", async () => {
    const exact: CompanyRoleGrant[] = [
      {
        action: "view-line",
        resourceType: "payroll-period",
        isSensitive: true,
        effect: "ALLOW",
        expiresAt: null,
      },
    ];
    await expect(
      gateWidgetOrThrow(permissionOverGrants(exact), user, "PAYROLL_COST"),
    ).resolves.toEqual({ action: "view-line", resourceType: "payroll-period" });
  });
});
