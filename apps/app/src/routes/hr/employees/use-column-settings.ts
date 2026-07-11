import { useMemo } from "react";
import type { VisibilityState } from "@tanstack/react-table";
import { useLocalPref } from "@/hooks/use-local-pref";
import type { EmployeeColumnMeta } from "./employee-table-columns";

const STORAGE_KEY = "mediaos.hr.employees.columns.v1";

/**
 * HR-PROFILE-UI-1 — ẩn/hiện cột bảng hồ sơ, persist localStorage (chỉ preference UI).
 * Lưu OVERRIDE so với default (không lưu full map) → thêm cột mới sau này vẫn nhận defaultVisible.
 */
export function useColumnSettings(catalog: EmployeeColumnMeta[]) {
  const [overrides, setOverrides] = useLocalPref<Record<string, boolean>>(STORAGE_KEY, {});

  const visibility = useMemo<VisibilityState>(() => {
    const state: VisibilityState = {};
    for (const col of catalog) {
      state[col.id] = overrides[col.id] ?? col.defaultVisible;
    }
    return state;
  }, [catalog, overrides]);

  const setVisible = (id: string, visible: boolean) => {
    setOverrides({ ...overrides, [id]: visible });
  };

  const reset = () => setOverrides({});

  return { visibility, setVisible, reset };
}
