import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import type {
  ChatOversightAuditQuery,
  ChatOversightAuditResponseDto,
  ChatOversightMessageDto,
  ChatOversightMessagesQuery,
  ChatOversightRoomDetailDto,
  ChatOversightRoomListDto,
  ChatOversightRoomQuery,
} from "@mediaos/contracts";
import { AuditService } from "../events/audit.service";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { ChatAttachmentsRepository } from "./chat-attachments.repository";
import { assertCursorExclusive } from "./chat-message-rules";
import {
  toOversightAttachmentDto,
  toOversightAuditEntryDto,
  toOversightMessageDto,
  toOversightRoomDetailDto,
  toOversightRoomSummaryDto,
} from "./chat-oversight.mapper";
import { ChatOversightRepository } from "./chat-oversight.repository";
import {
  CHAT_OVERSIGHT_ENDPOINT,
  chatOversightAuditEntry,
  type ChatOversightEndpoint,
} from "./chat-oversight.audit";
import { CHAT_ERR } from "./chat.errors";
import type { ChatActor } from "./chat-rooms.service";
// ⚠️ Codec con trỏ DÙNG LẠI của `S7-CHAT-BE-4`, KHÔNG viết bản thứ hai. Luật "cắt về mili-giây ở CẢ khoá
// sắp xếp lẫn con trỏ" (jsdoc `chat-search-cursor.ts`) là thứ hiện thực sai một cách IM LẶNG — trang sau
// sót dòng, HTTP 200, không lỗi. Một bản ⇒ sửa một chỗ là sửa cả hai đường.
//
// S7-CHAT-BE-9 gọi codec đó QUA `chat-oversight-audit-cursor.ts` (lớp bọc thêm dấu vân bộ lọc), nên
// service không còn import trực tiếp — lớp bọc là đường DUY NHẤT vào/ra con trỏ của 019.
// S7-CHAT-BE-9 (additive): bộ lọc của CHAT-API-019 + con trỏ MANG dấu vân bộ lọc.
import {
  decodeOversightAuditCursor,
  encodeOversightAuditCursor,
} from "./chat-oversight-audit-cursor";
import { resolveAuditFilter, type ChatOversightAuditFilter } from "./chat-oversight-audit-filter";
import { assertValidTimezone } from "../common/tz.util";
import { getSettingDefault } from "../foundation/settings/setting-defaults";
import { companies } from "../db/schema/companies";
import { and, eq, isNull } from "drizzle-orm";

/**
 * Mặc định khi hàng công ty hỏng/vắng. Lấy từ registry company-default (DB-10 §11.2) thay vì viết lại
 * chuỗi — xem `resolveCompanyTimeZone` để biết vì sao TZ **đọc từ cột `companies.timezone`** chứ không
 * từ khoá KV cùng tên.
 */
const COMPANY_TIMEZONE_FALLBACK = String(
  getSettingDefault("company.timezone")?.value ?? "Asia/Ho_Chi_Minh",
);

/**
 * S7-CHAT-BE-7 🔒 — ĐƯỜNG ĐỌC-VƯỢT MEMBERSHIP (CHAT-DEC-004 · SPEC-15 §3.3 · API-13 §5.3).
 *
 * ┌─ HAI MÔ HÌNH TRANSACTION KHÁC NHAU — ĐỌC TRƯỚC KHI SỬA BẤT KỲ DÒNG NÀO ──────────────────────────┐
 * │ THÀNH CÔNG (file này): audit `Success` ghi trong **CÙNG** transaction với truy vấn đọc, **TRƯỚC** │
 * │   khi DTO rời hàm. Ghi audit lỗi ⇒ throw ⇒ rollback ⇒ **0 byte** dữ liệu ra ngoài + HTTP 500      │
 * │   (CHAT-ERR-020). Ghi audit SAU khi trả, hoặc ở interceptor ngoài transaction, là KHÔNG ĐẠT.      │
 * │ TỪ CHỐI (`ChatOversightAuditGuard`): audit `Denied` ghi ở transaction **RIÊNG ĐÃ COMMIT**, rồi    │
 * │   `PermissionGuard` mới ném 403. Ném 403 trong cùng tx sẽ **rollback mất** chính dòng đó.          │
 * └───────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ Service này **KHÔNG** gọi `ChatAccessService` — đó là chức năng của nó, không phải thiếu sót
 * (API-13 §5.3 ràng buộc 1). Đổi lại, MỌI hàm public ở đây phải ghi audit; hàm nào không ghi là một
 * đường đọc toàn tenant KHÔNG DẤU VẾT. Ca int-spec đếm `audit_logs` trước/sau từng route đóng đinh điều đó.
 *
 * ⚠️ **CHỈ ĐỌC.** Không có biến thể ghi dưới `/chat/oversight/` (ràng buộc 4) — SA không gửi/ghim/thu
 * hồi/sửa thành viên được ở phòng mình không thuộc.
 *
 * ⚠️ **KHÔNG emit WS** (ràng buộc 6): phiên đọc-vượt không join `co:{companyId}:chatroom:{roomId}` và
 * không nhận `chat:message`. Đọc-vượt là tra cứu có chủ đích TẠI MỘT THỜI ĐIỂM, không phải giám sát liên
 * tục — và mỗi lần tra để lại đúng một dòng audit.
 */
