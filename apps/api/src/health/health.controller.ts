import { Controller, Get } from "@nestjs/common";
import { DatabaseService } from "../db/db.service";
import { Public } from "../permission/public.decorator";
import { type BuildInfo, readBuildInfo } from "./build-info";

@Public()
@Controller("health")
export class HealthController {
  /**
   * Đọc MỘT LẦN lúc dựng controller: định danh build đóng băng theo artifact, không đổi trong vòng đời
   * tiến trình ⇒ không chạm đĩa ở mỗi nhịp canary (canary-watch.sh mặc định 12 lượt mỗi deploy).
   */
  private readonly build: BuildInfo = readBuildInfo();

  constructor(private readonly database: DatabaseService) {}

  /**
   * Liveness — không chạm DB. Dùng cho canary/uptime (infra-zero-cost-plan §5).
   *
   * `build` (S6-REL-1 · D1) là 4 trường TĨNH đọc lúc khởi tạo, không truy vấn gì ⇒ vẫn là liveness
   * thuần. Ba trường cũ (`status`/`service`/`time`) GIỮ NGUYÊN: `scripts/canary-watch.sh` đọc `status`
   * và sẽ vỡ nếu đổi tên/kiểu. Thêm trường là additive, không phá client cũ.
   */
  @Get()
  health(): { status: "ok"; service: string; time: string; build: BuildInfo } {
    return {
      status: "ok",
      service: "mediaos-api",
      time: new Date().toISOString(),
      build: this.build,
    };
  }

  /** Readiness — ping DB (fail-soft: trả status "down" thay vì ném lỗi). */
  @Get("db")
  async healthDb(): Promise<{
    status: "ok" | "down";
    database: Awaited<ReturnType<DatabaseService["ping"]>>;
  }> {
    const database = await this.database.ping();
    return { status: database.ok ? "ok" : "down", database };
  }
}
