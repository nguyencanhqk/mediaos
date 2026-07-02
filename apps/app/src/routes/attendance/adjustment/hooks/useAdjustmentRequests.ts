/**
 * useAdjustmentRequests — TanStack Query hooks cho đơn điều chỉnh công (S3-FE-ATT-3, S3-ATT-BE-4).
 *
 * Quy tắc: KHÔNG gate `enabled` bằng useCan trên các cặp sensitive-KHÔNG-allowlisted (xem constants.ts) —
 * caller truyền `enabled` theo nhu cầu UI (vd tab đang active), KHÔNG theo permission. company_id do SERVER
 * resolve từ auth context — client KHÔNG nhận/forward.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AdjustmentListQuery,
  ApproveAdjustmentRequest,
  CreateAdjustmentRequest,
  DirectAdjustRequest,
  RejectAdjustmentRequest,
} from "@mediaos/contracts";
import { attendanceApi, attendanceKeys, attendanceInvalidation } from "@mediaos/web-core";

// ── Danh sách (Own / Team / Company) ───────────────────────────────────────────

export function useMyAdjustmentRequests(params: Partial<AdjustmentListQuery> = {}, enabled = true) {
  return useQuery({
    queryKey: attendanceKeys.adjustments.my(params),
    queryFn: () => attendanceApi.listMyAdjustmentRequests(params),
    enabled,
    staleTime: 15_000,
  });
}

export function useTeamAdjustmentRequests(
  params: Partial<AdjustmentListQuery> = {},
  enabled = true,
) {
  return useQuery({
    queryKey: attendanceKeys.adjustments.team(params),
    queryFn: () => attendanceApi.listTeamAdjustmentRequests(params),
    enabled,
    staleTime: 15_000,
  });
}

export function useCompanyAdjustmentRequests(
  params: Partial<AdjustmentListQuery> = {},
  enabled = true,
) {
  return useQuery({
    queryKey: attendanceKeys.adjustments.company(params),
    queryFn: () => attendanceApi.listCompanyAdjustmentRequests(params),
    enabled,
    staleTime: 15_000,
  });
}

// ── Chi tiết ────────────────────────────────────────────────────────────────────

export function useAdjustmentRequestDetail(id: string, enabled = true) {
  return useQuery({
    queryKey: attendanceKeys.adjustments.detail(id),
    queryFn: () => attendanceApi.getAdjustmentRequest(id),
    enabled: enabled && !!id,
    staleTime: 15_000,
  });
}

// ── Mutations ───────────────────────────────────────────────────────────────────

export function useCreateAdjustmentRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateAdjustmentRequest) => attendanceApi.createAdjustmentRequest(body),
    onSuccess: () => {
      for (const queryKey of attendanceInvalidation.createAdjustment()) {
        void queryClient.invalidateQueries({ queryKey });
      }
    },
  });
}

export function useApproveAdjustmentRequest(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ApproveAdjustmentRequest) =>
      attendanceApi.approveAdjustmentRequest(id, body),
    onSuccess: () => {
      for (const queryKey of attendanceInvalidation.approveAdjustment(id)) {
        void queryClient.invalidateQueries({ queryKey });
      }
    },
  });
}

export function useRejectAdjustmentRequest(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: RejectAdjustmentRequest) => attendanceApi.rejectAdjustmentRequest(id, body),
    onSuccess: () => {
      for (const queryKey of attendanceInvalidation.rejectAdjustment(id)) {
        void queryClient.invalidateQueries({ queryKey });
      }
    },
  });
}

export function useAdjustRecordDirect(recordId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: DirectAdjustRequest) => attendanceApi.adjustRecordDirect(recordId, body),
    onSuccess: () => {
      for (const queryKey of attendanceInvalidation.adjustDirect(recordId)) {
        void queryClient.invalidateQueries({ queryKey });
      }
    },
  });
}