@Injectable()
export class ChatOversightService {
  private readonly logger = new Logger(ChatOversightService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: ChatOversightRepository,
    private readonly attachmentRepo: ChatAttachmentsRepository,
    private readonly audit: AuditService,
  ) {}

  /**
   * CHAT-API-018a — tra phòng theo mã/tên/loại. Trả **siêu dữ liệu**, KHÔNG nội dung tin, KHÔNG thành viên.
   *
   * `objectId` của dòng audit là **NULL** (không có phòng đích); tiêu chí tra đi vào `metadata.criteria`
   * — đó là thứ trả lời câu hỏi điều tra "người này đã tra cái gì" (API-13 §5.3).
   */
  async searchRooms(
    actor: ChatActor,
    query: ChatOversightRoomQuery,
  ): Promise<ChatOversightRoomListDto> {
    return this.db.withTenant(actor.companyId, async (tx) => {
      const rows = await this.repo.searchRooms(tx, actor.companyId, {
        q: query.q,
        roomType: query.roomType,
        limit: query.limit,
      });
      // Repo trả `limit + 1` ⇒ dư một hàng nghĩa là còn kết quả bị cắt. Cắt trang mà im lặng đọc ra y hệt
      // "đã trả hết" (no-silent-caps) nên cờ này là một phần của hợp đồng, không phải tiện ích.
      const truncated = rows.length > query.limit;
      const page = truncated ? rows.slice(0, query.limit) : rows;

      await this.recordSuccess(tx, actor, CHAT_OVERSIGHT_ENDPOINT.ROOM_SEARCH, null, {
        q: query.q,
        roomType: query.roomType ?? null,
        resultCount: page.length,
        truncated,
      });

      return { data: page.map(toOversightRoomSummaryDto), truncated };
    });
  }

  /** CHAT-API-018b — chi tiết phòng + thành viên. Audit `object_id = roomId`, MỖI LẦN GỌI. */
  async getRoom(actor: ChatActor, roomId: string): Promise<ChatOversightRoomDetailDto> {
    return this.db.withTenant(actor.companyId, async (tx) => {
      const room = await this.repo.findRoom(tx, actor.companyId, roomId);
      // 404 với HẰNG dùng chung — GIỐNG HỆT đường đọc thường. Kèm chi tiết ở đây là biến chính đường
      // quản trị thành oracle dò sự tồn tại của phòng (CHAT-ERR-001).
      if (!room) throw new NotFoundException(CHAT_ERR.ROOM_NOT_FOUND);

      const members = await this.repo.listActiveMembers(tx, actor.companyId, roomId);

      await this.recordSuccess(tx, actor, CHAT_OVERSIGHT_ENDPOINT.ROOM_DETAIL, roomId, {
        memberCount: members.length,
      });

      return toOversightRoomDetailDto(room, members);
    });
  }

