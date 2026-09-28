import type { NextFunction, Request, Response } from "express";
import { runWithGrantMemo } from "../../permission/grant-snapshot-memo";

/**
 * S16-SOCIAL-PERMMEMO-1 (DECISIONS-15) — mở ngữ cảnh memo ảnh chụp grant cho MỘT request HTTP.
 *
 * FUNCTIONAL middleware (cùng lý do `requestIdMiddleware`: class `@Injectable` không chạy đúng qua
 * `app.use`). Đăng ký ở `main.ts` NGAY SAU `requestIdMiddleware`, dưới cờ
 * `PERMISSION_GRANT_MEMO_ENABLED`. Không đăng ký ⇒ `getCompanyRoleGrantsWithScope` passthrough
 * y hệt trước WO (đường job/outbox/WS và mọi int-spec không gọi `app.use` này).
 *
 * Store ALS RIÊNG, KHÔNG dùng store `{requestId}` của logger (plan D-1): kill-switch memo không
 * được kéo theo log, và tầng quan sát không được biết kiểu grant.
 */
export function grantMemoMiddleware(_req: Request, _res: Response, next: NextFunction): void {
  runWithGrantMemo(next);
}
