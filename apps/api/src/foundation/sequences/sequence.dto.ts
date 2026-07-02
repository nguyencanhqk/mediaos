import { createZodDto } from "nestjs-zod";
import { patchSequenceSchema } from "@mediaos/contracts";

/**
 * S2-FND-BE-2 — DTO ranh giới HTTP cho SequenceController. Nguồn sự thật = packages/contracts
 * (sequences.ts). Ở đây CHỈ bọc createZodDto cho ZodValidationPipe.
 *
 * BẤT BIẾN: patch .strict() chặn leo thang (id/sequenceKey/currentValue/companyId bất biến). ≥1 field
 * (refine) chống PATCH rỗng ghi audit no-op. KHÔNG secret trong DTO. View mapping làm ở SequenceService
 * (toCounterView — WHITELIST, KHÔNG current_value).
 */
export class PatchSequenceDto extends createZodDto(patchSequenceSchema) {}