  /**
   * CHAT-API-018c — một trang tin, **TOÀN DẢI `seq`** của phòng (ràng buộc 8), con trỏ RIÊNG.
   *
   * Đính kèm trả **metadata thuần, 0 URL ký** (ràng buộc 7): `ChatAttachmentPresignService` **không**
   * được gọi ở đây. Nó có mặt trong module cho đường đọc thường; kéo nó vào đây là biến payload oversight
   * thành máy phát khoá đọc tệp KHÔNG CẦN MEMBERSHIP — và khoá đó đi qua route FOUNDATION Files, nơi
   * KHÔNG có dòng audit CHAT nào.
   */
  async listMessages(
    actor: ChatActor,
    roomId: string,
    query: ChatOversightMessagesQuery,
  ): Promise<ChatOversightMessageDto[]> {
    // Loại trừ con trỏ ép TRƯỚC khi mở transaction: đây là lỗi đầu vào (CHAT-ERR-016, 422), không phải
    // một lần đọc-vượt — nó KHÔNG được sinh dòng audit `Success`.
    assertCursorExclusive(query.beforeSeq, query.afterSeq);

    return this.db.withTenant(actor.companyId, async (tx) => {
      const room = await this.repo.findRoom(tx, actor.companyId, roomId);
      if (!room) throw new NotFoundException(CHAT_ERR.ROOM_NOT_FOUND);

      const rows = await this.repo.listMessages(tx, actor.companyId, roomId, {
        beforeSeq: query.beforeSeq,
        afterSeq: query.afterSeq,
        limit: query.limit,
      });

      // Tin ĐÃ THU HỒI vẫn bị che ở mapper ⇒ không nạp đính kèm của chúng (mapper sẽ trả `[]` bất kể).
      const attachableIds = rows.filter((r) => r.recalledAt === null).map((r) => r.id);
      const attachments = await this.attachmentRepo.listAttachmentsForMessages(
        tx,
        actor.companyId,
        attachableIds,
      );
      const byMessage = new Map<string, ReturnType<typeof toOversightAttachmentDto>[]>();
      for (const a of attachments) {
        const bucket = byMessage.get(a.messageId);
        if (bucket) bucket.push(toOversightAttachmentDto(a));
        else byMessage.set(a.messageId, [toOversightAttachmentDto(a)]);
      }

      await this.recordSuccess(tx, actor, CHAT_OVERSIGHT_ENDPOINT.ROOM_MESSAGES, roomId, {
        beforeSeq: query.beforeSeq ?? null,
        afterSeq: query.afterSeq ?? null,
        resultCount: rows.length,
      });

      return rows.map((r) => toOversightMessageDto(r, byMessage.get(r.id) ?? []));
    });
  }

  /**
   * CHAT-API-019 — nhật ký đọc-vượt (CHAT-SCREEN-008).
   *
   * ⚠️ **KHÔNG ghi audit `Success`** — API-13 §5.3 bảng endpoint ghi cột Audit của 019 là `—`. Đọc nhật ký
   * KHÔNG phải đọc-vượt: nó không tiết lộ một byte nội dung chat nào. Ghi Success ở đây làm chính màn
   * CHAT-SCREEN-008 tự sinh nhiễu mỗi lần mở, và lối sửa rẻ nhất khi đó là lọc bỏ chúng khỏi truy vấn —
   * tức bịt mắt sổ. (Đường TỪ CHỐI thì vẫn ghi `Denied`: guard áp đồng nhất cho cả 4 route, xem
   * `ChatOversightAuditGuard`.)
   *
   * ═══ S7-CHAT-BE-9 — bộ lọc chạy ở SERVER ═══
   *
   * `actorUserId` + `from`/`to` (NGÀY theo TZ công ty) được quy đổi và áp ở truy vấn, KHÔNG phải lọc trên
   * các dòng FE đã tải: lọc trên một tập con làm người đọc kết luận "không có lần truy cập nào" trong khi
   * bằng chứng nằm ở trang chưa tải — đúng thứ SPEC-15 §18 gọi là audit không dùng được làm kiểm soát.
   *
   * ⚠️ **Thứ tự ba bước dưới đây có ý nghĩa**: giải TZ → dựng filter → mới giải con trỏ. Con trỏ mang dấu
   * vân của FILTER ĐÃ QUY ĐỔI, nên không thể kiểm nó trước khi biết TZ.
   */
  async listAudit(
    actor: ChatActor,
    query: ChatOversightAuditQuery,
  ): Promise<ChatOversightAuditResponseDto> {
    const filter = await this.buildAuditFilter(actor.companyId, query);

    // Con trỏ hỏng, hoặc sinh ra dưới bộ lọc KHÁC → 400 NGAY, trước khi mở transaction. KHÔNG im lặng rơi
    // về trang đầu (vòng lặp vô hạn ở FE) và KHÔNG im lặng trả một trang cắt theo tập kết quả khác.
    const cursor =
      query.cursor === undefined ? undefined : decodeOversightAuditCursor(query.cursor, filter);

    return this.db.withTenant(actor.companyId, async (tx) => {
      const rows = await this.repo.listOversightAudit(tx, actor.companyId, {
        limit: query.limit,
        cursor,
        ...filter,
      });
      const hasMore = rows.length > query.limit;
      const page = hasMore ? rows.slice(0, query.limit) : rows;
      const last = page[page.length - 1];

      return {
        data: page.map(toOversightAuditEntryDto),
        nextCursor:
          hasMore && last
            ? encodeOversightAuditCursor({ sortAt: last.sortAt, id: last.id }, filter)
            : null,
      };
    });
  }

