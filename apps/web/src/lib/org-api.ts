import { z } from "zod";
import type { CreateOrgUnitRequest, CreateTeamRequest, AddTeamMemberRequest } from "@mediaos/contracts";
import {
  orgUnitSchema,
  teamSchema,
  teamMemberSchema,
  employeeSchema,
} from "@mediaos/contracts";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3100/api/v1";

async function apiFetch<T>(
  path: string,
  schema: z.ZodType<T>,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${path}: ${body}`);
  }
  const json: unknown = await res.json();
  return schema.parse(json);
}

const voidSchema = z.void();

export const orgApi = {
  listDepartments: () =>
    apiFetch("/org/departments", z.array(orgUnitSchema)),
  createDepartment: (data: CreateOrgUnitRequest) =>
    apiFetch("/org/departments", orgUnitSchema, { method: "POST", body: JSON.stringify(data) }),

  listTeams: () =>
    apiFetch("/org/teams", z.array(teamSchema)),
  createTeam: (data: CreateTeamRequest) =>
    apiFetch("/org/teams", teamSchema, { method: "POST", body: JSON.stringify(data) }),

  listTeamMembers: (teamId: string) =>
    apiFetch(`/org/teams/${teamId}/members`, z.array(teamMemberSchema)),
  addTeamMember: (teamId: string, data: AddTeamMemberRequest) =>
    apiFetch(`/org/teams/${teamId}/members`, teamMemberSchema, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  removeTeamMember: (teamId: string, userId: string) =>
    apiFetch(`/org/teams/${teamId}/members/${userId}`, voidSchema, { method: "DELETE" }),

  listEmployees: () =>
    apiFetch("/org/employees", z.array(employeeSchema)),
};
