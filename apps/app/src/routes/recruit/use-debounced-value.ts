import { useEffect, useState } from "react";

/**
 * S12-RECRUIT-FE-1 (review-gate patch, item 15) — debounce nhẹ cho ô tìm kiếm (300ms). Chỉ giá trị ĐÃ
 * debounce mới vào query key — gõ nhanh không bắn một request/phím.
 */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
