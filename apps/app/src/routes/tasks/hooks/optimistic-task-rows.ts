import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { taskKeys } from "@mediaos/web-core";

/**
 * S20-TASK-QUICKEDIT-1 — vá LẠC QUAN các DÒNG việc đang nằm trong cache danh sách (`tasks/list/*` và
 * `tasks/my`), kèm ảnh chụp để hoàn tác khi server từ chối.
 *
 * Vì sao cần: `useTaskActionMutation` trước đây chỉ vá cache CHI TIẾT. Sửa ngay trên dòng «Việc của
 * tôi» / Danh sách / Quá hạn thì dòng đọc từ cache danh sách — không vá ở đây, badge đứng giá trị cũ
 * cho tới khi refetch xong, và việc không đổi nhóm. Chỉ vá mảng (mọi khoá dưới hai tiền tố này đều là
 * mảng dòng); dữ liệu khác hình bị bỏ qua, không đoán.
 *
 * Hoàn tác đảo ĐÚNG các trường thao tác này đã vá, trên ĐÚNG dòng của nó — không ghi lại cả mảng từ
 * ảnh chụp. Hai thao tác lạc quan có thể chồng nhau (đổi hạn và đổi trạng thái là hai điều khiển khác
 * nhau, nút của cái này không khoá cái kia; hoặc hai dòng khác nhau): ghi lại cả mảng thì thao tác đầu
 * lỗi xoá luôn vá của thao tác đang chờ, còn thao tác sau lỗi hồi sinh vá đã bị server từ chối.
 * Trường nào đã đổi khác giá trị vá (thao tác khác vá đè, hoặc refetch mang dữ liệu mới về) thì để
 * nguyên. Giới hạn còn lại: hai thao tác vá CÙNG một trường cùng giá trị (`isOverdue: false`) thì
 * thao tác lỗi vẫn trả trường đó về cũ — lệch tạm tới khi refetch của `onSettled` về.
 */
type Row = Readonly<Record<string, unknown>> & { readonly id: string };
type RowPatch = Readonly<Record<string, unknown>>;

export interface TaskRowsSnapshot {
  readonly taskId: string;
  readonly patch: RowPatch;
  /** Mỗi cache đã vá ⇒ dòng của việc này TRƯỚC khi vá. */
  readonly entries: ReadonlyArray<readonly [QueryKey, Row]>;
}

const LIST_PREFIX: QueryKey = [...taskKeys.all, "list"];

function isRowArray(data: unknown): data is Row[] {
  return (
    Array.isArray(data) &&
    data.every((r) => typeof r === "object" && r !== null && typeof (r as Row).id === "string")
  );
}

export async function patchTaskRows(
  queryClient: QueryClient,
  taskId: string,
  patch: RowPatch,
): Promise<TaskRowsSnapshot> {
  const prefixes: QueryKey[] = [LIST_PREFIX, taskKeys.my()];
  // Huỷ refetch đang bay: response CŨ về sau sẽ đè mất bản vá lạc quan.
  await Promise.all(prefixes.map((queryKey) => queryClient.cancelQueries({ queryKey })));
  const entries: Array<readonly [QueryKey, Row]> = [];
  for (const queryKey of prefixes) {
    for (const [key, data] of queryClient.getQueriesData({ queryKey })) {
      if (!isRowArray(data)) continue;
      const before = data.find((row) => row.id === taskId);
      if (!before) continue;
      entries.push([key, before]);
      queryClient.setQueryData(
        key,
        data.map((row) => (row.id === taskId ? { ...row, ...patch } : row)),
      );
    }
  }
  return { taskId, patch, entries };
}

/** Đảo các trường của `patch` mà dòng VẪN mang đúng giá trị vá; trường vắng ở bản trước thì bỏ đi. */
function revertRow(row: Row, before: Row, patch: RowPatch): Row {
  const reverted = new Set(
    Object.keys(patch).filter((field) => Object.is(row[field], patch[field])),
  );
  if (reverted.size === 0) return row;
  const kept = Object.entries(row).filter(([field]) => !reverted.has(field));
  const restored = Object.entries(before).filter(([field]) => reverted.has(field));
  return Object.fromEntries([...kept, ...restored]) as Row;
}

export function restoreTaskRows(queryClient: QueryClient, snapshot: TaskRowsSnapshot): void {
  for (const [key, before] of snapshot.entries) {
    const data = queryClient.getQueryData(key);
    if (!isRowArray(data)) continue;
    queryClient.setQueryData(
      key,
      data.map((row) =>
        row.id === snapshot.taskId ? revertRow(row, before, snapshot.patch) : row,
      ),
    );
  }
}
