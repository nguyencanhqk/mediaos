/**
 * S16-SOCIAL-FE-3 — `useGuardedMutation`: MỘT cơ chế cho mọi lượt GHI của cụm quản trị bảng tin (029 ·
 * 027 · 006; PR-B: huy hiệu). Ba luật, mỗi luật một nhóm ca:
 *   · KHOÁ đồng bộ — hai `start` trong cùng một nhịp chỉ lên dây MỘT lần;
 *   · NHẢ — sau lỗi luôn nhả; sau thành công nhả, trừ khi `keepLockAfterSuccess`;
 *   · HẠN CHỜ — lời gọi treo quá `GUARDED_MUTATION_TIMEOUT_MS` thì rơi vào `onError` và `signal` bị huỷ.
 *
 * Hạn chờ viết TAY (30 giây) — không đọc hằng của mã nguồn: đổi hằng mà quên câu chữ / tài liệu thì ca đỏ.
 */
import type { ReactNode } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { onlineManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { advanceFakeTimers } from "../admin-test-doubles";
import {
  GuardedMutationTimeoutError,
  useGuardedMutation,
  type GuardedMutationOptions,
} from "./use-guarded-mutation";

const TIMEOUT_MS = 30_000;

type Fn = GuardedMutationOptions<string, string>["mutationFn"];

function setup(mutationFn: Fn, keepLockAfterSuccess?: boolean) {
  const onSuccess = vi.fn();
  const onError = vi.fn();
  const client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const view = renderHook(
    () =>
      useGuardedMutation<string, string>({
        mutationFn,
        onSuccess,
        onError,
        ...(keepLockAfterSuccess === undefined ? {} : { keepLockAfterSuccess }),
      }),
    { wrapper },
  );
  return { ...view, onSuccess, onError };
}

/** Chạy hết microtask + timer 0 của react-query. */
const flush = advanceFakeTimers;

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  onlineManager.setOnline(true);
});

describe("KHOÁ đồng bộ", () => {
  it("hai `start` LIỀN NHAU ⇒ lượt đầu `true`, lượt hai `false`, `mutationFn` đúng 1 lần", async () => {
    vi.useFakeTimers();
    const mutationFn = vi.fn<Fn>(() => new Promise<string>(() => undefined));
    const { result } = setup(mutationFn);

    let started: boolean[] = [];
    act(() => {
      started = [result.current.start("a"), result.current.start("b")];
    });
    await flush();

    expect(started).toEqual([true, false]);
    expect(mutationFn).toHaveBeenCalledTimes(1);
    expect(mutationFn.mock.calls[0]?.[0]).toBe("a");
    expect(result.current.isLocked()).toBe(true);
    expect(result.current.isPending).toBe(true);
  });

  it("trình duyệt báo offline ⇒ `mutationFn` VẪN chạy (không «tạm dừng» vô hạn)", async () => {
    vi.useFakeTimers();
    onlineManager.setOnline(false);
    const mutationFn = vi.fn<Fn>(() => Promise.reject(new TypeError("Failed to fetch")));
    const { result, onError } = setup(mutationFn);

    act(() => {
      result.current.start("a");
    });
    await flush();

    expect(mutationFn).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(result.current.isLocked()).toBe(false);
  });
});

describe("NHẢ khoá", () => {
  it("sau LỖI ⇒ nhả: `start` kế tiếp lên dây", async () => {
    vi.useFakeTimers();
    const mutationFn = vi.fn<Fn>(() => Promise.reject(new Error("boom")));
    const { result, onError } = setup(mutationFn, true);

    act(() => {
      result.current.start("a");
    });
    await flush();
    expect(onError.mock.calls[0]?.[1]).toBe("a");
    expect(result.current.isLocked()).toBe(false);

    act(() => {
      result.current.start("b");
    });
    await flush();
    expect(mutationFn).toHaveBeenCalledTimes(2);
  });

  it("sau THÀNH CÔNG (mặc định) ⇒ nhả: hành động lặp lại được", async () => {
    vi.useFakeTimers();
    const mutationFn = vi.fn<Fn>((value) => Promise.resolve(value.toUpperCase()));
    const { result, onSuccess } = setup(mutationFn);

    act(() => {
      result.current.start("a");
    });
    await flush();
    expect(onSuccess).toHaveBeenCalledWith("A", "a");
    expect(result.current.isLocked()).toBe(false);

    let second = false;
    act(() => {
      second = result.current.start("b");
    });
    await flush();
    expect(second).toBe(true);
    expect(mutationFn).toHaveBeenCalledTimes(2);
  });

  it("`keepLockAfterSuccess` ⇒ sau thành công KHÔNG nhả: `start` kế tiếp bị từ chối", async () => {
    vi.useFakeTimers();
    const mutationFn = vi.fn<Fn>((value) => Promise.resolve(value));
    const { result } = setup(mutationFn, true);

    act(() => {
      result.current.start("a");
    });
    await flush();

    let second = true;
    act(() => {
      second = result.current.start("b");
    });
    await flush();
    expect(second).toBe(false);
    expect(result.current.isLocked()).toBe(true);
    expect(mutationFn).toHaveBeenCalledTimes(1);
  });
});

describe("HẠN CHỜ", () => {
  it("lời gọi treo: trước 30 giây còn khoá; đúng 30 giây ⇒ `onError(GuardedMutationTimeoutError)`, `signal` bị huỷ, khoá nhả", async () => {
    vi.useFakeTimers();
    const mutationFn = vi.fn<Fn>(() => new Promise<string>(() => undefined));
    const { result, onError, onSuccess } = setup(mutationFn);

    act(() => {
      result.current.start("a");
    });
    await flush(TIMEOUT_MS - 1);
    const signal = mutationFn.mock.calls[0]?.[1];
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(false);
    expect(onError).not.toHaveBeenCalled();
    expect(result.current.isLocked()).toBe(true);

    await flush(1);
    // Thêm một nhịp: react-query báo observer bằng một timer 0 xếp SAU nhịp vừa chạy.
    await flush(1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(GuardedMutationTimeoutError);
    expect(signal?.aborted).toBe(true);
    expect(onSuccess).not.toHaveBeenCalled();
    expect(result.current.isLocked()).toBe(false);
    expect(result.current.isPending).toBe(false);
  });

  it("phản hồi về TRƯỚC hạn ⇒ không có lỗi hạn chờ nào bắn ra sau đó, `signal` không bị huỷ", async () => {
    vi.useFakeTimers();
    const mutationFn = vi.fn<Fn>((value) => Promise.resolve(value));
    const { result, onError, onSuccess } = setup(mutationFn);

    act(() => {
      result.current.start("a");
    });
    await flush();
    await flush(TIMEOUT_MS * 2);

    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    expect(mutationFn.mock.calls[0]?.[1]?.aborted).toBe(false);
  });

  it("phản hồi về SAU hạn ⇒ bị bỏ qua: vẫn chỉ một `onError`, không `onSuccess` muộn", async () => {
    vi.useFakeTimers();
    let release: (value: string) => void = () => undefined;
    const mutationFn = vi.fn<Fn>(
      () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
    );
    const { result, onError, onSuccess } = setup(mutationFn);

    act(() => {
      result.current.start("a");
    });
    await flush(TIMEOUT_MS);
    release("late");
    await flush();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
