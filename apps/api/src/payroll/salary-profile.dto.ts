import { createZodDto } from "nestjs-zod";
import { createSalaryProfileSchema, updateSalaryProfileSchema } from "@mediaos/contracts";

export class CreateSalaryProfileDto extends createZodDto(createSalaryProfileSchema) {}
export class UpdateSalaryProfileDto extends createZodDto(updateSalaryProfileSchema) {}
