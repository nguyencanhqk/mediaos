import { createZodDto } from "nestjs-zod";
import { createDefectSchema } from "@mediaos/contracts";

export class CreateDefectDto extends createZodDto(createDefectSchema) {}
