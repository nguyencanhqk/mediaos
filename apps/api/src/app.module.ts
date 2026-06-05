import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { loadEnv } from "./config/env.schema";
import { AuthModule } from "./auth/auth.module";
import { DatabaseModule } from "./db/db.module";
import { EventsModule } from "./events/events.module";
import { HealthModule } from "./health/health.module";
import { OrgModule } from "./org/org.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Đọc .env của app rồi tới .env gốc monorepo (giá trị đầu thắng).
      envFilePath: [".env", "../../.env"],
      // Validate toàn bộ env qua Zod (fail-fast nếu thiếu/biến sai).
      validate: (config: Record<string, unknown>) => loadEnv(config as NodeJS.ProcessEnv),
    }),
    DatabaseModule,
    EventsModule,
    AuthModule,
    HealthModule,
    OrgModule,
  ],
})
export class AppModule {}
