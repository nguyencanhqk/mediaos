/**
 * useRetention — TanStack Query hooks cho danh mục Retention Policies (S2-FE-FND-6).
 *
 * Danh mục nhỏ theo company (KHÔNG phân trang server, list() không nhận params). Quy tắc chung với
 * useHolidays: `enabled` gate bằng useCan ở component (KHÔNG tự gọi trong hook).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  foundationInvalidation,
  foundationKeys,
  retentionApi,
  type PatchRetentionPolicyDto,
} from "@mediaos/web-core";

export function useRetentionPolicies(enabled = true) {
  return useQuery({
    queryKey: foundationKeys.retentionPolicies.list(),
    queryFn: () => retentionApi.list(),
    enabled,
    staleTime: 30_000,
  });
}

export function useUpdateRetentionPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: PatchRetentionPolicyDto }) =>
      retentionApi.update(id, body),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: foundationInvalidation.updateRetentionPolicy()[0] }),
    retry: false,
  });
}
