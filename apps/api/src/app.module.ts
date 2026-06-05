import { APP_GUARD } from "@nestjs/core";
import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { loadEnv } from "./config/env.schema";
import { AuthModule } from "./auth/auth.module";
import { DatabaseModule } from "./db/db.module";
import { EventsModule } from "./events/events.module";
import { HealthModule } from "./health/health.module";
import { OrgModule } from "./org/org.module";
import { MediaModule } from "./media/media.module";
import { WorkflowModule } from "./workflow/workflow.module";
import { PermissionModule } from "./permission/permission.module";
import { JwtAuthGuard } from "./permission/guards/jwt-auth.guard";
import { CompanyGuard } from "./permission/guards/company.guard";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [".env", "../../.env"],
      validate: (config: Record<string, unknown>) => loadEnv(config as NodeJS.ProcessEnv),
    }),
    DatabaseModule,
    EventsModule,
    AuthModule,
    PermissionModule,
    HealthModule,
    OrgModule,
    MediaModule,
    WorkflowModule,
  ],
  providers: [
    // Global guard pipeline: JWT auth → company context extraction.
    // PermissionGuard is NOT registered globally here — add @RequirePermission per-route.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: CompanyGuard },
  ],
})
export class AppModule {}
