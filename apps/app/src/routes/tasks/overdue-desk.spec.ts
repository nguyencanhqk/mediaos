/**
 * S20-TASK-OVERDUEDESK-1 (US-TASK-QL-07) — hàm THUẦN của bàn xử lý việc quá hạn.
 *
 * Mốc «bây giờ» = 06:30 ngày 24/10/2026 (Thứ Bảy) giờ công ty (Asia/Ho_Chi_Minh, UTC+7) = 23:30 ngày
 * 23/10 UTC. Chạy dưới `TZ=UTC`: nếu hàm đọc múi MÁY thì «hôm nay» thành 23/10 và số ngày trễ lệch 1.
 */
import { describe, expect, it } from "vitest";
import type { TaskCoreResponseDto } from "@mediaos/contracts";
import { resolveDeadlinePresets } from "./deadline-presets";
import {
  byDueAtAsc,
  EMPTY_OVERDUE_FILTERS,
  filterOverdueRows,
  keepSelectedOption,
  OVERDUE_DEADLINE_PRESETS,
  OVERDUE_FILTER_NONE,
  overdueDaysOf,
  overdueFilterOptions,
} from "./overdue-desk";

const TZ = "Asia/Ho_Chi_Minh";
const NOW = new Date("2026-10-23T23:30:00.000Z");

