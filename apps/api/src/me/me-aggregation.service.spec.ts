import "reflect-metadata";
import {
  ForbiddenException,
  NotFoundException,
  InternalServerErrorException,
} from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { MeAggregationService } from "./me-aggregation.service";
import type { CurrentPerson } from "./me-current-person.resolver";

/**
 * S5-ME-BE-1 — MeAggregationService UNIT (không DB). Chốt phần silent-failure-hunter soi kỹ nhất: PHÂN LOẠI
 * exception fail-soft (403≠404≠infra) + precedence gate (module_disabled/unlinked/forbidden KHÔNG đọc reader).
 * Anomaly >1 employee test ở me-current-person.resolver.spec.ts (mock repo, né partial-unique DB).
 */

const ACTOR = { id: "u1", companyId: "c1" };
const LINKED: CurrentPerson = {
  linkStatus: "linked",
  employee: {
    employeeId: "e1",
    employeeCode: "E1",
    fullName: "A",
    departmentName: "Dept",
    positionName: "Dev",
  },
};

type Reader = ReturnType<typeof vi.fn>;

interface Overrides {
  person?: CurrentPerson;
  /** by module code (HR/ATT/LEAVE/TASK/NOTI): false = disabled row; undefined = no row (enabled). */
  moduleEnabled?: Record<string, boolean | undefined>;
  /** allow decision per source pair "action:resourceType"; default allow all. */
  allow?: (key: string) => boolean;
  readers?: Partial<{
    hr: Reader;
    attendance: Reader;
    leave: Reader;
    task: Reader;
    notifications: Reader;
  }>;
}

function defaultReader(section: string): Reader {
  switch (section) {
    case "hr":
      return vi.fn(async () => ({
        employeeCode: "E1",
        fullName: "A",
        orgUnitName: "Dept",
        positionName: "Dev",
        status: "active",
        startDate: "2024-01-01",
      }));
    case "attendance":
      return vi.fn(async () => ({
        workDate: "2024-06-03",
        record: null,
        shift: null,
        disabledReason: null,
      }));
    case "leave":
      return vi.fn(async () => []);
    case "task":
      return vi.fn(async () => []);
    default:
      return vi.fn(async () => ({
        unread_count: 0,
        high_priority_unread_count: 0,
        urgent_unread_count: 0,
        last_notification_at: null,
      }));
  }
}

function build(o: Overrides = {}) {
  const readers = {
    hr: o.readers?.hr ?? defaultReader("hr"),
    attendance: o.readers?.attendance ?? defaultReader("attendance"),
    leave: o.readers?.leave ?? defaultReader("leave"),
    task: o.readers?.task ?? defaultReader("task"),
    notifications: o.readers?.notifications ?? defaultReader("notifications"),
  };
  const db = { withTenant: (_c: string, fn: (tx: unknown) => unknown) => fn({}) };
  const repo = {
    findAccountByUserIdTx: async () => ({
      userId: "u1",
      email: "a@x",
      status: "active",
      displayName: "A",
      lastLoginAt: null,
      createdAt: null,
    }),
    findActiveRolesByUserIdTx: async () => [],
    findActiveEmployeesByUserIdTx: async () => [],
  };
  const currentPerson = { resolve: async () => o.person ?? LINKED };
  const permission = {
    can: async (input: { action: string; resourceType: string }) => {
      const key = `${input.action}:${input.resourceType}`;
      const allow = o.allow ? o.allow(key) : true;
      return { allow, reason: allow ? "allow" : "deny-default", auditRequired: false };
    },
  };
  const settings = {
    resolveMany: async (_c: string, keys: string[]) =>
      keys.map((key) => {
        const code = key.replace(/^module\./, "").replace(/\.enabled$/, "");
        const v = o.moduleEnabled?.[code];
        return v === undefined
          ? { key, value: null, scope: "default", found: false }
          : { key, value: v, scope: "company", found: true };
      }),
  };
  const svc = new MeAggregationService(
    db as never,
    repo as never,
    currentPerson as never,
    permission as never,
    settings as never,
    { getMyProfile: readers.hr } as never,
    { getToday: readers.attendance } as never,
    { listMyBalances: readers.leave } as never,
    { getMyTasks: readers.task } as never,
    { unreadCount: readers.notifications } as never,
  );
  return { svc, readers };
}

