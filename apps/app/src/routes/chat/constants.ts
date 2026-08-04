/**
 * S7-CHAT-FE-2 — hằng của trang `/chat` (SPEC-15 §9 CHAT-SCREEN-001/003/004).
 *
 * Cặp quyền viết LITERAL theo đúng seed mig `0538:407-419` — KHÔNG suy từ mã `MODULE.RESOURCE.ACTION`
 * qua bảng map: bảng map là nguồn drift thứ hai, và cặp sai thì cổng UI mở/đóng ngược với server mà
 * không test nào đỏ (memory `s1-fnd-module-metadata-seed-drift`).
 */
import type { RouteMeta } from "@mediaos/web-core";

export const CHAT_PATH = "/chat";

/**
 * 9 cặp CHAT không nhạy cảm (`is_sensitive=false`) ⇒ CÓ MẶT trong `/auth/me.capabilities` ⇒ `useCan`
 * chạy thật. Cặp thứ 10 (`view:chat-oversight`, `is_sensitive=true`) thuộc `S7-CHAT-FE-5`, cố ý vắng
 * ở đây để trang này không có đường nào chạm tới đọc-vượt membership.
 */
export const CHAT_PAIRS = {
  /** Cổng nav + panel nổi (FE-3). Trang này gate bằng VIEW_ROOM, không phải cặp này. */
  ACCESS: { action: "access", resourceType: "chat" },
  VIEW_ROOM: { action: "view", resourceType: "chat-room" },
  CREATE_ROOM: { action: "create", resourceType: "chat-room" },
  UPDATE_ROOM: { action: "update", resourceType: "chat-room" },
  ARCHIVE_ROOM: { action: "archive", resourceType: "chat-room" },
  MANAGE_MEMBER: { action: "manage", resourceType: "chat-member" },
  SEND_MESSAGE: { action: "send", resourceType: "chat-message" },
  RECALL_MESSAGE: { action: "recall", resourceType: "chat-message" },
  PIN_MESSAGE: { action: "pin", resourceType: "chat-message" },
} as const;

/*
 * `FOUNDATION_FILE_UPLOAD_PAIR` ĐÃ XOÁ ở `S7-CHAT-BE-8` — đừng khai lại.
 *
 * FE-2 phải gate nút đính kèm bằng cặp FOUNDATION `upload:foundation-file` vì đường upload khi đó là
 * `POST /foundation/files/upload` + `/confirm`; cặp đó chỉ có ở `SA` · `company-admin` ·
 * `QUẢN LÝ CẤP CAO` nên nút biến mất với `employee`/`hr`/`manager`. BE-8 chuyển đường upload sang
 * `POST /chat/files/upload-url` + `/chat/files/:id/confirm`, gate `send:chat-message`. Từ đó cổng của
 * nút đính kèm ĐÚNG BẰNG cổng của nút Gửi — thêm cặp thứ hai chỉ ẩn nút của người server sẵn sàng phục vụ.
 */

/**
 * RouteMeta CỤC BỘ (không ở `ROUTE_REGISTRY` của web-core) — cùng kỹ thuật `hrOrgChartMeta` /
 * `attReportsMeta`. `showInSidebar: false`: lối vào sidebar + badge header thuộc `S7-CHAT-FE-3`.
 *
 * `moduleCode: "CHAT"` khai TƯỜNG MINH dù hôm nay vô hiệu: `buildSessionFromStore()` trả `modules: []`
 * cứng nên `evaluateRouteFromStore` bỏ `moduleCode` với MỌI route ⇒ nhánh SHOW_DISABLED chưa từng chạy.
 * Khai sẵn để lúc FE nối `modules` thật thì công tắc `modules.CHAT.is_active` (đang `false` — WO cuối
 * wave mới bật) tự có hiệu lực, không phải đi sửa lại route.
 */
export const CHAT_ROUTE_META: RouteMeta = {
  routeKey: "chat.workspace",
  path: CHAT_PATH,
  layout: "MODULE_WORKSPACE",
  moduleCode: "CHAT",
  screenCode: "CHAT-SCREEN-001",
  titleKey: "routeTitle.chat",
  requiredAnyPermissions: [`${CHAT_PAIRS.VIEW_ROOM.action}:${CHAT_PAIRS.VIEW_ROOM.resourceType}`],
  showInSidebar: false,
};

// ── Hằng UI ───────────────────────────────────────────────────────────────────

/** Cửa sổ người GỬI tự thu hồi (SPEC-15 §13.6). Server là cổng thật; số này chỉ để ẩn/hiện nút. */
export const RECALL_WINDOW_MS = 15 * 60 * 1000;

/** Khớp `sendMessageSchema.fileIds.max(10)` + `CHAT_MAX_ATTACHMENTS_PER_MESSAGE` ở BE. */
export const MAX_ATTACHMENTS_PER_MESSAGE = 10;

/** Khớp `sendMessageSchema.body.max(4000)`. */
export const MAX_MESSAGE_LENGTH = 4000;

/** Số tin mỗi trang khi cuộn ngược — khớp `listChatMessagesQuerySchema.limit.default(50)`. */
export const MESSAGE_PAGE_SIZE = 50;

/**
 * Ngưỡng "đang ở gần đáy" (px). Dưới ngưỡng: tin mới tự cuộn xuống + tự đánh dấu đã đọc. Trên ngưỡng:
 * người dùng đang đọc tin cũ ⇒ TUYỆT ĐỐI không kéo khung nhìn của họ, chỉ hiện nút "có tin mới".
 */
export const NEAR_BOTTOM_THRESHOLD_PX = 80;

/** Khoảng chống dội của `markRead` — cuộn là chuỗi sự kiện dày, không nện API mỗi khung hình. */
export const MARK_READ_DEBOUNCE_MS = 400;

/** Số lần nạp thêm tối đa khi nhảy tới một tin ghim nằm ngoài phần đã tải. Hết thì báo, không lặp vô hạn. */
export const JUMP_TO_MESSAGE_MAX_PAGES = 5;
