import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { loadEnv } from "./config/env.schema";
import { DatabaseModule } from "./db/db.module";
import { HealthModule } from "./health/health.module";

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
    HealthModule,
  ],
})
export class AppModule {}
