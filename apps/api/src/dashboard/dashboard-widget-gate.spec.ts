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
import type { PermissionService } from "../permission/permission.service";
import type { CompanyRoleGrant } from "../permission/permission.types";
import { decideCan } from "../permission/permission.decide";
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
 * `can()` chạy ENGINE THẬT (`decideCan`) trên một tập grant cho trước — cần cho ca wildcard, vì ca đó
 * hỏi «engine quyết thế nào», không phải «stub trả gì».
 */
function permissionOverGrants(grants: CompanyRoleGrant[]) {
  const can = vi.fn(async (input: Parameters<PermissionService["can"]>[0]) =>
    decideCan(grants, [], input, new Date()),
  );
  return { can } as unknown as PermissionService;
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

describe("gateWidgetOrThrow — GHIM hành vi wildcard hiện tại (KHÔNG phải mong muốn)", () => {
  const wildcard = (isSensitive: boolean): CompanyRoleGrant[] => [
    { action: "*", resourceType: "*", isSensitive, effect: "ALLOW", expiresAt: null },
  ];

  /**
   * ⚠️ Ca này ghim TRẠNG THÁI, không ghim MONG MUỐN. Comment cũ ở cả 4 bản `gateOrThrow` khẳng định
   * «wildcard KHÔNG lọt qua cặp sensitive» — SAI: `decideCan` tính
   * `effectivelySensitive = input.isSensitive || companyAllows.some(g => g.isSensitive)`, mà
   * `companyAllows` là các HÀNG GRANT KHỚP ⇒ đọc `is_sensitive` của hàng `*:*` (false), không phải
   * của cặp đích. Gate không truyền `isSensitive` ⇒ wildcard QUA.
   *
   * Chưa nổ ngoài thực địa: mig 0565 §6.7 census fail-closed (0 role seed giữ wildcard), 2 role tuỳ
   * biến PROD đã thu hồi ở S14-PROD-PAYROLLGRANT-1, và tầng-2 (PayrollAccessService /
   * RecruitAccessService) truyền cờ TƯỜNG MINH nên đường DỮ LIỆU vẫn kín. Hở là đường METADATA
   * `/dashboard/me` + gọi thẳng slug.
   *
   * Siết ở đây = đổi hành vi quyền thật ⇒ WO riêng `S14-SEC-DASHGATE-WILDCARD-1`. Ca này tồn tại để
   * lần đổi đó là CÓ CHỦ Ý (spec đỏ, người sửa phải đọc), không phải phụ phẩm im lặng của refactor.
   */
  it("grant CHỈ *:* với is_sensitive=false ⇒ HIỆN TẠI qua được gate PAYROLL_COST (nợ, xem doc-block)", async () => {
    await expect(
      gateWidgetOrThrow(permissionOverGrants(wildcard(false)), user, "PAYROLL_COST"),
    ).resolves.toEqual({ action: "view-line", resourceType: "payroll-period" });
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
