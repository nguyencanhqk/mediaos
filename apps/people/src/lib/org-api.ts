import { z } from "zod";
import type {
  AddTeamMemberRequest,
  CreateOrgUnitRequest,
  CreateTeamRequest,
  UpdateOrgUnitRequest,
} from "@mediaos/contracts";
import {
  employeeSchema,
  orgTreeNodeSchema,
  orgUnitSchema,
  teamMemberSchema,
  teamSchema,
} from "@mediaos/contracts";
import { apiFetch } from "@mediaos/web-core";

const voidSchema = z.void();

export const orgApi = {
  // ── Org units (phòng ban / khối) ───────────────────────────────────────────
  listDepartments: () => apiFetch("/org/departments", z.array(orgUnitSchema)),
  createDepartment: (data: CreateOrgUnitRequest) =>
    apiFetch("/org/departments", orgUnitSchema, { method: "POST", body: JSON.stringify(data) }),
  /** PATCH /org/units/:id — toggle status, gán trưởng phòng (headUserId), v.v. */
  updateOrgUnit: (id: string, data: UpdateOrgUnitRequest) =>
    apiFetch(`/org/units/${id}`, orgUnitSchema, { method: "PATCH", body: JSON.stringify(data) }),
  /** GET /org/units/tree — cây org_unit lồng nhau cho sơ đồ tổ chức. */
  getOrgTree: () => apiFetch("/org/units/tree", z.array(orgTreeNodeSchema)),

  // ── Teams ──────────────────────────────────────────────────────────────────
  listTeams: () => apiFetch("/org/teams", z.array(teamSchema)),
  createTeam: (data: CreateTeamRequest) =>
    apiFetch("/org/teams", teamSchema, { method: "POST", body: JSON.stringify(data) }),
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

  // ── Người dùng (picker trưởng phòng / team leader) ───────────────────────────
  listEmployees: () => apiFetch("/org/employees", z.array(employeeSchema)),
};
