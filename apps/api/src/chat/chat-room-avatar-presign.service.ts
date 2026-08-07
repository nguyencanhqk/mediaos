import { Inject, Injectable, Logger } from "@nestjs/common";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { FileRepository } from "../foundation/files/file.repository";
import { STORAGE_ADAPTER, type StorageAdapter } from "../storage/storage-adapter.port";

/**
 * S8-CHAT-UX-BE-2 — ký URL tải TTL-ngắn cho AVATAR PHÒNG, một lô cho cả trang.
 *
 * CỐ Ý (khuôn `CoverPresignService`/`AvatarPresignService`, cả hai đã qua FULL gate):
 *   - **MỘT truy vấn cho cả danh sách.** `CHAT-DEC-019` đã chốt nguyên tắc này cho avatar người gửi vì
 *     lý do y hệt: ký từng cái là N lần ký + N URL hết hạn lệch nhau. Ký cục bộ (HMAC, không round-trip
 *     mạng) nên N URL/trang là chấp nhận được về hiệu năng.
 *   - **KHÔNG persist URL.** `StorageAdapter` cấm; URL ký TƯƠI mỗi lần trả DTO.
 *   - **SELF-DEFENDING.** Toàn bộ ràng buộc an toàn nằm ở `findVerifiedRoomAvatarsTx` (link sống + vị
 *     từ độc quyền + image/Uploaded/Clean + owner=creator), KHÔNG ở cột `avatar_file_id`.
 *   - **KHÔNG ghi `file_access_logs` / KHÔNG bump `download_count`** — mirror avatar/cover: đây là ảnh
 *     trang trí render hàng loạt, ghi log mỗi dòng sẽ nhiễu số liệu tải thật.
 *   - **FAIL-SOFT có LOG:** storage lỗi → phòng vắng mặt trong map ⇒ `avatarUrl: null` ⇒ FE dựng chữ
 *     cái đầu, KHÔNG 500 cả danh sách phòng.
 *
 * ⚠️ **NGHĨA VỤ CỦA CALLER, không phải bảo đảm sẵn có.** Service này KHÔNG nhận actor: nó ký cho mọi
 * `roomId` được đưa vào. Vị từ độc quyền chỉ bảo đảm file được ký ĐÚNG là avatar của phòng đó — nó
 * KHÔNG kiểm người gọi có được đọc phòng ấy không. Phát biểu đúng là: "ai nhận được `avatarUrl`" ⊆ "ai
 * tải được file đó qua phòng", **VỚI ĐIỀU KIỆN caller chỉ đưa vào những phòng actor là thành viên**.
 * Cả hai caller hiện tại thoả: `listRooms` (đã innerJoin membership của actor) và `getRoom` (đã qua
 * `assertMember`). Caller mới nào cũng phải làm đúng như vậy.
 */
@Injectable()
export class ChatRoomAvatarPresignService {
  private readonly logger = new Logger(ChatRoomAvatarPresignService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly fileRepo: FileRepository,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
  ) {}

  /**
   * `roomIds` → `Map<roomId, signedUrl>`. Phòng KHÔNG có trong map ⇒ caller trả `avatarUrl: null`
   * (chưa đặt ảnh / ảnh không còn hợp lệ / ký lỗi) — cả ba fail-soft như nhau, có chủ đích: FE không
   * cần phân biệt, và không rò "có ảnh nhưng bạn không xem được".
   *
   * `callerTx` — tx CỦA CALLER, dùng khi lời gọi nằm SẴN trong một transaction đọc. Không có nó thì
   * caller trong tx buộc phải tách đôi luồng, vì mở `withTenant` LỒNG NHAU sẽ **treo** trên PgBouncer
   * transaction-mode.
   */
  async resolveRoomAvatars(
    companyId: string,
    roomIds: readonly string[],
    callerTx?: TenantTx,
  ): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const unique = [...new Set(roomIds)];
    if (unique.length === 0) return out;

    const verified = callerTx
      ? await this.fileRepo.findVerifiedRoomAvatarsTx(companyId, unique, callerTx)
      : await this.db.withTenant(companyId, (tx) =>
          this.fileRepo.findVerifiedRoomAvatarsTx(companyId, unique, tx),
        );
    if (verified.length === 0) return out;

    const results = await Promise.allSettled(
      verified.map(async (v) => ({
        roomId: v.roomId,
        url: (await this.storage.get({ key: v.storagePath, companyId })).url,
      })),
    );

    let failures = 0;
    let sampleReason: unknown;
    for (const res of results) {
      if (res.status === "fulfilled") out.set(res.value.roomId, res.value.url);
      else {
        failures++;
        sampleReason ??= res.reason;
      }
    }
    if (failures > 0) {
      // Degrade-CÓ-LOG (không nuốt im lặng): kèm 1 reason mẫu + companyId để một BUG THẬT (vd
      // `assertKeyInTenant` ném) KHÔNG lẩn sau fail-soft.
      const reason = sampleReason instanceof Error ? sampleReason.message : String(sampleReason);
      this.logger.warn(
        `resolveRoomAvatars[company=${companyId}]: ${failures}/${verified.length} avatar phòng ký lỗi (degrade→không ảnh). Reason mẫu: ${reason}`,
      );
    }
    return out;
  }
}
