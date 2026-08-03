import { Logger, type INestApplicationContext } from "@nestjs/common";
import type { Env } from "../config/env.schema";
import { ValkeyIoAdapter } from "./valkey-io.adapter";
import { resolveValkeyChannelKey } from "./ws-adapter-config";

const logger = new Logger("WebSocketAdapter");

/**
 * Gắn `ValkeyIoAdapter` vào app — hàm DÙNG CHUNG giữa `main.ts` và int-spec.
 *
 * S7-CHAT-RT-0. Gốc rễ của WO này là *"class định nghĩa đúng nhưng KHÔNG AI GỌI, và không test nào phát
 * hiện được vì không test nào chạm đường production thật"*. Vì vậy cố tình KHÔNG theo tiền lệ "mirror
 * main.ts bằng tay trong test" (`openapi-contract.e2e-spec.ts:74`): nếu bằng chứng của WO lại là một bản
 * chép tay trong test thì WO tự tái tạo đúng lớp rủi ro nó đang vá. Test gọi CHÍNH hàm này.
 *
 * PHẢI gọi TRƯỚC `app.listen()`/`app.init()`: `useWebSocketAdapter` sau khi WS module đã init là VÔ HIỆU
 * (@nestjs/core `nest-application.js:256-262` log warn đúng tình huống đó).
 *
 * Trả về instance để caller đọc `isMultiInstanceReady()` / gọi `disconnectValkey()`.
 */
export async function setupWebSocketAdapter(
  app: INestApplicationContext & { useWebSocketAdapter(adapter: unknown): unknown },
  env: Env,
): Promise<ValkeyIoAdapter> {
  const adapter = new ValkeyIoAdapter(app);

  if (env.VALKEY_URL) {
    await adapter.connectToValkey(
      env.VALKEY_URL,
      resolveValkeyChannelKey(env, process.env.LANE_DB),
    );
    // Nhánh thất bại đã log ERROR bên trong connectToValkey — không log lặp ở đây.
  } else {
    logger.error(
      "VALKEY_URL chưa cấu hình — BROADCAST ĐA INSTANCE TẮT (in-memory, chỉ đúng trên 1 tiến trình)",
    );
  }

  // LUÔN gắn, kể cả khi Valkey hỏng: adapter còn là nơi DUY NHẤT cấu hình CORS/allowRequest cho `/ws`.
  // Không gắn = trình duyệt không nối được, tức là biến một sự cố Valkey thành sự cố mất hẳn realtime.
  app.useWebSocketAdapter(adapter);
  return adapter;
}
