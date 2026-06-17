import { z } from "zod";
import {
  leaveBalanceSchema,
  leaveRequestSchema,
  leaveTypeSchema,
  type CreateLeaveRequest,
  type LeaveBalanceDto,
  type LeaveRequestDto,
  type LeaveTypeDto,
} from "@mediaos/contracts";
import { apiFetch } from "./client";

/**
 * Leave API client for mobile — self-service routes (list/create own request, own balances, types).
 * Mirrors apps/api/src/leave/leave.controller.ts. Listing requests defaults to scope=me server-side;
 * the client never passes scope=all (that path needs approve/manage and is HR-only). The server gates
 * every route (PermissionGuard, fail-closed) and scopes "own" data by req.user.
 */
export const leaveApi = {
  /** GET /leave/types — active leave types for the tenant (read:leave) — needed to pick a type. */
  listTypes: (): Promise<LeaveTypeDto[]> =>
    apiFetch("/leave/types", z.array(leaveTypeSchema), { authenticated: true }),

  /** GET /leave/requests — the caller's own leave requests (read:leave, scope=me server default). */
  listRequests: (): Promise<LeaveRequestDto[]> =>
    apiFetch("/leave/requests", z.array(leaveRequestSchema), { authenticated: true }),

  /** GET /leave/balances — the caller's own leave balances (read:leave, scope=me server default). */
  listBalances: (): Promise<LeaveBalanceDto[]> =>
    apiFetch("/leave/balances", z.array(leaveBalanceSchema), { authenticated: true }),

  /** POST /leave/requests — create a leave request (create:leave). Server enforces ownership. */
  createRequest: (data: CreateLeaveRequest): Promise<LeaveRequestDto> =>
    apiFetch("/leave/requests", leaveRequestSchema, {
      authenticated: true,
      method: "POST",
      body: JSON.stringify(data),
    }),
};
