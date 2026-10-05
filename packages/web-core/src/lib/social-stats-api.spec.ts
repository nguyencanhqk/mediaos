/**
 * social-stats-api.spec.ts — ranh giới hợp đồng của `socialStatsApi` (S16-SOCIAL-FE-3, ca A2:
 * `SOCIAL-API-052` · `053`).
 *
 * 052 đi `apiFetch` (JSON + Zod); 053 đi `apiFetchBlob` — `apiFetch` sẽ cố parse JSON một thân XLSX và
 * làm hỏng tệp (plan B12). Hai hàm được mock RIÊNG để đo đúng hàm nào được gọi.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import { socialStatsApi } from "./social-stats-api";
import * as apiClient from "./api-client";

vi.mock("./api-client", async (importOriginal) => {
  const mod = await importOriginal<typeof apiClient>();
  return { ...mod, apiFetch: vi.fn(), apiFetchBlob: vi.fn() };
});

const UNIT = "77777777-7777-4777-8777-777777777777";

const ENGAGEMENT = {
  range: { from: "2026-08-10", to: "2026-10-04", weeks: 8 },
  units: [{ orgUnitId: UNIT, name: "Phòng Kỹ thuật", isDeleted: false }],
  rows: [
    {
      weekStart: "2026-09-28",
      orgUnitId: UNIT,
      posts: 3,
      comments: 5,
      reactions: 9,
      activeMembers: 4,
    },
    {
      weekStart: "2026-09-28",
      orgUnitId: null,
      posts: 1,
      comments: 0,
      reactions: 2,
      activeMembers: 1,
    },
  ],
  weekTotals: [{ weekStart: "2026-09-28", posts: 4, comments: 5, reactions: 11, activeMembers: 5 }],
};

function lastFetch(): [string, z.ZodType<unknown>, { method?: string } | undefined] {
  const calls = vi.mocked(apiClient.apiFetch).mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1] as never;
}

beforeEach(() => {
  vi.mocked(apiClient.apiFetch).mockReset();
  vi.mocked(apiClient.apiFetch).mockResolvedValue(undefined as never);
  vi.mocked(apiClient.apiFetchBlob).mockReset();
});

describe("052 — engagement", () => {
  it("GET /social/stats/engagement với from + to + orgUnitId; parse `{range,units,rows,weekTotals}`", async () => {
    await socialStatsApi.engagement({ from: "2026-08-10", to: "2026-10-04", orgUnitId: UNIT });
    const [url, schema, init] = lastFetch();
    expect(url).toBe(`/social/stats/engagement?from=2026-08-10&to=2026-10-04&orgUnitId=${UNIT}`);
    expect(init?.method ?? "GET").toBe("GET");

    const parsed = schema.parse(ENGAGEMENT) as typeof ENGAGEMENT;
    expect(parsed.range.weeks).toBe(8);
    expect(parsed.units[0]?.name).toBe("Phòng Kỹ thuật");
    // Hàng «chưa gán đơn vị» (`orgUnitId: null`) là dữ liệu hợp lệ — schema phải giữ nó.
    expect(parsed.rows[1]?.orgUnitId).toBeNull();
    expect(parsed.weekTotals[0]?.activeMembers).toBe(5);
    expect(vi.mocked(apiClient.apiFetchBlob)).not.toHaveBeenCalled();
  });

  it("vắng tham số ⇒ không có query string (server tự lấy 8 tuần gần nhất)", async () => {
    await socialStatsApi.engagement();
    expect(lastFetch()[0]).toBe("/social/stats/engagement");
  });
});

describe("053 — exportEngagement", () => {
  it("đi `apiFetchBlob` (KHÔNG `apiFetch`) tới …/export với CÙNG tham số, trả nguyên `{blob, filename}`", async () => {
    const result = { blob: new Blob(["xlsx"]), filename: null };
    vi.mocked(apiClient.apiFetchBlob).mockResolvedValue(result);

    const out = await socialStatsApi.exportEngagement({
      from: "2026-08-10",
      to: "2026-10-04",
      orgUnitId: UNIT,
    });

    const blobCalls = vi.mocked(apiClient.apiFetchBlob).mock.calls;
    expect(blobCalls).toHaveLength(1);
    expect(blobCalls[0]?.[0]).toBe(
      `/social/stats/engagement/export?from=2026-08-10&to=2026-10-04&orgUnitId=${UNIT}`,
    );
    expect(out).toBe(result);
    expect(vi.mocked(apiClient.apiFetch)).not.toHaveBeenCalled();
  });

  it("vắng tham số ⇒ …/export không có query string", async () => {
    vi.mocked(apiClient.apiFetchBlob).mockResolvedValue({ blob: new Blob([]), filename: "a.xlsx" });
    await socialStatsApi.exportEngagement();
    expect(vi.mocked(apiClient.apiFetchBlob).mock.calls[0]?.[0]).toBe(
      "/social/stats/engagement/export",
    );
  });
});
