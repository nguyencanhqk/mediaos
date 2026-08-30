/**
 * S11-ASSET-FE-1 — neo bảng FSM ∩ quyền của màn chi tiết (SPEC-13 §13.1 + §14).
 *
 * Ca quan trọng nhất KHÔNG phải "trạng thái đúng thì hiện nút" mà là ba ô dễ sai:
 *   1. `Under Maintenance` CÒN người giữ ⇒ **không** hiện «Thanh lý» (ASSET-ERR-008 kiểm theo sự tồn
 *      tại lượt Active, KHÔNG theo status) — suy theo status sẽ hiện nút rồi ăn 409, đúng cái §14 cấm.
 *   2. `Under Maintenance` CÒN người giữ ⇒ **có** hiện «Thu hồi» (ô đường chéo `UM → UM: revoke` của
 *      `asset-fsm.ts`) — bỏ ô này là dựng ngõ cụt: không thu hồi được thì cũng không thanh lý được.
 *   3. Vế quyền phải cắt ĐỘC LẬP với vế FSM — ca ALLOW và ca DENY đều có mặt cho mỗi hành động, nếu
 *      không thì "mọi nút đều ẩn" cũng làm test xanh (deny-cases-vacuous-without-allow-case).
 */
import { describe, it, expect } from "vitest";
import {
  availableAssetActions,
  canDoAssetAction,
  hasActiveAssignment,
  isAllowedByFsm,
  ASSET_ACTION_ORDER,
  type AssetAction,
  type AssetActionPermissions,
  type AssetActionSubject,
} from "./asset-actions";

const ALL_PERMS: AssetActionPermissions = {
  canCreate: true,
  canUpdate: true,
  canDelete: true,
  canAssign: true,
  canRevoke: true,
  canDispose: true,
  canManageMaintenance: true,
};
const NO_PERMS: AssetActionPermissions = {
  canCreate: false,
  canUpdate: false,
  canDelete: false,
  canAssign: false,
  canRevoke: false,
  canDispose: false,
  canManageMaintenance: false,
};

function asset(over: Partial<AssetActionSubject> = {}): AssetActionSubject {
  return {
    status: "In Stock",
    openMaintenance: null,
    counts: { assignments: 0, maintenances: 0 },
    ...over,
  };
}

const HOLDER = { employeeId: "e1", employeeCode: "NV01", fullName: "A", assignedAt: "2026-08-01" };

describe("asset-actions — hasActiveAssignment", () => {
  it("status Assigned ⇒ true kể cả khi currentHolder bị che vì scope danh tính", () => {
    expect(hasActiveAssignment(asset({ status: "Assigned" }))).toBe(true);
  });

  it("Under Maintenance + có currentHolder ⇒ true (bảo trì vẫn có thể còn người giữ)", () => {
    expect(hasActiveAssignment(asset({ status: "Under Maintenance", currentHolder: HOLDER }))).toBe(
      true,
    );
  });

  it("Under Maintenance + vắng currentHolder ⇒ false", () => {
    expect(hasActiveAssignment(asset({ status: "Under Maintenance" }))).toBe(false);
  });
});

