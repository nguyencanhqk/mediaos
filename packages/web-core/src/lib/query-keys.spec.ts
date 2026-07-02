/**
 * query-keys.spec.ts — Unit tests cho query key factories (FRONTEND-04 §17).
 *
 * RED phase: viết trước khi implement. Land BƯỚC 7.
 */
import { describe, expect, it } from "vitest";
import {
  attendanceInvalidation,
  attendanceKeys,
  authKeys,
  dashboardKeys,
  foundationInvalidation,
  foundationKeys,
  hrInvalidation,
  hrKeys,
  leaveInvalidation,
  leaveKeys,
  notificationKeys,
  taskKeys,
} from "./query-keys";

describe("foundationKeys", () => {
  it("company.current() = ['foundation', 'company', 'current']", () => {
    expect(foundationKeys.company.current()).toEqual(["foundation", "company", "current"]);
  });

  it("settings.resolve(params) chứa 'foundation', 'settings', 'resolve' và params", () => {
    const params = { keys: ["general.timezone"] };
    const key = foundationKeys.settings.resolve(params);
    expect(key).toContain("foundation");
    expect(key).toContain("settings");
    expect(key).toContain("resolve");
    expect(key).toContain(params);
  });

  it("updateCompany invalidation nhắm current-company key", () => {
    const keys = foundationInvalidation.updateCompany();
    expect(keys).toContainEqual(foundationKeys.company.current());
  });

  it("updateSetting invalidation dùng prefix resolve (bỏ slot params) — khớp mọi biến thể", () => {
    const keys = foundationInvalidation.updateSetting();
    // Prefix KHÔNG có slot params → là prefix của mọi resolve(params).
    expect(keys[0]).toEqual(["foundation", "settings", "resolve"]);
  });
});

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

  // S2-FE-HR-4 — "mine" (self scope) KHÁC "list" (Company scope, HR) dù cùng resource.
  it("profileChangeRequests.mine(params) KHÁC .list(params) (scope khác nhau)", () => {
    const mine = hrKeys.profileChangeRequests.mine({ page: 1 });
    const list = hrKeys.profileChangeRequests.list({ page: 1 });
    expect(mine).toContain("mine");
    expect(list).toContain("list");
    expect(JSON.stringify(mine)).not.toBe(JSON.stringify(list));
  });

  it("profileChangeRequests.detail(id) chứa id", () => {
    expect(hrKeys.profileChangeRequests.detail("pcr-1")).toContain("pcr-1");
  });
});

describe("hrInvalidation (profile change request)", () => {
  it("createChangeRequest → chỉ prefix 'mine' (KHÔNG đụng 'list' của HR)", () => {
    const keys = hrInvalidation.createChangeRequest();
    expect(keys).toContainEqual(["hr", "profile-change-requests", "mine"]);
    expect(keys).not.toContainEqual(["hr", "profile-change-requests", "list"]);
  });

  it("cancelChangeRequest(id) → prefix 'mine' + detail(id)", () => {
    const keys = hrInvalidation.cancelChangeRequest("pcr-1");
    expect(keys).toContainEqual(["hr", "profile-change-requests", "mine"]);
    expect(keys).toContainEqual(["hr", "profile-change-requests", "detail", "pcr-1"]);
  });

  it("approveChangeRequest(id) → prefix 'list' (KHÔNG 'mine' — thuộc cache requester)", () => {
    const keys = hrInvalidation.approveChangeRequest("pcr-2");
    expect(keys).toContainEqual(["hr", "profile-change-requests", "list"]);
    expect(keys).toContainEqual(["hr", "profile-change-requests", "detail", "pcr-2"]);
    expect(keys).not.toContainEqual(["hr", "profile-change-requests", "mine"]);
  });

  it("rejectChangeRequest(id) → prefix 'list' + detail(id)", () => {
    const keys = hrInvalidation.rejectChangeRequest("pcr-3");
    expect(keys).toContainEqual(["hr", "profile-change-requests", "list"]);
    expect(keys).toContainEqual(["hr", "profile-change-requests", "detail", "pcr-3"]);
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

  // S3-FE-REGISTRY-1 — APPEND keys mới, KHÔNG rename key cũ.
  it("KHÔNG rename key cũ: myToday/mySummary/list/detail giữ nguyên hình dạng", () => {
    expect(attendanceKeys.myToday()).toEqual(["attendance", "my", "today"]);
    expect(attendanceKeys.mySummary({})).toEqual(["attendance", "my", "summary", {}]);
    expect(attendanceKeys.list({})).toEqual(["attendance", "list", {}]);
    expect(attendanceKeys.detail("a1")).toEqual(["attendance", "detail", "a1"]);
  });

  it("myRecords() = ['attendance','my','records', params]", () => {
    expect(attendanceKeys.myRecords()).toEqual(["attendance", "my", "records", undefined]);
    expect(attendanceKeys.myRecords({ page: 1 })[1]).toBe("my");
  });

  it("teamRecords() = ['attendance','team','records', params]", () => {
    expect(attendanceKeys.teamRecords()).toEqual(["attendance", "team", "records", undefined]);
  });

  it("records.detail(id) chứa id (records group tách khỏi detail top-level)", () => {
    expect(attendanceKeys.records.detail("r9")).toEqual(["attendance", "records", "detail", "r9"]);
  });
});

describe("mutation invalidation matrix", () => {
  it("check-in/out → today + prefix my-records (khớp mọi biến thể param'd)", () => {
    const keys = attendanceInvalidation.checkIn();
    expect(keys).toContainEqual(["attendance", "my", "today"]);
    expect(keys).toContainEqual(["attendance", "my", "records"]);
    expect(attendanceInvalidation.checkOut()).toEqual(keys);
  });

  // S3-FE-LEAVE-2: approver KHÔNG giữ balance key của requester → BỎ balances.all khỏi approve/reject.
  // Chỉ invalidate list (mọi biến thể param'd qua prefix) + chi tiết đúng đơn vừa duyệt/từ chối.
  it("leave approve → list prefix + detail(id), KHÔNG balances.all", () => {
    const keys = leaveInvalidation.approve("lr1");
    expect(keys).toContainEqual(["leave", "requests", "list"]);
    expect(keys).toContainEqual(["leave", "requests", "detail", "lr1"]);
    expect(keys).not.toContainEqual(["leave", "balances"]);
    expect(keys).toHaveLength(2);
  });

  it("leave reject → list prefix + detail(id), KHÔNG balances.all", () => {
    const keys = leaveInvalidation.reject("lr2");
    expect(keys).toContainEqual(["leave", "requests", "list"]);
    expect(keys).toContainEqual(["leave", "requests", "detail", "lr2"]);
    expect(keys).not.toContainEqual(["leave", "balances"]);
    expect(keys).toHaveLength(2);
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
