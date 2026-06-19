import { updateProfileRequestSchema } from "@mediaos/contracts";
import { createZodDto } from "nestjs-zod";

/** DTO suy ra TỪ contracts (Zod = nguồn sự thật) — validate input ở biên. */
export class UpdateProfileDto extends createZodDto(updateProfileRequestSchema) {}
