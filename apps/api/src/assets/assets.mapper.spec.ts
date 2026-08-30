import { describe, expect, it } from "vitest";
import type { AssetWithHolderRow } from "./assets.repository";
import type { MeAssetRow } from "./asset-assignments.repository";
import {
  toAssetAuditSnapshot,
  toAssetDetailDto,
  toAssetListItemDto,
  toMeAssetItemDto,
  toMaintenanceAuditSnapshot,
} from "./assets.mapper";

/**
 * S11-ASSET-BE-1 — masking THUẦN (không DB): tài chính theo `showFinancial`, danh tính theo cờ `holderVisible`
 * (không suy từ employeeCode), `/me/assets` không bao giờ chép trường tài chính dù row "bẩn".
 */
const now = new Date("2026-08-30T00:00:00Z");

function row(over: Partial<AssetWithHolderRow> = {}): AssetWithHolderRow {
  return {
    id: "a1",
    companyId: "c1",
    categoryId: "cat1",
    assetCode: "TS-LT-0001",
    name: "MacBook",
    serialNumber: "SN1",
    brand: null,
    model: null,
    purchaseDate: "2026-01-01",
    purchasePrice: "45000000.00",
    supplier: "Apple VN",
    warrantyEndDate: null,
    location: null,
    conditionNote: null,
    status: "Assigned",
    statusReason: null,
    statusChangedAt: null,
    statusChangedBy: null,
    nextMaintenanceDue: null,
    description: null,
    metadata: null,
    createdAt: now,
    createdBy: null,
    updatedAt: now,
    updatedBy: null,
    deletedAt: null,
    deletedBy: null,
    categoryCode: "LAPTOP",
    categoryName: "Laptop",
    holderVisible: true,
    holderFullName: "Nguyễn Văn A",
    holderEmployeeId: "e1",
    holderEmployeeCode: "NV-0001",
    holderAssignedAt: now,
    ...over,
  };
}

describe("assets.mapper — masking tài chính theo scope", () => {
  it("Company: có purchasePrice (số) + supplier", () => {
    const dto = toAssetDetailDto(row(), {
      showFinancial: true,
      openMaintenance: null,
      counts: { assignments: 1, maintenances: 0 },
    });
    expect(dto.purchasePrice).toBe(45000000);
    expect(dto.supplier).toBe("Apple VN");
  });

  it("Own/Department: VẮNG KHOÁ purchasePrice/supplier (không phải null)", () => {
    const dto = toAssetDetailDto(row(), {
      showFinancial: false,
      openMaintenance: null,
      counts: { assignments: 1, maintenances: 0 },
    });
    expect("purchasePrice" in dto).toBe(false);
    expect("supplier" in dto).toBe(false);
  });
});

describe("assets.mapper — danh tính người giữ theo cờ holderVisible", () => {
  it("cờ true ⇒ có currentHolder đủ trường", () => {
    const dto = toAssetListItemDto(row());
    expect(dto.currentHolder).toEqual({
      employeeId: "e1",
      employeeCode: "NV-0001",
      fullName: "Nguyễn Văn A",
      assignedAt: now.toISOString(),
    });
  });

  it("cờ false ⇒ VẮNG KHOÁ currentHolder dù row 'bẩn' còn employeeCode/employeeId", () => {
    const dto = toAssetListItemDto(row({ holderVisible: false, holderFullName: null }));
    expect("currentHolder" in dto).toBe(false);
  });

  it("không có lượt Active (In Stock) ⇒ vắng khoá kể cả Company", () => {
    const dto = toAssetListItemDto(
      row({
        status: "In Stock",
        holderEmployeeId: null,
        holderEmployeeCode: null,
        holderFullName: null,
      }),
    );
    expect("currentHolder" in dto).toBe(false);
  });
});

describe("assets.mapper — /me/assets không bao giờ mang tài chính", () => {
  it("row bẩn có purchasePrice/supplier/cost ⇒ DTO không có", () => {
    const dirty = {
      assignmentId: "as1",
      assetId: "a1",
      assetCode: "TS-LT-0001",
      assetName: "MacBook",
      categoryId: "cat1",
      categoryCode: "LAPTOP",
      categoryName: "Laptop",
      assetStatus: "Assigned",
      serialNumber: "SN1",
      assignedAt: now,
      issueCondition: "Good",
      expectedReturnDate: null,
      assignmentStatus: "Active",
      returnedAt: null,
      returnCondition: null,
      purchasePrice: "1",
      supplier: "X",
      cost: "2",
    } as MeAssetRow & Record<string, unknown>;
    const dto = toMeAssetItemDto(dirty) as Record<string, unknown>;
    expect(dto.purchasePrice).toBeUndefined();
    expect(dto.supplier).toBeUndefined();
    expect(dto.cost).toBeUndefined();
    expect(dto.assetCode).toBe("TS-LT-0001");
  });
});

describe("assets.mapper — snapshot audit không tiền (BẤT BIẾN #3)", () => {
  it("toAssetAuditSnapshot strip purchasePrice/supplier vô điều kiện", () => {
    const snap = toAssetAuditSnapshot(row());
    expect(snap.purchasePrice).toBeUndefined();
    expect(snap.supplier).toBeUndefined();
    expect(snap.assetCode).toBe("TS-LT-0001");
  });

  it("toMaintenanceAuditSnapshot strip cost", () => {
    const snap = toMaintenanceAuditSnapshot({
      id: "m1",
      companyId: "c1",
      assetId: "a1",
      openedAt: now,
      openedBy: null,
      reason: "r",
      vendor: null,
      status: "Closed",
      closedAt: now,
      closedBy: null,
      resultNote: null,
      cost: "99.00",
      nextDueDate: null,
      createdAt: now,
      updatedAt: now,
      updatedBy: null,
    });
    expect(snap.cost).toBeUndefined();
    expect(snap.status).toBe("Closed");
  });
});
