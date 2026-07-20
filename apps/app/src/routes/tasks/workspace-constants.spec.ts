import { describe, expect, it } from "vitest";
import {
  buildAssigneeSummary,
  DEFAULT_WORKSPACE_FILTERS,
  matchesAssigneeSelection,
  matchesWorkspaceFilters,
  normalizeSearchText,
  parseWorkspaceTab,
  pinSelectedInSummary,
  PROJECT_WORKSPACE_TABS,
  sanitizeWorkspaceTabOrder,
  sortWorkspaceTasks,
  UNASSIGNED_FILTER_VALUE,
  type WorkspaceTaskFilters,
} from "./workspace-constants";

// S5-TASK-WORKSPACE-1 — helper thuần của vỏ workspace: parser tab, predicate lọc chung (parity
// Bảng↔Danh sách theo cấu trúc), summary rail avatar, comparator sắp xếp.

type FilterableTask = Parameters<typeof matchesWorkspaceFilters>[0] &
  Parameters<typeof matchesAssigneeSelection>[0] &
  Parameters<typeof buildAssigneeSummary>[0][number];

function makeTask(overrides: Partial<FilterableTask> = {}): FilterableTask {
  return {
    title: "Việc mẫu",
    status: "Todo",
    priority: "Medium",
    isOverdue: false,
    mainAssigneeEmployeeId: null,
    assigneeName: null,
    // S5-TASK-AVATAR-1 — rail giờ mang thêm URL ảnh đã ký; mặc định null = chữ cái đầu.
    assigneeAvatarUrl: null,
    ...overrides,
  };
}

function filtersWith(part: Partial<WorkspaceTaskFilters>): WorkspaceTaskFilters {
  return { ...DEFAULT_WORKSPACE_FILTERS, ...part };
}

describe("parseWorkspaceTab", () => {
  it("nhận đúng các tab hợp lệ", () => {
    for (const tab of ["overview", "board", "list", "report", "activity", "members"]) {
      expect(parseWorkspaceTab(tab)).toBe(tab);
    }
  });

  it("giá trị rác/thiếu → overview (không crash deep-link bẩn)", () => {
    expect(parseWorkspaceTab(undefined)).toBe("overview");
    expect(parseWorkspaceTab("kanban")).toBe("overview");
    expect(parseWorkspaceTab(123)).toBe("overview");
    expect(parseWorkspaceTab(["board"])).toBe("overview");
  });
});

describe("sanitizeWorkspaceTabOrder", () => {
  it("giữ thứ tự đã lưu khi hợp lệ đầy đủ", () => {
    const reversed = [...PROJECT_WORKSPACE_TABS].reverse();
    expect(sanitizeWorkspaceTabOrder(reversed)).toEqual(reversed);
  });

  it("bỏ rác + trùng lặp, nối tab thiếu vào cuối theo mặc định", () => {
    expect(sanitizeWorkspaceTabOrder(["board", "kanban", "board", 42, "settings"])).toEqual([
      "board",
      "settings",
      "overview",
      "list",
      "report",
      "activity",
      "members",
    ]);
  });

  it("không phải mảng (storage hỏng/null) → thứ tự mặc định", () => {
    expect(sanitizeWorkspaceTabOrder(null)).toEqual([...PROJECT_WORKSPACE_TABS]);
    expect(sanitizeWorkspaceTabOrder("board")).toEqual([...PROJECT_WORKSPACE_TABS]);
    expect(sanitizeWorkspaceTabOrder({})).toEqual([...PROJECT_WORKSPACE_TABS]);
  });
});

describe("normalizeSearchText + matchesWorkspaceFilters", () => {
  it("tìm không phân biệt hoa-thường và DẤU tiếng Việt (gõ 'bao cao' khớp 'Báo cáo')", () => {
    expect(normalizeSearchText("Báo Cáo Tuần")).toBe("bao cao tuan");
    expect(normalizeSearchText("Đối chiếu")).toBe("doi chieu");
    const task = makeTask({ title: "Chuẩn bị Báo cáo tuần" });
    expect(matchesWorkspaceFilters(task, filtersWith({ q: "bao cao" }))).toBe(true);
    expect(matchesWorkspaceFilters(task, filtersWith({ q: "hợp đồng" }))).toBe(false);
  });

  it("lọc status/priority/overdue kết hợp AND", () => {
    const task = makeTask({ status: "In Progress", priority: "High", isOverdue: true });
    expect(matchesWorkspaceFilters(task, filtersWith({ status: "In Progress" }))).toBe(true);
    expect(matchesWorkspaceFilters(task, filtersWith({ status: "Done" }))).toBe(false);
    expect(matchesWorkspaceFilters(task, filtersWith({ priority: "High" }))).toBe(true);
    expect(matchesWorkspaceFilters(task, filtersWith({ priority: "Low" }))).toBe(false);
    expect(matchesWorkspaceFilters(task, filtersWith({ overdueOnly: true }))).toBe(true);
    expect(matchesWorkspaceFilters(makeTask(), filtersWith({ overdueOnly: true }))).toBe(false);
    expect(
      matchesWorkspaceFilters(task, filtersWith({ status: "In Progress", priority: "Low" })),
    ).toBe(false);
  });
});

