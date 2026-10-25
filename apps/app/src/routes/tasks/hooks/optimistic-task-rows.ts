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
 */
type Row = { readonly id: string };

export interface TaskRowsSnapshot {
  readonly entries: ReadonlyArray<readonly [QueryKey, unknown]>;
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
  patch: Readonly<Record<string, unknown>>,
): Promise<TaskRowsSnapshot> {
  const prefixes: QueryKey[] = [LIST_PREFIX, taskKeys.my()];
  // Huỷ refetch đang bay: response CŨ về sau sẽ đè mất bản vá lạc quan.
  await Promise.all(prefixes.map((queryKey) => queryClient.cancelQueries({ queryKey })));
  const entries: Array<readonly [QueryKey, unknown]> = [];
  for (const queryKey of prefixes) {
    for (const [key, data] of queryClient.getQueriesData({ queryKey })) {
      if (!isRowArray(data) || !data.some((row) => row.id === taskId)) continue;
      entries.push([key, data]);
      queryClient.setQueryData(
        key,
        data.map((row) => (row.id === taskId ? { ...row, ...patch } : row)),
      );
    }
  }
  return { entries };
}

export function restoreTaskRows(queryClient: QueryClient, snapshot: TaskRowsSnapshot): void {
  for (const [key, data] of snapshot.entries) queryClient.setQueryData(key, data);
}
