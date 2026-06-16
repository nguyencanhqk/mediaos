import { createZodDto } from "nestjs-zod";
import {
  createCompanySchema,
  setSubscriptionSchema,
  updateCompanySchema,
} from "@mediaos/contracts";

/** G16-3 — body DTOs cho platform company management. */
export class CreateCompanyDto extends createZodDto(createCompanySchema) {}
export class UpdateCompanyDto extends createZodDto(updateCompanySchema) {}
export class PlatformSetSubscriptionDto extends createZodDto(setSubscriptionSchema) {}
