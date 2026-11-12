import { describe, expect, it } from "vitest";
import type { DataScope } from "@mediaos/contracts";
import { DataScopeService, type ScopeContext } from "../permission/data-scope.service";
import {
  buildTypeVisibility,
  type TypeVisibilityRow,
} from "./leave-calendar-type-visibility";

/** isEmployeeInScope là hàm thuần (không đụng DB) — dựng service với phụ thuộc rỗng. */
const dataScope = new DataScopeService({} as never, {} as never);

const CO = "co-a";
const ME = "user-me";
const UNIT_OWN = "unit-own";
const UNIT_HEADED = "unit-headed";
const UNIT_OTHER = "unit-other";

const ctx: ScopeContext = {
  userId: ME,
  companyId: CO,
  orgUnitId: UNIT_OWN,
  managedUserIds: ["user-emr"],
  headedOrgUnitIds: [UNIT_HEADED],
};

function row(over: Partial<TypeVisibilityRow> = {}): TypeVisibilityRow {
  return {
    userId: "user-owner",
    ownerUserId: "user-owner",
    ownerCompanyId: CO,
    ownerOrgUnitId: UNIT_OTHER,
    ownerDirectManagerUserId: null,
    ownerDeletedAt: null,
    ...over,
  };
}

function visible(
  scopes: readonly (DataScope | null | undefined)[],
  r: TypeVisibilityRow,
): boolean {
  return buildTypeVisibility(dataScope, scopes, ctx, ME)(r);
}

describe("buildTypeVisibility — loại nghỉ chỉ hiện cho chủ đơn / người xem có view:leave|approve:leave phủ chủ đơn", () => {
  it("đơn của chính người xem ⇒ hiện, kể cả không có cặp nào", () => {
    expect(visible([null, null], row({ userId: ME, ownerUserId: ME }))).toBe(true);
  });

  it("không có cặp view/approve nào (null, null) ⇒ che", () => {
    expect(visible([null, null], row())).toBe(false);
  });

  it("mảng rỗng hoặc ô thiếu (undefined) ⇒ che, không biến deny thành allow", () => {
    expect(visible([], row())).toBe(false);
    expect(visible([undefined, undefined], row())).toBe(false);
    expect(visible([undefined, null], row())).toBe(false);
  });

  it("view:leave@Team phủ chủ đơn (quản lý trực tiếp) ⇒ hiện; ngoài đội ⇒ che", () => {
    expect(visible(["Team", null], row({ ownerDirectManagerUserId: ME }))).toBe(true);
    expect(visible(["Team", null], row({ ownerDirectManagerUserId: "someone" }))).toBe(false);
  });

  it("approve:leave@Team (chỉ số 1) phủ chủ đơn ⇒ hiện", () => {
    expect(visible([null, "Team"], row({ ownerDirectManagerUserId: ME }))).toBe(true);
    expect(visible([null, "Team"], row())).toBe(false);
  });

  it("Team qua EMR (managedUserIds) ⇒ hiện", () => {
    expect(visible(["Team", null], row({ ownerUserId: "user-emr", userId: "user-emr" }))).toBe(true);
  });

  it("Department: đơn vị của mình hoặc đơn vị mình đứng đầu ⇒ hiện; đơn vị khác ⇒ che", () => {
    expect(visible(["Department", null], row({ ownerOrgUnitId: UNIT_OWN }))).toBe(true);
    expect(visible([null, "Department"], row({ ownerOrgUnitId: UNIT_HEADED }))).toBe(true);
    expect(visible(["Department", null], row({ ownerOrgUnitId: UNIT_OTHER }))).toBe(false);
    expect(visible(["Department", null], row({ ownerOrgUnitId: null }))).toBe(false);
  });

  it("Company ⇒ hiện cho mọi chủ đơn cùng công ty; khác công ty ⇒ che", () => {
    expect(visible(["Company", null], row())).toBe(true);
    expect(visible([null, "Company"], row())).toBe(true);
    expect(visible(["Company", "Company"], row({ ownerCompanyId: "co-b" }))).toBe(false);
  });

  it("hồ sơ chủ đơn đã xoá mềm ⇒ che (fail-closed, cùng cách findOwnerScopeTargetTx)", () => {
    expect(visible(["Company", "Company"], row({ ownerDeletedAt: new Date() }))).toBe(false);
  });

  it("phạm vi Team theo hồ sơ nhân sự: user_id của leave_requests khác của hồ sơ thì theo hồ sơ", () => {
    const r = row({ userId: "user-x", ownerUserId: ME });
    expect(visible(["Team", null], r)).toBe(true);
    const r2 = row({ userId: ME, ownerUserId: "user-other" });
    // hàng của chính mình theo leave_requests.user_id vẫn hiện (nhánh đơn của mình, như che lý do).
    expect(visible([null, null], r2)).toBe(true);
  });
});
