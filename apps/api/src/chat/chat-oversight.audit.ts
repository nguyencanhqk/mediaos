import type { AuditEntry } from "../events/audit.service";
import { CHAT_AUDIT, CHAT_MODULE_CODE } from "./chat.errors";

/**
 * Cặp quyền của ĐƯỜNG ĐỌC-VƯỢT — hằng dùng cho `permission_code` của dòng audit và cho ca test đóng đinh.
 *
 * ⚠️ Đây **KHÔNG** phải nguồn cặp mà guard hỏi. `ChatOversightAuditGuard` đọc cặp từ metadata
 * `@RequirePermission` của chính route (qua `Reflector`, hệt `PermissionGuard`) — hai bản sao của cặp sẽ
 * trôi, và khi trôi thì guard audit ghi "Denied" cho một cặp trong khi `PermissionGuard` cho qua ở cặp
 * khác: audit nói dối, im lặng. Hằng này chỉ để GHI vào dòng audit và để test khẳng định route khai đúng.
 */
export const CHAT_OVERSIGHT_ACTION = "view" as const;
export const CHAT_OVERSIGHT_RESOURCE = "chat-oversight" as const;
export const CHAT_OVERSIGHT_PERMISSION_CODE = "CHAT.CHAT-OVERSIGHT.VIEW";

/**
 * Nhãn loại truy cập ghi vào `metadata.endpoint` — CHAT-SCREEN-008 dùng để phân loại dòng.
 *
 * `UNKNOWN` **không phải** một endpoint của SPEC: nó là nhãn cho đường dẫn KHÔNG khớp khuôn nào đã khai
 * (route thứ 5 thêm sau, hoặc request tới guard khi `req.route` chưa được gắn). Có nó thì `endpointOf`
 * không phải mượn nhãn của một endpoint CÓ THẬT làm mặc định — mượn thì dòng audit vẫn hợp lệ, vẫn hiện
 * trên màn hình, chỉ là nói SAI người ta đã đọc gì, và không có gì đỏ (S7-CHAT-CLEAN-2).
 */
export const CHAT_OVERSIGHT_ENDPOINT = {
  ROOM_SEARCH: "018a",
  ROOM_DETAIL: "018b",
  ROOM_MESSAGES: "018c",
  AUDIT_LOG: "019",
  UNKNOWN: "unknown",
} as const;
export type ChatOversightEndpoint =
  (typeof CHAT_OVERSIGHT_ENDPOINT)[keyof typeof CHAT_OVERSIGHT_ENDPOINT];

export interface ChatOversightAuditInput {
  actorUserId: string;
  endpoint: ChatOversightEndpoint;
  /** `null` với `018a` (tra danh sách — không có phòng đích) và với `019`. */
  roomId: string | null;
  resultStatus: "Success" | "Denied";
  /** Tiêu chí tra / con trỏ. **KHÔNG BAO GIỜ** chứa nội dung tin nhắn (SPEC-15 §18). */
  criteria?: Record<string, unknown>;
}

/**
 * S7-CHAT-BE-7 🔒 — HÌNH DẠNG DUY NHẤT của một dòng audit đọc-vượt (API-13 §5.3 "hình dạng dòng audit").
 *
 * ┌─ VÌ SAO MỘT HÀM CHỨ KHÔNG PHẢI HAI CHỖ TỰ DỰNG OBJECT ───────────────────────────────────────────┐
 * │ Dòng `Success` sinh ở `ChatOversightService` (trong tx nghiệp vụ), dòng `Denied` sinh ở            │
 * │ `ChatOversightAuditGuard` (tx riêng đã commit). Hai nơi, hai mô hình transaction — nhưng phải CÙNG │
 * │ `action` + `object_type` + `module_code`, nếu không thì `CHAT-API-019` (bó `action` AND            │
 * │ `module_code`) sẽ thấy một nửa số dòng. Nửa bị mất là nửa nào thì tuỳ ai gõ sai, và không có gì đỏ:│
 * │ nhật ký vẫn hiện, chỉ là **thiếu**. Một hàm ⇒ lệch là lỗi biên dịch, không phải lỗ trong sổ.       │
 * └───────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * `object_type = 'chat_room'` — đã có trong catalog CHECK (mig `0050`) và trong union TS `AuditObjectType`
 * ⇒ **KHÔNG cần migration** (memory `audit-check-union-parse-anchor-trap`: đừng nới CHECK cho vui).
 *
 * `sensitivityLevel: 'HighlySensitive'` — cặp quyền là `is_sensitive = true` và đây là bề mặt rủi ro lớn
 * nhất của module; `dataScope: 'System'` vì đường này CỐ Ý đứng ngoài mọi thang scope dữ liệu.
 */
export function chatOversightAuditEntry(input: ChatOversightAuditInput): AuditEntry {
  return {
    action: CHAT_AUDIT.OVERSIGHT_READ,
    objectType: "chat_room",
    // `undefined` (không phải `null`) để writer ghi cột NULL — `AuditEntry.objectId` là `string | undefined`.
    objectId: input.roomId ?? undefined,
    actorUserId: input.actorUserId,
    actorType: "User",
    moduleCode: CHAT_MODULE_CODE,
    entityType: "chat_room",
    entityId: input.roomId ?? undefined,
    permissionCode: CHAT_OVERSIGHT_PERMISSION_CODE,
    sensitivityLevel: "HighlySensitive",
    dataScope: "System",
    resultStatus: input.resultStatus,
    metadata: {
      endpoint: input.endpoint,
      criteria: input.criteria ?? {},
    },
  };
}
