/**
 * social-moderation-api.spec.ts — ranh giới hợp đồng của `socialModerationApi` (S16-SOCIAL-FE-3, ca A1:
 * `SOCIAL-API-027` · `028` · `029`).
 *
 * Khuôn `social-kudos-api.spec.ts`: mock `apiFetch` để đọc path/method/body/khoá idempotency, RỒI chạy
 * CHÍNH schema đã truyền vào trên payload chép đúng hình dạng service BE trả và assert trên DỮ LIỆU ĐÃ
 * PARSE (chỉ so URL thì schema sai vẫn xanh).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import { idempotencyKeyFor } from "./api-idempotency";
import { socialModerationApi } from "./social-moderation-api";
import * as apiClient from "./api-client";

vi.mock("./api-client", async (importOriginal) => {
  const mod = await importOriginal<typeof apiClient>();
  return { ...mod, apiFetch: vi.fn() };
});

interface FetchInit {
  method?: string;
  body?: string;
}

function lastCall(): [
  string,
  z.ZodType<unknown>,
  FetchInit | undefined,
  { idempotencyKey?: string } | undefined,
] {
  const calls = vi.mocked(apiClient.apiFetch).mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1] as never;
}

const REPORT = "66666666-6666-4666-8666-666666666666";
const POST = "11111111-1111-4111-8111-111111111111";
const COMMENT = "22222222-2222-4222-8222-222222222222";
const EMP = "33333333-3333-4333-8333-333333333333";
const ISO = "2026-10-01T02:03:04.000Z";

/** Hình dạng `SocialReportsService` trả cho 028/029 — tập khoá đóng của `feedReportSchema`. */
const REPORT_ROW = {
  id: REPORT,
  targetType: "post",
  targetId: POST,
  targetSnapshot: {
    postId: POST,
    authorEmployeeId: EMP,
    authorFullName: "Trần Thị B",
    avatarUrl: null,
    bodyExcerpt: "Nội dung bị báo cáo",
    status: "published",
    deletedAt: null,
  },
  // `null` = bị che theo scope (manager @Department) — khoá LUÔN có mặt.
  reporter: null,
  reason: "spam",
  note: "Đăng lặp lại nhiều lần",
  status: "open",
  resolvedBy: null,
  resolvedAt: null,
  resolutionNote: null,
  createdAt: ISO,
  updatedAt: ISO,
};

beforeEach(() => {
  vi.mocked(apiClient.apiFetch).mockReset();
  vi.mocked(apiClient.apiFetch).mockResolvedValue(undefined as never);
});

describe("028 — listReports", () => {
  it("GET /social/reports?status=open&page=2 và parse TRANG `{data,page,limit,total}`", async () => {
    await socialModerationApi.listReports({ status: "open", page: 2 });
    const [url, schema, init] = lastCall();
    expect(url).toBe("/social/reports?status=open&page=2");
    expect(init?.method ?? "GET").toBe("GET");

    const page = { data: [REPORT_ROW], page: 2, limit: 20, total: 21 };
    expect(schema.safeParse(page).success).toBe(true);
    const parsed = schema.parse(page) as {
      data: { id: string; reporter: unknown }[];
      total: number;
    };
    expect(parsed.total).toBe(21);
    expect(parsed.data[0]?.id).toBe(REPORT);
    expect(parsed.data[0]?.reporter).toBeNull();
    // Một HÀNG trần không phải là một trang — schema của 028 phải từ chối nó.
    expect(schema.safeParse(REPORT_ROW).success).toBe(false);
  });

  it("vắng tham số ⇒ không có query string (server tự mặc định page=1, limit=20, mọi trạng thái)", async () => {
    await socialModerationApi.listReports();
    expect(lastCall()[0]).toBe("/social/reports");
  });

  // Parser URL-search của màn trả ĐỦ khoá, kể cả khoá mang `undefined` (bộ lọc «Tất cả»). Query của 028
  // là `.strict()` + enum ⇒ `status=undefined` lọt lên URL là 400 cho cả hàng đợi.
  it("khoá CÓ MẶT mang `undefined` ⇒ KHÔNG lọt lên URL: chỉ còn `?page=1&limit=20`", async () => {
    await socialModerationApi.listReports({ status: undefined, page: 1, limit: 20 });
    expect(lastCall()[0]).toBe("/social/reports?page=1&limit=20");
  });
});

