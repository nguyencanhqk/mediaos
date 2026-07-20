import { Inject, Injectable, Logger } from "@nestjs/common";
import { DatabaseService, type TenantTx } from "../../db/db.service";
import { STORAGE_ADAPTER, type StorageAdapter } from "../../storage/storage-adapter.port";
import { FileRepository } from "./file.repository";

/**
 * S5-TASK-COVER-1 — ký URL tải TTL-ngắn cho ẢNH BÌA công việc, để board/chi tiết hiển thị được.
 *
 * CỐ Ý:
 *   - **SELF-DEFENDING.** Toàn bộ ràng buộc an toàn nằm ở `findVerifiedTaskCoversTx` (repo), KHÔNG ở
 *     đường ghi. Lý do: `file_links.is_primary` — thứ đánh dấu "đây là bìa" — là cột ĐA-NGƯỜI-GHI
 *     (`POST /foundation/files/:id/links` nhận `isPrimary` verbatim, chỉ chặn `Infected`). Ai đó bật cờ
 *     vòng qua `TaskFileService.setCover` thì đường đọc vẫn phải từ chối. Xem docblock repo về vị từ
 *     ĐỘC QUYỀN — nó là chốt chống leo thang đọc, không phải tối ưu.
 *   - **KHÔNG qua FilePolicy** — nhưng điều đó đặt một NGHĨA VỤ LÊN CALLER, không phải một bảo đảm sẵn.
 *     Service này KHÔNG nhận actor: nó ký cho mọi `taskId` được đưa vào. Vị từ độc quyền chỉ bảo đảm
 *     tệp được ký CHỈ thuộc đúng task đó — nó KHÔNG kiểm người gọi có quyền đọc task ấy không.
 *
 *     ⚠️ Phát biểu đúng là: "ai nhận được coverUrl" ⊆ "ai tải được tệp đó qua task",
 *     **VỚI ĐIỀU KIỆN caller đã gate bằng cặp `read:task` + data_scope của chính cặp đó.**
 *     (Bản đầu docblock này viết "trùng khít" vô điều kiện — SAI, và security-review bắt được.)
 *
 *     Vì sao điều kiện đó không tự động đúng: `data_scope` là PER-(permission, role). Đường TẢI tệp
 *     gate bằng `read:task`, nhưng board gate bằng `view-kanban:task` — hai cặp khác nhau có thể có
 *     scope khác nhau. `TaskKanbanService.getBoard` vì vậy phải resolve RIÊNG `read:task` trước khi
 *     gọi vào đây (xem chú thích tại đó). Caller mới nào cũng phải làm đúng như vậy.
 *   - **KHÔNG ghi `file_access_logs` / KHÔNG bump download_count** — mirror avatar: đây là ảnh trang
 *     trí render hàng loạt trên board, ghi log mỗi thẻ sẽ làm nhiễu số liệu tải thật.
 *   - **FAIL-SOFT:** storage lỗi → bỏ qua (không vào map) ⇒ `coverUrl: null` ⇒ thẻ không có bìa,
 *     KHÔNG 500 cả board.
 *
 * Ký cục bộ (HMAC, không round-trip mạng) ⇒ N URL/trang chấp nhận được về hiệu năng.
 *
 * GHI CHÚ VỀ TRÙNG LẶP: khối `Promise.allSettled` + degrade-có-log bên dưới lặp lại
 * `AvatarPresignService`. CÓ CHỦ ĐÍCH — tách helper dùng chung sẽ phải viết lại đường fail-soft của một
 * service crown-jewel ngay trong WO này, kéo diff và rủi ro regression của avatar vào FULL gate của
 * COVER-1. Dọn trùng ở WO riêng.
 */
@Injectable()
export class CoverPresignService {
  private readonly logger = new Logger(CoverPresignService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly fileRepo: FileRepository,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
  ) {}

  /**
   * `taskIds` → `Map<taskId, signedUrl>`. Task KHÔNG có trong map ⇒ caller trả `coverUrl: null`
   * (chưa đặt bìa / bìa không còn hợp lệ / ký lỗi) — cả ba đều fail-soft như nhau, có chủ đích:
   * FE không cần phân biệt, và không rò thông tin "có bìa nhưng bạn không được xem".
   *
   * `callerTx` — tx CỦA CALLER, dùng khi lời gọi nằm SẴN trong một transaction đọc. Không có nó thì
   * caller trong tx buộc phải tách đôi luồng, vì mở `withTenant` LỒNG NHAU sẽ **treo** trên PgBouncer
   * transaction-mode. Truyền tx vào là tái dùng đúng kết nối đang mở — vẫn cùng tenant, vẫn qua RLS.
   */
  async resolveTaskCovers(
    companyId: string,
    taskIds: readonly string[],
    callerTx?: TenantTx,
  ): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const unique = [...new Set(taskIds)];
    if (unique.length === 0) return out;

    const verified = callerTx
      ? await this.fileRepo.findVerifiedTaskCoversTx(companyId, unique, callerTx)
      : await this.db.withTenant(companyId, (tx) =>
          this.fileRepo.findVerifiedTaskCoversTx(companyId, unique, tx),
        );
    if (verified.length === 0) return out;

    const results = await Promise.allSettled(
      verified.map(async (v) => ({
        taskId: v.taskId,
        url: (await this.storage.get({ key: v.storagePath, companyId })).url,
      })),
    );

    let failures = 0;
    let sampleReason: unknown;
    for (const res of results) {
      if (res.status === "fulfilled") out.set(res.value.taskId, res.value.url);
      else {
        failures++;
        sampleReason ??= res.reason;
      }
    }
    if (failures > 0) {
      // Degrade-CÓ-LOG (không nuốt im lặng): storage lỗi/cấu hình thiếu → thẻ mất bìa, board vẫn trả.
      // Kèm 1 reason mẫu + companyId để một BUG THẬT (vd assertKeyInTenant ném) KHÔNG lẩn sau fail-soft.
      const reason = sampleReason instanceof Error ? sampleReason.message : String(sampleReason);
      this.logger.warn(
        `resolveTaskCovers[company=${companyId}]: ${failures}/${verified.length} ảnh bìa ký lỗi (degrade→không bìa). Reason mẫu: ${reason}`,
      );
    }
    return out;
  }
}
