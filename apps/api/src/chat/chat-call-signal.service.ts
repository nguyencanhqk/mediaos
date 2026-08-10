import { Injectable, NotFoundException } from "@nestjs/common";
import type { ChatCallStatus } from "../db/schema/communication";
import { DatabaseService } from "../db/db.service";
import { ChatAccessService } from "./chat-access.service";
import { CHAT_CALL_LIVE_STATUSES, ChatCallsRepository } from "./chat-calls.repository";

/** Ảnh chụp tư cách của MỘT actor trong MỘT cuộc gọi, tại đúng thời điểm một khung tín hiệu tới. */
export interface ChatCallSignalAccess {
  callId: string;
  roomId: string;
  status: ChatCallStatus;
  /** `status ∈ ('ringing','active')` — cùng tập với partial unique index `chat_calls_one_live_per_room_uq`. */
  isLive: boolean;
  /** Actor có hàng participant còn hiệu lực không (xem `activeUserIds`). */
  actorIsActive: boolean;
  /**
   * Actor có hàng participant **BẤT KỂ kết cục** — kể cả `left`/`rejected`/`missed`.
   *
   * ⚠️ Tách khỏi `actorIsActive` là điều kiện để phân biệt "dò cửa" với "đua vòng đời", và nó KHÔNG phải
   * tinh chỉnh cho đẹp: sau khi actor gác máy, `setParticipantOutcome` ghi `outcome='left'` ⇒ họ rơi khỏi
   * `activeUserIds`. Một ICE candidate còn trên đường bay (chuyện xảy ra ở MỌI cuộc gọi) sẽ biến người
   * vừa gác máy thành "người ngoài đang đẩy tín hiệu vào cuộc gọi" ⇒ ghi hàng an ninh + ngắt kết nối một
   * người dùng hoàn toàn hợp lệ. Bộ test bắt được đúng ca này.
   */
  actorIsParticipant: boolean;
  /**
   * Người **đang trong cuộc gọi** = có hàng participant với `outcome IS NULL` (chưa ngã ngũ) hoặc
   * `'accepted'` (đang nói chuyện). Bốn kết cục còn lại (`rejected`/`cancelled`/`missed`/`left`) là hấp
   * thụ — ĐÚNG tập mà `ChatCallsRepository.setParticipantOutcome` cho phép ghi tiếp, không phải một định
   * nghĩa thứ hai của "còn trong cuộc gọi".
   */
  activeUserIds: readonly string[];
  /** MỌI người từng được mời vào cuộc gọi này — dùng cho cùng phép phân biệt ở trục người NHẬN relay. */
  participantUserIds: readonly string[];
}

/**
 * S7-CALL-RT-1 — bề mặt **CHỈ ĐỌC** mà gateway `/ws-call` được phép chạm vào module CHAT.
 *
 * ┌─ VÌ SAO KHÔNG export thẳng `ChatCallsRepository` ────────────────────────────────────────────────┐
 * │ `chat.module.ts` ghi tường minh: 4 provider CALL **CỐ Ý KHÔNG export** — repository mang          │
 * │ `insertCall` · `transition` · `setParticipantOutcome` · `closeOpenParticipants`, tức TOÀN BỘ bề   │
 * │ mặt GHI vòng đời. Đưa nó ra ngoài module là đưa đường bắt đầu/kết thúc cuộc gọi ra khỏi cổng      │
 * │ `PermissionGuard` + audit — đúng hàng rào **R4** mà chữ ký owner ở `DECISIONS-07` đổi lấy.        │
 * │ Service này export ĐÚNG một phép đọc, không có method ghi nào, và không được thêm.                │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Hai truy vấn, KHÔNG cache (`DECISIONS-07` §3.2: *"mỗi sự kiện kiểm lại tư cách tham gia cuộc gọi —
 * không tin vào việc socket đang ở trong room"*, memory `ws-permission-gate-needs-its-own-room`).
 * Cái giá là ~2 truy vấn điểm mỗi khung tín hiệu; đó là đánh đổi CÓ CHỦ ĐÍCH đổi lấy việc **không có bản
 * sao thứ hai của luật membership** — `assertCallAccess` vẫn là điểm khẳng định duy nhất (bất biến #3 của
 * `chat-access.service.ts`, có grep test đóng đinh).
 */
@Injectable()
export class ChatCallSignalService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: ChatAccessService,
    private readonly calls: ChatCallsRepository,
  ) {}

  /**
   * `null` = actor **không nhìn thấy** cuộc gọi này: không tồn tại · thuộc tenant khác · phòng đã xoá
   * mềm · actor không (còn) là thành viên phòng. Bốn lý do trả CÙNG một giá trị, giống hệt cách
   * `assertCallAccess` trả cùng một 404 — gateway không được phép nói cho client biết lý do nào.
   *
   * ⚠️ Chỉ nuốt `NotFoundException`. Mọi lỗi khác (DB rớt, RLS chặn, bug) **ném tiếp** cho filter của
   * gateway: coi một sự cố hạ tầng là "không có quyền" sẽ biến một cuộc gọi hỏng vì Postgres thành một
   * cuộc gọi trông như bị từ chối, và xoá sạch dấu vết điều tra.
   */
  async resolveSignalAccess(
    companyId: string,
    callId: string,
    actorUserId: string,
  ): Promise<ChatCallSignalAccess | null> {
    return this.db.withTenant(companyId, async (tx) => {
      let call;
      try {
        const acc = await this.access.assertCallAccess(tx, companyId, callId, actorUserId);
        call = acc.call;
      } catch (err) {
        if (err instanceof NotFoundException) return null;
        throw err;
      }

      const participants = await this.calls.listParticipants(tx, companyId, callId);
      const activeUserIds = participants
        .filter((p) => p.outcome === null || p.outcome === "accepted")
        .map((p) => p.userId);

      const participantUserIds = participants.map((p) => p.userId);

      return {
        callId: call.id,
        roomId: call.roomId,
        status: call.status,
        isLive: (CHAT_CALL_LIVE_STATUSES as readonly string[]).includes(call.status),
        actorIsActive: activeUserIds.includes(actorUserId),
        actorIsParticipant: participantUserIds.includes(actorUserId),
        activeUserIds,
        participantUserIds,
      };
    });
  }
}
