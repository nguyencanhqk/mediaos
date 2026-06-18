import { z } from "zod";
import type {
  AddTeamMemberRequest,
  CreateOrgUnitRequest,
  CreateTeamRequest,
  UpdateOrgUnitRequest,
  UpdateTeamRequest,
} from "@mediaos/contracts";
import {
  employeeSchema,
  orgTreeNodeSchema,
  orgUnitSchema,
  teamMemberSchema,
  teamSchema,
} from "@mediaos/contracts";
import { apiFetch } from "@mediaos/web-core";

/**
 * Org API client cho apps/console (CS-3 — Cơ cấu tổ chức).
 *
 * Mirror apps/people/src/lib/org-api.ts — cùng endpoint, cùng schema.
 * Đây là TENANT SELF: server ép RLS + withTenant(JWT.companyId).
 */

const voidSchema = z.void();

export const orgApi = {
  // ── Org units (phòng ban / khối) ──────────────────────────────────────────
  listOrgUnits: () => apiFetch("/org/units", z.array(orgUnitSchema)),
  createOrgUnit: (data: CreateOrgUnitRequest) =>
    apiFetch("/org/units", orgUnitSchema, { method: "POST", body: JSON.stringify(data) }),
  updateOrgUnit: (id: string, data: UpdateOrgUnitRequest) =>
    apiFetch(`/org/units/${id}`, orgUnitSchema, { method: "PATCH", body: JSON.stringify(data) }),
  deleteOrgUnit: (id: string) =>
    apiFetch(`/org/units/${id}`, voidSchema, { method: "DELETE" }),
  /** GET /org/units/tree — cây org_unit lồng nhau cho sơ đồ tổ chức. */
  getOrgTree: () => apiFetch("/org/units/tree", z.array(orgTreeNodeSchema)),

  // ── Teams ─────────────────────────────────────────────────────────────────
  listTeams: () => apiFetch("/org/teams", z.array(teamSchema)),
  createTeam: (data: CreateTeamRequest) =>
    apiFetch("/org/teams", teamSchema, { method: "POST", body: JSON.stringify(data) }),
  updateTeam: (id: string, data: UpdateTeamRequest) =>
    apiFetch(`/org/teams/${id}`, teamSchema, { method: "PATCH", body: JSON.stringify(data) }),
  /** PATCH /org/teams/:id/leader — gán team leader. */
  assignTeamLeader: (teamId: string, leaderId: string) =>
    apiFetch(`/org/teams/${teamId}/leader`, teamSchema, {
      method: "PATCH",
      body: JSON.stringify({ leaderId }),
    }),
  listTeamMembers: (teamId: string) =>
    apiFetch(`/org/teams/${teamId}/members`, z.array(teamMemberSchema)),
  addTeamMember: (teamId: string, data: AddTeamMemberRequest) =>
    apiFetch(`/org/teams/${teamId}/members`, teamMemberSchema, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  removeTeamMember: (teamId: string, userId: string) =>
    apiFetch(`/org/teams/${teamId}/members/${userId}`, voidSchema, { method: "DELETE" }),

  // ── Employee picker (trưởng phòng / team leader) ─────────────────────────
  listEmployees: () => apiFetch("/org/employees", z.array(employeeSchema)),
};
