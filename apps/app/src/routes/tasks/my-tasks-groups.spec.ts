/**
 * S20-TASK-MYTASKS-1 (US-TASK-NV-01) — hàm nhóm THUẦN của «Việc của tôi».
 *
 * Mốc «bây giờ» = 06:30 ngày 24/10/2026 giờ công ty (Asia/Ho_Chi_Minh, UTC+7) = 23:30 ngày 23/10 UTC.
 * Chạy spec này dưới `TZ=UTC` và `TZ=America/Los_Angeles`: hàm nhóm không được đọc múi MÁY, nên hai
 * lượt phải cho cùng kết quả (ở hai múi đó «hôm nay» của máy vẫn là 23/10).
 */
import { describe, expect, it } from "vitest";
import type { MyTaskItemDto } from "@mediaos/contracts";
import {
  filterMyTasks,
  groupMyTasks,
  MY_TASK_GROUP_KEYS,
  patchMyTasksSearch,
  validateMyTasksSearch,
  type MyTaskGroup,
} from "./my-tasks-groups";
import { MY_TASKS_UPCOMING_DAYS } from "./constants";

const TZ = "Asia/Ho_Chi_Minh";
const NOW = new Date("2026-10-23T23:30:00.000Z"); // 06:30 ngày 24/10 giờ công ty

function item(id: string, overrides: Partial<MyTaskItemDto> = {}): MyTaskItemDto {
  return {
    id,
    companyId: "co-1",
    title: `Việc ${id}`,
    description: null,
    taskType: "office",
    status: "Todo",
    priority: "Medium",
    projectId: null,
    projectName: null,
    mainAssigneeEmployeeId: "emp-1",
    assigneeName: "Người A",
    creatorUserId: "u1",
    creatorName: "Người A",
    reporterEmployeeId: null,
    departmentId: null,
    dueAt: null,
    startAt: null,
    completedAt: null,
    isOverdue: false,
    createdBy: "u1",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    source: "assigned",
    ...overrides,
  };
}

function idsByGroup(groups: readonly MyTaskGroup[]): Record<string, string[]> {
  return Object.fromEntries(groups.map((g) => [g.key, g.items.map((i) => i.id)]));
}

describe("groupMyTasks — nhóm theo hạn (giờ công ty) rồi theo trạng thái", () => {
  const items = [
    // Hạn 09:00 hôm nay, server đã gắn quá hạn ⇒ «Quá hạn» (server là nguồn duy nhất của quá hạn).
    item("due-0900-overdue", { dueAt: "2026-10-24T02:00:00.000Z", isOverdue: true }),
    // 23:30 hôm nay giờ công ty — trên máy UTC/LA đó là «ngày mai» ⇒ bắt lỗi đọc múi máy.
    item("due-today-late", { dueAt: "2026-10-24T16:30:00.000Z" }),
    // Đang làm nhưng hạn hôm nay ⇒ nhóm hạn đứng trước nhóm trạng thái.
    item("in-progress-due-today", { status: "In Progress", dueAt: "2026-10-24T05:00:00.000Z" }),
    item("due-tomorrow-0000", { dueAt: "2026-10-24T17:00:00.000Z" }),
    item("due-plus3-2359", { dueAt: "2026-10-27T16:59:00.000Z" }),
    item("due-plus4-0000", { dueAt: "2026-10-27T17:00:00.000Z" }),
    item("in-progress", { status: "In Progress" }),
    item("in-review", { status: "In Review" }),
    item("todo-no-due", {}),
    // Hạn đã qua nhưng server KHÔNG gắn quá hạn ⇒ không tự suy «Quá hạn».
    item("past-not-flagged", { dueAt: "2026-10-22T03:00:00.000Z" }),
    item("done", { status: "Done", dueAt: "2026-10-20T03:00:00.000Z" }),
    item("cancelled-flagged", { status: "Cancelled", isOverdue: true }),
  ];

  it("mỗi việc đúng MỘT nhóm, thứ tự Quá hạn → Hôm nay → Sắp đến hạn → Đang làm → Chờ kiểm tra → Khác", () => {
    const groups = groupMyTasks(items, { now: NOW, timeZone: TZ, showDone: false });

    expect(groups.map((g) => g.key)).toEqual([
      "overdue",
      "today",
      "upcoming",
      "inProgress",
      "inReview",
      "other",
    ]);
    expect(idsByGroup(groups)).toEqual({
      overdue: ["due-0900-overdue"],
      today: ["due-today-late", "in-progress-due-today"],
      upcoming: ["due-tomorrow-0000", "due-plus3-2359"],
      inProgress: ["in-progress"],
      inReview: ["in-review"],
      other: ["due-plus4-0000", "todo-no-due", "past-not-flagged"],
    });
  });

  it("Done/Cancelled ẩn mặc định — kể cả khi cờ quá hạn bật nhầm", () => {
    const groups = groupMyTasks(items, { now: NOW, timeZone: TZ, showDone: false });
    const shown = groups.flatMap((g) => g.items.map((i) => i.id));
    expect(shown).not.toContain("done");
    expect(shown).not.toContain("cancelled-flagged");
    expect(shown).toHaveLength(items.length - 2);
  });

  it("showDone ⇒ thêm nhóm «Đã xong» ở CUỐI, chứa Done + Cancelled", () => {
    const groups = groupMyTasks(items, { now: NOW, timeZone: TZ, showDone: true });
    expect(groups.map((g) => g.key)).toEqual([...MY_TASK_GROUP_KEYS]);
    expect(groups.at(-1)).toMatchObject({ key: "done" });
    expect(groups.at(-1)?.items.map((i) => i.id)).toEqual(["done", "cancelled-flagged"]);
  });

  it("giữ thứ tự server trong từng nhóm", () => {
    const reversed = [...items].reverse();
    const groups = groupMyTasks(reversed, { now: NOW, timeZone: TZ, showDone: false });
    expect(idsByGroup(groups).today).toEqual(["in-progress-due-today", "due-today-late"]);
  });

  it("nhóm rỗng vẫn có mặt với 0 việc (trang tự thu gọn)", () => {
    const groups = groupMyTasks([item("only", { status: "In Review" })], {
      now: NOW,
      timeZone: TZ,
      showDone: false,
    });
    expect(groups.map((g) => [g.key, g.items.length])).toEqual([
      ["overdue", 0],
      ["today", 0],
      ["upcoming", 0],
      ["inProgress", 0],
      ["inReview", 1],
      ["other", 0],
    ]);
  });

  it("«Sắp đến hạn» là hằng số 3 ngày sau hôm nay (giờ công ty)", () => {
    expect(MY_TASKS_UPCOMING_DAYS).toBe(3);
  });

  it("biên ngày theo múi công ty: 23:59:59 vẫn là hôm nay, 00:00 ngày kế là sắp đến hạn", () => {
    const groups = groupMyTasks(
      [
        item("last-ms-today", { dueAt: "2026-10-24T16:59:59.999Z" }),
        item("first-ms-tomorrow", { dueAt: "2026-10-24T17:00:00.000Z" }),
      ],
      { now: NOW, timeZone: TZ, showDone: false },
    );
    expect(idsByGroup(groups)).toMatchObject({
      today: ["last-ms-today"],
      upcoming: ["first-ms-tomorrow"],
    });
  });

  it("hạn không đọc được ⇒ coi như không có hạn, không làm sập trang", () => {
    const groups = groupMyTasks([item("bad-due", { dueAt: "không-phải-ngày" })], {
      now: NOW,
      timeZone: TZ,
      showDone: false,
    });
    expect(idsByGroup(groups).other).toEqual(["bad-due"]);
  });
});

