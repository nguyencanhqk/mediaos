import { createZodDto } from "nestjs-zod";
import { createEmployeeProfileSchema, updateEmployeeProfileSchema } from "@mediaos/contracts";

export class CreateEmployeeProfileDto extends createZodDto(createEmployeeProfileSchema) {}
export class UpdateEmployeeProfileDto extends createZodDto(updateEmployeeProfileSchema) {}
