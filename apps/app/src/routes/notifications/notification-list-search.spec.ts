/**
 * S20-NOTI-LISTNAV-1 (US-X-13) — bộ lọc trang Thông báo trên URL.
 * Phủ: validateSearch KHÔNG ném với rác · query gửi API dùng tham số contract sẵn có · patch/clear giữ
 * tham số lạ (vd `?task=` của drawer) · phạm vi «đánh dấu đã đọc» theo khả năng endpoint.
 */
import { describe, it, expect } from "vitest";
import {
  clearNotificationListFilters,
  hasActiveNotificationListFilters,
  listWatermark,
  notificationMarkAllBody,
  notificationMarkAllScope,
  patchNotificationListSearch,
  toNotificationListQuery,
  validateNotificationListSearch,
} from "./notification-list-search";

describe("validateNotificationListSearch — rác ⇒ bỏ khoá, KHÔNG ném", () => {
  it("giữ giá trị hợp lệ (router đã JSON.parse: page là số)", () => {
    expect(
      validateNotificationListSearch({
        source: "CHAT",
        priority: "High",
        status: "Unread",
        page: 3,
      }),
    ).toEqual({ source: "CHAT", priority: "High", status: "Unread", page: 3 });
  });

  it("page dạng chuỗi số cũng nhận", () => {
    expect(validateNotificationListSearch({ page: "2" })).toEqual({ page: 2 });
  });

  it.each([
    [{ source: "HR" }],
    [{ source: "chat" }],
    [{ source: 42 }],
    [{ priority: "VeryHigh" }],
    [{ priority: null }],
    [{ status: "Read" }],
    [{ status: { $ne: 1 } }],
    [{ page: 1 }],
    [{ page: 0 }],
    [{ page: -5 }],
    [{ page: 2.5 }],
    [{ page: "abc" }],
    [{ page: 10_001 }],
  ])("%j ⇒ {}", (raw) => {
    expect(() => validateNotificationListSearch(raw as Record<string, unknown>)).not.toThrow();
    expect(validateNotificationListSearch(raw as Record<string, unknown>)).toEqual({});
  });

  it("tham số lạ (`task` của drawer) không làm ném, không lọt vào kết quả", () => {
    expect(validateNotificationListSearch({ task: "x", source: "TASK" })).toEqual({
      source: "TASK",
    });
  });
});

describe("toNotificationListQuery — chỉ tham số contract sẵn có", () => {
  it("không lọc ⇒ chỉ page + per_page", () => {
    expect(toNotificationListQuery({}, 20)).toEqual({ page: 1, per_page: 20 });
  });

  it("chip «Tin nhắn» ⇒ source_module = CHAT; priority + status đi kèm", () => {
    expect(
      toNotificationListQuery(
        { source: "CHAT", priority: "Urgent", status: "Unread", page: 2 },
        20,
      ),
    ).toEqual({
      page: 2,
      per_page: 20,
      source_module: "CHAT",
      priority: "Urgent",
      status: "Unread",
    });
  });
});

describe("patch / clear — giữ tham số khác trên URL", () => {
  it("đổi bộ lọc ⇒ về trang 1, giữ `task`", () => {
    expect(
      patchNotificationListSearch({ task: "t1", page: 4, source: "TASK" }, { source: "GOAL" }),
    ).toEqual({ task: "t1", source: "GOAL" });
  });

  it("giá trị undefined ⇒ bỏ khoá", () => {
    expect(
      patchNotificationListSearch({ source: "TASK", priority: "High" }, { source: undefined }),
    ).toEqual({ priority: "High" });
  });

  it("patch page ⇒ đặt page", () => {
    expect(patchNotificationListSearch({ source: "TASK" }, { page: 2 })).toEqual({
      source: "TASK",
      page: 2,
    });
  });

  it("bỏ lọc ⇒ bỏ source/priority/status/page, giữ `task`", () => {
    expect(
      clearNotificationListFilters({
        task: "t1",
        source: "CHAT",
        priority: "Low",
        status: "Unread",
        page: 2,
      }),
    ).toEqual({ task: "t1" });
  });

  it("hasActiveNotificationListFilters", () => {
    expect(hasActiveNotificationListFilters({})).toBe(false);
    expect(hasActiveNotificationListFilters({ page: 2 })).toBe(false);
    expect(hasActiveNotificationListFilters({ source: "LEAVE" })).toBe(true);
    expect(hasActiveNotificationListFilters({ priority: "Low" })).toBe(true);
    expect(hasActiveNotificationListFilters({ status: "Unread" })).toBe(true);
  });
});

// POST /notifications/mark-all-read nhận source_module + priority + created_before ⇒ mọi bộ lọc đều đi
// MỘT lời gọi (S20-NOTI-PRIORITYFILTER-1).
describe("notificationMarkAllScope — theo khả năng endpoint mark-all-read", () => {
  it.each([
    [{}, "all"],
    [{ status: "Unread" as const }, "all"],
    [{ page: 3 }, "all"],
    [{ source: "CHAT" as const }, "filter"],
    [{ source: "TASK" as const, status: "Unread" as const }, "filter"],
    [{ priority: "High" as const }, "filter"],
    [{ source: "GOAL" as const, priority: "Low" as const }, "filter"],
  ])("%j ⇒ %s", (search, expected) => {
    expect(notificationMarkAllScope(search)).toBe(expected);
  });
});

describe("notificationMarkAllBody", () => {
  const at = new Date("2026-01-02T03:04:05.000Z");
  it("gửi nguồn + mức + mốc tải danh sách", () => {
    expect(notificationMarkAllBody({ source: "TASK", priority: "Normal", page: 2 }, at)).toEqual({
      source_module: "TASK",
      priority: "Normal",
      created_before: at,
    });
  });
  it("chỉ lọc mức ⇒ không có source_module", () => {
    expect(notificationMarkAllBody({ priority: "High" }, at)).toEqual({
      priority: "High",
      created_before: at,
    });
  });
});

describe("listWatermark — mốc từ created_at của server, không từ đồng hồ client", () => {
  it("lấy created_at mới nhất +1ms (so <= với cột micro-giây)", () => {
    const w = listWatermark([
      { created_at: "2026-07-01T09:00:00.000Z" },
      { created_at: "2026-07-01T10:00:00.123Z" },
    ]);
    expect(w?.toISOString()).toBe("2026-07-01T10:00:00.124Z");
  });
  it("rỗng/undefined/ngày rác ⇒ null", () => {
    expect(listWatermark([])).toBeNull();
    expect(listWatermark(undefined)).toBeNull();
    expect(listWatermark([{ created_at: "rác" }])).toBeNull();
  });
});
