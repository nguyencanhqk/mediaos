import { createZodDto } from 'nestjs-zod';
import { createPositionSchema, updatePositionSchema } from '@mediaos/contracts';

export class CreatePositionDto extends createZodDto(createPositionSchema) {}
export class UpdatePositionDto extends createZodDto(updatePositionSchema) {}
