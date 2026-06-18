import { createZodDto } from "nestjs-zod";
import { testMailConfigSchema, upsertMailConfigSchema } from "@mediaos/contracts";

export class UpsertMailConfigDto extends createZodDto(upsertMailConfigSchema) {}
export class TestMailConfigDto extends createZodDto(testMailConfigSchema) {}
