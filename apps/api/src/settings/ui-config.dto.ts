import { createZodDto } from "nestjs-zod";
import {
  putI18nOverridesRequestSchema,
  putUiNavigationRequestSchema,
  updateBrandingRequestSchema,
} from "@mediaos/contracts";

/** AC-4 UI config DTOs — validate input tại boundary (Zod = nguồn sự thật @mediaos/contracts). */
export class UpdateBrandingDto extends createZodDto(updateBrandingRequestSchema) {}
export class PutUiNavigationDto extends createZodDto(putUiNavigationRequestSchema) {}
export class PutI18nOverridesDto extends createZodDto(putI18nOverridesRequestSchema) {}
