/**
 * social-kudos-api.spec.ts — ranh giới hợp đồng của `socialKudosApi` (S16-SOCIAL-FE-2C, 047/048/059).
 *
 * Khuôn `social-groups-api.spec.ts`: mock `apiFetch` để đọc path/method, RỒI chạy chính schema đã truyền
 * vào trên payload chép ĐÚNG hình dạng service BE trả. Chỉ so URL thì schema sai vẫn xanh.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import { KUDOS_BADGE_FETCH_LIMIT, socialKudosApi } from "./social-kudos-api";
import * as apiClient from "./api-client";

vi.mock("./api-client", async (importOriginal) => {
  const mod = await importOriginal<typeof apiClient>();
  return { ...mod, apiFetch: vi.fn() };
});

function lastCall(): [string, z.ZodType<unknown>, { method?: string } | undefined] {
  const calls = vi.mocked(apiClient.apiFetch).mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1] as never;
}

const EMP = "33333333-3333-4333-8333-333333333333";
const POST = "11111111-1111-4111-8111-111111111111";
const KUDOS = "44444444-4444-4444-8444-444444444444";
const BADGE = "55555555-5555-4555-8555-555555555555";

beforeEach(() => {
  vi.mocked(apiClient.apiFetch).mockReset();
  vi.mocked(apiClient.apiFetch).mockResolvedValue(undefined as never);
});

describe("047 — list", () => {
  it("GET /social/kudos với month + limit; schema nhận hình dạng service (`feedKudosListItem`)", async () => {
    await socialKudosApi.list({ month: "2026-09", limit: 5 });
    const [url, schema, init] = lastCall();
    expect(url.startsWith("/social/kudos?")).toBe(true);
    const qs = new URLSearchParams(url.split("?")[1]);
    expect(qs.get("month")).toBe("2026-09");
    expect(qs.get("limit")).toBe("5");
    expect(init?.method ?? "GET").toBe("GET");

    const row = {
      kudosId: KUDOS,
      postId: POST,
      createdAt: "2026-09-29T01:15:53.496Z",
      message: "Cảm ơn!",
      isOfficial: false,
      badge: null,
      recipients: [{ employeeId: EMP, fullName: null, avatarUrl: null, isFormerEmployee: true }],
    };
    expect(schema.safeParse({ data: [row], page: 1, limit: 5, total: 1 }).success).toBe(true);
  });
});

describe("059 — searchRecipients", () => {
  it("chỉ gửi `q` (không page/limit — query `.strict()`), schema ĐÚNG 3 khoá/người", async () => {
    await socialKudosApi.searchRecipients("An");
    const [url, schema] = lastCall();
    expect(url.startsWith("/social/kudos/recipients?")).toBe(true);
    const qs = new URLSearchParams(url.split("?")[1]);
    expect([...qs.keys()]).toEqual(["q"]);
    expect(qs.get("q")).toBe("An");
    expect(
      schema.safeParse({
        data: [{ employeeId: EMP, fullName: "Nguyễn Văn An", avatarUrl: null }],
        truncated: false,
      }).success,
    ).toBe(true);
  });
});

describe("048 — listBadges", () => {
  it("GET /social/kudos-badges?limit=<trần cố định>; schema nhận hàng `KudosBadgeRow`", async () => {
    await socialKudosApi.listBadges();
    const [url, schema] = lastCall();
    expect(url).toBe(`/social/kudos-badges?limit=${KUDOS_BADGE_FETCH_LIMIT}`);
    const row = {
      id: BADGE,
      code: "team-player",
      name: "Đồng đội",
      description: null,
      icon: "users-round",
      position: 1,
    };
    expect(schema.safeParse({ data: [row], page: 1, limit: 100, total: 1 }).success).toBe(true);
  });
});