describe("asset-actions — FSM thuần (chưa xét quyền)", () => {
  it.each([
    ["assign", "In Stock", true],
    ["assign", "Assigned", false],
    ["assign", "Under Maintenance", false],
    ["assign", "Disposed", false],
    ["assign", "Lost", false],
    ["revoke", "Assigned", true],
    ["revoke", "In Stock", false],
    ["revoke", "Lost", false],
    ["openMaintenance", "In Stock", true],
    ["openMaintenance", "Assigned", true],
    ["openMaintenance", "Disposed", false],
    ["recover", "Lost", true],
    ["recover", "In Stock", false],
    ["markLost", "In Stock", true],
    ["markLost", "Assigned", true],
    ["markLost", "Under Maintenance", true],
    ["markLost", "Disposed", false],
    ["markLost", "Lost", false],
    ["edit", "In Stock", true],
    ["edit", "Disposed", false],
    ["edit", "Lost", false],
  ] as const)("%s @ %s → %s", (action, status, expected) => {
    expect(isAllowedByFsm(action as AssetAction, asset({ status }))).toBe(expected);
  });

  it("openMaintenance ẩn khi ĐÃ có lượt Open (ASSET-ERR-004 — partial unique)", () => {
    expect(isAllowedByFsm("openMaintenance", asset({ openMaintenance: { id: "m1" } }))).toBe(false);
  });

  it("closeMaintenance đòi CẢ lượt Open lẫn status Under Maintenance", () => {
    expect(
      isAllowedByFsm(
        "closeMaintenance",
        asset({ status: "Under Maintenance", openMaintenance: { id: "m1" } }),
      ),
    ).toBe(true);
    expect(isAllowedByFsm("closeMaintenance", asset({ status: "Under Maintenance" }))).toBe(false);
    // Quan hệ "có lượt Open ⇒ status = UM" đứt (hồ sơ đã thanh lý tự đóng lượt) ⇒ nút biến mất.
    expect(
      isAllowedByFsm(
        "closeMaintenance",
        asset({ status: "Disposed", openMaintenance: { id: "m1" } }),
      ),
    ).toBe(false);
  });
});

describe("asset-actions — ô ASSET-ERR-008: thanh lý chặn theo LƯỢT ACTIVE, không theo status", () => {
  it("Under Maintenance + CÒN người giữ ⇒ KHÔNG hiện «Thanh lý»", () => {
    expect(
      isAllowedByFsm("dispose", asset({ status: "Under Maintenance", currentHolder: HOLDER })),
    ).toBe(false);
  });

  it("Under Maintenance + KHÔNG người giữ ⇒ CÓ hiện «Thanh lý» (ca ALLOW đối chứng)", () => {
    expect(isAllowedByFsm("dispose", asset({ status: "Under Maintenance" }))).toBe(true);
  });

  it("Assigned ⇒ không bao giờ thanh lý được (luôn có lượt Active)", () => {
    expect(isAllowedByFsm("dispose", asset({ status: "Assigned" }))).toBe(false);
  });

  it("In Stock ⇒ thanh lý được", () => {
    expect(isAllowedByFsm("dispose", asset({ status: "In Stock" }))).toBe(true);
  });

  it("«Ghi nhận mất» VẪN được khi còn người giữ — service tự đóng lượt với returnCondition Lost", () => {
    expect(
      isAllowedByFsm("markLost", asset({ status: "Under Maintenance", currentHolder: HOLDER })),
    ).toBe(true);
    expect(isAllowedByFsm("markLost", asset({ status: "Assigned" }))).toBe(true);
  });
});

describe("asset-actions — ô đường chéo UM → UM: revoke (chống ngõ cụt)", () => {
  it("Under Maintenance + CÒN người giữ ⇒ CÓ hiện «Thu hồi»", () => {
    expect(
      isAllowedByFsm("revoke", asset({ status: "Under Maintenance", currentHolder: HOLDER })),
    ).toBe(true);
  });

  it("Under Maintenance + KHÔNG người giữ ⇒ ẩn «Thu hồi» (ASSET-ERR-003)", () => {
    expect(isAllowedByFsm("revoke", asset({ status: "Under Maintenance" }))).toBe(false);
  });

  it("thu hồi được ⇒ sau đó thanh lý được: không có trạng thái nào kẹt cả hai", () => {
    const stuck = asset({ status: "Under Maintenance", currentHolder: HOLDER });
    // Trước khi thu hồi: thanh lý bị chặn…
    expect(isAllowedByFsm("dispose", stuck)).toBe(false);
    // …nhưng thu hồi mở, nên người dùng có đường đi tiếp.
    expect(isAllowedByFsm("revoke", stuck)).toBe(true);
  });
});

