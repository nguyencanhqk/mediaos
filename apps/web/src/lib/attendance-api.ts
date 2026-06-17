import { z } from "zod";
import type {
  CheckInRequest,
  CheckOutRequest,
  CreateAdjustmentRequest,
  CreateWorkScheduleRequest,
  UpdateWorkScheduleRequest,
} from "@mediaos/contracts";
import {
  adjustmentRequestSchema,
  attendancePeriodSchema,
  attendanceTodaySchema,
  attendanceRecordSchema,
  workScheduleSchema,
} from "@mediaos/contracts";
import { apiFetch } from "@mediaos/web-core";

export interface AttendanceMonthFilters {
  month: string;
  userId?: string;
}

export interface AdjustmentFilters {
  status?: string;
  scope?: "me" | "all";
}

function buildAttendanceQuery(filters: AttendanceMonthFilters): string {
  const qs = new URLSearchParams();
  qs.set("month", filters.month);
  if (filters.userId) qs.set("userId", filters.userId);
  return `?${qs.toString()}`;
}

function buildAdjustmentQuery(filters: AdjustmentFilters = {}): string {
  const qs = new URLSearchParams();
  if (filters.status) qs.set("status", filters.status);
  if (filters.scope) qs.set("scope", filters.scope);
  const suffix = qs.toString();
  return suffix ? `?${suffix}` : "";
}

export const attendanceApi = {
  // ── Today ────────────────────────────────────────────────────────────────
  getToday: () => apiFetch("/attendance/today", attendanceTodaySchema),

  checkIn: (data: CheckInRequest) =>
    apiFetch("/attendance/check-in", attendanceTodaySchema, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  checkOut: (data: CheckOutRequest) =>
    apiFetch("/attendance/check-out", attendanceTodaySchema, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  // ── Monthly list ─────────────────────────────────────────────────────────
  listMonthly: (filters: AttendanceMonthFilters) =>
    apiFetch(
      `/attendance${buildAttendanceQuery(filters)}`,
      z.array(attendanceRecordSchema),
    ),

  // ── Schedules ────────────────────────────────────────────────────────────
  listSchedules: () =>
    apiFetch("/attendance/schedules", z.array(workScheduleSchema)),

  createSchedule: (data: CreateWorkScheduleRequest) =>
    apiFetch("/attendance/schedules", workScheduleSchema, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  updateSchedule: (id: string, data: UpdateWorkScheduleRequest) =>
    apiFetch(`/attendance/schedules/${id}`, workScheduleSchema, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  // ── Adjustments ──────────────────────────────────────────────────────────
  listAdjustments: (filters?: AdjustmentFilters) =>
    apiFetch(
      `/attendance/adjustments${buildAdjustmentQuery(filters)}`,
      z.array(adjustmentRequestSchema),
    ),

  createAdjustment: (data: CreateAdjustmentRequest) =>
    apiFetch("/attendance/adjustments", adjustmentRequestSchema, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  approveAdjustment: (id: string, note?: string) =>
    apiFetch(`/attendance/adjustments/${id}/approve`, adjustmentRequestSchema, {
      method: "POST",
      body: JSON.stringify({ note }),
    }),

  rejectAdjustment: (id: string, note?: string) =>
    apiFetch(`/attendance/adjustments/${id}/reject`, adjustmentRequestSchema, {
      method: "POST",
      body: JSON.stringify({ note }),
    }),

  cancelAdjustment: (id: string) =>
    apiFetch(`/attendance/adjustments/${id}/cancel`, z.unknown(), {
      method: "POST",
    }),

  // ── Periods ──────────────────────────────────────────────────────────────
  listPeriods: () =>
    apiFetch("/attendance/periods", z.array(attendancePeriodSchema)),

  lockPeriod: (periodMonth: string) =>
    apiFetch("/attendance/periods/lock", attendancePeriodSchema, {
      method: "POST",
      body: JSON.stringify({ periodMonth }),
    }),
};
