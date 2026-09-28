import { Module } from "@nestjs/common";
import { RecycleBinRegistry } from "./recycle-bin.registry";

/**
 * S16-SOCIAL-BE-3C (D6) — module LÁ: chỉ cấp + export `RecycleBinRegistry`, **0 import**.
 *
 * `RecycleBinModule` (controller đọc) và `SocialModule` (handler ghi) cùng import module này ⇒ CÙNG một
 * singleton, và KHÔNG có cạnh `RecycleBin ↔ Social` ⇒ không vòng DI. Giữ nó TĨNH: dynamic module
 * (`forRoot`/`register`) sinh instance riêng mỗi lần import ⇒ đăng ký một nơi, đọc một nẻo.
 */
@Module({
  providers: [RecycleBinRegistry],
  exports: [RecycleBinRegistry],
})
export class RecycleBinRegistryModule {}
