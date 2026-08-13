import { AsyncLocalStorage } from "node:async_hooks";

interface RequestLogContext {
  requestId: string;
}

/**
 * request-context.ts — S10-FND-JSONLOG-1.
 *
 * Mang `request_id` xuyên toàn bộ async call-graph của MỘT request HTTP để `JsonConsoleLogger`
 * gắn được nó vào log phát ra từ service/repository nằm sâu bên trong — không có đường nào truyền
 * `req` thủ công tới `new Logger(context)` ở những lớp đó, và cũng KHÔNG NÊN có (sẽ buộc sửa 100+
 * file service chỉ để log).
 *
 * Gắn ở `requestIdMiddleware` (SỚM NHẤT trong pipeline, trước routing/guard — xem `main.ts`) bằng
 * `runWithRequestId`; Node truyền context qua Promise/async-await/setTimeout tự động miễn là được
 * khởi tạo TRONG lệnh gọi `.run()` (đúng thứ `requestIdMiddleware` làm khi bọc `next()`).
 */
const requestContext = new AsyncLocalStorage<RequestLogContext>();

/** Chạy `fn` (thường là Express `next()`) trong ngữ cảnh mang `requestId`. */
export function runWithRequestId<T>(requestId: string, fn: () => T): T {
  return requestContext.run({ requestId }, fn);
}

/** Đọc `requestId` của request hiện tại — `undefined` nếu gọi ngoài một request (job nền, bootstrap). */
export function getRequestId(): string | undefined {
  return requestContext.getStore()?.requestId;
}
