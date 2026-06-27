import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../db/db.module";
import { SequenceRepository } from "./sequence.repository";
import { SequenceService } from "./sequence.service";

/**
 * SequenceModule — wires the FOUNDATION-BE-2 SequenceService for its first consumer (S2-HR-BE-2 HR
 * employee-code generation). AuditService comes from the @Global EventsModule. Exports SequenceService
 * so future code-generating modules (leave/document codes, …) can reuse it.
 */
@Module({
  imports: [DatabaseModule],
  providers: [SequenceService, SequenceRepository],
  exports: [SequenceService],
})
export class SequenceModule {}