describe("filterMyTasks — chip nguồn + lọc nhanh theo tiêu đề", () => {
  const items = [
    item("a", { title: "Báo cáo tuần", source: "assigned" }),
    item("c", { title: "Chuẩn bị họp", source: "created" }),
    item("w", { title: "Đọc báo cáo quý", source: "watched" }),
  ];

  it("không nguồn, không từ khoá ⇒ giữ nguyên (gộp 3 nguồn)", () => {
    expect(filterMyTasks(items, {}).map((i) => i.id)).toEqual(["a", "c", "w"]);
  });

  it("nguồn ⇒ chỉ việc của nguồn đó", () => {
    expect(filterMyTasks(items, { source: "watched" }).map((i) => i.id)).toEqual(["w"]);
  });

  it("từ khoá không phân biệt hoa thường và dấu tiếng Việt", () => {
    expect(filterMyTasks(items, { query: "  BAO CAO " }).map((i) => i.id)).toEqual(["a", "w"]);
    expect(filterMyTasks(items, { query: "doc" }).map((i) => i.id)).toEqual(["w"]);
  });

  it("nguồn + từ khoá cùng áp", () => {
    expect(filterMyTasks(items, { source: "assigned", query: "quý" })).toEqual([]);
  });
});

describe("validateMyTasksSearch — `?group=&source=&showDone=` không bao giờ ném", () => {
  it("giá trị hợp lệ được giữ; showDone chuẩn hoá về 1", () => {
    expect(validateMyTasksSearch({ group: "overdue", source: "watched", showDone: 1 })).toEqual({
      group: "overdue",
      source: "watched",
      showDone: 1,
    });
    expect(validateMyTasksSearch({ showDone: "1" })).toEqual({ showDone: 1 });
    expect(validateMyTasksSearch({ showDone: true })).toEqual({ showDone: 1 });
    expect(validateMyTasksSearch({ group: "done" })).toEqual({ group: "done" });
  });

  it("rác ⇒ bỏ khoá đó, dùng mặc định", () => {
    expect(
      validateMyTasksSearch({
        group: "abc",
        source: ["watched"],
        showDone: 0,
        page: 3,
        task: "x",
      }),
    ).toEqual({});
    expect(validateMyTasksSearch({ group: null, source: { a: 1 }, showDone: "yes" })).toEqual({});
  });
});

describe("patchMyTasksSearch — ghi bộ lọc mà giữ tham số khác của URL", () => {
  it("giữ `task` của drawer; undefined ⇒ bỏ khoá", () => {
    const prev = { task: "t-1", source: "created", group: "today" };
    expect(patchMyTasksSearch(prev, { source: "watched", group: undefined })).toEqual({
      task: "t-1",
      source: "watched",
    });
  });
});
