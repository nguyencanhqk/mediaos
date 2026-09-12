import * as React from "react";
import type { VisibilityState } from "@tanstack/react-table";
import { useLocalPref } from "./use-local-pref";

/**
 * Bộ cột đang hiện của một bảng — lưu **per-user + per-table** ở client (UI-07 §12.3, DEC-020).
 *
 * ⚠️ **Danh sách `options` là của CALLER, và chỉ được chứa cột user ĐƯỢC PHÉP thấy.** Trường server
 * đã mask (vắng khoá trong payload) phải vắng khỏi cả picker — nếu không, ⚙ trở thành nơi liệt kê
 * tên trường cho đúng người không có quyền đọc trường đó (UI-07 §10.4 mục 10).
 *
 * ⚠️ Cột `locked` (Identity · Actions · cột ghim) KHÔNG tắt được — và luật đó được ép **lúc TÍNH**
 * `visibility`, không chỉ lúc bấm: một `localStorage` cũ còn ghi id nay đã `locked` thì phải bị bỏ
 * qua, chứ không được âm thầm ẩn mất cột định danh của bảng.
 */

export interface ColumnOption {
  /** Trùng `column.id` / `accessorKey` của `DataTable`. */
  id: string;
  /** Nhãn ĐÃ dịch — hiện trong menu ⚙. */
  label: string;
  /** Cột không tắt được (Identity · Actions · cột ghim). */
  locked?: boolean;
  /** Ẩn SẴN ở lần đầu mở bảng (người dùng bật lại được). */
  defaultHidden?: boolean;
}

export interface ColumnVisibilityState {
  /** Truyền thẳng vào `DataTable.columnVisibility`. */
  visibility: VisibilityState;
  /** Id đang ẩn (đã loại cột `locked`). */
  hiddenIds: readonly string[];
  toggle: (id: string) => void;
  reset: () => void;
  /** `true` khi đang ở đúng bộ cột mặc định — dùng để ẩn nút «Mặc định». */
  isDefault: boolean;
}

const STORAGE_PREFIX = "mediaos.table.hiddenColumns:";

export function useColumnVisibility(
  tableKey: string,
  options: readonly ColumnOption[],
): ColumnVisibilityState {
  const defaultHidden = React.useMemo(
    () => options.filter((o) => o.defaultHidden && !o.locked).map((o) => o.id),
    [options],
  );
  const [stored, setStored] = useLocalPref<string[] | null>(`${STORAGE_PREFIX}${tableKey}`, null);

  // `null` = người dùng chưa đụng vào ⇒ dùng bộ mặc định. Mảng rỗng là lựa chọn HỢP LỆ («hiện hết»),
  // nên không thể dùng `[]` làm giá trị «chưa đặt» — phân biệt hai thứ đó bằng `null`.
  const rawHidden = stored ?? defaultHidden;

  const lockedIds = React.useMemo(
    () => new Set(options.filter((o) => o.locked).map((o) => o.id)),
    [options],
  );
  const knownIds = React.useMemo(() => new Set(options.map((o) => o.id)), [options]);

  const hiddenIds = React.useMemo(
    () => rawHidden.filter((id) => knownIds.has(id) && !lockedIds.has(id)),
    [rawHidden, knownIds, lockedIds],
  );

  const visibility = React.useMemo<VisibilityState>(() => {
    const next: VisibilityState = {};
    for (const id of hiddenIds) next[id] = false;
    return next;
  }, [hiddenIds]);

  const toggle = React.useCallback(
    (id: string) => {
      if (lockedIds.has(id)) return;
      /**
       * Ghi từ `rawHidden` (bản THÔ), KHÔNG từ `hiddenIds` (bản đã lọc theo `options` lần này).
       *
       * `options` của một bảng có thể TẠM hẹp lại: màn hồ sơ lương bỏ cột tiền khỏi picker khi
       * trang rỗng (fail-closed masking). Nếu ghi đè bằng danh sách đã lọc, chỉ cần người dùng bấm
       * một cột KHÁC trong lúc đó là lựa chọn của cột tiền bị **xoá khỏi localStorage** — và họ
       * không hề chạm vào nó. Giữ id lạ lại thì chúng vẫn bị `hiddenIds` lọc lúc đọc, nên không
       * sinh khoá rác cho `DataTable`.
       */
      const set = new Set(rawHidden.filter((x) => !lockedIds.has(x)));
      if (set.has(id)) set.delete(id);
      else set.add(id);
      setStored([...set]);
    },
    [rawHidden, lockedIds, setStored],
  );

  const reset = React.useCallback(() => setStored(null), [setStored]);

  const isDefault =
    stored === null ||
    (hiddenIds.length === defaultHidden.length &&
      hiddenIds.every((id) => defaultHidden.includes(id)));

  return { visibility, hiddenIds, toggle, reset, isDefault };
}
