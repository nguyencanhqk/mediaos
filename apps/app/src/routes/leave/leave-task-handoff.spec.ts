import { describe, it, expect } from "vitest";
import type { MyTaskItemDto } from "@mediaos/contracts";
import { deadlineAt } from "@mediaos/web-core";
import { isLeaveHandoffEligible, tasksDueDuringLeave } from "./leave-task-handoff";
import {
  afterLeavePreset,
  nextWorkingDay,
  resolveDeadlinePresets,
} from "../tasks/deadline-presets";

const TZ = "Asia/Ho_Chi_Minh";

function task(id: string, day: string, over: Partial<MyTaskItemDto> = {}): MyTaskItemDto {
  return {
    id,
    title: id,
    source: "assigned",
    status: "In Progress",
    dueAt: deadlineAt(day, "17:00", TZ).toISOString(),
    ...over,
  } as MyTaskItemDto;
}

describe("tasksDueDuringLeave", () => {
  const period = { startDate: "2025-10-27", endDate: "2025-10-31" };

  it("đơn 27–31/10: việc hạn 28/10, 30/10 vào; 05/11 và việc Done hạn 29/10 ra ⇒ N = 2", () => {
    const rows = [
      task("a", "2025-10-28"),
      task("b", "2025-10-30"),
      task("c", "2025-11-05"),
      task("d", "2025-10-29", { status: "Done" }),
    ];
    expect(tasksDueDuringLeave(rows, period, TZ).map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("chỉ nguồn «Được giao»; bỏ việc Cancelled, không hạn, hạn ngoài hai đầu mút", () => {
    const rows = [
      task("created", "2025-10-28", { source: "created" }),
      task("watched", "2025-10-28", { source: "watched" }),
      task("cancel", "2025-10-28", { status: "Cancelled" }),
      task("nodue", "2025-10-28", { dueAt: null }),
      task("before", "2025-10-26"),
      task("first", "2025-10-27"),
      task("last", "2025-10-31"),
    ];
    expect(tasksDueDuringLeave(rows, period, TZ).map((r) => r.id)).toEqual(["first", "last"]);
  });

  it("ngày hạn tính theo GIỜ CÔNG TY: 23:30 giờ VN ngày 31/10 vẫn thuộc 31/10 dù UTC là 16:30", () => {
    const late = task("late", "2025-10-31", {
      dueAt: deadlineAt("2025-10-31", "23:30", TZ).toISOString(),
    });
    expect(tasksDueDuringLeave([late], period, TZ)).toHaveLength(1);
    const next = task("next", "2025-11-01", {
      dueAt: deadlineAt("2025-11-01", "00:30", TZ).toISOString(),
    });
    expect(tasksDueDuringLeave([next], period, TZ)).toHaveLength(0);
  });
});

describe("isLeaveHandoffEligible", () => {
  const now = deadlineAt("2025-10-28", "09:00", TZ);
  const base = { startDate: "2025-10-27", endDate: "2025-10-31" };

  it.each(["Pending", "Approved"])("%s + kỳ nghỉ chưa qua ⇒ đủ điều kiện", (status) => {
    expect(isLeaveHandoffEligible({ ...base, status }, now, TZ)).toBe(true);
  });

  it.each(["Draft", "Rejected", "Cancelled", "Revoked"])("%s ⇒ không hiện", (status) => {
    expect(isLeaveHandoffEligible({ ...base, status }, now, TZ)).toBe(false);
  });

  it("endDate = hôm nay vẫn hiện; endDate hôm qua ⇒ không", () => {
    expect(
      isLeaveHandoffEligible({ ...base, endDate: "2025-10-28", status: "Approved" }, now, TZ),
    ).toBe(true);
    expect(
      isLeaveHandoffEligible({ ...base, endDate: "2025-10-27", status: "Approved" }, now, TZ),
    ).toBe(false);
  });
});

describe("«Sau kỳ nghỉ»", () => {
  it("Thứ Sáu 31/10/2025 ⇒ Thứ Hai 03/11 17:00 giờ công ty", () => {
    expect(nextWorkingDay("2025-10-31")).toBe("2025-11-03");
    const now = deadlineAt("2025-10-28", "09:00", TZ);
    const found = resolveDeadlinePresets(now, TZ, [afterLeavePreset("2025-10-31")]);
    expect(found).toHaveLength(1);
    expect(found[0]?.dueAt).toBe(deadlineAt("2025-11-03", "17:00", TZ).toISOString());
  });

  it("Thứ Hai–Thứ Năm ⇒ ngày kế tiếp; Thứ Bảy/Chủ Nhật ⇒ Thứ Hai", () => {
    expect(nextWorkingDay("2025-10-27")).toBe("2025-10-28");
    expect(nextWorkingDay("2025-10-30")).toBe("2025-10-31");
    expect(nextWorkingDay("2025-11-01")).toBe("2025-11-03");
    expect(nextWorkingDay("2025-11-02")).toBe("2025-11-03");
  });
});
