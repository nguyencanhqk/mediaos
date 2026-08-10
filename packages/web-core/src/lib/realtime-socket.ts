import { io, type Socket } from "socket.io-client";
import { WS_CALL_NAMESPACE, WS_NAMESPACE } from "@mediaos/contracts";
import { getAccessToken } from "../stores/auth";
import { getApiBaseUrl } from "./api-client";

/**
 * S7-CHAT-FE-1 — kết nối Socket.IO DUY NHẤT của app shell (namespace `/ws`).
 *
 * ══ VÌ SAO SỐNG Ở `web-core` CHỨ KHÔNG PHẢI TRONG HOOK CHAT ══
 * `/ws` là namespace DÙNG CHUNG: `chat:*` (SPEC-15 §13.8) và `notification:*` (S4-NOTI-BE-1) đi trên
 * cùng một kết nối. Nếu socket do hook CHAT sở hữu và gate bằng cặp quyền CHAT thì:
 *   1. tài khoản KHÔNG được cấp CHAT sẽ mất luôn realtime NOTI — hai module không liên quan gì nhau;
 *   2. một WO NOTI-FE sau này không tìm được điểm dùng chung, buộc phải mở `io()` thứ hai.
 * Vì thế gate ở ĐÂY chỉ có đúng một điều kiện: **đã có phiên xác thực**. Cặp quyền của từng module
 * được gate ở tầng hook tiêu thụ (`useChatRealtime` dùng `view:chat-room`).
 *
 * ══ ĐÂY LÀ NƠI DUY NHẤT ĐƯỢC GỌI `io()` PHÍA CLIENT ══
 * Ép bằng ESLint `no-restricted-imports` (`eslint.config.mjs`), KHÔNG phải quy ước bằng lời: mọi file
 * khác trong `apps/app/src/**` + `packages/web-core/src/**` import `socket.io-client` là lint ĐỎ. Một
 * kết nối thứ hai không chỉ tốn tài nguyên — nó nhân đôi mọi sự kiện vào store và làm hỏng dedupe.
 */

/** Singleton module-private. `null` = chưa từng mở (hoặc chưa có phiên lúc gọi lần đầu). */
let socket: Socket | null = null;

/**
 * Origin của WS — tách từ base URL REST.
 *
 * REST có prefix đường dẫn (`http://host:3100/api/v1`) còn Socket.IO đăng ký ở GỐC + namespace
 * (`http://host:3100/ws`). Không có biến env riêng cho WS (`VITE_WS_URL` cố ý KHÔNG tồn tại): thêm một
 * env thứ hai là thêm một chỗ để lệch nhau giữa 4 môi trường.
 *
 * Fallback `window.location.origin` cho trường hợp base URL là đường dẫn tương đối (`/api/v1` sau
 * reverse proxy) — lúc đó `new URL()` ném, và origin của chính trang mới là đáp án đúng.
 */
function wsOrigin(): string {
  const base = getApiBaseUrl();
  try {
    return new URL(base).origin;
  } catch {
    return typeof window !== "undefined" ? window.location.origin : "";
  }
}

/**
 * Kết nối `/ws` dùng chung. `null` khi **chưa có phiên xác thực** — caller PHẢI xử lý nhánh đó
 * (`if (!s) return;`), không được `!`-assert: hook shell có thể chạy trước khi `bootstrapSession()`
 * nạp xong access token.
 *
 * Kiểu trả về là `Socket` NGUYÊN BẢN của `socket.io-client`, cố ý KHÔNG bọc alias tự chế: `web-core`
 * build dual ESM/CJS nên một alias sẽ rò vào `.d.ts` công khai và buộc mọi consumer phụ thuộc vào hình
 * dạng nội bộ của package này.
 *
 * `auth` là **HÀM**, không phải object tĩnh: `socket.io-client` gọi lại nó ở MỖI lần thử kết nối, nên
 * sau `refreshAccessToken()` lần thử kế tiếp tự mang token MỚI. Truyền object tĩnh sẽ đóng băng token
 * hết hạn vĩnh viễn và biến mọi lần reconnect thành `unauthorized`.
 *
 * KHÔNG chốt `transports`: giữ mặc định của thư viện (`polling` trước rồi upgrade `websocket`) —
 * `S7-CHAT-RT-0` §1.5 giao quyết định này cho FE và đường polling là thứ sống sót qua proxy doanh
 * nghiệp chặn upgrade WS. Ép `["websocket"]` sẽ đổi "chậm một nhịp" thành "không kết nối được".
 */
