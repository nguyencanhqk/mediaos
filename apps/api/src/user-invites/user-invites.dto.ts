import { createZodDto } from "nestjs-zod";
import { acceptInviteSchema, createUserInviteSchema } from "@mediaos/contracts";

export class CreateUserInviteDto extends createZodDto(createUserInviteSchema) {}
export class AcceptInviteDto extends createZodDto(acceptInviteSchema) {}
