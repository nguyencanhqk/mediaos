import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ApproveRequest,
  RequestRevisionRequest,
  SubmitStepRequest,
} from "@mediaos/contracts";
import { workflowApi } from "../api/workflow-api";
import { MY_TASKS_KEY } from "./use-tasks";

export const APPROVALS_KEY = ["workflow", "approval-requests"] as const;

/** GET /workflow/approval-requests — server-scoped to the caller's pending approvals. */
export function useApprovalRequests() {
  return useQuery({ queryKey: APPROVALS_KEY, queryFn: workflowApi.listApprovalRequests });
}

/**
 * POST /workflow/steps/:stepId/submit — submit work; refresh my-tasks so status flips.
 * `stepId` is passed as a mutation variable (not closed over) so the call always targets the CURRENT
 * step even if the task re-fetches and advances between renders.
 */
export function useSubmitStep() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ stepId, data }: { stepId: string; data: SubmitStepRequest }) =>
      workflowApi.submitStep(stepId, data),
    onSuccess: () => void qc.invalidateQueries({ queryKey: MY_TASKS_KEY }),
  });
}

/** POST /workflow/steps/:stepId/start. `stepId` is a mutation variable (see useSubmitStep). */
export function useStartStep() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (stepId: string) => workflowApi.startStep(stepId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: MY_TASKS_KEY }),
  });
}

/** POST /workflow/approval-requests/:id/approve. */
export function useApprove(requestId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: ApproveRequest) => workflowApi.approve(requestId, data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: APPROVALS_KEY });
      void qc.invalidateQueries({ queryKey: MY_TASKS_KEY });
    },
  });
}

/** POST /workflow/approval-requests/:id/request-revision. */
export function useRequestRevision(requestId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: RequestRevisionRequest) => workflowApi.requestRevision(requestId, data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: APPROVALS_KEY });
      void qc.invalidateQueries({ queryKey: MY_TASKS_KEY });
    },
  });
}
