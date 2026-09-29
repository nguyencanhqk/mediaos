/**
 * social-groups-api.spec.ts — ranh giới hợp đồng của `socialGroupsApi` (S16-SOCIAL-FE-2B, 030..039).
 *
 * Khuôn `social-api.spec.ts`: mock `apiFetch` ở ranh giới `./api-client` để đọc path/method/body/khoá,
 * RỒI chạy chính schema đã truyền vào trên payload chép ĐÚNG hình dạng service BE trả
 * (`social-groups.service.ts` — `toFeedGroupDto` · `toMemberDto` · `{deleted:true}` · `{left:true}`).
 * Chỉ so URL thì schema sai vẫn xanh — đúng cái bẫy `039` từng khai sai trong contracts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import { createFeedGroupSchema, decideFeedGroupMemberSchema } from "@mediaos/contracts";
import { feedGroupLeftResultSchema, socialGroupsApi } from "./social-groups-api";
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

const GROUP_ID = "11111111-1111-4111-8111-111111111111";
const GROUP_ID_2 = "55555555-5555-4555-8555-555555555555";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const EMP_ID = "33333333-3333-4333-8333-333333333333";
const ISO = "2026-09-29T01:15:53.496Z";

/** Chép `toFeedGroupDto` (`social-groups.service.ts:619-630`). */
const GROUP = {
  id: GROUP_ID,
  name: "Bóng đá công ty",
  description: null,
  visibility: "private",
  memberCount: 3,
  myRole: "member",
  myStatus: "pending",
  createdAt: ISO,
};

/** Chép `toMemberDto` (`social-groups.service.ts:632-642`) — hàng `pending` có `joinedAt:null`. */
const MEMBER = {
  userId: USER_ID,
  employeeId: EMP_ID,
  fullName: "Nguyễn Văn A",
  avatarUrl: null,
  role: "member",
  status: "pending",
  joinedAt: null,
};

beforeEach(() => {
  vi.mocked(apiClient.apiFetch).mockReset();
  vi.mocked(apiClient.apiFetch).mockResolvedValue(undefined as never);
});

describe("030 list", () => {
  it("GET /social/groups mang `membership` + `page`; schema nhận trang OFFSET thật", async () => {
    await socialGroupsApi.list({ membership: "mine", page: 2, limit: 5 });
    const [url, schema, init] = lastCall();
    expect(url).toBe("/social/groups?membership=mine&page=2&limit=5");
    expect(init?.method ?? "GET").toBe("GET");
    expect(
      schema.safeParse({
        data: [GROUP, { ...GROUP, id: GROUP_ID_2, myRole: null, myStatus: null }],
        page: 2,
        limit: 5,
        total: 7,
      }).success,
    ).toBe(true);
  });

  it("không query ⇒ không dấu `?` (server tự mặc định membership=all)", async () => {
    await socialGroupsApi.list();
    expect(lastCall()[0]).toBe("/social/groups");
  });
});

describe("031 create", () => {
  const BODY = createFeedGroupSchema.parse({ name: "Nhóm A", visibility: "public" });

  it("POST thân nguyên vẹn + khoá idempotency suy từ thân (ổn định giữa hai lượt)", async () => {
    await socialGroupsApi.create(BODY);
    const [url, schema, init, opts] = lastCall();
    expect(url).toBe("/social/groups");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body ?? "{}")).toEqual(BODY);
    expect(opts?.idempotencyKey).toEqual(expect.any(String));
    const first = opts?.idempotencyKey;
    await socialGroupsApi.create(BODY);
    expect(lastCall()[3]?.idempotencyKey).toBe(first);
    await socialGroupsApi.create({ ...BODY, name: "Nhóm B" });
    expect(lastCall()[3]?.idempotencyKey).not.toBe(first);
    expect(schema.safeParse({ ...GROUP, myRole: "owner", myStatus: "active" }).success).toBe(true);
  });
});

describe("032 get · 033 update · 034 remove", () => {
  it("get: GET đúng đường, parse FeedGroupDto", async () => {
    await socialGroupsApi.get(GROUP_ID);
    const [url, schema, init] = lastCall();
    expect(url).toBe(`/social/groups/${GROUP_ID}`);
    expect(init?.method ?? "GET").toBe("GET");
    expect(schema.safeParse(GROUP).success).toBe(true);
  });

  it("update: PATCH chỉ các trường gửi vào", async () => {
    await socialGroupsApi.update(GROUP_ID, { description: null });
    const [url, schema, init] = lastCall();
    expect(url).toBe(`/social/groups/${GROUP_ID}`);
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(init?.body ?? "{}")).toEqual({ description: null });
    expect(schema.safeParse(GROUP).success).toBe(true);
  });

  it("remove: DELETE không body; schema nhận `{deleted:true}`, TỪ CHỐI mutation DTO", async () => {
    await socialGroupsApi.remove(GROUP_ID);
    const [url, schema, init] = lastCall();
    expect(url).toBe(`/social/groups/${GROUP_ID}`);
    expect(init?.method).toBe("DELETE");
    expect(init?.body).toBeUndefined();
    expect(schema.safeParse({ deleted: true }).success).toBe(true);
    expect(schema.safeParse({ userId: USER_ID, role: null, status: null }).success).toBe(false);
  });
});

