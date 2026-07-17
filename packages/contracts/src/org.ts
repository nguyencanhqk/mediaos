import { z } from "zod";

const orgUnitTypeEnum = z.enum(["department", "division", "unit", "office", "branch"]);
const orgUnitStatusEnum = z.enum(["active", "inactive"]);
const teamTypeEnum = z.enum([
  "production_team",
  "script_team",
  "editor_team",
  "thumbnail_team",
  "seo_team",
  "qa_team",
  "project_team",
  "office_team",
]);
const teamStatusEnum = z.enum(["active", "inactive"]);

/** DTO phòng ban / khối (org_unit) — G5-2 mở rộng. */
export const orgUnitSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  parentId: z.string().uuid().nullable(),
  name: z.string().min(1).max(200),
  type: orgUnitTypeEnum,
  code: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  headUserId: z.string().uuid().nullable().optional(),
  headUserName: z.string().nullable().optional(),
  status: orgUnitStatusEnum,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type OrgUnitDto = z.infer<typeof orgUnitSchema>;

export const createOrgUnitSchema = z.object({
  name: z.string().min(1).max(200),
  type: orgUnitTypeEnum.default("department"),
  code: z.string().max(50).optional(),
  description: z.string().optional(),
  parentId: z.string().uuid().optional(),
  headUserId: z.string().uuid().optional(),
});
export type CreateOrgUnitRequest = z.infer<typeof createOrgUnitSchema>;

export const updateOrgUnitSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  type: orgUnitTypeEnum.optional(),
  code: z.string().max(50).nullable().optional(),
  description: z.string().nullable().optional(),
  parentId: z.string().uuid().nullable().optional(),
  headUserId: z.string().uuid().nullable().optional(),
  status: orgUnitStatusEnum.optional(),
});
export type UpdateOrgUnitRequest = z.infer<typeof updateOrgUnitSchema>;

/** DTO node cây org chart — dùng cho /org/units/tree. */
export const orgTreeNodeSchema: z.ZodType<OrgTreeNode> = z.lazy(() =>
  z.object({
    id: z.string().uuid(),
    name: z.string(),
    type: orgUnitTypeEnum,
    code: z.string().nullable().optional(),
    status: orgUnitStatusEnum,
    headUserName: z.string().nullable().optional(),
    // S5-HR-ORGCHART-BE-1 (additive): headcount employee ACTIVE trực tiếp trong đơn vị (không rollup subtree).
    // OPTIONAL để additive thật sự (không phá literal `OrgTreeNode` cũ ở consumer); BE luôn populate (?? 0).
    employeeCount: z.number().int().nonnegative().optional(),
    children: z.array(orgTreeNodeSchema),
  }),
);
export type OrgTreeNode = {
  id: string;
  name: string;
  type: "department" | "division" | "unit" | "office" | "branch";
  code?: string | null;
  status: "active" | "inactive";
  headUserName?: string | null;
  employeeCount?: number;
  children: OrgTreeNode[];
};

/** DTO team / ekip — G5-3 mở rộng. */
export const teamSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  orgUnitId: z.string().uuid().nullable(),
  name: z.string().min(1).max(200),
  code: z.string().nullable().optional(),
  type: teamTypeEnum,
  leaderUserId: z.string().uuid().nullable().optional(),
  leaderUserName: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  capacity: z.number().int().nullable().optional(),
  status: teamStatusEnum,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type TeamDto = z.infer<typeof teamSchema>;

export const createTeamSchema = z.object({
  name: z.string().min(1).max(200),
  orgUnitId: z.string().uuid().optional(),
  code: z.string().max(50).optional(),
  type: teamTypeEnum.default("production_team"),
  leaderUserId: z.string().uuid().optional(),
  description: z.string().optional(),
  capacity: z.number().int().positive().optional(),
});
export type CreateTeamRequest = z.infer<typeof createTeamSchema>;

export const updateTeamSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  orgUnitId: z.string().uuid().nullable().optional(),
  code: z.string().max(50).nullable().optional(),
  type: teamTypeEnum.optional(),
  leaderUserId: z.string().uuid().nullable().optional(),
  description: z.string().nullable().optional(),
  capacity: z.number().int().positive().nullable().optional(),
  status: teamStatusEnum.optional(),
});
export type UpdateTeamRequest = z.infer<typeof updateTeamSchema>;

export const assignTeamLeaderSchema = z.object({
  leaderId: z.string().uuid(),
});
export type AssignTeamLeaderRequest = z.infer<typeof assignTeamLeaderSchema>;

/** DTO thành viên team. */
export const teamMemberSchema = z.object({
  id: z.string().uuid(),
  teamId: z.string().uuid(),
  userId: z.string().uuid(),
  roleName: z.string().min(1).max(100),
  joinedAt: z.string().datetime(),
  userFullName: z.string().nullable().optional(),
  userEmail: z.string().email().optional(),
});
export type TeamMemberDto = z.infer<typeof teamMemberSchema>;

export const addTeamMemberSchema = z.object({
  userId: z.string().uuid(),
  roleName: z.string().min(1).max(100).default("member"),
});
export type AddTeamMemberRequest = z.infer<typeof addTeamMemberSchema>;

/** DTO employee (user) kèm team + role info — dùng cho /org/employees (legacy). */
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
