import { useQueries } from "@tanstack/react-query";
import type { LeaveManagementListItemView } from "@mediaos/contracts";
import { leaveApi, leaveKeys } from "@mediaos/web-core";

/** BE pageSize tối đa (pendingLeaveRequestListQuerySchema.pageSize max 100). */
const MERGE_PAGE_SIZE = 100;

export interface UseAllLeaveRequestsParams {
  /** 1+ trạng thái cần gộp — GET /leave/requests CHỈ lọc ĐÚNG 1 status/lần gọi (BE chưa hỗ trợ "tất cả"). */
  statuses: readonly string[];
  leaveTypeId?: string;
  fromDate?: string;
  toDate?: string;
  enabled: boolean;
}

export interface UseAllLeaveRequestsResult {
  items: LeaveManagementListItemView[];
  isLoading: boolean;
  /** true CHỈ khi MỌI status đều lỗi (best-effort: 1 status lỗi vẫn hiển thị phần còn lại). */
  isError: boolean;
  refetchAll: () => void;
}

/**
 * GET /leave/requests (LeaveApprovalService.listPending) luôn where status = filters.status (mặc định
 * 'Pending' khi bỏ trống) — KHÔNG có sentinel "mọi trạng thái" (apps/api/src/leave/leave-approval.repository.ts
 * pendingConds). Màn "Tất cả đơn nghỉ phép" (LEAVE-SCREEN-006) cần hiển thị MỌI trạng thái mặc định; thay vì sửa
 * BE (ngoài phạm vi lane FE), hook này gọi SONG SONG 1 request/status rồi merge + sort desc theo
 * submittedAt‖createdAt. Giới hạn: mỗi status tối đa 100 dòng (pageSize max của BE) — đủ quy mô MVP hiện tại;
 * phân trang hiển thị (page/pageSize UI) làm CLIENT-SIDE trên tập đã merge ở component gọi hook này.
 */
export function useAllLeaveRequests(params: UseAllLeaveRequestsParams): UseAllLeaveRequestsResult {
  const { statuses, leaveTypeId, fromDate, toDate, enabled } = params;

  const queries = useQueries({
    queries: statuses.map((status) => ({
      queryKey: leaveKeys.requests.list({
        scope: "all-merged",
        status,
        leaveTypeId,
        fromDate,
        toDate,
      }),
      queryFn: () =>
        leaveApi.listRequests({
          status,
          leaveTypeId,
          fromDate,
          toDate,
          page: 1,
          pageSize: MERGE_PAGE_SIZE,
        }),
      enabled,
      staleTime: 30_000,
    })),
  });

  const isLoading = enabled && queries.some((q) => q.isLoading);
  const isError = enabled && queries.length > 0 && queries.every((q) => q.isError);

  const items = queries
    .flatMap((q) => q.data?.items ?? [])
    .sort((a, b) => {
      const at = a.submittedAt ?? a.createdAt;
      const bt = b.submittedAt ?? b.createdAt;
      return bt.localeCompare(at);
    });

  return {
    items,
    isLoading,
    isError,
    refetchAll: () => {
      for (const q of queries) void q.refetch();
    },
  };
}
