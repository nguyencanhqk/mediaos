/**
 * useHolidays — TanStack Query hooks cho danh mục Public Holidays (S2-FE-FND-4).
 *
 * Danh mục nhỏ theo company/năm (KHÔNG phân trang server, list() nhận params year/month). Quy tắc chung
 * với useAttendanceAdmin: `enabled` gate bằng useCan ở component (KHÔNG tự gọi trong hook). CRUD chỉ áp
 * dụng cho holiday scope 'company' (server chặn sửa/xoá holiday 'global').
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  foundationInvalidation,
  foundationKeys,
  holidayApi,
  type CreateHolidayBody,
  type HolidayListParams,
  type UpdateHolidayBody,
} from "@mediaos/web-core";

export function useHolidays(params: HolidayListParams, enabled = true) {
  return useQuery({
    queryKey: foundationKeys.holidays.list({ ...params }),
    queryFn: () => holidayApi.list(params),
    enabled,
    staleTime: 30_000,
  });
}

export function useCreateHoliday() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateHolidayBody) => holidayApi.create(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: foundationInvalidation.createHoliday()[0] }),
    retry: false,
  });
}

export function useUpdateHoliday() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateHolidayBody }) =>
      holidayApi.update(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: foundationInvalidation.updateHoliday()[0] }),
    retry: false,
  });
}

export function useDeleteHoliday() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => holidayApi.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: foundationInvalidation.deleteHoliday()[0] }),
    retry: false,
  });
}
