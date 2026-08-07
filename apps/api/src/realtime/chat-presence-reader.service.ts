import { Injectable, Logger } from "@nestjs/common";
import { loadEnv } from "../config/env.schema";
import { ValkeyService } from "../permission/valkey.service";
import { resolveEnvScope } from "./ws-adapter-config";

/**
 * ChatPresenceReaderService (S8-CHAT-UX-FE-3) — vế **CHỈ ĐỌC** của "đang online", tách ra làm module LÁ.
 *
 * ══ VÌ SAO PHẢI TÁCH ══
 * `ChatModule` cần đọc presence để gắn ảnh chụp vào roster (`CHAT-API-007a`), nhưng `ChatPresenceService`
 * sống trong `RealtimeModule`, mà `RealtimeModule` ĐÃ `import { ChatModule }` (nó cần `ChatRoomsRepository`
 * lúc handshake). Import chiều ngược lại là **vòng** `Chat → Realtime → Chat`: Nest sập lúc bootstrap và
 * triệu chứng là 100+ int-spec đỏ dây chuyền, không phải một lỗi đọc được (lớp
 * `systemjobhandler-optional-dbw-di`). `forwardRef` chữa được về mặt kỹ thuật nhưng nó GIẤU vòng đi thay
 * vì phá nó. Khuôn đúng đã có sẵn trong repo: `RealtimeEmitterModule` — module lá được tách ra chính vì
 * lý do này.
 *
 * ══ VÌ SAO KHÔNG CHÉP `presenceKey` SANG CHAT ══
 * Không gian khoá là thứ ép hai môi trường không thấy nhau (`{envScope}` — memory
 * `valkey-shared-across-all-envs-no-channel-prefix`). Bản sao thứ hai của phép suy đó sẽ TRÔI khỏi bản
 * gốc, và lúc nó trôi thì bên ghi và bên đọc nhìn hai khoá khác nhau ⇒ "không ai online bao giờ" — một
 * hỏng hóc im lặng, không log, không exception (memory `module-closed-by-second-assert-not-scope`).
 * Vì thế `presenceKey` chuyển HẲN về đây và `ChatPresenceService` (vế GHI) uỷ quyền xuống.
 *
 * Service này KHÔNG ghi gì, KHÔNG phát sự kiện nào, và không phụ thuộc module nghiệp vụ nào.
 */
@Injectable()
export class ChatPresenceReaderService {
  private readonly logger = new Logger(ChatPresenceReaderService.name);
  private readonly envScope: string;
  private warnedDisabled = false;

  constructor(private readonly valkey: ValkeyService) {
    this.envScope = resolveEnvScope(loadEnv(), process.env.LANE_DB);
  }

  /**
   * Khoá presence của một user — **NGUỒN DUY NHẤT** của định dạng này (vế ghi ở `ChatPresenceService`
   * gọi lại đúng hàm này). Public để test đo được KHÔNG GIAN KHOÁ trực tiếp mà không cần Valkey thật:
   * đó là thứ chứng minh dev-online và PROD không thấy nhau.
   */
  presenceKey(companyId: string, userId: string): string {
    return `chat:presence:${this.envScope}:co:${companyId}:user:${userId}`;
  }

  isEnabled(): boolean {
    if (this.valkey.isEnabled()) return true;
    if (!this.warnedDisabled) {
      this.warnedDisabled = true;
      this.logger.warn(
        "VALKEY_URL chưa cấu hình — TRẠNG THÁI ĐANG ONLINE TẮT HOÀN TOÀN (không có bản sao in-memory: " +
          "bản sao chỉ đúng trên 1 instance và sẽ nói dối ngay khi scale)",
      );
    }
    return false;
  }

  /**
   * Lọc ra những user ĐANG online trong một danh sách.
   *
   * FAIL-SOFT: Valkey tắt/lỗi ⇒ trả **mảng rỗng**, KHÔNG ném. Caller (roster) dịch nó thành
   * `isOnline: false` cho mọi người — tức "không có chấm", đúng nghĩa "không biết ai đang online".
   * Ném từ đây sẽ làm cả danh sách thành viên 500 vì một tính năng mỹ thuật.
   */
  async getOnlineUserIds(companyId: string, userIds: readonly string[]): Promise<string[]> {
    if (!this.isEnabled() || userIds.length === 0) return [];
    const online: string[] = [];
    // Tuần tự chứ không `Promise.all`: danh sách là THÀNH VIÊN MỘT PHÒNG (đơn vị chục), còn `Promise.all`
    // trên một kết nối Valkey chung chỉ đổi thứ tự pipeline chứ không giảm round-trip đáng kể.
    for (const userId of new Set(userIds)) {
      try {
        const size = await this.valkey.sCard(this.presenceKey(companyId, userId));
        if (size !== null && size > 0) online.push(userId);
      } catch (err) {
        // Một khoá lỗi KHÔNG được giết cả danh sách. Nhưng phải để lại dấu: im lặng ở đây nghĩa là
        // presence chết dần mà không ai biết (CLAUDE.md §5).
        this.logger.warn(
          `getOnlineUserIds: đọc khoá presence của user=${userId} lỗi — coi như offline`,
          { error: err instanceof Error ? err.message : String(err) },
        );
      }
    }
    return online;
  }
}
