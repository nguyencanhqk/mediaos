import { addTeamMemberSchema, createOrgUnitSchema, createTeamSchema } from "@mediaos/contracts";
import { createZodDto } from "nestjs-zod";

export class CreateOrgUnitDto extends createZodDto(createOrgUnitSchema) {}
export class CreateTeamDto extends createZodDto(createTeamSchema) {}
export class AddTeamMemberDto extends createZodDto(addTeamMemberSchema) {}