export function getAppSocket(): Socket | null {
  if (socket) return socket;
  if (getAccessToken() === null) return null;

  socket = io(`${wsOrigin()}/${WS_NAMESPACE}`, {
    auth: (cb: (data: { token?: string }) => void) => {
      cb({ token: getAccessToken() ?? undefined });
    },
  });
  return socket;
}

// ─── S7-CALL-FE-1 — `/ws-call` (tín hiệu WebRTC) ──────────────────────────────

/**
 * Singleton của namespace tín hiệu. `null` = KHÔNG có cuộc gọi nào đang mở — trạng thái BÌNH THƯỜNG,
 * khác hẳn `socket` ở trên (mở suốt phiên).
 */
let callSocket: Socket | null = null;

/**
 * Kết nối `/ws-call` — namespace RIÊNG chở SDP/ICE/media-state của cuộc gọi (`DECISIONS-07` R1).
 *
 * ══ VÌ SAO Ở CHUNG TỆP VỚI `getAppSocket()` ══
 * `no-restricted-imports` chặn `socket.io-client` trên toàn `apps/app/src/**` + `packages/web-core/src/**`
 * và `ignores` đúng MỘT tệp. Khai ở tệp mới buộc phải nới `ignores` — tức nới chính hàng rào đang giữ
 * "một kết nối `/ws` duy nhất", đổi lấy một thứ không cần đổi. `/ws-call` là namespace KHÁC nên nó
 * không đụng lý do gốc của luật; chỗ khai vẫn phải là tệp đã được miễn.
 *
 * ══ HAI ĐIỂM KHÁC `getAppSocket()`, CẢ HAI CÓ CHỦ ĐÍCH ══
 *  1. **KHÔNG mở sẵn.** Caller gọi hàm này lúc bắt đầu một cuộc gọi, không phải lúc mount shell. Đây là
 *     kênh DUY NHẤT trong hệ mà client được GHI lên WS — giữ nó mở suốt phiên cho một tính năng dùng
 *     vài phút mỗi ngày là để ngỏ một bề mặt tấn công không có ai đang dùng.
 *  2. **`closeCallSocket()` được phép ngắt thật.** `/ws` không được (dùng chung với NOTI, `<StrictMode>`
 *     chạy effect hai lần ⇒ ngắt ở cleanup giết kết nối cả app). `/ws-call` không chia sẻ với module nào.
 *
 * `auth` là HÀM — cùng lý do như `/ws`: `socket.io-client` gọi lại nó ở MỖI lần thử kết nối, nên sau
 * `refreshAccessToken()` lần thử kế tiếp tự mang token MỚI. Quan trọng gấp đôi ở đây vì gateway ghim
 * `exp` của token lúc handshake và **hẹn giờ ngắt** đúng lúc nó hết hạn (`scheduleTokenExpiry`).
 */
export function getCallSocket(): Socket | null {
  if (callSocket) return callSocket;
  if (getAccessToken() === null) return null;

  callSocket = io(`${wsOrigin()}/${WS_CALL_NAMESPACE}`, {
    auth: (cb: (data: { token?: string }) => void) => {
      cb({ token: getAccessToken() ?? undefined });
    },
  });
  return callSocket;
}

/**
 * Đóng `/ws-call` và quên singleton — gọi khi cuộc gọi kết thúc.
 *
 * ⚠️ PHẢI `callSocket = null` sau `disconnect()`. Giữ lại tham chiếu đã ngắt thì lần gọi kế tiếp
 * `getCallSocket()` trả về đúng object đó ở trạng thái `disconnected`; `socket.io-client` KHÔNG tự nối
 * lại sau `disconnect()` chủ động ⇒ cuộc gọi thứ hai của phiên im lặng không có tín hiệu nào, và triệu
 * chứng ("gọi lần đầu được, lần sau không") không chỉ về đây.
 */
export function closeCallSocket(): void {
  if (!callSocket) return;
  callSocket.removeAllListeners();
  callSocket.disconnect();
  callSocket = null;
}
