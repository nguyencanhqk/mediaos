import { createZodDto } from "nestjs-zod";
import { aiInsightQuerySchema } from "@mediaos/contracts";

/** DTO từ contracts Zod (nguồn sự thật). ZodValidationPipe parse/reject + default ở boundary. */
export class AiInsightQueryDto extends createZodDto(aiInsightQuerySchema) {}
