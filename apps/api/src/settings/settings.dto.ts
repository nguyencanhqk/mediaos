import { createZodDto } from 'nestjs-zod';
import { updateCompanySettingsSchema } from '@mediaos/contracts';

export class UpdateCompanySettingsDto extends createZodDto(updateCompanySettingsSchema) {}
