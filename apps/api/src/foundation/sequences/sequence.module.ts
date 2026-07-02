import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../db/db.module";
import { PermissionModule } from "../../permission/permission.module";
import { SequenceController } from "./sequence.controller";
import { SequenceRepository } from "./sequence.repository";
import { SequenceService } from "./sequence.service";

/**
 * SequenceModule — wires the FOUNDATION-BE-2 SequenceService for its first consumer (S2-HR-BE-2 HR
 * employee-code generation). AuditService comes from the @Global EventsModule. Exports SequenceService
 * so future code-generating modules (leave/document codes, …) can reuse it.
 *
 * S2-FND-BE-2 (ADDITIVE): SequenceController = admin HTTP ops surface (GET list/preview · PATCH config).
 * PermissionModule imported cho PermissionGuard stack (route gate view/update:foundation-sequence).
 */
@Module({
  imports: [DatabaseModule, PermissionModule],
  controllers: [SequenceController],
  providers: [SequenceService, SequenceRepository],
  exports: [SequenceService],
})
export class SequenceModule {}