function row(id: string, overrides: Partial<TaskCoreResponseDto> = {}): TaskCoreResponseDto {
  return {
    id,
    companyId: "co-1",
    title: `Việc ${id}`,
    description: null,
    taskType: "office",
    status: "In Progress",
    priority: "Medium",
    projectId: null,
    projectName: null,
    mainAssigneeEmployeeId: null,
    assigneeName: null,
    creatorUserId: "u-other",
    creatorName: "Người khác",
    reporterEmployeeId: null,
    departmentId: null,
    dueAt: "2026-10-20T10:00:00.000Z",
    startAt: null,
    completedAt: null,
    isOverdue: true,
    createdBy: "u-other",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("overdueDaysOf — số ngày trễ theo giờ công ty", () => {
  it("hạn 17:00 ngày 19/10 giờ công ty ⇒ 5 ngày (theo múi UTC của máy sẽ ra 4)", () => {
    expect(overdueDaysOf("2026-10-19T10:00:00.000Z", NOW, TZ)).toBe(5);
  });

  it("hạn 23:00 ngày 23/10 giờ công ty (= 16:00 UTC) ⇒ 1 ngày", () => {
    expect(overdueDaysOf("2026-10-23T16:00:00.000Z", NOW, TZ)).toBe(1);
  });

  it("hạn 03:00 sáng nay giờ công ty (vẫn là 23/10 theo UTC) ⇒ 0 — trễ dưới một ngày", () => {
    expect(overdueDaysOf("2026-10-23T20:00:00.000Z", NOW, TZ)).toBe(0);
  });

  it("hạn ở tương lai (vừa dời, chờ server xác nhận) ⇒ null — không trễ, không ra số âm", () => {
    expect(overdueDaysOf("2026-10-27T10:00:00.000Z", NOW, TZ)).toBeNull();
  });

  it("không có hạn hoặc hạn hỏng ⇒ null", () => {
    expect(overdueDaysOf(null, NOW, TZ)).toBeNull();
    expect(overdueDaysOf("không-phải-ngày", NOW, TZ)).toBeNull();
  });
});

describe("byDueAtAsc — trễ lâu nhất đứng đầu", () => {
  it("sắp hạn tăng dần, việc không có hạn xuống cuối", () => {
    const rows = [
      row("b", { dueAt: "2026-10-22T10:00:00.000Z" }),
      row("none", { dueAt: null }),
      row("a", { dueAt: "2026-10-10T10:00:00.000Z" }),
    ];
    expect([...rows].sort(byDueAtAsc).map((r) => r.id)).toEqual(["a", "b", "none"]);
  });
});

describe("OVERDUE_DEADLINE_PRESETS — mốc riêng của trang Quá hạn", () => {
  it("+1 ngày · +3 ngày · Thứ Sáu, 17:00 giờ công ty, tính từ HÔM NAY (không từ hạn cũ)", () => {
    const presets = resolveDeadlinePresets(NOW, TZ, OVERDUE_DEADLINE_PRESETS);
    expect(presets.map((p) => [p.id, p.labelKey, p.dueAt])).toEqual([
      ["plus1d", "plusOneDay", "2026-10-25T10:00:00.000Z"],
      ["plus3d", "plusThreeDays", "2026-10-27T10:00:00.000Z"],
      // 24/10/2026 là Thứ Bảy ⇒ Thứ Sáu «này» đã qua ⇒ Thứ Sáu tuần sau.
      ["friday", "nextFriday", "2026-10-30T10:00:00.000Z"],
    ]);
  });

  it("mọi mốc ở tương lai ⇒ việc vừa dời rời danh sách quá hạn", () => {
    for (const preset of resolveDeadlinePresets(NOW, TZ, OVERDUE_DEADLINE_PRESETS)) {
      expect(new Date(preset.dueAt).getTime()).toBeGreaterThan(NOW.getTime());
    }
  });
});

describe("filterOverdueRows — lọc client-side trên các dòng đã tải", () => {
  const rows = [
    row("p1-a", { projectId: "p1", projectName: "Dự án 1", mainAssigneeEmployeeId: "emp-a" }),
    row("p1-b", {
      projectId: "p1",
      projectName: "Dự án 1",
      mainAssigneeEmployeeId: "emp-b",
      creatorUserId: "u-me",
    }),
    row("p2-a", { projectId: "p2", projectName: "Dự án 2", mainAssigneeEmployeeId: "emp-a" }),
    row("loose", { creatorUserId: "u-me" }),
  ];
  const ids = (out: readonly TaskCoreResponseDto[]) => out.map((r) => r.id);

  it("không lọc ⇒ giữ nguyên thứ tự", () => {
    expect(ids(filterOverdueRows(rows, EMPTY_OVERDUE_FILTERS, "u-me"))).toEqual(ids(rows));
  });

  it("theo dự án · theo người · kết hợp", () => {
    expect(ids(filterOverdueRows(rows, { ...EMPTY_OVERDUE_FILTERS, project: "p1" }, null))).toEqual(
      ["p1-a", "p1-b"],
    );
    expect(
      ids(filterOverdueRows(rows, { ...EMPTY_OVERDUE_FILTERS, assignee: "emp-a" }, null)),
    ).toEqual(["p1-a", "p2-a"]);
    expect(
      ids(
        filterOverdueRows(
          rows,
          { ...EMPTY_OVERDUE_FILTERS, project: "p1", assignee: "emp-a" },
          null,
        ),
      ),
    ).toEqual(["p1-a"]);
  });

  it("«Không thuộc dự án» / «Chưa giao» = giá trị rỗng", () => {
    const none = { ...EMPTY_OVERDUE_FILTERS, project: OVERDUE_FILTER_NONE };
    expect(ids(filterOverdueRows(rows, none, null))).toEqual(["loose"]);
    const unassigned = { ...EMPTY_OVERDUE_FILTERS, assignee: OVERDUE_FILTER_NONE };
    expect(ids(filterOverdueRows(rows, unassigned, null))).toEqual(["loose"]);
  });

  it("«Tôi giao» = creatorUserId là tôi; chưa biết tôi là ai ⇒ rỗng (không đoán)", () => {
    const mine = { ...EMPTY_OVERDUE_FILTERS, mine: true };
    expect(ids(filterOverdueRows(rows, mine, "u-me"))).toEqual(["p1-b", "loose"]);
    expect(filterOverdueRows(rows, mine, null)).toEqual([]);
  });
});

describe("overdueFilterOptions — lựa chọn lấy từ chính các dòng đã tải", () => {
  it("dự án / người không trùng, xếp theo tên; báo có dòng rỗng", () => {
    const options = overdueFilterOptions([
      row("1", {
        projectId: "p2",
        projectName: "Zeta",
        mainAssigneeEmployeeId: "e2",
        assigneeName: "Bình",
      }),
      row("2", {
        projectId: "p1",
        projectName: "Alpha",
        mainAssigneeEmployeeId: "e1",
        assigneeName: "An",
      }),
      row("3", {
        projectId: "p2",
        projectName: "Zeta",
        mainAssigneeEmployeeId: "e2",
        assigneeName: "Bình",
      }),
    ]);
    expect(options.projects).toEqual([
      { id: "p1", name: "Alpha" },
      { id: "p2", name: "Zeta" },
    ]);
    expect(options.assignees).toEqual([
      { id: "e1", name: "An" },
      { id: "e2", name: "Bình" },
    ]);
    expect(options.hasNoProject).toBe(false);
    expect(options.hasUnassigned).toBe(false);
    const loose = overdueFilterOptions([row("x")]);
    expect(loose.hasNoProject).toBe(true);
    expect(loose.hasUnassigned).toBe(true);
  });
});

describe("keepSelectedOption — ô lọc luôn hiện giá trị đang lọc", () => {
  const P1 = { id: "p-1", name: "Dự án 1" };
  const P2 = { id: "p-2", name: "Dự án 2" };

  it("giá trị còn trong lựa chọn (hoặc không lọc) ⇒ giữ nguyên", () => {
    expect(keepSelectedOption([P1, P2], false, "p-1", undefined)).toEqual({
      options: [P1, P2],
      hasEmpty: false,
    });
    expect(keepSelectedOption([P1], true, null, P2)).toEqual({ options: [P1], hasEmpty: true });
  });

  it("dòng cuối của giá trị đang lọc đã rời ⇒ thêm lại bằng tên lúc chọn", () => {
    expect(keepSelectedOption([P2], false, "p-1", P1)).toEqual({
      options: [P2, P1],
      hasEmpty: false,
    });
  });

  it("không nhớ tên của đúng giá trị đó ⇒ hiện id, không lấy nhầm tên khác", () => {
    expect(keepSelectedOption([], false, "p-1", P2).options).toEqual([{ id: "p-1", name: "p-1" }]);
  });

  it("đang lọc «Không thuộc dự án» mà không còn dòng nào như vậy ⇒ vẫn có lựa chọn đó", () => {
    expect(keepSelectedOption([P1], false, OVERDUE_FILTER_NONE, undefined)).toEqual({
      options: [P1],
      hasEmpty: true,
    });
  });
});
