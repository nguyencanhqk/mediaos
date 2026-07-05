import { createZodDto } from "nestjs-zod";
import {
  patchCompanySettingSchema,
  patchSystemSettingSchema,
  publicQuerySchema,
  resolveBodySchema,
  systemSettingsQuerySchema,
} from "@mediaos/contracts";

/**
 * S1-FND-SETTING-1 / S2-FND-CONTRACT-1 — Zod DTO cho SettingService. Schema là NGUỒN SỰ THẬT ở
 * packages/contracts (foundation/settings.ts) — file này CHỈ re-export schema/type + bọc `createZodDto`
 * (nestjs-zod là dep của api, KHÔNG của contracts). KHÔNG khai báo schema cục bộ để tránh drift (CLAUDE §4).
 */

export {
  SETTING_VALUE_TYPES,
  valueTypeEnum,
  settingStatusEnum,
  publicQuerySchema,
  resolveBodySchema,
  resolveQuerySchema,
  patchCompanySettingSchema,
  systemSettingsQuerySchema,
  patchSystemSettingSchema,
} from "@mediaos/contracts";
export type {
  SettingValueType,
  PublicQuery,
  ResolveBody,
  ResolveQuery,
  PatchCompanySettingInput,
  SystemSettingsQuery,
  PatchSystemSettingInput,
} from "@mediaos/contracts";

export class PublicQueryDto extends createZodDto(publicQuerySchema) {}
export class ResolveBodyDto extends createZodDto(resolveBodySchema) {}
export class PatchCompanySettingDto extends createZodDto(patchCompanySettingSchema) {}
export class SystemSettingsQueryDto extends createZodDto(systemSettingsQuerySchema) {}
export class PatchSystemSettingDto extends createZodDto(patchSystemSettingSchema) {}
