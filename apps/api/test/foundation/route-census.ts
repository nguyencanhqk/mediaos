/**
 * S6-SEC-ROUTEMAP-1 — BỘ QUÉT ROUTE RUNTIME (nguồn sự thật DUY NHẤT cho census + Phụ lục A).
 *
 * VÌ SAO CÓ FILE NÀY. Báo cáo `S6-SEC-1` §0.4 ghi lại việc con số "route không gate" SAI BỐN LẦN
 * (49 → 38 → 114 → 40) vì đo bằng regex trên mã nguồn:
 *   - bỏ `@RequirePermission` **cấp class** ⇒ đếm thừa 11 route `/me/*`;
 *   - cửa sổ decorator cố định `i+8` **nuốt decorator của route kế tiếp** ⇒ đếm THIẾU, và chính chỗ
 *     đó giấu route `GET /org/teams/:id/members` (SEC-F04 thứ hai);
 *   - `@RequirePermission(` trải nhiều dòng ⇒ regex đòi trọn cặp ngoặc trượt ⇒ đếm thừa ồ ạt;
 *   - docstring nhắc TÊN decorator để giải thích vì sao KHÔNG dùng nó ⇒ bị đọc thành "đã gác".
 * Cả bốn bẫy đều là bẫy của **parse tĩnh**, không phải bất cẩn. Quét runtime không có bẫy nào trong
 * số đó: metadata đọc từ `AppModule` ĐÃ BOOT chính là thứ `PermissionGuard` đọc lúc chạy thật.
 *
 * BẤT BIẾN CỦA FILE NÀY: **0 regex trên mã nguồn**. Nếu một câu hỏi về gate không trả lời được bằng
 * metadata runtime thì câu trả lời là "không biết", không phải "grep thử xem".
 *
 * KHÔNG cần Postgres — chỉ boot + đọc metadata (mirror `openapi-docs.e2e-spec`). Vì vậy các spec dùng
 * module này KHÔNG được `skipIf(!hasDb)`: chúng phải chạy trong `pnpm test` mặc định để CI thật sự gác.
 */

import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { DiscoveryService, MetadataScanner } from "@nestjs/core";
import { IS_PUBLIC } from "../../src/permission/public.decorator";
import {
  REQUIRE_PERMISSION,
  type RequirePermissionMeta,
} from "../../src/permission/require-permission.decorator";

/** Chỉ số `RequestMethod` của Nest → tên verb. Thứ tự do @nestjs/common quy định, không đổi được. */
const HTTP_METHOD_NAME = [
  "GET",
  "POST",
  "PUT",
  "DELETE",
  "PATCH",
  "ALL",
  "OPTIONS",
  "HEAD",
  "SEARCH",
] as const;

/** Tiền tố toàn cục đặt ở main.ts:40 (`${API_PREFIX}/${API_VERSION}`); mặc định env.schema = api/v1. */
export const GLOBAL_PREFIX = "api/v1";

export interface RouteInfo {
  /** Tên class controller — nửa đầu của khoá census `Controller#method`. */
  controller: string;
  /** Tên method handler — nửa sau của khoá census. */
  method: string;
  /** GET · POST · … ("?" nếu METHOD_METADATA vắng, tức Nest đổi cách khai — phải điều tra, không bỏ qua). */
  httpMethod: string;
  /** Đường dẫn ĐẦY ĐỦ đúng như client gọi: /api/v1 + prefix controller + path route. */
  path: string;
  /** Đường dẫn khai trong `@Controller(...)` (giữ để soi controller mount ở đâu). */
  controllerPath: string;
  /** Có `@RequirePermission` ở handler HOẶC ở class (guard đọc `getAllAndOverride([handler, class])`). */
  hasPermission: boolean;
  /** Cặp quyền thật `action:resourceType` nếu có — để đối chiếu với seed, không phải để trang trí. */
  permission: string | null;
  /** Cấp mà `@RequirePermission` được khai — bẫy #1 của §0.4 là bỏ quên vế "class". */
  permissionLevel: "handler" | "class" | null;
  /** Có `@Public()` ở handler hoặc class ⇒ MỌI guard (JWT/Company/Permission) bỏ qua. */
  isPublic: boolean;
  /** Tên guard khai bằng `@UseGuards` ở CẤP CLASS (vd InternalGuard) — vế "OTHER_GUARD" của Phụ lục A. */
  classGuards: readonly string[];
  /** Tên guard khai bằng `@UseGuards` ở CẤP ROUTE. */
  routeGuards: readonly string[];
}

/** Khoá census của một route. Ổn định hơn path (path đổi khi mount lại; cặp class#method thì không). */
export function routeKey(route: Pick<RouteInfo, "controller" | "method">): string {
  return `${route.controller}#${route.method}`;
}

