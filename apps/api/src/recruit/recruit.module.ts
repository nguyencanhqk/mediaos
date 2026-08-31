import { Module, type OnModuleInit } from "@nestjs/common";
import { FilePolicyService } from "../foundation/files/file-policy.service";
import { FilesModule } from "../foundation/files/files.module";
import { EmployeesModule } from "../employees/employees.module";
import { PermissionModule } from "../permission/permission.module";
import { CandidatesRepository } from "./candidates.repository";
import { CandidatesService } from "./candidates.service";
import { InterviewsRepository } from "./interviews.repository";
import { InterviewsService } from "./interviews.service";
import { JobOpeningsRepository } from "./job-openings.repository";
import { JobOpeningsService } from "./job-openings.service";
import { OffersRepository } from "./offers.repository";
import { OffersService } from "./offers.service";
import { RecruitAccessService } from "./recruit-access.service";
import { RecruitCandidateFileResolver } from "./recruit-candidate-file.resolver";
import { RecruitConvertService } from "./recruit-convert.service";
import { RecruitPeopleRepository } from "./recruit-people.repository";
import {
  CandidatesController,
  InterviewsController,
  JobOpeningsController,
  OffersController,
  RecruitPickersController,
} from "./recruit.controllers";

/**
 * S12-RECRUIT-BE-1 — RecruitModule (SPEC-12 · DB-14 · API-17).
 *
 * imports: PermissionModule (PermissionGuard + DataScopeService — guard 2 tầng §11) ·
 * EmployeesModule (HrWriteService: `allocateEmployeeCode` + `createEmployeeFromCandidateTx` cho
 * convert §13.5 — KHÔNG gọi `createEmployee`) · FilesModule (FilePolicyService — đăng ký resolver
 * CV, additive). AuditService + OutboxService từ EventsModule @Global.
 *
 * NOTI: registrar 4 event sống ở `notifications/**` (tiền lệ GOAL/ASSET) — module này KHÔNG import
 * NotificationsModule và ngược lại. Module `RECRUIT` vẫn `inactive` (FE-1 mới bật cờ).
 */
@Module({
  imports: [PermissionModule, EmployeesModule, FilesModule],
  controllers: [
    JobOpeningsController,
    CandidatesController,
    InterviewsController,
    OffersController,
    RecruitPickersController,
  ],
  providers: [
    RecruitAccessService,
    RecruitPeopleRepository,
    JobOpeningsRepository,
    CandidatesRepository,
    InterviewsRepository,
    OffersRepository,
    JobOpeningsService,
    CandidatesService,
    InterviewsService,
    OffersService,
    RecruitConvertService,
    RecruitCandidateFileResolver,
  ],
})
export class RecruitModule implements OnModuleInit {
  constructor(
    private readonly filePolicy: FilePolicyService,
    private readonly candidateFileResolver: RecruitCandidateFileResolver,
  ) {}

  onModuleInit(): void {
    // Additive — cặp (RECRUIT, candidate) chưa ai giữ; route download Foundation Files hết deny-no-resolver.
    this.filePolicy.registerResolver(this.candidateFileResolver);
  }
}
