/**
 * Ambient declaration — mở rộng Express.Request với `requestId` (do `requestIdMiddleware` gán).
 * Auto-include qua tsconfig `include: ["src"]`. Cho phép interceptor + filter đọc `req.requestId`
 * type-safe (KHÔNG cần ép kiểu `as any` hay tắt type-check — gate cấm).
 */
declare global {
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

export {};
