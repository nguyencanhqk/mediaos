import { Controller, Get } from "@nestjs/common";
import { DatabaseService } from "../db/db.service";

@Controller("health")
export class HealthController {
  constructor(private readonly database: DatabaseService) {}

  /** Liveness — không chạm DB. Dùng cho canary/uptime (infra-zero-cost-plan §5). */
  @Get()
  health(): { status: "ok"; service: string; time: string } {
    return {
      status: "ok",
      service: "mediaos-api",
      time: new Date().toISOString(),
    };
  }

  /** Readiness — ping DB (fail-soft: trả status "down" thay vì ném lỗi). */
  @Get("db")
  async healthDb(): Promise<{ status: "ok" | "down"; database: Awaited<ReturnType<DatabaseService["ping"]>> }> {
    const database = await this.database.ping();
    return { status: database.ok ? "ok" : "down", database };
  }
}
