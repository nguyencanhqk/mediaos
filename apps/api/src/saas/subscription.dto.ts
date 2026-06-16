import { createZodDto } from "nestjs-zod";
import {
  setFeatureFlagSchema,
  setSubscriptionSchema,
  setUsageLimitSchema,
} from "@mediaos/contracts";

/** G16-3 — body DTOs cho subscription self-service + platform set. */
export class SetSubscriptionDto extends createZodDto(setSubscriptionSchema) {}
export class SetFeatureFlagDto extends createZodDto(setFeatureFlagSchema) {}
export class SetUsageLimitDto extends createZodDto(setUsageLimitSchema) {}
