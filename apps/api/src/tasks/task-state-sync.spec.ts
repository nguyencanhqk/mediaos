import { describe, expect, it } from "vitest";
import {
  STATE_GROUP_TO_STATUS,
  isStateInGroupForStatus,
  pickTargetState,
  type SyncStateRow,
} from "./task-state-sync";

/**
 * S5-TASK-PIPELINE-1 (lane fsm) — D-20/D-21 (DECISIONS-03): ánh xạ nhóm cột ↔ status + bậc thang chọn
 * cột đích cho đồng bộ ngược state_id. Unit thuần, KHÔNG DB. Input `states` đã sort ORDER BY
 * sort_order, created_at, id (repo đảm bảo) — picker chỉ áp bậc thang, không sort lại.
 */

const row = (id: string, stateGroup: string, isDefault = false): SyncStateRow => ({
  id,
  stateGroup,
  isDefault,
});

describe("task-state-sync — STATE_GROUP_TO_STATUS (SPEC-06 §6.8)", () => {
  it("map đủ 6 nhóm: backlog|unstarted→Todo · started→In Progress · review→In Review · completed→Done · cancelled→Cancelled", () => {
    expect(STATE_GROUP_TO_STATUS).toEqual({
      backlog: "Todo",
      unstarted: "Todo",
      started: "In Progress",
      review: "In Review",
      completed: "Done",
      cancelled: "Cancelled",
    });
  });
});

describe("task-state-sync — isStateInGroupForStatus (guard D-21.2 KHÔNG giật cột)", () => {
  it("cột cùng nhóm với status mới ⇒ true (giữ nguyên vị trí thẻ)", () => {
    expect(isStateInGroupForStatus("started", "In Progress")).toBe(true);
    expect(isStateInGroupForStatus("completed", "Done")).toBe(true);
  });

  it("Todo khớp CẢ backlog LẪN unstarted (ánh xạ ngược không đơn trị — không kéo thẻ Backlog về Cần làm)", () => {
    expect(isStateInGroupForStatus("backlog", "Todo")).toBe(true);
    expect(isStateInGroupForStatus("unstarted", "Todo")).toBe(true);
  });

  it("khác nhóm hoặc chưa có cột (NULL) ⇒ false (phải đồng bộ)", () => {
    expect(isStateInGroupForStatus("started", "Done")).toBe(false);
    expect(isStateInGroupForStatus(null, "Todo")).toBe(false);
    expect(isStateInGroupForStatus("nhom-la", "Todo")).toBe(false);
  });
});

describe("task-state-sync — pickTargetState (bậc thang D-20: nhóm đích → is_default → sort_order nhỏ nhất)", () => {
  it("có cột nhóm đích ⇒ lấy cột ĐẦU TIÊN theo thứ tự đã sort (không ưu tiên is_default trong nhóm)", () => {
    const states = [
      row("s1", "unstarted", true),
      row("s2", "started"),
      row("s3", "started"),
      row("s4", "completed"),
    ];
    expect(pickTargetState(states, "In Progress")?.id).toBe("s2");
    expect(pickTargetState(states, "Done")?.id).toBe("s4");
  });

  it("Todo ưu tiên unstarted TRƯỚC backlog; thiếu unstarted mới rơi xuống backlog", () => {
    const both = [row("b1", "backlog"), row("u1", "unstarted")];
    expect(pickTargetState(both, "Todo")?.id).toBe("u1");
    const onlyBacklog = [row("b1", "backlog"), row("s1", "started")];
    expect(pickTargetState(onlyBacklog, "Todo")?.id).toBe("b1");
  });

  it("thiếu nhóm đích ⇒ rơi xuống cột is_default (dự án cột tự tạo có thể thiếu nhóm)", () => {
    const states = [row("s1", "started"), row("s2", "completed", true)];
    expect(pickTargetState(states, "In Review")?.id).toBe("s2");
  });

  it("không có is_default ⇒ cột đầu tiên theo thứ tự đã sort (sort_order nhỏ nhất)", () => {
    const states = [row("s1", "started"), row("s2", "completed")];
    expect(pickTargetState(states, "In Review")?.id).toBe("s1");
  });

  it("dự án 0 state ⇒ null (giữ state_id NULL, không ném lỗi)", () => {
    expect(pickTargetState([], "Done")).toBeNull();
  });
});
