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
  meKeys,
  notificationKeys,
  notificationPreferenceKeys,
  socialKeys,
  taskKeys,
  taskSubtaskInvalidation,
  goalKeys,
  goalInvalidation,
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

  // S2-FE-FND-5 (lane FE batch C) — sequence counters + seed run status.
  it("sequences.list()/preview(id) ổn định", () => {
    expect(foundationKeys.sequences.list()).toEqual(["foundation", "sequences", "list"]);
    expect(foundationKeys.sequences.preview("seq-1")).toEqual([
      "foundation",
      "sequences",
      "preview",
      "seq-1",
    ]);
  });

  it("seeds.list() ổn định", () => {
    expect(foundationKeys.seeds.list()).toEqual(["foundation", "seeds", "list"]);
  });

  it("updateSequence invalidation nhắm sequences.list()", () => {
    expect(foundationInvalidation.updateSequence()).toContainEqual(foundationKeys.sequences.list());
  });
});

describe("authKeys", () => {
  it("me() = ['auth', 'me']", () => {
    expect(authKeys.me()).toEqual(["auth", "me"]);
  });

  it("profile() chứa 'auth'", () => {
    expect(authKeys.profile()[0]).toBe("auth");
  });

  // S2-FE-AUTH-4 (lane FE batch C) — role & permission admin catalogs.
  it("roles.list() = ['auth', 'roles', 'list']", () => {
    expect(authKeys.roles.list()).toEqual(["auth", "roles", "list"]);
  });

  it("permissionCatalog.list() = ['auth', 'permission-catalog', 'list']", () => {
    expect(authKeys.permissionCatalog.list()).toEqual(["auth", "permission-catalog", "list"]);
  });

  // S2-FE-AUTH-5 (lane FE batch C) — session self-service.
  it("sessions.list() = ['auth', 'sessions', 'list']", () => {
    expect(authKeys.sessions.list()).toEqual(["auth", "sessions", "list"]);
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
  // S5-BE-CONTRACT-1 (§13.3): THÊM lịch nghỉ (approve) + widget dashboard của chính người duyệt.
  // Bất biến "KHÔNG đụng balances của người GỬI đơn" GIỮ NGUYÊN — đó mới là điểm mấu chốt của test này;
  // độ dài được cập nhật CÓ Ý THỨC theo hợp đồng mới (xem query-invalidation-contract.spec.ts).
  it("leave approve → list prefix + detail(id) + lịch + dashboard, KHÔNG balances.all", () => {
    const keys = leaveInvalidation.approve("lr1");
    expect(keys).toContainEqual(["leave", "requests", "list"]);
    expect(keys).toContainEqual(["leave", "requests", "detail", "lr1"]);
    expect(keys).toContainEqual(["leave", "calendar"]);
    expect(keys).toContainEqual(["dashboard", "widgets"]);
    expect(keys).not.toContainEqual(["leave", "balances"]);
    expect(keys).toHaveLength(4);
  });

  it("leave reject → list prefix + detail(id) + dashboard, KHÔNG balances.all", () => {
    const keys = leaveInvalidation.reject("lr2");
    expect(keys).toContainEqual(["leave", "requests", "list"]);
    expect(keys).toContainEqual(["leave", "requests", "detail", "lr2"]);
    expect(keys).toContainEqual(["dashboard", "widgets"]);
    expect(keys).not.toContainEqual(["leave", "balances"]);
    expect(keys).toHaveLength(3);
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

  // S5-TASK-SUBTASK-1 — subtasks(taskId) namespace riêng, KHÁC checklists(taskId) dù cùng taskId.
  it("subtasks(taskId) chứa 'tasks'/'subtasks'/id, khác checklists(taskId)", () => {
    const key = taskKeys.subtasks("task-abc");
    expect(key).toEqual(["tasks", "subtasks", "task-abc"]);
    expect(key).not.toEqual(taskKeys.checklists("task-abc"));
  });
});

describe("taskSubtaskInvalidation", () => {
  it("afterMutate chạm ĐỦ BA: subtasks(parentId) · prefix detail(parentId) · kanban(projectId)", () => {
    const keys = taskSubtaskInvalidation.afterMutate("parent-1", "proj-1");
    expect(keys).toContainEqual(taskKeys.subtasks("parent-1"));
    expect(keys).toContainEqual(taskKeys.detail("parent-1"));
    expect(keys).toContainEqual(taskKeys.kanban("proj-1"));
  });

  it("projectId null (task cá nhân ngoài dự án) ⇒ KHÔNG thêm khoá kanban ĐÍCH DANH", () => {
    const keys = taskSubtaskInvalidation.afterMutate("parent-1", null);
    expect(keys).toContainEqual(taskKeys.subtasks("parent-1"));
    // Vá 2026-07-20: detail() giờ kèm PREFIX ['tasks','kanban'] (sửa trong panel chi tiết phải
    // sang board không cần F5) nên prefix ấy CÓ MẶT cả ở đây — vô hại với task cá nhân (board nào
    // active thì refetch, không có thì thôi). Điều vẫn bị cấm: khoá kanban ĐÍCH DANH id rỗng/null.
    expect(keys).not.toContainEqual(taskKeys.kanban(""));
    expect(keys.some((k) => k[1] === "kanban" && k.length > 2)).toBe(false);
  });
});

describe("dashboardKeys", () => {
  it("overview() ổn định", () => {
    expect(dashboardKeys.overview()).toEqual(dashboardKeys.overview());
  });

  // S4-FE-DASH-1 — me()/widgets.catalog()/widgets.data() dùng cho DashboardMePage + WidgetCard lazy-load.
  it("me() ổn định + chứa 'dashboard'", () => {
    expect(dashboardKeys.me()).toEqual(dashboardKeys.me());
    expect(dashboardKeys.me()[0]).toBe("dashboard");
  });

  it("widgets.catalog(params) ổn định theo params", () => {
    const params = { dashboard_type: "Employee" };
    expect(dashboardKeys.widgets.catalog(params)).toEqual(dashboardKeys.widgets.catalog(params));
  });

  it("widgets.data(widgetCode, params) khác nhau theo widgetCode", () => {
    const a = dashboardKeys.widgets.data("MY_TASKS");
    const b = dashboardKeys.widgets.data("TASK_ALERTS");
    expect(a).not.toEqual(b);
    expect(a).toContain("MY_TASKS");
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

// S5-ME-FE-3 — meKeys.preferences() + notificationPreferenceKeys (APPEND).
describe("meKeys (S5-ME-FE-3 append)", () => {
  it("attendanceSummary/leaveSummary/taskSummary/notificationSummary ổn định + khác overview()", () => {
    expect(meKeys.attendanceSummary()).toEqual(meKeys.attendanceSummary());
    expect(meKeys.leaveSummary()).not.toEqual(meKeys.overview());
    expect(meKeys.taskSummary()).not.toEqual(meKeys.notificationSummary());
  });

  it("preferences() ổn định + khác overview()", () => {
    expect(meKeys.preferences()).toEqual(meKeys.preferences());
    expect(meKeys.preferences()).not.toEqual(meKeys.overview());
  });

  // S5-ME-FE-2 — securityActivity(query) (Hoạt động bảo mật, ME-SCREEN-008): namespace dưới root 'me',
  // param'd theo query (page/per_page/from_date/to_date) — key khác nhau theo trang.
  it("securityActivity(query) nằm dưới root 'me' + khác nhau theo query", () => {
    const key = meKeys.securityActivity({ page: 1 });
    expect(key[0]).toBe("me");
    expect(key).toContain("security-activity");
    expect(meKeys.securityActivity({ page: 1 })).toEqual(meKeys.securityActivity({ page: 1 }));
    expect(meKeys.securityActivity({ page: 1 })).not.toEqual(meKeys.securityActivity({ page: 2 }));
    expect(meKeys.securityActivity()).not.toEqual(meKeys.overview());
  });
});

describe("notificationPreferenceKeys", () => {
  it("list() nằm dưới prefix 'notifications' nhưng khác notificationKeys.list()", () => {
    const key = notificationPreferenceKeys.list();
    expect(key[0]).toBe("notifications");
    expect(key).not.toEqual(notificationKeys.list({}));
  });

  it("all là prefix của list()", () => {
    const list = notificationPreferenceKeys.list();
    expect(list.slice(0, notificationPreferenceKeys.all.length)).toEqual([
      ...notificationPreferenceKeys.all,
    ]);
  });
});

// ── S5-GOAL-FE-2 (APPEND) — vòng đo: check-in / chốt kỳ / gắn-tháo task ────────────────────────────
describe("goalKeys / goalInvalidation (S5-GOAL-FE-2 append)", () => {
  it("meKeys.goals(params) nằm dưới root 'me' + khác nhau theo params", () => {
    const key = meKeys.goals({ status: "Active" });
    expect(key[0]).toBe("me");
    expect(key).toContain("goals");
    expect(meKeys.goals({ status: "Active" })).toEqual(meKeys.goals({ status: "Active" }));
    expect(meKeys.goals({ status: "Active" })).not.toEqual(meKeys.goals({ status: "Draft" }));
    // KHÔNG đụng goalKeys.list — /me/goals là endpoint own-scope KHÁC (GOAL-API-013).
    expect(meKeys.goals()).not.toEqual(goalKeys.list());
  });

  it("goalKeys.updatesOf(id) là PREFIX của updates(id, params) — khớp mọi trang phân trang", () => {
    const prefix = goalKeys.updatesOf("g-1");
    const paged = goalKeys.updates("g-1", { limit: 20, offset: 20 });
    expect(paged.slice(0, prefix.length)).toEqual([...prefix]);
  });

  it("checkin(id) làm mới detail + SỔ check-in (prefix) + list + tree", () => {
    const keys = goalInvalidation.checkin("g-1").map((k) => JSON.stringify(k));
    expect(keys).toContain(JSON.stringify(goalKeys.detail("g-1")));
    expect(keys).toContain(JSON.stringify(goalKeys.updatesOf("g-1")));
    expect(keys).toContain(JSON.stringify(["goals", "list"]));
    expect(keys).toContain(JSON.stringify(["goals", "tree"]));
  });

  it("finalize(id) = cùng tập với checkin(id) (chốt kỳ/mở lại cũng ghi sổ + đổi finalizedAt)", () => {
    expect(goalInvalidation.finalize("g-1")).toEqual(goalInvalidation.checkin("g-1"));
  });

  it("linkTasks phủ CẢ goal mới lẫn goal CŨ (detail + linked-tasks 2 chiều) + task detail + kanban", () => {
    const keys = goalInvalidation
      .linkTasks({ goalIds: ["g-new", "g-old"], taskId: "t-1", projectId: "p-1" })
      .map((k) => JSON.stringify(k));
    for (const goalId of ["g-new", "g-old"]) {
      expect(keys).toContain(JSON.stringify(goalKeys.detail(goalId)));
      expect(keys).toContain(JSON.stringify(goalKeys.linkedTasks(goalId)));
    }
    expect(keys).toContain(JSON.stringify(taskKeys.detail("t-1")));
    expect(keys).toContain(JSON.stringify(taskKeys.kanban("p-1")));
    // Đổi tập việc của mục tiêu ⇒ % đổi ⇒ danh sách/cây mục tiêu phải làm mới.
    expect(keys).toContain(JSON.stringify(["goals", "list"]));
    expect(keys).toContain(JSON.stringify(["goals", "tree"]));
  });

  it("linkTasks bỏ qua goalId null/undefined + KHÔNG lặp key khi goal mới trùng goal cũ", () => {
    const keys = goalInvalidation.linkTasks({ goalIds: ["g-1", null, undefined, "g-1"] });
    const detailKey = JSON.stringify(goalKeys.detail("g-1"));
    expect(keys.filter((k) => JSON.stringify(k) === detailKey)).toHaveLength(1);
    expect(keys.map((k) => JSON.stringify(k))).not.toContain(JSON.stringify(goalKeys.detail("")));
  });

  // ── Vá gate LIGHT: khối /me đọc endpoint own-scope RIÊNG (me/goals) nên KHÔNG nằm dưới prefix
  // `goals/*`. Mọi helper ghi-mục-tiêu thiếu vế này ⇒ ghi xong % trên card /me đứng yên, số cũ nhìn
  // vẫn hợp lý (staleTime 60s + refetchOnWindowFocus tắt) nên người dùng không có cách nào biết.
  const ME_GOALS_PREFIX = JSON.stringify(["me", "goals"]);

  it("checkin/finalize/linkTasks đều phủ prefix me/goals — card 'Mục tiêu của tôi' không đọng số cũ", () => {
    for (const keys of [
      goalInvalidation.checkin("g-1"),
      goalInvalidation.finalize("g-1"),
      goalInvalidation.linkTasks({ goalIds: ["g-1"], taskId: "t-1" }),
    ]) {
      expect(keys.map((k) => JSON.stringify(k))).toContain(ME_GOALS_PREFIX);
    }
  });

  it("me/goals prefix là PREFIX THẬT của meKeys.goals(params) — khớp mọi biến thể filter", () => {
    const paged = meKeys.goals({ status: "Active", limit: 20 });
    expect(JSON.stringify(paged.slice(0, 2))).toBe(ME_GOALS_PREFIX);
  });

  it("taskProgress(goalId) phủ detail + linked-tasks + list + tree + me/goals (task đổi trạng thái)", () => {
    const keys = goalInvalidation.taskProgress("g-1").map((k) => JSON.stringify(k));
    expect(keys).toContain(JSON.stringify(goalKeys.detail("g-1")));
    expect(keys).toContain(JSON.stringify(goalKeys.linkedTasks("g-1")));
    expect(keys).toContain(JSON.stringify(["goals", "list"]));
    expect(keys).toContain(JSON.stringify(["goals", "tree"]));
    expect(keys).toContain(ME_GOALS_PREFIX);
  });

  it("taskProgress KHÔNG kèm key phía task — call-site đã tự invalidate, tránh invalidate kép", () => {
    const keys = goalInvalidation.taskProgress("g-1").map((k) => JSON.stringify(k));
    expect(keys).not.toContain(JSON.stringify(taskKeys.detail("t-1")));
    expect(keys.some((k) => k.includes("kanban"))).toBe(false);
  });
});

// ── S16-SOCIAL-FE-3 (APPEND, ca A3) — kiểm duyệt · thống kê · huy hiệu quản trị ─────────────────────
//
// TanStack v5 so khớp một phần theo PHẦN TỬ mảng ⇒ «A là tiền tố của B» ⇔ invalidate A làm mới B.
// Mọi ca dưới đo đúng quan hệ đó, không so chuỗi.
describe("socialKeys — moderation / stats / badges-admin (S16-SOCIAL-FE-3 append)", () => {
  const isPrefix = (prefix: readonly unknown[], key: readonly unknown[]): boolean =>
    prefix.length <= key.length &&
    prefix.every((part, i) => JSON.stringify(part) === JSON.stringify(key[i]));

  it("moderation.reports.lists() là tiền tố của MỌI reports.list(params), và khoá đổi theo params", () => {
    const lists = socialKeys.moderation.reports.lists();
    const open2 = socialKeys.moderation.reports.list({ status: "open", page: 2 });
    expect(lists.length).toBeGreaterThan(0);
    expect(isPrefix(lists, open2)).toBe(true);
    expect(isPrefix(lists, socialKeys.moderation.reports.list({ page: 1 }))).toBe(true);
    expect(open2).toEqual(socialKeys.moderation.reports.list({ status: "open", page: 2 }));
    expect(open2).not.toEqual(socialKeys.moderation.reports.list({ status: "open", page: 3 }));
    expect(open2).not.toEqual(socialKeys.moderation.reports.list({ status: "resolved", page: 2 }));
  });

  it("moderation.allOf() nằm dưới root social và phủ cả danh sách báo cáo lẫn bài đang ẩn", () => {
    const all = socialKeys.moderation.allOf();
    expect(isPrefix(socialKeys.all, all)).toBe(true);
    expect(all.length).toBeGreaterThan(socialKeys.all.length);
    expect(isPrefix(all, socialKeys.moderation.reports.lists())).toBe(true);
    expect(isPrefix(all, socialKeys.moderation.hiddenPosts())).toBe(true);
  });

  it("hiddenPosts() là nhánh RIÊNG: không nằm dưới reports.lists() cũng KHÔNG nằm dưới feed.allOf()", () => {
    const hidden = socialKeys.moderation.hiddenPosts();
    expect(hidden.length).toBeGreaterThan(socialKeys.moderation.allOf().length);
    expect(isPrefix(socialKeys.moderation.reports.lists(), hidden)).toBe(false);
    // 001 `status=hidden` gác thêm `manage:feed-post` — không được nằm chung nhánh với dòng cuộn mà
    // `view:feed` đọc (khuôn `posts.acks`).
    expect(isPrefix(socialKeys.feed.allOf(), hidden)).toBe(false);
    expect(hidden).not.toEqual(socialKeys.feed.list({ status: "hidden", sort: "latest" }));
  });

  it("stats.allOf() là tiền tố của engagement(params); khoá đổi theo params; tách khỏi moderation", () => {
    const all = socialKeys.stats.allOf();
    const w8 = socialKeys.stats.engagement({});
    const ranged = socialKeys.stats.engagement({ from: "2026-08-10", to: "2026-10-04" });
    expect(isPrefix(socialKeys.all, all)).toBe(true);
    expect(all.length).toBeGreaterThan(socialKeys.all.length);
    expect(isPrefix(all, w8)).toBe(true);
    expect(isPrefix(all, ranged)).toBe(true);
    expect(ranged).not.toEqual(w8);
    expect(isPrefix(socialKeys.moderation.allOf(), ranged)).toBe(false);
  });

  it("kudos.badgesAdminAll() là tiền tố của badgesAdmin(params) và nằm dưới kudos.allOf()", () => {
    const adminAll = socialKeys.kudos.badgesAdminAll();
    const page2 = socialKeys.kudos.badgesAdmin({ page: 2, limit: 50 });
    expect(adminAll.length).toBeGreaterThan(socialKeys.kudos.allOf().length);
    expect(isPrefix(socialKeys.kudos.allOf(), adminAll)).toBe(true);
    expect(isPrefix(adminAll, page2)).toBe(true);
    expect(page2).not.toEqual(socialKeys.kudos.badgesAdmin({ page: 1, limit: 50 }));
  });

  it("badgesAdminAll() KHÔNG là tiền tố của badges() và NGƯỢC LẠI — 056 (`manage:feed-kudos`) và 048 (`view:feed`) không chung nhánh cache", () => {
    const adminAll = socialKeys.kudos.badgesAdminAll();
    const page1 = socialKeys.kudos.badgesAdmin({ page: 1, limit: 50 });
    const publicBadges = socialKeys.kudos.badges();
    expect(isPrefix(adminAll, publicBadges)).toBe(false);
    expect(isPrefix(publicBadges, adminAll)).toBe(false);
    expect(isPrefix(publicBadges, page1)).toBe(false);
    // Khoá công khai giữ nguyên hình dạng cũ — composer đang invalidate đúng khoá này.
    expect(publicBadges).toEqual(["social", "kudos", "badges"]);
  });
});
