// @vitest-environment jsdom
/**
 * [S2-FE-FND-7 §7] AuditLogsPage default filter range — mặc-định 30 ngày gần nhất.
 *
 * Kiểm:
 *  1. defaultAuditFromDate = yyyy-mm-dd của (hôm nay − 30 ngày).
 *  2. createInitialAuditFilters đặt fromDate = mặc-định-30-ngày cho CẢ draft LẪN applied (khởi tạo).
 *  3. resetFilters của useAuditLogFilters trả về mặc-định-30-ngày (KHÔNG rỗng).
 *  4. Người dùng VẪN xoá/đổi được fromDate (setDraftField), rồi applyFilters cập nhật applied.
 */
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { format, subDays } from "date-fns";
import {
  AUDIT_DEFAULT_RANGE_DAYS,
  createInitialAuditFilters,
  defaultAuditFromDate,
  type AuditLogFilters,
} from "./audit-log-utils";
import { useAuditLogFilters } from "./use-audit-log-filters";

describe("audit default filter range (30 ngày)", () => {
  it("AUDIT_DEFAULT_RANGE_DAYS = 30", () => {
    expect(AUDIT_DEFAULT_RANGE_DAYS).toBe(30);
  });

  it("defaultAuditFromDate = hôm-nay − 30 ngày (yyyy-mm-dd)", () => {
    const fixed = new Date("2026-07-02T10:00:00.000Z");
    expect(defaultAuditFromDate(fixed)).toBe("2026-06-02");
    // Với ngày hiện tại thực: khớp công thức subDays(now, 30).
    const now = new Date();
    expect(defaultAuditFromDate(now)).toBe(format(subDays(now, 30), "yyyy-MM-dd"));
  });

  it("createInitialAuditFilters đặt fromDate mặc-định-30-ngày, các field khác rỗng", () => {
    const fixed = new Date("2026-07-02T10:00:00.000Z");
    const init = createInitialAuditFilters(fixed);
    expect(init.fromDate).toBe("2026-06-02");
    expect(init.toDate).toBe("");
    expect(init.moduleCode).toBe("");
    expect(init.action).toBe("");
    expect(init.actorUserId).toBe("");
    expect(init.entityType).toBe("");
  });

  it("draft VÀ applied khởi tạo CÙNG mặc-định-30-ngày", () => {
    const init = createInitialAuditFilters(new Date("2026-07-02T10:00:00.000Z"));
    const { result } = renderHook(() => useAuditLogFilters<AuditLogFilters>(init));
    expect(result.current.draft.fromDate).toBe("2026-06-02");
    expect(result.current.applied.fromDate).toBe("2026-06-02");
  });

  it("resetFilters trả về mặc-định-30-ngày (KHÔNG rỗng)", () => {
    const init = createInitialAuditFilters(new Date("2026-07-02T10:00:00.000Z"));
    const { result } = renderHook(() => useAuditLogFilters<AuditLogFilters>(init));

    // Đổi fromDate → rồi reset.
    act(() => result.current.setDraftField("fromDate", "2026-01-01"));
    act(() => result.current.applyFilters());
    expect(result.current.applied.fromDate).toBe("2026-01-01");

    act(() => result.current.resetFilters());
    expect(result.current.draft.fromDate).toBe("2026-06-02");
    expect(result.current.applied.fromDate).toBe("2026-06-02");
    expect(result.current.draft.fromDate).not.toBe("");
  });

  it("VẪN xoá được fromDate (đặt rỗng) rồi apply", () => {
    const init = createInitialAuditFilters(new Date("2026-07-02T10:00:00.000Z"));
    const { result } = renderHook(() => useAuditLogFilters<AuditLogFilters>(init));

    act(() => result.current.setDraftField("fromDate", ""));
    act(() => result.current.applyFilters());
    expect(result.current.applied.fromDate).toBe("");

    // ...và đổi sang giá trị khác.
    act(() => result.current.setDraftField("fromDate", "2026-05-15"));
    act(() => result.current.applyFilters());
    expect(result.current.applied.fromDate).toBe("2026-05-15");
  });
});