  /**
   * Query → bộ lọc đã quy đổi. Chỉ đọc TZ khi request THỰC SỰ lọc theo ngày — không lọc ngày thì không
   * tốn truy vấn nào, và màn nhật ký lật trang liên tục nên đó không phải vi mô-tối-ưu.
   */
  private async buildAuditFilter(
    companyId: string,
    query: ChatOversightAuditQuery,
  ): Promise<ChatOversightAuditFilter> {
    const needsTimeZone = query.from !== undefined || query.to !== undefined;
    if (!needsTimeZone) {
      return query.actorUserId === undefined ? {} : { actorUserId: query.actorUserId };
    }
    return resolveAuditFilter(query, await this.resolveCompanyTimeZone(companyId));
  }

  /**
   * TZ công ty cho bộ lọc NGÀY của CHAT-API-019 — đọc **cột `companies.timezone`**.
   *
   * ┌─ ⚠️ ĐỌC ĐÚNG NGUỒN MÀ SẢN PHẨM GHI — BẢN ĐẦU CỦA WO NÀY ĐỌC SAI ────────────────────────────────┐
   * │ Bản đầu đọc khoá KV `company.timezone` qua `SettingService` (DB-10 §11.2 có khai khoá đó). Đo     │
   * │ thật 04/08/2026: **KHÔNG một writer nào** tồn tại cho khoá KV ấy — `company_settings` và          │
   * │ `system_settings` đều 0 hàng, và toàn `apps/api` chỉ có entry mặc định hard-coded ở               │
   * │ `setting-defaults.ts`. Ô múi giờ mà admin thật sự bấm (`apps/console/src/routes/settings/         │
   * │ company.tsx` → `PATCH /settings/company` → `SettingsService.updateCompanySettings`) ghi vào       │
   * │ **cột `companies.timezone`**, và DASHBOARD đã đọc đúng cột đó.                                    │
   * │                                                                                                   │
   * │ Hậu quả nếu giữ bản đầu: admin đổi múi giờ sang New York ⇒ DASHBOARD tính theo New York, còn      │
   * │ CHAT-SCREEN-008 vẫn cắt cửa sổ theo mặc định VN. Người điều tra hỏi "ngày 15/01 ai đọc-vượt?" và  │
   * │ nhận về **thiếu nửa ngày bằng chứng, HTTP 200, không lỗi** — đúng loại hỏng mà chính WO này sinh   │
   * │ ra để bịt, chỉ khác là "hai người ở hai múi giờ" trở thành "hai module của cùng một sản phẩm".    │
   * │ Ca int-spec 26e vì thế phải ghim **NGUỒN** (`companies.timezone`), không chỉ ghim CƠ CHẾ.         │
   * │                                                                                                   │
   * │ Khoá KV `company.timezone` hiện là **hàng chết** (khai trong DB-10 nhưng không ai ghi). Nếu sau    │
   * │ này owner chốt KV mới là canonical thì phải đổi CẢ DASHBOARD trong cùng nhịp — hai định nghĩa      │
   * │ "ngày của công ty" cùng sống là chỗ drift tiếp theo.                                              │
   * └───────────────────────────────────────────────────────────────────────────────────────────────────┘
   *
   * ⚠️ **FAIL-SAFE, KHÔNG ném.** `assertValidTimezone` đã chặn ở biên GHI (`SettingsService`), nên nhánh
   * dưới chỉ với tới khi hàng công ty hỏng/vắng. Làm chết cả màn nhật ký vì một ô cấu hình hỏng thì tệ hơn
   * chạy theo mặc định: CHAT-SCREEN-008 là công cụ điều tra. Nhưng **im lặng thì không được** — mọi nhánh
   * degrade đều `logger.warn`, và người đọc còn `createdAt` nguyên vẹn của từng dòng để tự đối chiếu.
   *
   * ⚠️ Mặc định lấy từ `getSettingDefault` (registry DB-10 §11.2) — KHÔNG viết lại chuỗi
   * `"Asia/Ho_Chi_Minh"` ở đây. Bản sao thứ hai của giá trị mặc định là nguồn drift, và repo đã có sẵn
   * một bản (`dashboard-widget-handlers.service.ts` `DEFAULT_TZ`); không thêm bản thứ ba.
   */
  private async resolveCompanyTimeZone(companyId: string): Promise<string> {
    const fallback = COMPANY_TIMEZONE_FALLBACK;

    const rows = await this.db.withTenant(companyId, async (tx) =>
      tx
        .select({ timezone: companies.timezone })
        .from(companies)
        // ⚠️ `eq(companies.id, companyId)` là vế **CHỊU LỰC**, KHÔNG phải trang trí — đừng "dọn" nó vì
        // thấy đã nằm trong `withTenant`. Đo thật (FULL gate vòng 2): `companies` có HAI policy
        // PERMISSIVE, và `companies_all_tenant_read` mang `qual = true`; policy permissive OR với nhau
        // ⇒ **RLS KHÔNG thu hẹp SELECT trên bảng này**. Bỏ vế id đi thì câu thành "lấy múi giờ của một
        // công ty BẤT KỲ" — im lặng, HTTP 200, và cửa sổ lọc của cả màn điều tra chạy sai.
        .where(and(eq(companies.id, companyId), isNull(companies.deletedAt)))
        .limit(1),
    );

    const value = rows[0]?.timezone;
    if (typeof value !== "string" || value === "") {
      this.logger.warn(
        `companies.timezone vắng (company ${companyId}) — bộ lọc CHAT-API-019 dùng ${fallback}.`,
      );
      return fallback;
    }

    try {
      assertValidTimezone(value);
      return value;
    } catch {
      this.logger.warn(
        `companies.timezone không phải IANA hợp lệ (company ${companyId}) — bộ lọc CHAT-API-019 dùng ${fallback}.`,
      );
      return fallback;
    }
  }

