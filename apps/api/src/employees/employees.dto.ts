import { createZodDto } from 'nestjs-zod';
import {
  createEmployeeProfileSchema,
  importEmployeeConfirmSchema,
  updateEmployeeProfileSchema,
} from '@mediaos/contracts';

export class CreateEmployeeProfileDto extends createZodDto(createEmployeeProfileSchema) {}
export class UpdateEmployeeProfileDto extends createZodDto(updateEmployeeProfileSchema) {}
export class ImportConfirmDto extends createZodDto(importEmployeeConfirmSchema) {}
