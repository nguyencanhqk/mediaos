/**
 * S16-SOCIAL-FE-3 (gate code, CODE-02) — RATCHET giữa HAI đường làm mới «mọi bề mặt đang vẽ bài»:
 *   · màn Kiểm duyệt  — `invalidatePostSurfaces` (file này);
 *   · menu ⋯ thẻ bài  — `invalidatePostLists` trong `feed/lib/use-feed-actions.ts`.
 *
 * Hai tập khoá đang được chép tay ở hai nơi. `invalidatePostLists` đã được nối khoá qua nhiều WO; lần nối
 * kế tiếp mà quên màn Kiểm duyệt thì bài ẩn/xoá từ hàng đợi vẫn nằm ở bề mặt mới — và mọi spec viết tay
 * danh sách khoá vẫn xanh. Ca dưới KHÔNG viết tay danh sách: nó chạy THẬT đường menu ⋯ (`moderate` qua
 * `useFeedActions`), thu mọi khoá đường đó invalidate, rồi đòi đường Kiểm duyệt phủ đủ từng khoá.
 *
 * Chiều ngược (đường menu ⋯ chưa invalidate `moderation.hiddenPosts()` / `reports.lists()`) là nợ ĐÃ BIẾT
 * — ghi ở `socialKeys.moderation` (web-core); ca cuối ghim đúng hiện trạng đó để ngày trả nợ phải sửa ca.
 */
import type { ReactNode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider, type QueryKey } from "@tanstack/react-query";
import { socialKeys } from "@mediaos/web-core";
import { useFeedActions } from "../../feed/lib/use-feed-actions";
import { makePost } from "../../feed/social-test-doubles";
import { invalidatePostSurfaces } from "./moderation-invalidation";

const moderatePost = vi.fn();

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    socialApi: {
      ...actual.socialApi,
      moderatePost: (...a: unknown[]) => moderatePost(...a),
    },
  };
});

const POST_ID = "11111111-1111-4111-8111-111111111111";

/** `QueryClient` ghi lại mọi `queryKey` được đưa vào `invalidateQueries`. */
function spiedClient(): { client: QueryClient; keys: () => QueryKey[] } {
  const client = new QueryClient();
  const spy = vi.spyOn(client, "invalidateQueries");
  const keys = (): QueryKey[] =>
    spy.mock.calls.flatMap(([filters]) =>
      filters?.queryKey === undefined ? [] : [filters.queryKey],
    );
  return { client, keys };
}

const isPrefixOf = (prefix: QueryKey, key: QueryKey): boolean =>
  prefix.length <= key.length &&
  prefix.every((part, index) => JSON.stringify(part) === JSON.stringify(key[index]));

/** Khoá mà đường menu ⋯ invalidate sau MỘT lượt kiểm duyệt bài thành công (chạy thật `useFeedActions`). */
async function keysOfCardMenuPath(): Promise<QueryKey[]> {
  const { client, keys } = spiedClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useFeedActions(), { wrapper });
  act(() => {
    result.current.moderate(POST_ID, { hidden: true });
  });
  await waitFor(() => expect(keys().length).toBeGreaterThan(0));
  return keys();
}

function keysOfModerationPath(): QueryKey[] {
  const { client, keys } = spiedClient();
  invalidatePostSurfaces(client);
  return keys();
}

beforeEach(() => {
  moderatePost.mockReset();
  moderatePost.mockImplementation(() => Promise.resolve(makePost({ id: POST_ID })));
});
afterEach(() => {
  cleanup();
});

describe("màn Kiểm duyệt phủ ĐỦ mọi bề mặt bài mà menu ⋯ của thẻ bài làm mới", () => {
  it("mỗi khoá danh sách của đường menu ⋯ đều nằm dưới một khoá của `invalidatePostSurfaces`", async () => {
    const cardMenu = await keysOfCardMenuPath();
    const moderation = keysOfModerationPath();
    // Chi tiết của MỘT bài do nơi gọi của màn Kiểm duyệt tự làm mới (chỉ nơi gọi biết id bài).
    const detail = socialKeys.posts.detail(POST_ID);
    const surfaces = cardMenu.filter((key) => JSON.stringify(key) !== JSON.stringify(detail));

    // Đường menu ⋯ thật sự đã chạy: có chi tiết bài + ít nhất dòng cuộn (chống ca «tập rỗng ⇒ xanh»).
    expect(cardMenu).toContainEqual(detail);
    expect(surfaces).toContainEqual(socialKeys.feed.allOf());
    expect(surfaces.length).toBeGreaterThanOrEqual(8);

    const uncovered = surfaces.filter(
      (key) => !moderation.some((prefix) => isPrefixOf(prefix, key)),
    );
    expect(uncovered).toEqual([]);
  });

  it("màn Kiểm duyệt làm mới THÊM `moderation.hiddenPosts()` — nhánh riêng, không nằm dưới `feed.allOf()`", () => {
    expect(keysOfModerationPath()).toContainEqual(socialKeys.moderation.hiddenPosts());
  });

  it("không quét sạch: không khoá nào của `invalidatePostSurfaces` là gốc `social` hay phủ catalog huy hiệu / sinh nhật", () => {
    const moderation = keysOfModerationPath();
    const untouched = [socialKeys.kudos.badges(), socialKeys.birthdays({ range: "week" })];
    for (const key of untouched) {
      expect(moderation.filter((prefix) => isPrefixOf(prefix, key))).toEqual([]);
    }
  });

  it("NỢ ĐÃ BIẾT (chiều ngược): đường menu ⋯ CHƯA làm mới `moderation.hiddenPosts()` lẫn `reports.lists()`", async () => {
    const cardMenu = await keysOfCardMenuPath();
    const reaches = (key: QueryKey): boolean => cardMenu.some((prefix) => isPrefixOf(prefix, key));
    expect(reaches(socialKeys.moderation.hiddenPosts())).toBe(false);
    expect(reaches(socialKeys.moderation.reports.lists())).toBe(false);
  });
});
