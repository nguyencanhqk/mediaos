import { Injectable } from "@nestjs/common";
import type { RecycleBinHandlerMap, RecycleBinObjectType } from "./recycle-bin.types";

/**
 * S16-SOCIAL-BE-3C (D6, owner ký O3) — registry TỐI THIỂU của thùng rác theo LOẠI đối tượng.
 *
 * Module sở hữu dữ liệu tự `register` ở `onModuleInit` (khuôn `MasterDataSeederRegistry` + `SocialSeedRegistrar`);
 * controller của `recycle-bin/` `get` ra handler rồi uỷ quyền. Không có cạnh DI `RecycleBin ↔ <module>`.
 *
 * ┌─ HAI CHẾ ĐỘ HỎNG, CẢ HAI ĐỀU ỒN ÀO ──────────────────────────────────────────────────────────────┐
 * │ • `register` TRÙNG loại ⇒ `throw` lúc BOOT: hai handler cho một loại là hai bản luật quyền/che cho  │
 * │   cùng một dữ liệu, và «handler sau đè handler trước» là một quyết định phân quyền không ai viết.  │
 * │ • `get` loại CHƯA đăng ký ⇒ `throw Error` ⇒ 500 + log (fail-CLOSED). KHÔNG trả `undefined` để      │
 * │   controller tự xử: một nhánh «không có handler thì trả rỗng» là thành công RỖNG — HR thấy thùng   │
 * │   rác trống trơn và kết luận không có gì để khôi phục (memory `empty-success-is-the-fail-open-shape`).│
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ PHẢI là singleton toàn app: cung cấp DUY NHẤT qua `RecycleBinRegistryModule` (module lá, tĩnh). Biến
 * module đó thành dynamic/`forRoot` là đẻ HAI instance — module đăng ký vào một cái, controller đọc cái kia
 * ⇒ mọi request 500 (int-spec A1 + mutant M6 bắt).
 */
@Injectable()
export class RecycleBinRegistry {
  private readonly handlers = new Map<RecycleBinObjectType, unknown>();

  register<K extends RecycleBinObjectType>(type: K, handler: RecycleBinHandlerMap[K]): void {
    if (this.handlers.has(type)) {
      throw new Error(
        `RecycleBinRegistry: loại '${type}' đã có handler — hai module đăng ký CÙNG một loại đối tượng`,
      );
    }
    this.handlers.set(type, handler);
  }

  get<K extends RecycleBinObjectType>(type: K): RecycleBinHandlerMap[K] {
    const handler = this.handlers.get(type);
    if (handler === undefined) {
      throw new Error(
        `RecycleBinRegistry: chưa có handler cho loại '${type}' — module sở hữu chưa đăng ký ở onModuleInit`,
      );
    }
    // Map chỉ nhận giá trị qua `register<K>` (khoá K ↔ kiểu RecycleBinHandlerMap[K]) ⇒ ép kiểu này đúng.
    return handler as RecycleBinHandlerMap[K];
  }
}
