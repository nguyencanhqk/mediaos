/**
 * S16-SOCIAL-FE-3 (gate code, CODE-02) → S16-SOCIAL-FEMODINVAL-1 — RATCHET giữa các đường làm mới «mọi bề
 * mặt đang vẽ bài»: màn Kiểm duyệt (`invalidatePostSurfaces`) · menu ⋯ thẻ bài (`useFeedActions`).
 *
 * Hai đường nay đọc CÙNG một nguồn (`feed/lib/post-list-invalidation.ts`) nên hai tập không thể trôi khỏi
 * nhau; ca dưới vẫn chạy THẬT đường menu ⋯ và thu mọi khoá nó invalidate (không viết tay danh sách) để bắt
 * ca ai đó nối thêm khoá thẳng vào `use-feed-actions.ts` mà bỏ qua helper.
 */
import type { ReactNode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider, type QueryKey } from "@tanstack/react-query";
import { socialKeys } from "@mediaos/web-core";
import { useFeedActions } from "../../feed/lib/use-feed-actions";
import { makePost } from "../../feed/social-test-doubles";
import { postListKeys } from "../../feed/lib/post-list-invalidation";
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

const same = (a: QueryKey, b: QueryKey): boolean => JSON.stringify(a) === JSON.stringify(b);

describe("một nguồn tập khoá «mọi bề mặt đang vẽ bài»", () => {
  it('mỗi khoá danh sách mà đường menu ⋯ THẬT invalidate đều nằm dưới một khoá của `postListKeys("queues")`', async () => {
    const cardMenu = await keysOfCardMenuPath();
    const source = postListKeys("queues");
    // Chi tiết của MỘT bài là của nơi gọi (chỉ nơi gọi biết id bài).
    const detail = socialKeys.posts.detail(POST_ID);
    const surfaces = cardMenu.filter((key) => !same(key, detail));

    // Đường menu ⋯ thật sự đã chạy (chống ca «tập rỗng ⇒ xanh»).
    expect(cardMenu).toContainEqual(detail);
    expect(surfaces).toContainEqual(socialKeys.feed.allOf());
    expect(surfaces.length).toBeGreaterThanOrEqual(10);

    expect(surfaces.filter((key) => !source.some((prefix) => isPrefixOf(prefix, key)))).toEqual([]);
  });

  it("chiều ngược: mỗi khoá của nguồn đều được đường menu ⋯ THẬT làm mới (menu ⋯ không bỏ sót)", async () => {
    const cardMenu = await keysOfCardMenuPath();
    const missed = postListKeys("queues").filter((key) => !cardMenu.some((k) => same(k, key)));
    expect(missed).toEqual([]);
  });

  it('`invalidatePostSurfaces` làm mới ĐÚNG tập `postListKeys("hidden")` — không thừa, không thiếu', () => {
    const moderation = keysOfModerationPath();
    const source = postListKeys("hidden");
    expect(moderation).toHaveLength(source.length);
    expect(source.filter((key) => !moderation.some((k) => same(k, key)))).toEqual([]);
    expect(moderation).toContainEqual(socialKeys.moderation.hiddenPosts());
  });

  it("ẩn / xoá từ menu ⋯ làm mới thêm `moderation.hiddenPosts()` + `reports.lists()`", async () => {
    const cardMenu = await keysOfCardMenuPath();
    const reaches = (key: QueryKey): boolean => cardMenu.some((prefix) => isPrefixOf(prefix, key));
    expect(reaches(socialKeys.moderation.hiddenPosts())).toBe(true);
    expect(reaches(socialKeys.moderation.reports.lists())).toBe(true);
  });

  it("không quét sạch: không khoá nào của nguồn phủ catalog huy hiệu / sinh nhật", () => {
    const untouched = [socialKeys.kudos.badges(), socialKeys.birthdays({ range: "week" })];
    for (const key of untouched) {
      expect(postListKeys("queues").filter((prefix) => isPrefixOf(prefix, key))).toEqual([]);
    }
  });
});
