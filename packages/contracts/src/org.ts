import { z } from "zod";

/** DTO phòng ban / khối (org_unit). */
export const orgUnitSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  parentId: z.string().uuid().nullable(),
  name: z.string().min(1).max(200),
  type: z.enum(["department", "division"]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type OrgUnitDto = z.infer<typeof orgUnitSchema>;

export const createOrgUnitSchema = z.object({
  name: z.string().min(1).max(200),
  type: z.enum(["department", "division"]).default("department"),
  parentId: z.string().uuid().optional(),
});
export type CreateOrgUnitRequest = z.infer<typeof createOrgUnitSchema>;

/** DTO team / ekip. */
export const teamSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  orgUnitId: z.string().uuid().nullable(),
  name: z.string().min(1).max(200),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type TeamDto = z.infer<typeof teamSchema>;

export const createTeamSchema = z.object({
  name: z.string().min(1).max(200),
  orgUnitId: z.string().uuid().optional(),
});
export type CreateTeamRequest = z.infer<typeof createTeamSchema>;

/** DTO thành viên team. */
export const teamMemberSchema = z.object({
  id: z.string().uuid(),
  teamId: z.string().uuid(),
  userId: z.string().uuid(),
  roleName: z.string().min(1).max(100),
  joinedAt: z.string().datetime(),
  /** Populated khi list members: tên hiển thị user. */
  userFullName: z.string().nullable().optional(),
  userEmail: z.string().email().optional(),
});
export type TeamMemberDto = z.infer<typeof teamMemberSchema>;

export const addTeamMemberSchema = z.object({
  userId: z.string().uuid(),
  roleName: z.string().min(1).max(100).default("member"),
});
export type AddTeamMemberRequest = z.infer<typeof addTeamMemberSchema>;

/** DTO employee (user) kèm team + role info — dùng cho /org/employees. */
export const employeeSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  fullName: z.string().nullable(),
  status: z.string(),
  teams: z.array(
    z.object({
      teamId: z.string().uuid(),
      teamName: z.string(),
      roleName: z.string(),
    }),
  ),
});
export type EmployeeDto = z.infer<typeof employeeSchema>;