describe("029 — resolveReport", () => {
  it("PATCH /social/reports/:id với đúng body và parse MỘT báo cáo (không phải trang)", async () => {
    const body = { status: "resolved", resolutionNote: "Đã ẩn bài", action: "hide_post" } as const;
    await socialModerationApi.resolveReport(REPORT, body);
    const [url, schema, init, opts] = lastCall();
    expect(url).toBe(`/social/reports/${REPORT}`);
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(init?.body ?? "null")).toEqual(body);
    // 029 KHÔNG `@Idempotent()` — gửi khoá là vô nghĩa, chống bấm đúp do nút `disabled` đảm nhiệm.
    expect(opts?.idempotencyKey).toBeUndefined();

    const resolved = {
      ...REPORT_ROW,
      status: "resolved",
      resolvedAt: ISO,
      resolutionNote: "Đã ẩn bài",
    };
    expect(schema.safeParse(resolved).success).toBe(true);
    const parsed = schema.parse(resolved) as { id: string; status: string };
    expect(parsed.id).toBe(REPORT);
    expect(parsed.status).toBe("resolved");
    expect(schema.safeParse({ data: [resolved], page: 1, limit: 20, total: 1 }).success).toBe(
      false,
    );
  });
});

describe("027 — createReport", () => {
  const BODY = { targetType: "post", targetId: POST, reason: "spam", note: "Spam" } as const;
  const keyOf = (): string | undefined => lastCall()[3]?.idempotencyKey;

  it("POST /social/reports với đúng body, KÈM Idempotency-Key, parse `{ id }`", async () => {
    await socialModerationApi.createReport(BODY, "attempt-1");
    const [url, schema, init, opts] = lastCall();
    expect(url).toBe("/social/reports");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body ?? "null")).toEqual(BODY);
    expect(opts?.idempotencyKey).toMatch(/^social-report_/);

    expect((schema.parse({ id: REPORT }) as { id: string }).id).toBe(REPORT);
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ id: "khong-phai-uuid" }).success).toBe(false);
  });

  it("cùng (attemptId, body) ⇒ CÙNG khoá — thử lại trong một lượt mở hộp thoại không tạo báo cáo thứ hai", async () => {
    await socialModerationApi.createReport(BODY, "attempt-1");
    const first = keyOf();
    await socialModerationApi.createReport({ ...BODY }, "attempt-1");
    expect(first).toEqual(expect.any(String));
    expect(keyOf()).toBe(first);
  });

  it("khác attemptId ⇒ KHÁC khoá dù body y hệt (plan D20: lượt mở mới không phát lại phản hồi cũ)", async () => {
    await socialModerationApi.createReport(BODY, "attempt-1");
    const first = keyOf();
    await socialModerationApi.createReport(BODY, "attempt-2");
    const second = keyOf();
    expect(second).toEqual(expect.any(String));
    expect(second).not.toBe(first);
    // Khoá KHÔNG được là băm của riêng nội dung — đó chính là lỗi D20 (ii).
    expect(first).not.toBe(idempotencyKeyFor("social-report", BODY));
  });

  it("cùng attemptId, khác body ⇒ KHÁC khoá (đổi lý do / đổi đích là một ý định khác)", async () => {
    await socialModerationApi.createReport(BODY, "attempt-1");
    const first = keyOf();
    await socialModerationApi.createReport({ ...BODY, reason: "harassment" }, "attempt-1");
    const otherReason = keyOf();
    await socialModerationApi.createReport(
      { ...BODY, targetType: "comment", targetId: COMMENT },
      "attempt-1",
    );
    const otherTarget = keyOf();
    expect(new Set([first, otherReason, otherTarget]).size).toBe(3);
  });
});