describe("matchesAssigneeSelection", () => {
  it("selection rỗng = hiện tất cả; multi-select khớp BẤT KỲ; sentinel Chưa giao khớp null", () => {
    const mine = makeTask({ mainAssigneeEmployeeId: "emp-1" });
    const other = makeTask({ mainAssigneeEmployeeId: "emp-2" });
    const unassigned = makeTask({ mainAssigneeEmployeeId: null });

    expect(matchesAssigneeSelection(mine, new Set())).toBe(true);
    expect(matchesAssigneeSelection(unassigned, new Set())).toBe(true);

    const multi = new Set(["emp-1", UNASSIGNED_FILTER_VALUE]);
    expect(matchesAssigneeSelection(mine, multi)).toBe(true);
    expect(matchesAssigneeSelection(unassigned, multi)).toBe(true);
    expect(matchesAssigneeSelection(other, multi)).toBe(false);
  });
});

describe("buildAssigneeSummary", () => {
  it("đếm theo người + Chưa giao, sắp count desc rồi tên, lấy tên đầu tiên không-null", () => {
    const summary = buildAssigneeSummary([
      makeTask({ mainAssigneeEmployeeId: "emp-1", assigneeName: null }),
      makeTask({ mainAssigneeEmployeeId: "emp-1", assigneeName: "An" }),
      makeTask({ mainAssigneeEmployeeId: "emp-2", assigneeName: "Bình" }),
      makeTask({ mainAssigneeEmployeeId: null }),
      makeTask({ mainAssigneeEmployeeId: null }),
    ]);
    expect(summary.unassignedCount).toBe(2);
    expect(summary.assignees).toEqual([
      { id: "emp-1", name: "An", avatarUrl: null, count: 2 },
      { id: "emp-2", name: "Bình", avatarUrl: null, count: 1 },
    ]);
  });
});

describe("pinSelectedInSummary", () => {
  it("GHIM người đang chọn vào rail (count 0, tên tra từ tập gốc) khi toolbar lọc hết task của họ", () => {
    const all = [
      makeTask({ mainAssigneeEmployeeId: "emp-1", assigneeName: "An" }),
      makeTask({ mainAssigneeEmployeeId: "emp-2", assigneeName: "Bình" }),
    ];
    // Toolbar đã lọc hết task của emp-2 → summary chỉ còn emp-1.
    const summary = buildAssigneeSummary([all[0]]);
    const pinned = pinSelectedInSummary(summary, new Set(["emp-2"]), all);
    expect(pinned.assignees).toEqual([
      { id: "emp-1", name: "An", avatarUrl: null, count: 1 },
      { id: "emp-2", name: "Bình", avatarUrl: null, count: 0 },
    ]);
  });

  it("selection rỗng hoặc người chọn vẫn còn trong summary → trả nguyên summary", () => {
    const all = [makeTask({ mainAssigneeEmployeeId: "emp-1", assigneeName: "An" })];
    const summary = buildAssigneeSummary(all);
    expect(pinSelectedInSummary(summary, new Set(), all)).toBe(summary);
    expect(pinSelectedInSummary(summary, new Set(["emp-1"]), all)).toBe(summary);
    // Sentinel Chưa giao KHÔNG bị ghim thành entry avatar (nút riêng lo việc này).
    expect(pinSelectedInSummary(summary, new Set([UNASSIGNED_FILTER_VALUE]), all)).toBe(summary);
  });
});

describe("sortWorkspaceTasks", () => {
  const t1 = {
    title: "B",
    priority: "Low" as const,
    dueAt: "2026-07-02T00:00:00.000Z",
    createdAt: "2026-07-01T00:00:00.000Z",
  };
  const t2 = {
    title: "A",
    priority: "Urgent" as const,
    dueAt: null,
    createdAt: "2026-07-03T00:00:00.000Z",
  };
  const t3 = {
    title: "C",
    priority: null,
    dueAt: "2026-07-01T00:00:00.000Z",
    createdAt: "2026-07-02T00:00:00.000Z",
  };

  it("default giữ nguyên thứ tự server và KHÔNG mutate mảng gốc", () => {
    const input = [t1, t2, t3];
    const out = sortWorkspaceTasks(input, "default");
    expect(out).toEqual([t1, t2, t3]);
    expect(out).not.toBe(input);
  });

  it("dueAsc/dueDesc — null luôn xuống cuối", () => {
    expect(sortWorkspaceTasks([t1, t2, t3], "dueAsc")).toEqual([t3, t1, t2]);
    expect(sortWorkspaceTasks([t1, t2, t3], "dueDesc")).toEqual([t1, t3, t2]);
  });

  it("priorityDesc — Urgent trước, thiếu priority xuống cuối", () => {
    expect(sortWorkspaceTasks([t1, t2, t3], "priorityDesc")).toEqual([t2, t1, t3]);
  });

  it("titleAsc + createdDesc", () => {
    expect(sortWorkspaceTasks([t1, t2, t3], "titleAsc")).toEqual([t2, t1, t3]);
    expect(sortWorkspaceTasks([t1, t2, t3], "createdDesc")).toEqual([t2, t3, t1]);
  });
});