describe("MeAggregationService — fail-soft classification (silent-failure guard)", () => {
  it("degraded: reader ném non-HttpException → status='error' (KHÔNG 500, KHÔNG nuốt thành ok)", async () => {
    const { svc } = build({
      readers: { attendance: vi.fn(async () => Promise.reject(new Error("db down"))) },
    });
    const sec = await svc.getAttendanceSummary(ACTOR);
    expect(sec.status).toBe("error");
    expect(sec.data).toBeNull();
  });

  it("degraded: HttpException khác 403/404 (500 InternalServer) → 'error'", async () => {
    const { svc } = build({
      readers: { task: vi.fn(async () => Promise.reject(new InternalServerErrorException())) },
    });
    const sec = await svc.getTaskSummary(ACTOR);
    expect(sec.status).toBe("error");
  });

  it("404-not-forbidden: reader ném NotFoundException → status='ok' + data null (KHÔNG 'forbidden')", async () => {
    const { svc } = build({
      readers: {
        attendance: vi.fn(async () => Promise.reject(new NotFoundException("no employee"))),
      },
    });
    const sec = await svc.getAttendanceSummary(ACTOR);
    expect(sec.status).toBe("ok");
    expect(sec.data).toBeNull();
  });

  it("403 từ reader nguồn → status='forbidden' (KHÔNG nuốt thành ok/error)", async () => {
    const { svc } = build({
      readers: { task: vi.fn(async () => Promise.reject(new ForbiddenException())) },
    });
    const sec = await svc.getTaskSummary(ACTOR);
    expect(sec.status).toBe("forbidden");
  });
});

describe("MeAggregationService — precedence gate KHÔNG đọc reader (fail-closed)", () => {
  it("thiếu cặp quyền nguồn (can=false) → 'forbidden' + reader KHÔNG được gọi", async () => {
    const { svc, readers } = build({ allow: (k) => k !== "view-own:attendance" });
    const sec = await svc.getAttendanceSummary(ACTOR);
    expect(sec.status).toBe("forbidden");
    expect(readers.attendance).not.toHaveBeenCalled();
  });

  it("module tắt (company_settings=false) → 'module_disabled' + reader KHÔNG được gọi", async () => {
    const { svc, readers } = build({ moduleEnabled: { LEAVE: false } });
    const sec = await svc.getLeaveSummary(ACTOR);
    expect(sec.status).toBe("module_disabled");
    expect(readers.leave).not.toHaveBeenCalled();
  });

  it("module KHÔNG có row company_settings → ENABLED (đọc bình thường, không stale §12.3)", async () => {
    const { svc, readers } = build({ moduleEnabled: {} });
    const sec = await svc.getNotificationSummary(ACTOR);
    expect(sec.status).toBe("ok");
    expect(readers.notifications).toHaveBeenCalledTimes(1);
  });

  it("unlinked: section employee-dependent (ATT) → 'unlinked_employee'; TASK (user-based) vẫn 'ok'", async () => {
    const unlinked: CurrentPerson = { linkStatus: "unlinked", employee: null };
    const { svc, readers } = build({ person: unlinked });
    const att = await svc.getAttendanceSummary(ACTOR);
    expect(att.status).toBe("unlinked_employee");
    expect(readers.attendance).not.toHaveBeenCalled();
    const task = await svc.getTaskSummary(ACTOR);
    expect(task.status).toBe("ok");
    expect(readers.task).toHaveBeenCalledTimes(1);
  });
});

describe("MeAggregationService — overview: 1 section forbidden, section khác vẫn ok", () => {
  it("thiếu read:employee (HR) → overview.hr='forbidden', 4 section còn lại='ok', identity.account có", async () => {
    const { svc } = build({ allow: (k) => k !== "read:employee" });
    const ov = await svc.getOverview(ACTOR);
    expect(ov.hr.status).toBe("forbidden");
    expect(ov.attendance.status).toBe("ok");
    expect(ov.leave.status).toBe("ok");
    expect(ov.task.status).toBe("ok");
    expect(ov.notification.status).toBe("ok");
    expect(ov.identity.account.userId).toBe("u1");
    expect(ov.identity.linkStatus).toBe("linked");
  });

  it("overview compose CHỈ dữ liệu directory-class ở hr (KHÔNG salary/PII field)", async () => {
    const { svc } = build({});
    const ov = await svc.getOverview(ACTOR);
    expect(ov.hr.status).toBe("ok");
    expect(Object.keys(ov.hr.data ?? {}).sort()).toEqual(
      ["departmentName", "employeeCode", "fullName", "positionName", "startDate", "status"].sort(),
    );
  });
});
