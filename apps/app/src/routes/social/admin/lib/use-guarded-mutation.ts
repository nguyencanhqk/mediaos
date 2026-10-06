/**
 * S16-SOCIAL-FE-3 — MỘT cơ chế cho mọi lượt GHI của cụm quản trị bảng tin: 029 (kết thúc báo cáo) · 027
 * (gửi báo cáo) · 006 «Hiện lại»; PR-B dùng tiếp cho huy hiệu (plan D20). Trước đây ba nơi tự viết tay
 * cùng bộ này với luật nhả khác nhau — chép nhầm biến thể là mọi cú bấm sau lượt đầu bị nuốt im lặng.
 *
 * Hook sở hữu BA thứ mà `useMutation` trần không cho:
 *  1. KHOÁ ĐỒNG BỘ. `isPending` tới màn sau một nhịp của react-query, nên hai kích hoạt sát nhau (bấm đúp,
 *     Enter giữ phím) đều thấy nút còn mở. `start` đặt cờ ref TRƯỚC khi `mutate` ⇒ lượt hai bị từ chối.
 *  2. LUẬT NHẢ ở MỘT chỗ (`onSettled`): sau lỗi LUÔN nhả (còn gửi lại được); sau thành công nhả, trừ khi
 *     `keepLockAfterSuccess` (hành động chỉ làm MỘT lần cho mỗi lượt mount — vd 027).
 *  3. KHÔNG TREO. `networkMode: "always"`: trình duyệt báo offline thì hỏng ngay thay vì «tạm dừng» vô hạn
 *     mà không gọi `onError`. Và HẠN CHỜ: `apiFetch` không có timeout, nên một yêu cầu treo (rớt Wi-Fi /
 *     VPN khi `navigator.onLine` vẫn `true`) giữ `isPending` tới khi TCP/proxy cắt — hộp thoại đang chặn mọi
 *     đường đóng thành lớp phủ không lối ra. Quá `GUARDED_MUTATION_TIMEOUT_MS` ⇒ `signal` bị huỷ và lượt
 *     gửi rơi vào `onError` với `GuardedMutationTimeoutError` (không phải `ApiError` ⇒ `generic` + «Thử lại»).
 *
 * ⚠️ Hết hạn KHÔNG có nghĩa là server chưa ghi. Nơi gọi phải chịu được lượt lặp: 029 nhận 409 `021` (đã
 * xử lý), 027 gửi lại CÙNG khoá idempotency, 006 `{ hidden: false }` lặp lại không đổi gì.
 *
 * Phản hồi về SAU hạn bị bỏ qua (lượt gửi đã có kết cục) — hạn chờ đua với lời gọi chứ không chỉ dựa vào
 * việc `fetch` tôn trọng `signal`, nên `mutationFn` không nối `signal` xuống dây vẫn không treo màn.
 */
import * as React from "react";
import { useMutation } from "@tanstack/react-query";

/** Trần chờ một lượt ghi. Dài hơn mọi lượt ghi lành mạnh của cụm này, ngắn hơn sự kiên nhẫn của người dùng. */
export const GUARDED_MUTATION_TIMEOUT_MS = 30_000;

export class GuardedMutationTimeoutError extends Error {
  constructor() {
    super("Guarded mutation timed out");
    this.name = "GuardedMutationTimeoutError";
  }
}

export interface GuardedMutationOptions<TData, TVariables> {
  /**
   * Mọi thứ gửi đi nằm trong `variables` — thân hàm KHÔNG đọc state (v5 nạp lại closure trong effect).
   * `signal` bị huỷ khi hết hạn chờ: nối nó xuống `fetch` nếu client của lời gọi nhận `signal`.
   */
  mutationFn: (variables: TVariables, signal: AbortSignal) => Promise<TData>;
  onSuccess: (data: TData, variables: TVariables) => void;
  /** BẮT BUỘC: app không có toast toàn cục — mutation thiếu `onError` là hỏng im lặng. */
  onError: (error: unknown, variables: TVariables) => void;
  /** `true` ⇒ sau lượt THÀNH CÔNG khoá không nhả nữa (một lượt mount, một lần ghi). Mặc định `false`. */
  keepLockAfterSuccess?: boolean;
}

export interface GuardedMutation<TVariables> {
  /** Thứ người dùng THẤY (khoá nút, `aria-busy`) — tới màn sau một nhịp. Thứ CHẶN là `isLocked`. */
  isPending: boolean;
  /** Đọc đồng bộ: đang có lượt gửi bay, hoặc đã thành công với `keepLockAfterSuccess`. */
  isLocked: () => boolean;
  /** Gửi nếu chưa khoá. `false` ⇒ lượt này bị từ chối, không có gì lên dây. */
  start: (variables: TVariables) => boolean;
}

function raceWithTimeout<T>(run: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const controller = new AbortController();
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      controller.abort();
      reject(new GuardedMutationTimeoutError());
    }, ms);
    run(controller.signal).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

export function useGuardedMutation<TData, TVariables>({
  mutationFn,
  onSuccess,
  onError,
  keepLockAfterSuccess = false,
}: GuardedMutationOptions<TData, TVariables>): GuardedMutation<TVariables> {
  const isLockedRef = React.useRef(false);

  const mutation = useMutation<TData, unknown, TVariables>({
    networkMode: "always",
    mutationFn: (variables) =>
      raceWithTimeout((signal) => mutationFn(variables, signal), GUARDED_MUTATION_TIMEOUT_MS),
    // Chỉ hai tham số đầu: nơi gọi không phụ thuộc `context` / tham số thứ tư của react-query.
    onSuccess: (data, variables) => {
      onSuccess(data, variables);
    },
    onError: (error, variables) => {
      onError(error, variables);
    },
    // MỘT chỗ nhả cho mọi kết cục — không nhánh lỗi nào (kể cả nhánh thêm sau này) để quên được.
    onSettled: (_data, error) => {
      if (error !== null || !keepLockAfterSuccess) isLockedRef.current = false;
    },
  });

  const { mutate } = mutation;
  const isLocked = React.useCallback((): boolean => isLockedRef.current, []);
  const start = React.useCallback(
    (variables: TVariables): boolean => {
      if (isLockedRef.current) return false;
      isLockedRef.current = true;
      mutate(variables);
      return true;
    },
    [mutate],
  );

  return { isPending: mutation.isPending, isLocked, start };
}
