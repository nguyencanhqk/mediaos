import { Module } from "@nestjs/common";
import { LmsSsoController } from "./lms-sso.controller";
import { LmsSsoService } from "./lms-sso.service";

/** Tích hợp LMS (fmc-app) — Giai đoạn A: cầu SSO. Không chạm DB, không migration. */
@Module({
  controllers: [LmsSsoController],
  providers: [LmsSsoService],
})
export class IntegrationsLmsModule {}
