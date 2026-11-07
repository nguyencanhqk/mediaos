/**
 * S16-SOCIAL-FE-2B — `useCreatePost` (tách từ FeedPage, plan D10 + §8 M3). Hai chế độ:
 *  - bảng tin (không `groupId`): lỗi KHÔNG mang `reason` (trừ mã vinh danh — S16-SOCIAL-FE-2C), không
 *    đụng cache nhóm;
 *  - trang nhóm: 404 ERR-012 ⇒ `groupGone`; 403 (mất tư cách thành viên) ⇒ banner forbidden + kéo lại
 *    nhóm; 201 có `droppedMentions` ⇒ đếm (server bỏ im lặng mention người ngoài nhóm).
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ApiError, socialKeys } from "@mediaos/web-core";
import { SOCIAL_ERROR_CODES, type CreateFeedPostDto } from "@mediaos/contracts";
import { useCreatePost } from "./use-create-post";

const createPost = vi.fn();

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    socialApi: { ...actual.socialApi, createPost: (...a: unknown[]) => createPost(...a) },
  };
});

const GROUP_ID = "11111111-1111-4111-8111-111111111111";
const DTO = { type: "share", audience: "group", groupId: GROUP_ID, body: "x" } as CreateFeedPostDto;

function setup(opts: Parameters<typeof useCreatePost>[0] = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useCreatePost(opts), { wrapper });
  const keys = () => invalidate.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
  return { ...hook, keys, client };
}

afterEach(() => {
  createPost.mockReset();
});

describe("useCreatePost — chế độ nhóm", () => {
  it("404 ERR-012 ⇒ reason groupGone + kéo lại nhóm; promise vẫn REJECT (ô soạn giữ chữ)", async () => {
    createPost.mockRejectedValue(new ApiError(404, "RESOURCE-ERR-NOT-FOUND", "SOCIAL-ERR-012: không tìm thấy nhóm."));
    const { result, keys } = setup({ groupId: GROUP_ID });
    await act(async () => {
      await expect(result.current.submit(DTO)).rejects.toBeInstanceOf(ApiError);
    });
    await waitFor(() => expect(result.current.postError).toEqual({ forbidden: false, reason: "groupGone" }));
    expect(keys()).toContain(JSON.stringify(socialKeys.groups.detail(GROUP_ID)));
  });

  it("403 ERR-002 (không còn là thành viên) ⇒ forbidden + kéo lại nhóm", async () => {
    createPost.mockRejectedValue(
      new ApiError(403, "AUTH-ERR-FORBIDDEN", "SOCIAL-ERR-002: không đăng được vào đơn vị hoặc nhóm mà bạn không thuộc về."),
    );
    const { result, keys } = setup({ groupId: GROUP_ID });
    await act(async () => {
      await result.current.submit(DTO).catch(() => undefined);
    });
    await waitFor(() => expect(result.current.postError).toEqual({ forbidden: true, reason: null }));
    expect(keys()).toContain(JSON.stringify(socialKeys.groups.detail(GROUP_ID)));
  });

  it("201 có droppedMentions ⇒ đếm; invalidate feed (gồm feed nhóm) + onCreated được gọi", async () => {
    createPost.mockResolvedValue({ id: "p1", type: "share", droppedMentions: ["a", "b"] });
    const onCreated = vi.fn();
    const { result, keys } = setup({ groupId: GROUP_ID, onCreated });
    await act(async () => {
      await result.current.submit(DTO);
    });
    await waitFor(() => expect(result.current.droppedMentionCount).toBe(2));
    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(keys()).toContain(JSON.stringify(socialKeys.feed.allOf()));
    act(() => result.current.clearDroppedMentions());
    expect(result.current.droppedMentionCount).toBe(0);
  });
});

describe("useCreatePost — bảng tin (không groupId) giữ hành vi cũ", () => {
  it("lỗi không phải vinh danh (ERR-012) ⇒ KHÔNG mang reason, KHÔNG đụng cache nhóm", async () => {
    createPost.mockRejectedValue(new ApiError(404, "RESOURCE-ERR-NOT-FOUND", "SOCIAL-ERR-012: không tìm thấy nhóm."));
    const { result, keys } = setup();
    await act(async () => {
      await result.current.submit(DTO).catch(() => undefined);
    });
    await waitFor(() => expect(result.current.postError).toEqual({ forbidden: false, reason: null }));
    expect(keys().some((k) => k.includes('"groups"'))).toBe(false);
    act(() => result.current.clearPostError());
    expect(result.current.postError).toBeNull();
  });

  it("S16-SOCIAL-FE-2D E1: 422 `SOCIAL-ERR-007` ở BẢNG TIN ⇒ reason `attachmentRejected`", async () => {
    createPost.mockRejectedValue(
      new ApiError(
        422,
        SOCIAL_ERROR_CODES.ATTACHMENT_LIMIT,
        "SOCIAL-ERR-007: vượt giới hạn đính kèm.",
      ),
    );
    const { result } = setup();
    await act(async () => {
      await result.current.submit(DTO).catch(() => undefined);
    });
    await waitFor(() => expect(result.current.postError).not.toBeNull());
    expect(result.current.postError?.reason ?? null).toBe("attachmentRejected");
    expect(result.current.postError?.forbidden).toBe(false);
  });

  it("bài poll mới ⇒ invalidate màn bình chọn; idea ⇒ màn sáng kiến", async () => {
    createPost.mockResolvedValueOnce({ id: "p1", type: "poll", droppedMentions: [] });
    const { result, keys } = setup();
    await act(async () => {
      await result.current.submit(DTO);
    });
    expect(keys()).toContain(JSON.stringify(socialKeys.polls.allOf()));
    createPost.mockResolvedValueOnce({ id: "p2", type: "idea", droppedMentions: [] });
    await act(async () => {
      await result.current.submit(DTO);
    });
    expect(keys()).toContain(JSON.stringify(socialKeys.ideas.allOf()));
  });
});

/**
 * S16-SOCIAL-FE-2C — ca KE. Cache kiểm trên KHOÁ THẬT mà màn/widget dùng (plan §8 H1): so chuỗi khoá
 * invalidate với chính đầu ra factory thì xanh cả khi khoá đó KHÔNG khớp query nào (tiền tố so theo PHẦN
 * TỬ mảng). Seed dữ liệu vào khoá thật rồi đọc `isInvalidated`.
 */
