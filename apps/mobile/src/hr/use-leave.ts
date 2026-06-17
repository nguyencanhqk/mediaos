import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateLeaveRequest } from "@mediaos/contracts";
import { leaveApi } from "../api/leave-api";

/** Query keys — namespaced so leave cache is isolated from tasks/attendance. */
export const LEAVE_REQUESTS_KEY = ["leave", "requests", "mine"] as const;
export const LEAVE_BALANCES_KEY = ["leave", "balances", "mine"] as const;
export const LEAVE_TYPES_KEY = ["leave", "types"] as const;

/** GET /leave/requests — the caller's own requests. */
export function useMyLeaveRequests() {
  return useQuery({ queryKey: LEAVE_REQUESTS_KEY, queryFn: leaveApi.listRequests });
}

/** GET /leave/balances — the caller's own balances. */
export function useMyLeaveBalances() {
  return useQuery({ queryKey: LEAVE_BALANCES_KEY, queryFn: leaveApi.listBalances });
}

/** GET /leave/types — active leave types (for the create form's picker). */
export function useLeaveTypes() {
  return useQuery({ queryKey: LEAVE_TYPES_KEY, queryFn: leaveApi.listTypes });
}

/** POST /leave/requests — invalidates the request list + balances (approve later deducts). */
export function useCreateLeaveRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateLeaveRequest) => leaveApi.createRequest(data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: LEAVE_REQUESTS_KEY });
      void qc.invalidateQueries({ queryKey: LEAVE_BALANCES_KEY });
    },
  });
}
