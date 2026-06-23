import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

/** Header truy vết request (echo lại cho client + log tương quan). */
export const REQUEST_ID_HEADER = "X-Request-Id";

/**
 * FUNCTIONAL middleware (KHÔNG class @Injectable — class không chạy đúng qua `app.use`).
 *
 * Gán `req.requestId` từ header `X-Request-Id` của client (nếu hợp lệ) hoặc sinh UUID mới,
 * rồi echo ra response header. Đăng ký SỚM ở `main.ts` (`app.use`) để interceptor + filter
 * luôn có `req.requestId` cho `meta.request_id` — kể cả request bị guard từ chối sớm.
 */
/** Chỉ nhận id client gửi nếu an toàn: ký tự word/.-, tối đa 128. Ngược lại sinh UUID mới. */
const SAFE_REQUEST_ID = /^[\w.-]{1,128}$/;

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.headers["x-request-id"];
  // Whitelist charset+length: chống phản chiếu giá trị không giới hạn vào body + chống CRLF (response-splitting).
  const requestId =
    typeof incoming === "string" && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
  req.requestId = requestId;
  res.setHeader(REQUEST_ID_HEADER, requestId);
  next();
}
