import type { INestApplication } from "@nestjs/common";
import { ModulesContainer, Reflector } from "@nestjs/core";
import { IDEMPOTENT } from "../common/idempotency/idempotency.decorator";
import { IS_PUBLIC } from "../permission/public.decorator";
import {
  REQUIRE_PERMISSION,
  type RequirePermissionMeta,
} from "../permission/require-permission.decorator";

/**
 * S5-BE-CONTRACT-1 (WS-D §13.2) — Thu thập metadata AUTH/PERMISSION của từng route để bơm vào OpenAPI.
 *
 * TẠI SAO PHẢI QUÉT LẠI: `@nestjs/swagger` chỉ đọc decorator của CHÍNH nó (`@ApiTags`/`@ApiOperation`…).
 * Yêu cầu "permission note" của WO nằm ở decorator RIÊNG của dự án (`@RequirePermission`, `@Public`) nên
 * document sinh ra không hề biết. Thay vì gắn tay `@ApiOperation` lên 78 controller (bloat + chắc chắn
 * trôi), ta đọc CHÍNH metadata mà `PermissionGuard` dùng lúc chạy ⇒ tài liệu KHÔNG THỂ lệch với hành vi
 * thực thi (một nguồn sự thật duy nhất).
 *
 * KHOÁ NỐI với document = `operationId` mặc định của swagger: `<TênClassController>_<tênMethod>`.
 * Đã verify trên document sinh thật: 441/441 operationId DUY NHẤT, không có hậu tố `_1`. Nếu quy ước này
 * đổi ở bản swagger sau, `openapi-contract.e2e-spec` (assert 100% operation khớp metadata) sẽ ĐỎ chứ
 * không âm thầm bỏ chú thích quyền.
 */

/** Metadata auth/permission của một route handler. */
export interface RouteAuthMeta {
  /** `<Controller>_<method>` — khớp `operationId` mặc định của @nestjs/swagger. */
  operationId: string;
  /** Route gắn `@Public()` → JwtAuthGuard toàn cục bỏ qua (không cần Bearer). */
  isPublic: boolean;
  /** Metadata `@RequirePermission` (method ưu tiên hơn class). `null` khi route không khai. */
  permission: RequirePermissionMeta | null;
  /** Route gắn `@Idempotent()` → chấp nhận header `Idempotency-Key` (IMPLEMENTATION-08 §13.2). */
  isIdempotent: boolean;
}

/** Các method KHÔNG phải route handler (bỏ qua khi quét prototype). */
const NON_HANDLER_KEYS = new Set(["constructor"]);

/** Liệt kê tên method khai báo trực tiếp trên prototype của controller. */
function handlerNames(prototype: object): string[] {
  return Object.getOwnPropertyNames(prototype).filter((key) => {
    if (NON_HANDLER_KEYS.has(key)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, key);
    // Bỏ qua getter/setter (descriptor.get) — truy cập .value trên accessor sẽ gọi hàm ngoài ý muốn.
    return typeof descriptor?.value === "function";
  });
}

/**
 * Quét MỌI controller đã đăng ký trong app → map `operationId` → metadata auth/permission.
 *
 * Dùng `ModulesContainer` (provider toàn cục của `InternalCoreModule`, lấy được qua `app.get` mà KHÔNG
 * cần import `DiscoveryModule`) và `Reflector` — đúng cặp API mà Nest dùng để đọc metadata lúc chạy.
 */
export function collectRouteAuthMeta(app: INestApplication): Map<string, RouteAuthMeta> {
  const modulesContainer = app.get(ModulesContainer);
  const reflector = app.get(Reflector);
  const result = new Map<string, RouteAuthMeta>();

  for (const module of modulesContainer.values()) {
    for (const wrapper of module.controllers.values()) {
      const controller = wrapper.metatype;
      if (typeof controller !== "function") continue;
      const prototype = controller.prototype as object | undefined;
      if (!prototype) continue;

      for (const methodName of handlerNames(prototype)) {
        const handler = (prototype as Record<string, unknown>)[methodName] as (
          ...a: unknown[]
        ) => unknown;
        // getAllAndOverride: metadata ở METHOD thắng metadata ở CLASS — đúng thứ tự ưu tiên của Nest guard.
        const isPublic =
          reflector.getAllAndOverride<boolean>(IS_PUBLIC, [handler, controller]) === true;
        const permission =
          reflector.getAllAndOverride<RequirePermissionMeta>(REQUIRE_PERMISSION, [
            handler,
            controller,
          ]) ?? null;
        const isIdempotent =
          reflector.getAllAndOverride<boolean>(IDEMPOTENT, [handler, controller]) === true;
        result.set(`${controller.name}_${methodName}`, {
          operationId: `${controller.name}_${methodName}`,
          isPublic,
          permission,
          isIdempotent,
        });
      }
    }
  }

  return result;
}
