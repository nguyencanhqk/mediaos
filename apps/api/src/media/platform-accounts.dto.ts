import {
  createPlatformAccountSchema,
  listPlatformAccountsQuerySchema,
  reauthRequestSchema,
  updatePlatformAccountSecretSchema,
} from '@mediaos/contracts';
import { createZodDto } from 'nestjs-zod';

/** Request DTOs for PlatformAccountsController — Zod contracts are the single source of truth. */
export class CreatePlatformAccountDto extends createZodDto(createPlatformAccountSchema) {}
export class UpdatePlatformAccountSecretDto extends createZodDto(updatePlatformAccountSecretSchema) {}
export class ReauthDto extends createZodDto(reauthRequestSchema) {}
export class ListPlatformAccountsQueryDto extends createZodDto(listPlatformAccountsQuerySchema) {}