describe("useCreatePost — vinh danh (S16-SOCIAL-FE-2C)", () => {
  const KUDOS_DTO = {
    type: "kudos",
    audience: "company",
    requiresAck: false,
    kudos: { recipientEmployeeIds: [GROUP_ID], message: "x", isOfficial: false },
  } as CreateFeedPostDto;
  const C = SOCIAL_ERROR_CODES;

  it("422 SELF-RECIPIENT ở BẢNG TIN ⇒ reason kudosSelf (không bị nuốt thành câu chung)", async () => {
    createPost.mockRejectedValue(new ApiError(422, C.KUDOS_SELF_RECIPIENT, `${C.KUDOS_SELF_RECIPIENT}: x`));
    const { result } = setup();
    await act(async () => {
      await result.current.submit(KUDOS_DTO).catch(() => undefined);
    });
    await waitFor(() => expect(result.current.postError).toEqual({ forbidden: false, reason: "kudosSelf" }));
  });

  it("403 OFFICIAL-DENIED ⇒ forbidden + reason kudosOfficialDenied", async () => {
    createPost.mockRejectedValue(new ApiError(403, C.KUDOS_OFFICIAL_DENIED, `${C.KUDOS_OFFICIAL_DENIED}: x`));
    const { result } = setup();
    await act(async () => {
      await result.current.submit(KUDOS_DTO).catch(() => undefined);
    });
    await waitFor(() =>
      expect(result.current.postError).toEqual({ forbidden: true, reason: "kudosOfficialDenied" }),
    );
  });

  it("422 `022` (huy hiệu tắt) ⇒ reason kudosBadgeInvalid + catalog 048 THẬT bị invalidate", async () => {
    createPost.mockRejectedValue(new ApiError(422, C.KUDOS_BADGE_INVALID, `${C.KUDOS_BADGE_INVALID}: x`));
    const { result, client } = setup();
    client.setQueryData(socialKeys.kudos.badges(), { data: [], page: 1, limit: 100, total: 0 });
    await act(async () => {
      await result.current.submit(KUDOS_DTO).catch(() => undefined);
    });
    await waitFor(() =>
      expect(result.current.postError).toEqual({ forbidden: false, reason: "kudosBadgeInvalid" }),
    );
    expect(client.getQueryState(socialKeys.kudos.badges())?.isInvalidated).toBe(true);
  });

  it("DENY: lỗi KHÁC 022 ⇒ catalog huy hiệu KHÔNG bị invalidate", async () => {
    createPost.mockRejectedValue(new ApiError(422, C.KUDOS_SELF_RECIPIENT, `${C.KUDOS_SELF_RECIPIENT}: x`));
    const { result, client } = setup();
    client.setQueryData(socialKeys.kudos.badges(), { data: [], page: 1, limit: 100, total: 0 });
    await act(async () => {
      await result.current.submit(KUDOS_DTO).catch(() => undefined);
    });
    await waitFor(() => expect(result.current.postError).not.toBeNull());
    expect(client.getQueryState(socialKeys.kudos.badges())?.isInvalidated).toBe(false);
  });

  it("201 kudos ⇒ khoá THẬT của widget + màn 009 bị invalidate; bài share thì KHÔNG", async () => {
    const widgetKey = socialKeys.kudos.list({ month: "2026-09", limit: 5 });
    const pageKey = socialKeys.kudos.list({ month: "2026-09", page: 2, limit: 20 });
    const empty = { data: [], page: 1, limit: 5, total: 0 };

    createPost.mockResolvedValueOnce({ id: "p0", type: "share", droppedMentions: [] });
    const { result, client } = setup();
    client.setQueryData(widgetKey, empty);
    client.setQueryData(pageKey, empty);
    await act(async () => {
      await result.current.submit(DTO);
    });
    expect(client.getQueryState(widgetKey)?.isInvalidated).toBe(false);

    createPost.mockResolvedValueOnce({ id: "p1", type: "kudos", droppedMentions: [] });
    await act(async () => {
      await result.current.submit(KUDOS_DTO);
    });
    expect(client.getQueryState(widgetKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(pageKey)?.isInvalidated).toBe(true);
  });
});
