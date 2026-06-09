import { createZodDto } from "nestjs-zod";
import { createCommentSchema } from "@mediaos/contracts";

export class CreateCommentDto extends createZodDto(createCommentSchema) {}
