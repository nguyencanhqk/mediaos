import { useCallback, useMemo } from "react";
import { useLocalPref } from "@/hooks/use-local-pref";

/**
 * Tập id lưu localStorage (S5-TASK-NAV-TREE-1) — dùng chung cho trạng thái GẬP của cây sidebar
 * (ModuleSidebar branches + TaskSidebarTree phòng ban). Xây trên useLocalPref (một nguồn xử lý
 * lỗi storage duy nhất) — KHÔNG tự chép logic JSON/try-catch ra từng chỗ.
 */
export function usePersistedSet(storageKey: string): {
  has: (id: string) => boolean;
  toggle: (id: string) => void;
} {
  const [ids, setIds] = useLocalPref<string[]>(storageKey, []);
  const set = useMemo(() => new Set(ids), [ids]);

  const has = useCallback((id: string) => set.has(id), [set]);
  const toggle = useCallback(
    (id: string) => {
      setIds(set.has(id) ? ids.filter((x) => x !== id) : [...ids, id]);
    },
    [set, ids, setIds],
  );

  return { has, toggle };
}
