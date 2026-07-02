/**
 * useRemoteWorkRequests — TanStack Query hooks cho đơn làm việc từ xa/công tác (S3-FE-ATT-4).
 *
 * Quy tắc: `enabled` gate bằng useCan/useCanExact ở component (KHÔNG tự gọi bên trong hook).
 * company_id do SERVER resolve — client KHÔNG nhận/forward. STATE-MACHINE (CHỐT 2026-07-02):
 * create → Draft; submit RIÊNG (Draft→Pending, chọn approver + watchers); chỉ Pending mới
 * approve/reject; Draft/Pending mới cancel-own (chủ đơn).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  RemoteWorkRequestListQuery,
  CreateRemoteWorkRequest,
  SubmitRemoteWorkRequest,
  ApproveRemoteWorkRequest,
  RejectRemoteWorkRequest,
} from "@mediaos/contracts";
import { attendanceApi, attendanceKeys, remoteWorkRequestInvalidation } from "@mediaos/web-core";

// ── Queries ───────────────────────────────────────────────────────────────────

export function useMyRemoteWorkRequests(
  params: Partial<RemoteWorkRequestListQuery> = {},
  enabled = true,
) {
  return useQuery({
    queryKey: attendanceKeys.remoteWorkRequests.my(params),
    queryFn: () => attendanceApi.listMyRemoteWorkRequests(params),
    enabled,
    staleTime: 30_000,
  });
}

export function useTeamRemoteWorkRequests(
  params: Partial<RemoteWorkRequestListQuery> = {},
  enabled = true,
) {
  return useQuery({
    queryKey: attendanceKeys.remoteWorkRequests.team(params),
    queryFn: () => attendanceApi.listTeamRemoteWorkRequests(params),
    enabled,
    staleTime: 30_000,
  });
}

export function useCompanyRemoteWorkRequests(
  params: Partial<RemoteWorkRequestListQuery> = {},
  enabled = true,
) {
  return useQuery({
    queryKey: attendanceKeys.remoteWorkRequests.company(params),
    queryFn: () => attendanceApi.listCompanyRemoteWorkRequests(params),
    enabled,
    staleTime: 30_000,
  });
}

export function useRemoteWorkRequestDetail(id: string, enabled = true) {
  return useQuery({
    queryKey: attendanceKeys.remoteWorkRequests.detail(id),
    queryFn: () => attendanceApi.getRemoteWorkRequest(id),
    enabled: enabled && !!id,
    staleTime: 30_000,
  });
}

// ── Mutations ─────────────────────────────────────────────────────────────────

function invalidateAll(qc: ReturnType<typeof useQueryClient>, id: string) {
  return Promise.all(
    remoteWorkRequestInvalidation.mutate(id).map((queryKey) => qc.invalidateQueries({ queryKey })),
  );
}

export function useCreateRemoteWorkRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateRemoteWorkRequest) => attendanceApi.createRemoteWorkRequest(body),
    onSuccess: (dto) => void invalidateAll(qc, dto.id),
    retry: false,
  });
}

export function useSubmitRemoteWorkRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: SubmitRemoteWorkRequest }) =>
      attendanceApi.submitRemoteWorkRequest(id, body),
    onSuccess: (dto) => void invalidateAll(qc, dto.id),
    retry: false,
  });
}

export function useApproveRemoteWorkRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: ApproveRemoteWorkRequest }) =>
      attendanceApi.approveRemoteWorkRequest(id, body),
    onSuccess: (dto) => void invalidateAll(qc, dto.id),
    retry: false,
  });
}

export function useRejectRemoteWorkRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: RejectRemoteWorkRequest }) =>
      attendanceApi.rejectRemoteWorkRequest(id, body),
    onSuccess: (dto) => void invalidateAll(qc, dto.id),
    retry: false,
  });
}

export function useCancelOwnRemoteWorkRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => attendanceApi.cancelOwnRemoteWorkRequest(id),
    onSuccess: (dto) => void invalidateAll(qc, dto.id),
    retry: false,
  });
}
