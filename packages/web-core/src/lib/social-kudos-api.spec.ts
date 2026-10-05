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

// ── S16-SOCIAL-FE-3 (ca A2) — huy hiệu ở góc nhìn QUẢN TRỊ: 056 · 049 · 050 · 051 ────────────────────
//
// Assert trên ĐẦU RA parse, không trên `.success`: `kudosBadgeSchema` của 048 KHÔNG `.strict()` nên nó
// nhận cả hàng quản trị rồi LẶNG LẼ bỏ `isActive` — `.success` vẫn `true` trong khi màn mất đúng cột
// cần để vẽ «Ngừng dùng»/«Bật lại».
describe("S16-SOCIAL-FE-3 — huy hiệu quản trị", () => {
  interface FetchInit {
    method?: string;
    body?: string;
  }
  type AdminRow = { id: string; isActive: boolean; createdAt: string };

  function lastCallFull(): [
    string,
    z.ZodType<unknown>,
    FetchInit | undefined,
    { idempotencyKey?: string } | undefined,
  ] {
    const calls = vi.mocked(apiClient.apiFetch).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    return calls[calls.length - 1] as never;
  }

  const ISO = "2026-10-01T02:03:04.000Z";
  const ADMIN_ROW = {
    id: BADGE,
    code: "team-player",
    name: "Đồng đội",
    description: null,
    icon: "users-round",
    position: 1,
    isActive: false,
    createdAt: ISO,
    updatedAt: ISO,
  };
  const CREATE_BODY = { code: "sang-tao", name: "Sáng tạo", icon: "lightbulb", position: 2 };

  it("056 listBadgesAdmin ⇒ GET /social/kudos-badges/manage?page=2&limit=50; đầu ra GIỮ `isActive`", async () => {
    await socialKudosApi.listBadgesAdmin({ page: 2, limit: 50 });
    const [url, schema, init] = lastCallFull();
    expect(url).toBe("/social/kudos-badges/manage?page=2&limit=50");
    expect(init?.method ?? "GET").toBe("GET");

    const parsed = schema.parse({ data: [ADMIN_ROW], page: 2, limit: 50, total: 51 }) as {
      data: AdminRow[];
      total: number;
    };
    expect(parsed.total).toBe(51);
    expect(parsed.data[0]?.isActive).toBe(false);
    expect(parsed.data[0]?.createdAt).toBe(ISO);
  });

  it("049 createBadge ⇒ POST /social/kudos-badges KÈM Idempotency-Key; trả DTO quản trị", async () => {
    await socialKudosApi.createBadge(CREATE_BODY, "attempt-1");
    const [url, schema, init, opts] = lastCallFull();
    expect(url).toBe("/social/kudos-badges");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body ?? "null")).toEqual(CREATE_BODY);
    expect(opts?.idempotencyKey).toMatch(/^social-kudos-badge_/);
    expect((schema.parse({ ...ADMIN_ROW, isActive: true }) as AdminRow).isActive).toBe(true);
  });

  it("049 khoá idempotency theo (attemptId, body): cùng cặp ⇒ cùng khoá; khác attemptId HOẶC khác body ⇒ khác khoá", async () => {
    const keyOf = (): string | undefined => lastCallFull()[3]?.idempotencyKey;
    await socialKudosApi.createBadge(CREATE_BODY, "attempt-1");
    const first = keyOf();
    await socialKudosApi.createBadge({ ...CREATE_BODY }, "attempt-1");
    const retry = keyOf();
    await socialKudosApi.createBadge(CREATE_BODY, "attempt-2");
    const reopened = keyOf();
    await socialKudosApi.createBadge({ ...CREATE_BODY, name: "Sáng tạo nhất" }, "attempt-1");
    const edited = keyOf();

    expect(first).toEqual(expect.any(String));
    expect(retry).toBe(first);
    // Tạo → ngừng dùng → tạo lại y hệt trong 15 phút phải là lượt TẠO THẬT, không phát lại 201 cũ (D20).
    expect(reopened).not.toBe(first);
    expect(edited).not.toBe(first);
  });

  it("050 updateBadge ⇒ PATCH /social/kudos-badges/:id với đúng body, KHÔNG khoá idempotency", async () => {
    await socialKudosApi.updateBadge(BADGE, { isActive: true });
    const [url, schema, init, opts] = lastCallFull();
    expect(url).toBe(`/social/kudos-badges/${BADGE}`);
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(init?.body ?? "null")).toEqual({ isActive: true });
    expect(opts?.idempotencyKey).toBeUndefined();
    expect((schema.parse({ ...ADMIN_ROW, isActive: true }) as AdminRow).isActive).toBe(true);
  });

  it("051 deactivateBadge ⇒ DELETE /social/kudos-badges/:id không body; trả DTO quản trị đã tắt", async () => {
    await socialKudosApi.deactivateBadge(BADGE);
    const [url, schema, init] = lastCallFull();
    expect(url).toBe(`/social/kudos-badges/${BADGE}`);
    expect(init?.method).toBe("DELETE");
    expect(init?.body).toBeUndefined();

    const parsed = schema.parse(ADMIN_ROW) as AdminRow;
    expect(parsed.id).toBe(BADGE);
    expect(parsed.isActive).toBe(false);
    // 051 trả HÀNG huy hiệu, không phải `{ deleted: true }` như xoá bài/bình luận.
    expect(schema.safeParse({ deleted: true }).success).toBe(false);
  });
});