  /**
   * Ghi dòng `Success` TRONG tx đang mở. Lỗi ⇒ **500 CHAT-ERR-020** ⇒ `withTenant` rollback ⇒ 0 byte.
   *
   * ⚠️ `try/catch` bọc HẸP đúng lời gọi audit, KHÔNG bao câu đọc phía trên: bao rộng thì một lỗi đọc
   * (phòng biến mất giữa chừng, DB rớt) cũng bị báo là "lỗi ghi nhật ký" — sai nguyên nhân trên đúng
   * đường mà chẩn đoán đúng là quan trọng nhất.
   *
   * ⚠️ Ném `InternalServerErrorException` chứ KHÔNG nuốt-rồi-trả-rỗng: `200` với thân rỗng LÀ
   * "đọc-vượt không dấu vết" ngụy trang thành kết quả trống (API-13 §8).
   */
  private async recordSuccess(
    tx: TenantTx,
    actor: ChatActor,
    endpoint: ChatOversightEndpoint,
    roomId: string | null,
    criteria: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.audit.record(
        tx,
        chatOversightAuditEntry({
          actorUserId: actor.id,
          endpoint,
          roomId,
          resultStatus: "Success",
          criteria,
        }),
      );
    } catch (err: unknown) {
      throw new InternalServerErrorException(CHAT_ERR.OVERSIGHT_AUDIT_FAILED, {
        cause: err instanceof Error ? err : undefined,
      });
    }
  }
}
