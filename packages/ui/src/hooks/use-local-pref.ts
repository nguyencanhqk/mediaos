import * as React from "react";

/**
 * Tuỳ chọn HIỂN THỊ per-user lưu `localStorage` (bộ cột đang hiện, số dòng/trang, nhóm sidebar đang
 * gập…). **KHÔNG** dùng cho dữ liệu nghiệp vụ/nhạy cảm — chỉ preference UI thuần, không gọi API.
 *
 * `localStorage` hỏng/đầy/private-mode ⇒ giữ state trong phiên, KHÔNG crash và KHÔNG nuốt im lặng giá
 * trị mặc định: đọc lỗi ⇒ rơi về `initial` (UI-07 §9.2 mục 8, §12.3).
 *
 * Bản DUY NHẤT — `apps/app/src/hooks/use-local-pref.ts` chỉ re-export (S15-PAYROLL-DEBT-1 gộp bản sinh đôi).
 */
export function useLocalPref<T>(key: string, initial: T): [T, (value: T) => void] {
  const [value, setValue] = React.useState<T>(() => {
    try {
      const raw = window.localStorage.getItem(key);
      return raw !== null ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });

  const set = React.useCallback(
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
