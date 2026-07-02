/**
 * useAttendanceAdmin — TanStack Query hooks cho danh mục admin ATT (S3-FE-ATT-5, nối S3-ATT-BE-3 PR #69).
 *
 * Ca làm việc / Gán ca / Rule chấm công: danh mục nhỏ theo company (KHÔNG phân trang server) — list()
 * KHÔNG nhận params. Quy tắc chung với useAttendanceRecords: `enabled` gate bằng useCan/useCanExact ở
 * component (KHÔNG tự gọi bên trong hook — tách biệt concern). company_id do SERVER resolve.
 *
 * CRUD tối thiểu (create/update) nối POST/PATCH đã gated ở AttendanceShiftController; mutation invalidate
 * danh sách tương ứng. Nâng cao (delete/bulk/wizard) = carry-over CO-S4-007.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateShiftRequest,
  UpdateShiftRequest,
  CreateShiftAssignmentRequest,
  CreateRuleRequest,
  UpdateRuleRequest,
} from "@mediaos/contracts";
import { attendanceApi, attendanceKeys } from "@mediaos/web-core";

// ── Queries ───────────────────────────────────────────────────────────────────

export function useShifts(enabled = true) {
  return useQuery({
    queryKey: attendanceKeys.shifts.list(),
    queryFn: () => attendanceApi.listShifts(),
    enabled,
    staleTime: 30_000,
  });
}

export function useShiftAssignments(enabled = true) {
  return useQuery({
    queryKey: attendanceKeys.shiftAssignments.list(),
    queryFn: () => attendanceApi.listShiftAssignments(),
    enabled,
    staleTime: 30_000,
  });
}

export function useAttendanceRules(enabled = true) {
  return useQuery({
    queryKey: attendanceKeys.rules.list(),
    queryFn: () => attendanceApi.listRules(),
    enabled,
    staleTime: 30_000,
  });
}

// ── Mutations (CRUD tối thiểu) ──────────────────────────────────────────────────

export function useCreateShift() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateShiftRequest) => attendanceApi.createShift(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: attendanceKeys.shifts.all }),
    retry: false,
  });
}

export function useUpdateShift() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateShiftRequest }) =>
      attendanceApi.updateShift(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: attendanceKeys.shifts.all }),
    retry: false,
  });
}

export function useCreateShiftAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateShiftAssignmentRequest) => attendanceApi.createShiftAssignment(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: attendanceKeys.shiftAssignments.all }),
    retry: false,
  });
}

export function useCreateRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateRuleRequest) => attendanceApi.createRule(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: attendanceKeys.rules.all }),
    retry: false,
  });
}

export function useUpdateRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateRuleRequest }) =>
      attendanceApi.updateRule(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: attendanceKeys.rules.all }),
    retry: false,
  });
}
