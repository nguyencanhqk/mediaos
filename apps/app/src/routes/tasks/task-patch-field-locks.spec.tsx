import { describe, it, expect, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useAuthStore } from "@mediaos/web-core";
import type { TaskCoreResponseDto } from "@mediaos/contracts";
import {
  taskLockReason,
  useTaskActionAllowed,
  useTaskDeleteAllowed,
} from "./task-patch-field-locks";

/**
 * S20-TASK-ALLOWEDACTIONS-1 — hook chọn nguồn: `allowedActions` của server thắng; vắng khoá ⇒ `useCan`.
 */
function caps(c: Record<string, boolean>) {
  useAuthStore.setState({
    isAuthenticated: true,
    capabilities: c,
    user: { id: "u1", email: "t@d.l", fullName: "T", status: "Active", companyId: "co-001" },
  });
}
const task = (allowedActions?: TaskCoreResponseDto["allowedActions"]) =>
  ({ id: "t", allowedActions }) as unknown as TaskCoreResponseDto;

describe("useTaskActionAllowed / useTaskDeleteAllowed", () => {
  beforeEach(() => useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null }));

  it("không có trường ⇒ theo useCan (ALLOW và DENY)", () => {
    caps({ "update:task": true });
    expect(renderHook(() => useTaskActionAllowed(task(), "edit")).result.current).toBe(true);
    expect(renderHook(() => useTaskActionAllowed(task(), "assign")).result.current).toBe(false);
  });

  it("có khoá ⇒ server thắng ở cả hai chiều", () => {
    caps({ "update:task": true });
    const denied = renderHook(() => useTaskActionAllowed(task({ edit: false }), "edit"));
    expect(denied.result.current).toBe(false);
    const allowed = renderHook(() => useTaskActionAllowed(task({ assign: true }), "assign"));
    expect(allowed.result.current).toBe(true);
  });

  it("F5 · delete:false ẩn dù useCanExact true; trường vắng ⇒ theo useCanExact", () => {
    caps({ "delete:task": true });
    expect(renderHook(() => useTaskDeleteAllowed(task({ delete: false }))).result.current).toBe(
      false,
    );
    expect(renderHook(() => useTaskDeleteAllowed(task())).result.current).toBe(true);
    expect(renderHook(() => useTaskDeleteAllowed(task({ edit: true }))).result.current).toBe(true);
  });

  it("taskLockReason chỉ trả watcher khi server nêu", () => {
    expect(taskLockReason(task({ lockReason: "watcher" }))).toBe("watcher");
    expect(taskLockReason(task({ lockReason: null }))).toBeNull();
    expect(taskLockReason(task())).toBeNull();
  });
});
