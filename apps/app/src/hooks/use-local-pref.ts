import { useCallback, useState } from "react";

/**
 * Tuỳ chọn hiển thị per-user lưu localStorage (view mode, ẩn/hiện tổng quan, cột bảng…).
 * KHÔNG dùng cho dữ liệu nghiệp vụ/nhạy cảm — chỉ preference UI thuần.
 * localStorage hỏng/quota (private mode) → giữ state trong phiên, không crash.
 */
export function useLocalPref<T>(key: string, initial: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = window.localStorage.getItem(key);
      return raw !== null ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });

  const set = useCallback(
    (next: T) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // quota/private mode — chấp nhận mất persist, state phiên vẫn đúng
      }
    },
    [key],
  );

  return [value, set];
}