describe("035 join · 036 leave — toggle, CỐ Ý KHÔNG khoá idempotency (plan D2)", () => {
  it("join: POST …/join, KHÔNG `idempotencyKey`, parse FeedGroupDto (pending)", async () => {
    await socialGroupsApi.join(GROUP_ID);
    const [url, schema, init, opts] = lastCall();
    expect(url).toBe(`/social/groups/${GROUP_ID}/join`);
    expect(init?.method).toBe("POST");
    // Khoá suy từ {groupId} ⇒ join→leave→join trong 15 phút được server PHÁT LẠI 201 cũ, không tạo hàng.
    expect(opts?.idempotencyKey).toBeUndefined();
    expect(schema.safeParse(GROUP).success).toBe(true);
  });

  it("leave: POST …/leave, KHÔNG `idempotencyKey`, schema nhận `{left:true}`", async () => {
    await socialGroupsApi.leave(GROUP_ID);
    const [url, schema, init, opts] = lastCall();
    expect(url).toBe(`/social/groups/${GROUP_ID}/leave`);
    expect(init?.method).toBe("POST");
    expect(opts?.idempotencyKey).toBeUndefined();
    expect(schema.safeParse({ left: true }).success).toBe(true);
  });

  it("feedGroupLeftResultSchema: chỉ `{left:true}` — `false`/rỗng/thừa trường ⇒ từ chối", () => {
    expect(feedGroupLeftResultSchema.safeParse({ left: true }).success).toBe(true);
    expect(feedGroupLeftResultSchema.safeParse({ left: false }).success).toBe(false);
    expect(feedGroupLeftResultSchema.safeParse({}).success).toBe(false);
    expect(feedGroupLeftResultSchema.safeParse({ left: true, extra: 1 }).success).toBe(false);
  });
});

describe("037 listMembers", () => {
  it("mang `status` rõ ràng; schema nhận hàng pending (`joinedAt:null`) lẫn active", async () => {
    await socialGroupsApi.listMembers(GROUP_ID, { status: "pending", page: 1 });
    const [url, schema] = lastCall();
    expect(url).toBe(`/social/groups/${GROUP_ID}/members?status=pending&page=1`);
    expect(
      schema.safeParse({
        data: [MEMBER, { ...MEMBER, role: "owner", status: "active", joinedAt: ISO }],
        page: 1,
        limit: 20,
        total: 2,
      }).success,
    ).toBe(true);
  });
});

describe("038 decideMember · 039 removeMember", () => {
  it("decide: PATCH đúng MỘT dạng của union (decision) — không khoá", async () => {
    const body = decideFeedGroupMemberSchema.parse({ decision: "approve" });
    await socialGroupsApi.decideMember(GROUP_ID, USER_ID, body);
    const [url, schema, init, opts] = lastCall();
    expect(url).toBe(`/social/groups/${GROUP_ID}/members/${USER_ID}`);
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(init?.body ?? "{}")).toEqual({ decision: "approve" });
    expect(opts?.idempotencyKey).toBeUndefined();
    expect(schema.safeParse({ userId: USER_ID, role: "member", status: "active" }).success).toBe(
      true,
    );
    // Từ chối xoá cứng hàng ⇒ role/status null.
    expect(schema.safeParse({ userId: USER_ID, role: null, status: null }).success).toBe(true);
  });

  it("decide: dạng `{role}` gửi nguyên vẹn", async () => {
    await socialGroupsApi.decideMember(GROUP_ID, USER_ID, { role: "owner" });
    expect(JSON.parse(lastCall()[2]?.body ?? "{}")).toEqual({ role: "owner" });
  });

  it("removeMember: DELETE; schema nhận `{deleted:true}` (KHÔNG phải mutation DTO như docblock cũ)", async () => {
    await socialGroupsApi.removeMember(GROUP_ID, USER_ID);
    const [url, schema, init] = lastCall();
    expect(url).toBe(`/social/groups/${GROUP_ID}/members/${USER_ID}`);
    expect(init?.method).toBe("DELETE");
    expect(init?.body).toBeUndefined();
    expect(schema.safeParse({ deleted: true }).success).toBe(true);
    expect(schema.safeParse({ userId: USER_ID, role: null, status: null }).success).toBe(false);
  });
});
