import { describe, expect, it, vi } from "vitest";
import type { DataScope } from "@mediaos/contracts";
import {
  allowedActionRequests,
  computeTaskAllowedActions,
  TASK_ALLOWED_ACTION_GATES,
  type AllowedActionsRow,
} from "./task-allowed-actions";

const tx = {} as never;
const user = { id: "u1", companyId: "c1" };
const row: AllowedActionsRow = {
  id: "t1",
  taskStatus: "Todo",
  projectId: "p1",
  parentTaskId: null,
  isWorkflow: false,
};
const all = (s: DataScope | null): (DataScope | null)[] => TASK_ALLOWED_ACTION_GATES.map(() => s);

function mk(inScope = true, watcher = false) {
  const check = vi.fn(async (..._args: unknown[]) => inScope);
  const isWatcher = vi.fn(async () => watcher);
  return {
    check,
    isWatcher,
    deps: { projectAccess: { checkTaskInScopeTx: check as never }, isWatcher },
  };
}

describe("computeTaskAllowedActions", () => {
  it("một phạm vi ⇒ đúng 1 lời gọi kiểm phạm vi dù 7 khoá; 7 khoá true", async () => {
    const m = mk();
    const r = await computeTaskAllowedActions(m.deps, tx, user, row, all("Company"));
    const bits = Object.entries(r ?? {}).filter(([k]) => k !== "lockReason");
    expect(bits).toHaveLength(7);
    expect(bits.every(([, v]) => v === true)).toBe(true);
    expect(m.check).toHaveBeenCalledTimes(1);
    expect(m.isWatcher).not.toHaveBeenCalled();
  });

  it("memo theo phạm vi: Own + Team ⇒ đúng 2 lời gọi, mọi lời gọi mode write", async () => {
    const m = mk();
    const scopes = TASK_ALLOWED_ACTION_GATES.map((_, i): DataScope => (i % 2 ? "Own" : "Team"));
    await computeTaskAllowedActions(m.deps, tx, user, row, scopes);
    expect(m.check).toHaveBeenCalledTimes(2);
    for (const call of m.check.mock.calls) expect(call[4]).toBe("write");
  });

  it("phần tử scope undefined/null ⇒ false, không hoá allow", async () => {
    const m = mk();
    const r = await computeTaskAllowedActions(m.deps, tx, user, row, [undefined]);
    expect(r?.changeStatus).toBe(false);
    expect(r?.edit).toBe(false);
    expect(m.check).not.toHaveBeenCalled();
  });

  it("ngoài phạm vi ghi ⇒ mọi khoá false", async () => {
    const m = mk(false);
    const r = await computeTaskAllowedActions(m.deps, tx, user, row, all("Own"));
    expect(r?.changeStatus).toBe(false);
    expect(r?.delete).toBe(false);
  });

  it("changeState false với việc con / không dự án dù có cặp; khoá khác giữ nguyên", async () => {
    for (const patch of [{ parentTaskId: "p0" }, { projectId: null }]) {
      const m = mk();
      const r = await computeTaskAllowedActions(
        m.deps,
        tx,
        user,
        { ...row, ...patch },
        all("Company"),
      );
      expect(r?.changeState).toBe(false);
      expect(r?.changeStatus).toBe(true);
    }
  });

  it("việc Cancelled: hạn/ưu tiên/assign false; status/state/edit/delete true", async () => {
    const m = mk();
    const r = await computeTaskAllowedActions(
      m.deps,
      tx,
      user,
      { ...row, taskStatus: "Cancelled" },
      all("Company"),
    );
    expect([r?.changeDeadline, r?.changePriority, r?.assign]).toEqual([false, false, false]);
    expect([r?.changeStatus, r?.changeState, r?.edit, r?.delete]).toEqual([true, true, true, true]);
  });

  it("workflow ⇒ mọi khoá false", async () => {
    const m = mk();
    const r = await computeTaskAllowedActions(
      m.deps,
      tx,
      user,
      { ...row, isWorkflow: true },
      all("Company"),
    );
    expect(Object.entries(r ?? {}).filter(([k, v]) => k !== "lockReason" && v)).toEqual([]);
  });

  it("viaApiKey ⇒ undefined", async () => {
    const m = mk();
    const r = await computeTaskAllowedActions(
      m.deps,
      tx,
      { ...user, viaApiKey: true },
      row,
      all("Company"),
    );
    expect(r).toBeUndefined();
  });

  it("lockReason chỉ khi 3 khoá chính false ∧ đang theo dõi; không tra khi có khoá true", async () => {
    const w = mk(true, true);
    expect((await computeTaskAllowedActions(w.deps, tx, user, row, all(null)))?.lockReason).toBe(
      "watcher",
    );
    const nw = mk(true, false);
    expect(
      (await computeTaskAllowedActions(nw.deps, tx, user, row, all(null)))?.lockReason,
    ).toBeNull();
    const ok = mk(true, true);
    expect(
      (await computeTaskAllowedActions(ok.deps, tx, user, row, all("Company")))?.lockReason,
    ).toBeNull();
    expect(ok.isWatcher).not.toHaveBeenCalled();
  });

  it("yêu cầu quyền khớp bảng: delete nhạy cảm, đúng thứ tự", () => {
    const reqs = allowedActionRequests();
    expect(reqs.map((r) => r.action)).toEqual(TASK_ALLOWED_ACTION_GATES.map((g) => g.action));
    expect(reqs.find((r) => r.action === "delete")?.isSensitive).toBe(true);
    expect(reqs.filter((r) => r.isSensitive)).toHaveLength(1);
  });
});
