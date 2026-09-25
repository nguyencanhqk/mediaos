import { Module } from "@nestjs/common";
import { DatabaseModule } from "../db/db.module";
import { SecurityAlertService } from "./security-alert.service";

/**
 * S16-SOCIAL-ATTDEBT-1 (C-5, owner ký S-4 ngày 24/09/2026) — module **LÁ** cấp `SecurityAlertService`.
 *
 * ┌─ VÌ SAO TÁCH RA THAY VÌ CHO `SocialModule` IMPORT `AuthModule` ──────────────────────────────┐
 * │ `SocialModule` cần ĐÚNG MỘT service để ghi vết DENY của cổng gắn tệp. Import `AuthModule` kéo │
 * │ cả đồ thị auth (6 import — trong đó 2 `forwardRef` — 2 controller, 17 provider) vào injector  │
 * │ của SOCIAL. Đó đúng lớp việc mà docblock `social.module.ts` cảnh báo bằng tiền lệ đã trả giá: │
 * │ import nhầm một module nặng làm Nest **sập lúc bootstrap** và kéo đỏ dây chuyền mọi int-spec. │
 * │ `SecurityAlertService` chỉ phụ thuộc `DatabaseService` + `AuditService` (`EventsModule` là    │
 * │ `@Global`) ⇒ một module lá là đủ. Khuôn có sẵn nguyên si: `RealtimeEmitterModule`.            │
 * └───────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * 🔴 **`AuthModule` PHẢI gỡ `SecurityAlertService` khỏi `providers` của nó** và import module này
 * thay thế. Giữ cả hai ⇒ Nest tạo provider THEO MODULE ⇒ **HAI instance** của một service
 * crown-jewel append-only. Không sai chức năng hôm nay, nhưng là đúng thứ khiến một lượt thêm state
 * (cache, bộ đếm, cửa sổ khử trùng) sau này hỏng theo cách không ai tìm ra.
 * `AuthModule` **re-export MODULE này** trong `exports` ⇒ mọi consumer cũ của `AuthModule` không
 * phải đổi một dòng.
 */
@Module({
  imports: [DatabaseModule],
  providers: [SecurityAlertService],
  exports: [SecurityAlertService],
})
export class SecurityAlertModule {}
