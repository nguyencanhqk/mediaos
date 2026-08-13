import "reflect-metadata";
import { describe, expect, it, vi } from "vitest";
import { SYSTEM_JOB_HANDLER } from "../scheduler/job-handler";
import type { DashboardRefreshService } from "./dashboard-refresh.service";
import {
  DASHBOARD_MV_REFRESH_JOB_CODE,
  DEFAULT_DASHBOARD_MV_REFRESH_INTERVAL_MS,
  DashboardMvRefreshJobHandler,
  resolveDashboardMvRefreshIntervalMs,
} from "./dashboard-mv-refresh.job-handler";

/**
 * RED-first (S10-DASH-MVREFRESH-1) — DashboardMvRefreshJobHandler.
 *
 * KI-017 nửa "lịch chạy": TRƯỚC WO này, `DashboardRefreshService.refresh()` KHÔNG có nơi nào tự gọi
 * định kỳ — chỉ chạy khi có người bấm `POST /dashboard/refresh` (dashboard.controller.ts). Bài học
 * KI-034 (nuốt lỗi = job "thành công" vĩnh viễn) là chính cái bẫy KI-017 từng mắc (đường refresh CHẾT
 * suốt từ G14 mà không ai biết vì không có gì gọi tới, không phải vì lỗi bị nuốt) — nên ca "lỗi PHẢI
 * propagate" dưới đây đứng vai trò ca nhạy-cảm cho lane này (silent-failure).
 */

function fakeRefreshService(impl: () => Promise<{ refreshedAt: string }>): DashboardRefreshService {
  return { refresh: vi.fn(impl) } as unknown as DashboardRefreshService;
}

describe("DashboardMvRefreshJobHandler", () => {
  it("jobCode + @SystemJobHandler() metadata đăng ký đúng khuôn (DiscoveryService gom qua metadata)", () => {
    expect(DASHBOARD_MV_REFRESH_JOB_CODE).toBe("DASHBOARD_MV_REFRESH");
    const handler = new DashboardMvRefreshJobHandler(
      fakeRefreshService(async () => ({
        refreshedAt: "2026-08-13T00:00:00.000Z",
      })),
    );
    expect(handler.jobCode).toBe(DASHBOARD_MV_REFRESH_JOB_CODE);
    expect(Reflect.getMetadata(SYSTEM_JOB_HANDLER, DashboardMvRefreshJobHandler)).toBe(true);
  });

  it("run() THÀNH CÔNG: gọi refreshService.refresh() đúng 1 lần, trả refreshedAt trong metadata", async () => {
    const refresh = vi.fn(async () => ({ refreshedAt: "2026-08-13T01:00:00.000Z" }));
    const handler = new DashboardMvRefreshJobHandler({
      refresh,
    } as unknown as DashboardRefreshService);

    const result = await handler.run({ companyId: "co-1" });

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      total: 1,
      success: 1,
      failed: 0,
      metadata: { skipped: false, refreshedAt: "2026-08-13T01:00:00.000Z" },
    });
  });

  it("run() KHÔNG nuốt lỗi — refreshService.refresh() ném thì run() NÉM LẠI (KI-034: propagate cho JobRunner finalize Failed)", async () => {
    const boom = new Error("MV refresh failed: permission denied for materialized view");
    const handler = new DashboardMvRefreshJobHandler(
      fakeRefreshService(async () => {
        throw boom;
      }),
    );

    await expect(handler.run({ companyId: "co-1" })).rejects.toThrow(
      /permission denied for materialized view/,
    );
  });

  it("throttle nội bộ: 2 lần run() liên tiếp TRONG chu kỳ ⇒ lần 2 SKIP (không gọi refresh() lại) — chặn N lần refresh trùng trong CÙNG 1 tick đa-tenant", async () => {
    const refresh = vi.fn(async () => ({ refreshedAt: "2026-08-13T02:00:00.000Z" }));
    const handler = new DashboardMvRefreshJobHandler({
      refresh,
    } as unknown as DashboardRefreshService);

    const first = await handler.run({ companyId: "co-1" });
    const second = await handler.run({ companyId: "co-2" });

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(first.metadata).toMatchObject({ skipped: false });
    expect(second).toMatchObject({ total: 0, success: 1, failed: 0 });
    expect(second.metadata).toMatchObject({ skipped: true, reason: "not-due" });
  });
});

describe("resolveDashboardMvRefreshIntervalMs (parse an toàn + clamp — mirror resolveSystemJobsPollMs)", () => {
  it("unset/rỗng/NaN/không nguyên/ngoài biên → mặc định", () => {
    expect(resolveDashboardMvRefreshIntervalMs(undefined)).toBe(
      DEFAULT_DASHBOARD_MV_REFRESH_INTERVAL_MS,
    );
    expect(resolveDashboardMvRefreshIntervalMs("")).toBe(DEFAULT_DASHBOARD_MV_REFRESH_INTERVAL_MS);
    expect(resolveDashboardMvRefreshIntervalMs("abc")).toBe(
      DEFAULT_DASHBOARD_MV_REFRESH_INTERVAL_MS,
    );
    expect(resolveDashboardMvRefreshIntervalMs("1000.5")).toBe(
      DEFAULT_DASHBOARD_MV_REFRESH_INTERVAL_MS,
    );
    expect(resolveDashboardMvRefreshIntervalMs("1")).toBe(DEFAULT_DASHBOARD_MV_REFRESH_INTERVAL_MS); // < sàn
    expect(resolveDashboardMvRefreshIntervalMs("999999999")).toBe(
      DEFAULT_DASHBOARD_MV_REFRESH_INTERVAL_MS,
    ); // > trần
  });

  it("giá trị hợp lệ trong biên → dùng nguyên giá trị", () => {
    expect(resolveDashboardMvRefreshIntervalMs("120000")).toBe(120_000);
  });
});
