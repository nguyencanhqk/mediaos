/**
 * query-keys.spec.ts — Unit tests cho query key factories (FRONTEND-04 §17).
 *
 * RED phase: viết trước khi implement. Land BƯỚC 7.
 */
import { describe, expect, it } from "vitest";
import {
  attendanceKeys,
  authKeys,
  dashboardKeys,
  hrKeys,
  leaveKeys,
  notificationKeys,
  taskKeys,
} from "./query-keys";

describe("authKeys", () => {
  it("me() = ['auth', 'me']", () => {
    expect(authKeys.me()).toEqual(["auth", "me"]);
  });

  it("profile() chứa 'auth'", () => {
    expect(authKeys.profile()[0]).toBe("auth");
  });
});

describe("hrKeys", () => {
  it("employees.list(params) chứa 'employees', 'list', và params", () => {
    const params = { page: 1, per_page: 20 };
    const key = hrKeys.employees.list(params);
    expect(key).toContain("employees");
    expect(key).toContain("list");
    expect(key).toContain(params);
  });

  it("employees.detail(id) chứa id", () => {
    const key = hrKeys.employees.detail("emp-123");
    expect(key).toContain("emp-123");
  });

  it("key KHÁC nhau khi params khác (cache invalidation ổn định)", () => {
    const k1 = hrKeys.employees.list({ page: 1 });
    const k2 = hrKeys.employees.list({ page: 2 });
    expect(JSON.stringify(k1)).not.toBe(JSON.stringify(k2));
  });
});

describe("attendanceKeys", () => {
  it("list(params) chứa 'attendance'", () => {
    const key = attendanceKeys.list({});
    expect(key[0]).toBe("attendance");
  });

  it("myToday() ổn định", () => {
    expect(attendanceKeys.myToday()).toEqual(attendanceKeys.myToday());
  });
});

describe("leaveKeys", () => {
  it("requests.list(params) chứa 'leave'", () => {
    const key = leaveKeys.requests.list({});
    expect(key[0]).toBe("leave");
  });
});

describe("taskKeys", () => {
  it("list(params) chứa 'tasks'", () => {
    const key = taskKeys.list({});
    expect(key[0]).toBe("tasks");
  });

  it("detail(id) chứa id", () => {
    const key = taskKeys.detail("task-abc");
    expect(key).toContain("task-abc");
  });
});

describe("dashboardKeys", () => {
  it("overview() ổn định", () => {
    expect(dashboardKeys.overview()).toEqual(dashboardKeys.overview());
  });
});

describe("notificationKeys", () => {
  it("list(params) chứa 'notifications'", () => {
    const key = notificationKeys.list({});
    expect(key[0]).toBe("notifications");
  });

  it("unreadCount() ổn định", () => {
    expect(notificationKeys.unreadCount()).toEqual(notificationKeys.unreadCount());
  });
});
