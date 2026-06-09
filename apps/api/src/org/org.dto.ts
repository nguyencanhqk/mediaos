import {
  addTeamMemberSchema,
  assignTeamLeaderSchema,
  createOrgUnitSchema,
  createTeamSchema,
  updateOrgUnitSchema,
  updateTeamSchema,
} from "@mediaos/contracts";
import { createZodDto } from "nestjs-zod";

export class CreateOrgUnitDto extends createZodDto(createOrgUnitSchema) {}
export class UpdateOrgUnitDto extends createZodDto(updateOrgUnitSchema) {}
export class CreateTeamDto extends createZodDto(createTeamSchema) {}
export class UpdateTeamDto extends createZodDto(updateTeamSchema) {}
export class AssignTeamLeaderDto extends createZodDto(assignTeamLeaderSchema) {}
export class AddTeamMemberDto extends createZodDto(addTeamMemberSchema) {}
