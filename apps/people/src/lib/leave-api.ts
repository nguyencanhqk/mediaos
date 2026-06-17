import { z } from "zod";
import type {
  CreateLeaveRequest,
  CreateLeaveTypeRequest,
  UpdateLeaveTypeRequest,
  UpsertLeaveBalanceRequest,
} from "@mediaos/contracts";
import {
  leaveBalanceSchema,
  leaveCalendarEntrySchema,
  leaveRequestSchema,
  leaveTypeSchema,
} from "@mediaos/contracts";
import { apiFetch } from "@mediaos/web-core";

export interface LeaveRequestFilters {
  status?: string;
  scope?: "me" | "all";
  year?: number;
}

export interface LeaveBalanceFilters {
  scope?: "me" | "all";
  year?: number;
}

function buildLeaveQuery(filters: LeaveRequestFilters = {}): string {
  const qs = new URLSearchParams();
  if (filters.status) qs.set("status", filters.status);
  if (filters.scope) qs.set("scope", filters.scope);
  if (filters.year != null) qs.set("year", String(filters.year));
  const suffix = qs.toString();
  return suffix ? `?${suffix}` : "";
}

export const leaveApi = {
  // ── Leave types ───────────────────────────────────────────────────────────
  listTypes: () => apiFetch("/leave/types", z.array(leaveTypeSchema)),

  createType: (data: CreateLeaveTypeRequest) =>
    apiFetch("/leave/types", leaveTypeSchema, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  updateType: (id: string, data: UpdateLeaveTypeRequest) =>
    apiFetch(`/leave/types/${id}`, leaveTypeSchema, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  // ── Leave balances ────────────────────────────────────────────────────────
  listBalances: (filters?: LeaveBalanceFilters) =>
    apiFetch(`/leave/balances${buildLeaveQuery(filters)}`, z.array(leaveBalanceSchema)),

  upsertBalance: (data: UpsertLeaveBalanceRequest) =>
    apiFetch("/leave/balances", leaveBalanceSchema, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  // ── Leave requests ────────────────────────────────────────────────────────
  listRequests: (filters?: LeaveRequestFilters) =>
    apiFetch(`/leave/requests${buildLeaveQuery(filters)}`, z.array(leaveRequestSchema)),

  createRequest: (data: CreateLeaveRequest) =>
    apiFetch("/leave/requests", leaveRequestSchema, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  approveRequest: (id: string, note?: string) =>
    apiFetch(`/leave/requests/${id}/approve`, leaveRequestSchema, {
      method: "POST",
      body: JSON.stringify({ note }),
    }),

  rejectRequest: (id: string, note?: string) =>
    apiFetch(`/leave/requests/${id}/reject`, leaveRequestSchema, {
      method: "POST",
      body: JSON.stringify({ note }),
    }),

  cancelRequest: (id: string) =>
    apiFetch(`/leave/requests/${id}/cancel`, z.unknown(), { method: "POST" }),

  // ── Team calendar ─────────────────────────────────────────────────────────
  listCalendar: (month: string) =>
    apiFetch(`/leave/calendar?month=${encodeURIComponent(month)}`, z.array(leaveCalendarEntrySchema)),
};
