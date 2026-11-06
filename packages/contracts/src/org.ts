import { z } from "zod";
import { emailSchema } from "./common/email";
import { idSchema } from "./common/id";

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
  id: idSchema,
  companyId: idSchema,
  parentId: idSchema.nullable(),
  name: z.string().min(1).max(200),
  type: orgUnitTypeEnum,
  code: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  headUserId: idSchema.nullable().optional(),
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
  parentId: idSchema.optional(),
  headUserId: idSchema.optional(),
});
export type CreateOrgUnitRequest = z.infer<typeof createOrgUnitSchema>;

export const updateOrgUnitSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  type: orgUnitTypeEnum.optional(),
  code: z.string().max(50).nullable().optional(),
  description: z.string().nullable().optional(),
  parentId: idSchema.nullable().optional(),
  headUserId: idSchema.nullable().optional(),
  status: orgUnitStatusEnum.optional(),
});
export type UpdateOrgUnitRequest = z.infer<typeof updateOrgUnitSchema>;

/** DTO node cây org chart — dùng cho /org/units/tree. */
export const orgTreeNodeSchema: z.ZodType<OrgTreeNode> = z.lazy(() =>
  z.object({
    id: idSchema,
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
  id: idSchema,
  companyId: idSchema,
  orgUnitId: idSchema.nullable(),
  name: z.string().min(1).max(200),
  code: z.string().nullable().optional(),
  type: teamTypeEnum,
  leaderUserId: idSchema.nullable().optional(),
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
  orgUnitId: idSchema.optional(),
  code: z.string().max(50).optional(),
  type: teamTypeEnum.default("production_team"),
  leaderUserId: idSchema.optional(),
  description: z.string().optional(),
  capacity: z.number().int().positive().optional(),
});
export type CreateTeamRequest = z.infer<typeof createTeamSchema>;

export const updateTeamSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  orgUnitId: idSchema.nullable().optional(),
  code: z.string().max(50).nullable().optional(),
  type: teamTypeEnum.optional(),
  leaderUserId: idSchema.nullable().optional(),
  description: z.string().nullable().optional(),
  capacity: z.number().int().positive().nullable().optional(),
  status: teamStatusEnum.optional(),
});
export type UpdateTeamRequest = z.infer<typeof updateTeamSchema>;

export const assignTeamLeaderSchema = z.object({
  leaderId: idSchema,
});
export type AssignTeamLeaderRequest = z.infer<typeof assignTeamLeaderSchema>;

/** DTO thành viên team. */
export const teamMemberSchema = z.object({
  id: idSchema,
  teamId: idSchema,
  userId: idSchema,
  roleName: z.string().min(1).max(100),
  joinedAt: z.string().datetime(),
  userFullName: z.string().nullable().optional(),
  userEmail: emailSchema.optional(),
});
export type TeamMemberDto = z.infer<typeof teamMemberSchema>;

export const addTeamMemberSchema = z.object({
  userId: idSchema,
  roleName: z.string().min(1).max(100).default("member"),
});
export type AddTeamMemberRequest = z.infer<typeof addTeamMemberSchema>;

/** DTO employee (user) kèm team + role info — dùng cho /org/employees (legacy). */
export const employeeSchema = z.object({
  id: idSchema,
  email: emailSchema,
  fullName: z.string().nullable(),
  status: z.string(),
  teams: z.array(
    z.object({
      teamId: idSchema,
      teamName: z.string(),
      roleName: z.string(),
    }),
  ),
});
export type EmployeeDto = z.infer<typeof employeeSchema>;
