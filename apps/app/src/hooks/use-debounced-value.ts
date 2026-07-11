import { useEffect, useState } from "react";

/**
 * HR-PROFILE-UI-1b (P1 perf) — trễ giá trị theo delay. Dùng cho ô tìm kiếm: gõ 12 phím = 1 API call
 * thay vì 12 (query key chỉ đổi khi giá trị debounced đổi).
 */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState<T>(value);

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs]);

  return debounced;
}
