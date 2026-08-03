import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../db/db.service";
import { sequenceCounters } from "../db/schema/sequences";
import { SequenceService } from "../foundation/sequences/sequence.service";
import { SequenceNotFoundError } from "../foundation/sequences/sequence.types";

/**
 * CONTRACT KHOÁ của counter `chat_room` — phải trùng LITERAL với `0538:157-165`.
 *
 * Lệch một trường là mã do migration backfill và mã do runtime cấp có hình dạng khác nhau mà KHÔNG ai
 * báo (không CHECK nào ở DB ép hai nơi giống nhau). Ví dụ cụ thể: bỏ `currentValue: 0` thì mã đầu tiên
 * của company mới phụ thuộc DEFAULT của cột, không phụ thuộc hợp đồng này. Ca test 12 pin nguyên bộ.
 */
const CHAT_ROOM_COUNTER = {
  moduleCode: "CHAT",
  sequenceKey: "chat_room",
  scopeType: "Company",
  prefix: "ROOM-",
  paddingLength: 4,
  resetPolicy: "Never",
  incrementBy: 1,
  currentValue: 0n,
  status: "Active",
} as const;

/**
 * S7-CHAT-BE-1 — cấp `room_code`, kèm LAZY-CREATE counter (trả nợ FULL gate của `S7-CHAT-DB-1`).
 *
 * ── Nợ đang trả ────────────────────────────────────────────────────────────────────────────────
 * Mig `0538` seed counter bằng `INSERT … SELECT FROM companies` ⇒ CHỈ company tồn tại LÚC MIGRATE có
 * counter. `sequence_counters` KHÔNG nằm trong `master-data-seeder.registry`, và registry cũng chỉ chạy
 * lúc boot — nên kể cả đăng ký seeder vẫn còn cửa sổ "company tạo giữa hai lần restart". Company mới sẽ
 * `SequenceNotFoundError` ngay ở phòng ĐẦU TIÊN.
 *
 * ── Chọn: lazy-create tại đây (không phải seeder) ──────────────────────────────────────────────
 * Đo được app role có `SELECT, INSERT, UPDATE` trên `sequence_counters` (`0434:126`), nên tạo được
 * tại chỗ. `ON CONFLICT DO NOTHING` bắt partial-unique `uq_sequence_counters_company_key_scope_active`
 * (`0434:109`) ⇒ hai request đồng thời của company mới không đẻ hai counter.
 *
 * Retry ĐÚNG MỘT lần. Lần hai vẫn `SequenceNotFoundError` nghĩa là counter bị đặt `status<>'Active'`,
 * `deleted_at` khác NULL, hoặc RLS chặn — những thứ vòng lặp không sửa được, phải ném lên để người thấy.
 *
 * ── Hệ quả chấp nhận: LỖ SỐ ─────────────────────────────────────────────────────────────────────
 * `SequenceService.nextCode()` tự mở `withTenant` bên trong (`sequence.service.ts:137`) nên KHÔNG lồng
 * được vào transaction nghiệp vụ. Gọi TRƯỚC khi vào tx tạo phòng ⇒ tx rollback thì mã đã cấp bị bỏ phí.
 * Giống hệt `task-code.util.ts`; đây là hành vi đã có của hệ, không phải khuyết tật mới của WO này.
 *
 * `task` (mig 0498) có ĐÚNG lỗ counter này và chưa vá — ngoài phạm vi WO, đã ghi nợ ở backlog.
 */
@Injectable()
export class ChatRoomCodeService {
  private readonly logger = new Logger(ChatRoomCodeService.name);

  constructor(
    private readonly sequences: SequenceService,
    private readonly db: DatabaseService,
  ) {}

  /** Cấp `room_code` kế tiếp (`ROOM-0001`, `ROOM-0002`, …). Gọi NGOÀI transaction nghiệp vụ. */
  async allocate(companyId: string): Promise<string> {
    try {
      return await this.next(companyId);
    } catch (err) {
      // Bắt theo LỚP LỖI, không theo chuỗi message: message đổi câu chữ là bắt trượt, và bắt trượt ở
      // đây nghĩa là company mới không tạo được phòng nào — im lặng cho tới lần đầu có người thử.
      if (!(err instanceof SequenceNotFoundError)) throw err;
      this.logger.warn(
        `Counter 'chat_room' chưa có cho company ${companyId} (company tạo sau mig 0538) — tạo theo contract của 0538.`,
      );
      await this.ensureCounter(companyId);
      return this.next(companyId);
    }
  }

  private async next(companyId: string): Promise<string> {
    const res = await this.sequences.nextCode(companyId, {
      sequenceKey: CHAT_ROOM_COUNTER.sequenceKey,
      scopeType: CHAT_ROOM_COUNTER.scopeType,
    });
    return res.code;
  }

  private async ensureCounter(companyId: string): Promise<void> {
    await this.db.withTenant(companyId, async (tx) => {
      await tx
        .insert(sequenceCounters)
        .values({
          companyId,
          moduleCode: CHAT_ROOM_COUNTER.moduleCode,
          sequenceKey: CHAT_ROOM_COUNTER.sequenceKey,
          scopeType: CHAT_ROOM_COUNTER.scopeType,
          prefix: CHAT_ROOM_COUNTER.prefix,
          paddingLength: CHAT_ROOM_COUNTER.paddingLength,
          resetPolicy: CHAT_ROOM_COUNTER.resetPolicy,
          incrementBy: CHAT_ROOM_COUNTER.incrementBy,
          currentValue: CHAT_ROOM_COUNTER.currentValue,
          status: CHAT_ROOM_COUNTER.status,
        })
        .onConflictDoNothing();
    });
  }
}