describe("asset-actions — xoá mềm (ASSET-ERR-015)", () => {
  it("In Stock + 0 lượt cấp phát + 0 lượt bảo trì ⇒ hiện", () => {
    expect(isAllowedByFsm("delete", asset())).toBe(true);
  });

  it("có lịch sử cấp phát ⇒ ẩn (dùng «Thanh lý» thay vì xoá)", () => {
    expect(isAllowedByFsm("delete", asset({ counts: { assignments: 1, maintenances: 0 } }))).toBe(
      false,
    );
  });

  it("có lịch sử bảo trì ⇒ ẩn", () => {
    expect(isAllowedByFsm("delete", asset({ counts: { assignments: 0, maintenances: 2 } }))).toBe(
      false,
    );
  });

  it("không In Stock ⇒ ẩn dù chưa có lịch sử", () => {
    expect(isAllowedByFsm("delete", asset({ status: "Under Maintenance" }))).toBe(false);
  });
});

describe("asset-actions — vế QUYỀN cắt độc lập với vế FSM", () => {
  it("FSM cho phép + đủ quyền ⇒ hiện (ca ALLOW)", () => {
    expect(canDoAssetAction("assign", asset(), ALL_PERMS)).toBe(true);
  });

  it("FSM cho phép + KHÔNG quyền ⇒ ẩn (ca DENY)", () => {
    expect(canDoAssetAction("assign", asset(), NO_PERMS)).toBe(false);
  });

  it("một cặp dispose:asset gate CẢ BA thanh lý/mất/tìm-thấy-lại", () => {
    const onlyDispose: AssetActionPermissions = { ...NO_PERMS, canDispose: true };
    expect(canDoAssetAction("dispose", asset(), onlyDispose)).toBe(true);
    expect(canDoAssetAction("markLost", asset(), onlyDispose)).toBe(true);
    expect(canDoAssetAction("recover", asset({ status: "Lost" }), onlyDispose)).toBe(true);
    // …và thiếu cặp đó thì cả ba cùng ẩn.
    expect(canDoAssetAction("dispose", asset(), NO_PERMS)).toBe(false);
    expect(canDoAssetAction("markLost", asset(), NO_PERMS)).toBe(false);
    expect(canDoAssetAction("recover", asset({ status: "Lost" }), NO_PERMS)).toBe(false);
  });

  it("manage:asset-maintenance gate cả mở lẫn đóng lượt", () => {
    const onlyMaint: AssetActionPermissions = { ...NO_PERMS, canManageMaintenance: true };
    expect(canDoAssetAction("openMaintenance", asset(), onlyMaint)).toBe(true);
    expect(
      canDoAssetAction(
        "closeMaintenance",
        asset({ status: "Under Maintenance", openMaintenance: { id: "m" } }),
        onlyMaint,
      ),
    ).toBe(true);
  });

  it("không quyền nào ⇒ danh sách hành động RỖNG ở mọi trạng thái", () => {
    for (const status of [
      "In Stock",
      "Assigned",
      "Under Maintenance",
      "Disposed",
      "Lost",
    ] as const) {
      expect(availableAssetActions(asset({ status }), NO_PERMS)).toEqual([]);
    }
  });
});

describe("asset-actions — availableAssetActions", () => {
  it("giữ đúng thứ tự ASSET_ACTION_ORDER", () => {
    const actions = availableAssetActions(asset(), ALL_PERMS);
    const positions = actions.map((a) => ASSET_ACTION_ORDER.indexOf(a));
    expect(positions).toEqual([...positions].sort((x, y) => x - y));
  });

  it("In Stock sạch ⇒ cấp phát · mở bảo trì · thanh lý · ghi nhận mất · sửa · xoá", () => {
    expect(availableAssetActions(asset(), ALL_PERMS)).toEqual([
      "assign",
      "openMaintenance",
      "dispose",
      "markLost",
      "edit",
      "delete",
    ]);
  });

  it("Disposed = trạng thái CUỐI ⇒ không còn hành động nào dù đủ mọi quyền", () => {
    expect(availableAssetActions(asset({ status: "Disposed" }), ALL_PERMS)).toEqual([]);
  });

  it("Lost ⇒ chỉ «Tìm thấy lại»", () => {
    expect(availableAssetActions(asset({ status: "Lost" }), ALL_PERMS)).toEqual(["recover"]);
  });
});
