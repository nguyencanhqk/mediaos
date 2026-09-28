import type { INestApplication } from "@nestjs/common";
import { ZodValidationPipe } from "nestjs-zod";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../src/common/interceptors/response-envelope.interceptor";
import { grantMemoMiddleware } from "../../src/common/middleware/grant-memo.middleware";
import { requestIdMiddleware } from "../../src/common/middleware/request-id.middleware";
import { envSchema } from "../../src/config/env.schema";

/**
 * S16-TEST-PIPELINE-PARITY-1 — dựng pipeline request của int-spec Y HỆT `src/main.ts`.
 *
 * Int-spec dựng app bằng `moduleRef.createNestApplication()` — KHÔNG chạy `main.ts`. Trước WO này
 * ~240 file tự chép tay `useGlobalInterceptors` + `useGlobalFilters` và KHÔNG đăng ký middleware
 * nào ⇒ bộ hồi quy rộng chỉ phủ đường passthrough của memo grant (DECISIONS-15) và không có
 * `req.requestId`. Helper này là NƠI DUY NHẤT test chép pipeline; lưới
 * `test/foundation/pipeline-parity.unit-spec.ts` so nó với `main.ts` theo AST (thứ tự + điều kiện).
 *
 * Phần của `main.ts` CỐ Ý KHÔNG chép (lý do từng dòng nằm ở `MAIN_ONLY_CALLS` của lưới):
 * `setGlobalPrefix` (int-spec gọi route KHÔNG tiền tố) · `enableCors` · `trust proxy` ·
 * WebSocket adapter · Swagger · `listen` (spec tự `listen(0)` — census S18-QA-SUPERTESTLISTEN-1).
 *
 * ⚠️ KHÔNG dựng request supertest (không chạm HTTP server) ở đây: census supertest phân tích
 * TỪNG FILE và dựa vào tiền đề «không helper dùng chung nào dựng request» (`sharedRequestHelpers`).
 */
export interface MainPipelineOptions {
  /**
   * Quyết định CỤC BỘ có đăng ký `grantMemoMiddleware` hay không — KHÔNG ghi `process.env`, không
   * ảnh hưởng nơi nào khác đọc cờ. Bỏ trống ⇒ đọc `PERMISSION_GRANT_MEMO_ENABLED` như `main.ts`
   * (mặc định bật). `false` = đường kill-switch của PROD (vẫn có `requestIdMiddleware`).
   */
  readonly grantMemo?: boolean;
}

export function applyMainPipeline(
  app: INestApplication,
  opts: MainPipelineOptions = {},
): INestApplication {
  const grantMemoEnabled = opts.grantMemo ?? readMemoFlag() === "true";

  app.use(requestIdMiddleware);
  if (grantMemoEnabled) {
    app.use(grantMemoMiddleware);
  }

  app.useGlobalPipes(new ZodValidationPipe());
  app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());
  return app;
}

/**
 * Đọc ĐÚNG MỘT cờ qua CHÍNH schema của `env.schema.ts` (cùng default/enum với `main.ts`) — KHÔNG gọi
 * `loadEnv()`: nó kiểm cả bộ env + superRefine, một biến lạ không liên quan sẽ ném ở đây.
 */
function readMemoFlag(): "true" | "false" {
  return envSchema
    .innerType()
    .shape.PERMISSION_GRANT_MEMO_ENABLED.parse(process.env.PERMISSION_GRANT_MEMO_ENABLED);
}