/**
 * KHÔNG gate = không `@RequirePermission` VÀ không `@Public()`.
 *
 * Đây là ĐÚNG định nghĩa mà `PermissionGuard` dùng, nên tập này = tập route mà một user **bất kỳ đã
 * đăng nhập** (qua `JwtAuthGuard` + `CompanyGuard` toàn cục) gọi được, trừ khi có guard khác chặn.
 * `@Public()` KHÔNG có nghĩa "an toàn" — nghĩa là "đã có phán quyết PUBLIC", và phán quyết đó vẫn
 * phải xuất hiện trong sổ Phụ lục A.
 */
export function isUngated(route: RouteInfo): boolean {
  return !route.hasPermission && !route.isPublic;
}

function joinPath(...parts: string[]): string {
  const segments = parts
    .flatMap((p) => p.split("/"))
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return `/${segments.join("/")}`;
}

/**
 * `@Controller(['a','b'])` / `@Get(['x','y'])` là hợp lệ trong Nest (một handler, NHIỀU path).
 * Nối bằng `|` thay vì lặng lẽ lấy phần tử đầu: mất một path là mất một bề mặt khỏi census, đúng kiểu
 * hụt phạm vi mà WO này tồn tại để chặn. Census 2026-07-27: 0 route dùng dạng mảng.
 */
function declaredPath(value: unknown): string {
  if (Array.isArray(value)) return value.map((v) => String(v)).join("|");
  if (value === undefined || value === null) return "";
  return String(value);
}

function guardNames(target: unknown): readonly string[] {
  const guards: unknown = Reflect.getMetadata(GUARDS_METADATA, target as object);
  if (!Array.isArray(guards)) return [];
  return guards.map((g: unknown) => {
    if (typeof g === "function") return g.name;
    // Instance guard (`@UseGuards(new X())`) — lấy tên qua constructor.
    if (g && typeof g === "object") return (g as object).constructor?.name ?? "anonymous";
    return String(g);
  });
}

/**
 * CENSUS 100% ROUTE của ứng dụng ĐÃ BOOT.
 *
 * Đi qua `DiscoveryService.getControllers()` (chính danh sách Nest dùng để mount route), rồi với mỗi
 * method có `PATH_METADATA` (⇒ là route handler, không phải helper) đọc metadata ở CẢ handler LẪN
 * class — hệt như `reflector.getAllAndOverride([handler, class])` của guard.
 */
export function collectRoutes(app: INestApplication): RouteInfo[] {
  const discovery = app.get(DiscoveryService, { strict: false });
  const scanner = new MetadataScanner();
  const routes: RouteInfo[] = [];

  for (const wrapper of discovery.getControllers()) {
    const { metatype, instance } = wrapper;
    if (!metatype || instance == null) continue;
    const prototype = Object.getPrototypeOf(instance) as object;

    const controllerPath = declaredPath(Reflect.getMetadata(PATH_METADATA, metatype));
    const classPermission = Reflect.getMetadata(REQUIRE_PERMISSION, metatype) as
      | RequirePermissionMeta
      | undefined;
    const classPublic = Reflect.getMetadata(IS_PUBLIC, metatype) === true;
    const classGuards = guardNames(metatype);

    for (const methodName of scanner.getAllMethodNames(prototype)) {
      const handler = (prototype as Record<string, unknown>)[methodName];
      if (typeof handler !== "function") continue;
      // Không có PATH_METADATA ⇒ không phải route handler (helper thường của controller).
      const routePath: unknown = Reflect.getMetadata(PATH_METADATA, handler);
      if (routePath === undefined) continue;

      const methodIdx: unknown = Reflect.getMetadata(METHOD_METADATA, handler);
      const handlerPermission = Reflect.getMetadata(REQUIRE_PERMISSION, handler) as
        | RequirePermissionMeta
        | undefined;
      const effectivePermission = handlerPermission ?? classPermission;

      routes.push({
        controller: metatype.name,
        method: methodName,
        httpMethod:
          typeof methodIdx === "number" ? (HTTP_METHOD_NAME[methodIdx] ?? String(methodIdx)) : "?",
        path: joinPath(GLOBAL_PREFIX, controllerPath, declaredPath(routePath)),
        controllerPath: joinPath(controllerPath),
        hasPermission: effectivePermission !== undefined,
        permission: effectivePermission
          ? `${effectivePermission.action}:${effectivePermission.resourceType}`
          : null,
        permissionLevel:
          handlerPermission !== undefined
            ? "handler"
            : classPermission !== undefined
              ? "class"
              : null,
        isPublic: Reflect.getMetadata(IS_PUBLIC, handler) === true || classPublic,
        classGuards,
        routeGuards: guardNames(handler),
      });
    }
  }

  // Sắp xếp ổn định ⇒ artifact máy-đọc có diff sạch giữa hai lần sinh (không phụ thuộc thứ tự DI).
  return routes.sort((a, b) => routeKey(a).localeCompare(routeKey(b)));
}
