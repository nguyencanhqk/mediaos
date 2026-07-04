import { createZodDto } from "nestjs-zod";
import { patchModuleToggleSchema } from "@mediaos/contracts";

/**
 * S2-FND-BE-8 — DTO ranh giới HTTP cho PATCH /foundation/modules/:code. Nguồn sự thật = packages/contracts
 * (foundation/module-catalog.ts patchModuleToggleSchema). Ở đây CHỈ bọc createZodDto cho ZodValidationPipe.
 *
 * BẤT BIẾN: .strict() (ở schema) chặn field lạ (không trust input). CHỈ `enabled` boolean — KHÔNG secret.
 * Rule core-lock (7 module MVP) enforce ở ModuleToggleService (400), KHÔNG ở Zod.
 */
export class PatchModuleToggleDto extends createZodDto(patchModuleToggleSchema) {}
