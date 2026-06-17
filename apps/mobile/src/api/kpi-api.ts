import { z } from "zod";
import {
  kpiDefinitionSchema,
  kpiResultSchema,
  type ComputeKpiRequest,
  type KpiDefinitionDto,
  type KpiResultDto,
} from "@mediaos/contracts";
import { apiFetch } from "./client";

/**
 * KPI API client for mobile — personal read-only. Mirrors apps/api/src/kpi/kpi.controller.ts.
 *
 * The backend has NO "list my KPI results" endpoint. The only read route is POST /kpi/compute
 * (gated read:kpi) which computes the caller's own snapshot for a chosen definition + period. So the
 * personal-KPI screen: lists active definitions (GET /kpi/definitions) then computes the OWN result
 * (subjectUserId = self) for the current month. The server gates read:kpi (fail-closed) — an employee
 * without it gets a generic 403, which the screen surfaces as a permission message (no leak). No
 * migration / no API change — both routes already exist.
 */
export const kpiApi = {
  /** GET /kpi/definitions — active KPI definitions for the tenant (ungated read; RLS-scoped). */
  listDefinitions: (): Promise<KpiDefinitionDto[]> =>
    apiFetch("/kpi/definitions", z.array(kpiDefinitionSchema), { authenticated: true }),

  /**
   * POST /kpi/compute — compute a KPI snapshot for one subject in a period (read:kpi). The screen
   * always passes subjectUserId = the caller's own id, so this reads only the caller's own KPI.
   */
  compute: (data: ComputeKpiRequest): Promise<KpiResultDto> =>
    apiFetch("/kpi/compute", kpiResultSchema, {
      authenticated: true,
      method: "POST",
      body: JSON.stringify(data),
    }),
};
