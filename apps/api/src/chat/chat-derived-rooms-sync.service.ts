import { Injectable, Logger } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";
import { AuditService } from "../events/audit.service";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { employeeProfiles } from "../db/schema";
import { ChatRoomCodeService } from "./chat-room-code.service";
import { ChatRoomsRepository } from "./chat-rooms.repository";
import { RealtimeEmitterService } from "../realtime/realtime-emitter.service";
import { CHAT_AUDIT, CHAT_MODULE_CODE } from "./chat.errors";
import {
  desiredDerivedPairsSql,
  type DerivedMembershipScope,
} from "./chat-derived-rooms-predicates";

/**
 * Ai gây ra lần đồng bộ này. `kind` quyết định `actor_type` của dòng audit — `'system'` khi một người vừa
 * ghi HR/TASK và hệ thống suy ra hệ quả, `'job'` khi nhịp đối soát tự chạy (KHÔNG người nào đứng sau).
 */
export interface ChatSyncActor {
  kind: "system" | "job";
  userId?: string | null;
}

/**
 * Lỗi của **đường THU HỒI** — lớp riêng để writer nghiệp vụ phân biệt được "hỏng ở nhánh rời phòng"
 * với lỗi nghiệp vụ của chính nó (trùng mã nhân viên, sai tham chiếu…).
 *
 * Vì sao cần phân biệt: chỉ nhánh này mới phải ghi audit `Failure` ở transaction riêng. Bắt nhầm lỗi
 * nghiệp vụ thành lỗi sync sẽ đẻ ra dòng audit sai ngữ cảnh trong một bảng append-only — không sửa được.
 */
export class ChatSyncRevokeError extends Error {
  constructor(
    readonly reason: unknown,
    readonly context: { companyId: string; userId: string | null },
  ) {
    super("CHAT: thu hồi tư cách thành viên phòng dẫn xuất THẤT BẠI");
    this.name = "ChatSyncRevokeError";
  }
}

interface PairRow {
  room_id: string;
  user_id: string;
}

const PG_UNIQUE_VIOLATION = "23505";

function isConstraintConflict(err: unknown, constraint: string): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: unknown; constraint?: unknown };
  return e.code === PG_UNIQUE_VIOLATION && e.constraint === constraint;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * PHÂN LOẠI lỗi thành chuỗi ổn định, KHÔNG mang nội dung tự do — dùng cho dòng audit `Failure`.
 *
 * Vì sao không ghi `err.message`: drizzle bọc MỌI lỗi query thành `DrizzleQueryError` với message
 * `Failed query: <SQL đầy đủ>\nparams: <mảng bind>`, và `23505` của Postgres còn kèm `Key (a,b)=(giá trị)`.
 * `AuditMaskerService` mask theo TÊN KHOÁ nên một chuỗi tự do đi qua nguyên vẹn — mà `audit_logs` là bảng
 * app role KHÔNG có UPDATE/DELETE. Ghi nhầm một lần là vĩnh viễn.
 *
 * `scrubErrorMessage` (scheduler) che được `password=…`/`scheme://user:pass@host` nhưng KHÔNG che câu SQL
 * lẫn giá trị hàng, nên nó không đủ cho đường này. Toàn văn vẫn đi vào `logger.error` — nơi có xoay vòng.
 */
function classifyFailure(err: unknown): string {
  let cur: unknown = err;
  for (let depth = 0; depth < 3 && cur !== null && typeof cur === "object"; depth++) {
    const e = cur as { code?: unknown; cause?: unknown; name?: unknown };
    if (typeof e.code === "string" && e.code.length > 0) return `pg:${e.code}`;
    if (depth === 0 && typeof e.name === "string" && e.name.length > 0 && !e.cause) return e.name;
    cur = e.cause;
  }
  return err instanceof Error ? err.name : "unknown";
}

/**
 * S7-CHAT-BE-5 — phòng chat dẫn xuất theo phòng ban & dự án (SPEC-15 §3.1 · §13.3 · DB-12 §6).
 *
 * ══ Hình dạng đã chốt (micro-plan rev 3, mục B2) ══
 * MỌI writer phía nhân viên gọi **đúng một** hàm: `syncUserDerivedMembershipTx`. Hàm đó KHÔNG nhận biết
 * trường nào vừa đổi — nó **tính lại tập mong muốn** cho người đó rồi **diff với tập thực tế** và áp
 * chênh lệch. Đó là lý do 9 điểm ghi phía nhân viên không thể bỏ sót trường nào: không có nhánh
 * `if (dto.status)` nào để quên. Bản rev 2 chọn hình dạng "mỗi writer tự quyết trường nào đổi thì thu
 * hồi gì" = 9 bản sao của một luật, và đã bỏ sót đúng một trong chín.
 *
 * ══ Hai nửa, hai chính sách lỗi (owner chốt 02/08, điểm 2 & 3) ══
 *   • **THU HỒI (rời phòng)** — LOUD. KHÔNG bọc `SAVEPOINT`: lỗi propagate, tx nghiệp vụ rollback TOÀN
 *     BỘ. Cửa sổ "đã đổi phòng ban nhưng vẫn đọc được phòng cũ" = 0. Kèm audit `Failure` ở tx RIÊNG.
 *   • **CẤP (vào phòng)** — best-effort, bọc `SAVEPOINT`. "Thiếu một phòng ≠ rò quyền đọc": nhịp job kế
 *     tiếp sẽ vá. Chặn cả `updateEmployee` chỉ vì phòng đích chưa kịp sinh là đánh đổi sai chiều.
 *
 * ══ Vì sao đúng MỘT câu SQL cho cả hook lẫn job ══
 * Cả hai gọi `applyLeavesTx`/`applyJoinsTx` với `scope` khác nhau (hook: `{userId}`, job: `{}`). Vị từ
 * "tập mong muốn" **được tái kiểm ngay trong `WHERE` của chính câu ghi** (`chat-derived-rooms-predicates.ts`)
 * chứ không đọc-trước-rồi-ghi-theo-danh-sách — nên một hook chạy xen giữa hai pha của job không bị ghi
 * đè bằng trạng thái cũ hơn.
 */
@Injectable()
export class ChatDerivedRoomsSyncService {
  private readonly logger = new Logger(ChatDerivedRoomsSyncService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: ChatRoomsRepository,
    private readonly roomCode: ChatRoomCodeService,
    private readonly audit: AuditService,
    // S7-CHAT-RT-1 (additive) — CHỈ dùng cho nhánh THU HỒI, xem `forceSocketLeave`.
    private readonly realtime: RealtimeEmitterService,
  ) {}

  // ═══════════════════ Hook — đường DUY NHẤT của 14 writer ═══════════════════

  /**
   * Tính lại + áp chênh lệch tư cách thành viên phòng dẫn xuất cho MỘT người.
   *
   * `userId = null` ⇒ no-op im lặng: nhân viên chưa có tài khoản thì không có gì để thêm vào phòng
   * (`chat_room_members` khoá theo `user_id`). Đây là trạng thái hợp lệ, KHÔNG phải lỗi.
   *
   * @throws {ChatSyncRevokeError} khi nhánh THU HỒI hỏng — writer nghiệp vụ PHẢI để nó nổi lên.
   */
  async syncUserDerivedMembershipTx(
    tx: TenantTx,
    companyId: string,
    userId: string | null,
    actor: ChatSyncActor,
  ): Promise<void> {
    if (!userId) return;
    const scope: DerivedMembershipScope = { userId };

    try {
      await this.applyLeavesTx(tx, companyId, scope, actor);
      await this.applyOffboardLeavesTx(tx, companyId, scope, actor);
    } catch (err) {
      throw new ChatSyncRevokeError(err, { companyId, userId });
    }

    // SAVEPOINT: lỗi ở đây (vd phòng đích chưa tồn tại rồi đua với một tx khác) KHÔNG được abort
    // transaction nghiệp vụ. Không có SAVEPOINT thì try/catch là vô nghĩa — Postgres đã abort cả tx,
    // mọi câu sau đó trả 25P02 (micro-plan §3.2).
    try {
      await tx.transaction((sp) => this.applyJoinsTx(sp, companyId, scope, actor));
    } catch (err) {
      this.logger.warn(
        `CHAT: vào phòng dẫn xuất thất bại (KHÔNG chặn ghi nghiệp vụ) user=${userId}: ${messageOf(err)}`,
      );
    }
  }

  // ═══════════════════ Hai câu ghi — dùng chung hook & job ═══════════════════

  /**
   * RỜI: mọi hàng membership ĐANG hoạt động của phòng dẫn xuất **còn mở** mà cặp (phòng, người) không
   * còn trong tập mong muốn.
   *
   * `is_archived = false` ở vế phòng là CỐ Ý: lưu trữ phòng **đóng băng** danh sách thành viên. Không có
   * vế này thì đóng dự án (W4) sẽ đuổi mọi người khỏi phòng, và vì `listRoomsForUser` đòi
   * `left_at IS NULL` kể cả ở danh sách `archived=true`, họ sẽ mất luôn đường đọc lại lịch sử.
   */
  private async applyLeavesTx(
    tx: TenantTx,
    companyId: string,
    scope: DerivedMembershipScope,
    actor: ChatSyncActor,
  ): Promise<number> {
    const desired = desiredDerivedPairsSql(companyId, scope);
    const userFilter = scope.userId ? sql`AND m.user_id = ${scope.userId}::uuid` : sql``;

    const res = await tx.execute(sql`
      UPDATE chat_room_members m
      SET left_at = now()
      FROM chat_rooms r
      WHERE m.company_id = ${companyId}::uuid
        AND r.company_id = ${companyId}::uuid
        AND r.id = m.room_id
        AND r.sync_source IN ('department', 'project')
        AND r.deleted_at IS NULL
        AND r.is_archived = false
        AND m.left_at IS NULL
        ${userFilter}
        AND NOT EXISTS (
          SELECT 1 FROM ${desired} d
          WHERE d.room_id = m.room_id AND d.user_id = m.user_id
        )
      RETURNING m.room_id AS room_id, m.user_id AS user_id
    `);

    const rows = (res as unknown as { rows: PairRow[] }).rows ?? [];
    for (const row of rows) {
      await this.recordMembershipAudit(tx, CHAT_AUDIT.MEMBER_AUTO_REMOVED, row, actor);
      this.forceSocketLeave(companyId, row);
    }
    return rows.length;
  }

  /**
   * RỜI (vế thứ hai) — **rời công ty thì rời cả phòng ĐÃ LƯU TRỮ**.
   *
   * `applyLeavesTx` cố ý bỏ qua phòng đã lưu trữ để "lưu trữ = đóng băng danh sách thành viên". Nhưng đóng
   * băng phải theo **tư cách NGƯỜI**, không theo trạng thái PHÒNG — nếu không thì chuỗi này để hở:
   *
   *   đóng dự án (phòng lưu trữ, mọi người giữ nguyên membership — ĐÚNG)
   *   → nhân viên nghỉ việc / xoá mềm hồ sơ / gỡ tài khoản
   *   → `applyLeavesTx` không chạm phòng đã lưu trữ ⇒ `left_at` vẫn NULL
   *   → `assertMember` KHÔNG có vế `is_archived`, `listRoomsForUser(archived=true)` vẫn trả phòng đó
   *   → người đã nghỉ đăng nhập lại (đăng nhập chỉ gate `users.status`, KHÔNG gate trạng thái nhân sự;
   *     `lockUser` là TUỲ CHỌN và `deleteEmployee`/`unlinkUser` không chạm `users`) và đọc TOÀN BỘ lịch sử
   *     dự án — CHAT-DEC-008 không cắt lịch sử.
   *
   * SPEC-15 §13.3 nói "rời **MỌI** phòng dẫn xuất", không phải "mọi phòng còn mở".
   *
   * Vế phân biệt hai ca: người chỉ **đổi phòng ban / rời một dự án** vẫn còn hồ sơ `active` ⇒ KHÔNG bị câu
   * này đụng, giữ nguyên quyền đọc lại phòng cũ đã lưu trữ. Người **rời công ty** không còn hồ sơ `active`
   * nào ⇒ rời sạch. Phòng đã xoá mềm không cần xử lý: `assertMember` đã lọc `deleted_at`.
   */
  private async applyOffboardLeavesTx(
    tx: TenantTx,
    companyId: string,
    scope: DerivedMembershipScope,
    actor: ChatSyncActor,
  ): Promise<number> {
    const userFilter = scope.userId ? sql`AND m.user_id = ${scope.userId}::uuid` : sql``;

    const res = await tx.execute(sql`
      UPDATE chat_room_members m
      SET left_at = now()
      FROM chat_rooms r
      WHERE m.company_id = ${companyId}::uuid
        AND r.company_id = ${companyId}::uuid
        AND r.id = m.room_id
        AND r.sync_source IN ('department', 'project')
        AND r.is_archived = true
        AND m.left_at IS NULL
        ${userFilter}
        AND NOT EXISTS (
          SELECT 1 FROM employee_profiles ep
          WHERE ep.company_id = ${companyId}::uuid
            AND ep.user_id = m.user_id
            AND ep.status = 'active'
            AND ep.deleted_at IS NULL
        )
      RETURNING m.room_id AS room_id, m.user_id AS user_id
    `);

    const rows = (res as unknown as { rows: PairRow[] }).rows ?? [];
    for (const row of rows) {
      await this.recordMembershipAudit(tx, CHAT_AUDIT.MEMBER_AUTO_REMOVED, row, actor);
      this.forceSocketLeave(companyId, row);
    }
    return rows.length;
  }

  /**
   * VÀO: mọi cặp mong muốn chưa có hàng membership hoạt động.
   *
   * `ON CONFLICT … DO UPDATE SET left_at = NULL` tái dùng ĐÚNG hàng cũ của người từng rời phòng — unique
   * `(room_id,user_id)` không cho hàng thứ hai, và `joined_at`/`added_by` KHÔNG nằm trong 6 cột được cấp
   * UPDATE (`0538`) nên không thể làm mới hai cột đó dù có muốn.
   *
   * ⚠️ TUYỆT ĐỐI KHÔNG set `visible_from_seq` ở đây. Cột đó NẰM TRONG tập cột UPDATE-được, nên viết vào
   * là **chạy được, không lỗi gì** — và lặng lẽ lật CHAT-DEC-008 ("người mới đọc được toàn bộ lịch sử",
   * tiêu chí nghiệm thu SPEC-15 §20 mục 3). Ca test 21 là đai duy nhất gác điều này.
   */
  private async applyJoinsTx(
    tx: TenantTx,
    companyId: string,
    scope: DerivedMembershipScope,
    actor: ChatSyncActor,
  ): Promise<number> {
    const desired = desiredDerivedPairsSql(companyId, scope);

    const res = await tx.execute(sql`
      INSERT INTO chat_room_members (company_id, room_id, user_id, role, added_by)
      SELECT ${companyId}::uuid, d.room_id, d.user_id, 'member', NULL
      FROM ${desired} d
      WHERE NOT EXISTS (
        SELECT 1 FROM chat_room_members m
        WHERE m.company_id = ${companyId}::uuid
          AND m.room_id = d.room_id
          AND m.user_id = d.user_id
          AND m.left_at IS NULL
      )
      ON CONFLICT (room_id, user_id) DO UPDATE SET left_at = NULL
      RETURNING room_id, user_id
    `);

    const rows = (res as unknown as { rows: PairRow[] }).rows ?? [];
    for (const row of rows) {
      await this.recordMembershipAudit(tx, CHAT_AUDIT.MEMBER_AUTO_ADDED, row, actor);
    }
    return rows.length;
  }

  /**
   * S7-CHAT-RT-1 — đá socket của người vừa bị THU HỒI tư cách thành viên phòng dẫn xuất ra khỏi room
   * Socket.IO NGAY, không đợi họ kết nối lại (SPEC-15 §13.3).
   *
   * ⚠️ Gọi TRONG transaction nghiệp vụ — CỐ Ý, và là NGOẠI LỆ DUY NHẤT của luật "emit sau commit".
   * Lý do: `syncUserDerivedMembershipTx` nhận `tx` từ 14 writer ở các module khác (employees · org ·
   * tasks · recycle-bin) và không sở hữu vòng đời transaction đó; `DatabaseService.withTenant` KHÔNG có
   * hook after-commit. Thread điểm gọi ra ngoài cả 14 writer nằm ngoài phạm vi WO này.
   *
   * An toàn vì HƯỚNG của sai số: nếu tx rollback, ta đã đá một socket ra khỏi phòng mà đáng lẽ họ còn ở
   * trong — hệ quả là mất realtime của phòng đó tới lần reconnect kế tiếp (`handleConnection` tra lại DB
   * và join đúng trạng thái thật). Đó là FAIL-SAFE. Chiều ngược lại — `socketsJoin` trước commit — mới
   * là rò: kéo người vào phòng họ rốt cuộc không thuộc.
   *
   * ⚠️ Vì thế nhánh VÀO (`applyJoinsTx`) CỐ Ý KHÔNG được wire ở đây. Bỏ sót một join chỉ làm người dùng
   * chưa thấy realtime của phòng mới tới lần reconnect — không phải lỗ bảo mật. Đừng "cho đối xứng".
   */
  private forceSocketLeave(companyId: string, row: PairRow): void {
    this.realtime.syncRoomMembership(companyId, row.room_id, row.user_id, "leave");
  }

  private async recordMembershipAudit(
    tx: TenantTx,
    action: string,
    row: PairRow,
    actor: ChatSyncActor,
  ): Promise<void> {
    await this.audit.record(tx, {
      action,
      objectType: "chat_room",
      objectId: row.room_id,
      // Job KHÔNG có actor người — bỏ trống chứ không mượn id của ai (dòng audit phải nói đúng sự thật).
      actorUserId: actor.kind === "system" ? (actor.userId ?? undefined) : undefined,
      actorType: actor.kind === "system" ? "System" : "Job",
      moduleCode: CHAT_MODULE_CODE,
      resultStatus: "Success",
      newValues: { userId: row.user_id },
    });
  }

  // ═══════════════════ Đối soát toàn tenant (Pha 3 của job) ═══════════════════

  /** Diff set-based cho TOÀN tenant. Lỗi propagate — JobRunner đánh dấu lần chạy `Failed`. */
  async reconcileMembershipTx(
    tx: TenantTx,
    companyId: string,
    actor: ChatSyncActor,
  ): Promise<{ joined: number; left: number }> {
    const left =
      (await this.applyLeavesTx(tx, companyId, {}, actor)) +
      (await this.applyOffboardLeavesTx(tx, companyId, {}, actor));
    const joined = await this.applyJoinsTx(tx, companyId, {}, actor);
    return { joined, left };
  }

  // ═══════════════════ Tạo/đóng phòng — NGOÀI transaction nghiệp vụ ═══════════════════

  /**
   * Bảo đảm org_unit có phòng `department`. Idempotent, 3 lớp chống trùng (mirror `openDirect`):
   * tra trước khi cấp mã → tra lại trong tx → bắt `23505` của ĐÚNG `chat_rooms_org_unit_uq` rồi SELECT lại.
   *
   * Chạy NGOÀI tx nghiệp vụ vì `roomCode.allocate` tự mở `withTenant` (không lồng được — owner điểm 3).
   * Thành viên hiện có được seed TRONG CÙNG tx tạo phòng ⇒ phòng không bao giờ ra đời rỗng rồi chờ job.
   */
  async ensureOrgUnitRoom(
    companyId: string,
    orgUnitId: string,
    name: string,
    actor: ChatSyncActor,
  ): Promise<string> {
    const existing = await this.db.withTenant(companyId, (tx) =>
      this.repo.findRoomByOrgUnitId(tx, companyId, orgUnitId),
    );
    if (existing) return this.reviveIfTombstoned(companyId, existing, actor);

    const roomCode = await this.roomCode.allocate(companyId);
    try {
      return await this.db.withTenant(companyId, async (tx) => {
        const again = await this.repo.findRoomByOrgUnitId(tx, companyId, orgUnitId);
        if (again) return again.id;

        const room = await this.repo.insertRoom(tx, {
          companyId,
          roomType: "department",
          orgUnitId,
          name,
          description: null,
          roomCode,
          createdBy: actor.kind === "system" ? (actor.userId ?? null) : null,
        });
        await this.recordRoomAudit(tx, CHAT_AUDIT.ROOM_AUTO_CREATED, room.id, actor, {
          roomType: "department",
          orgUnitId,
          name,
        });
        await this.applyJoinsTx(tx, companyId, { roomId: room.id }, actor);
        return room.id;
      });
    } catch (err) {
      if (!isConstraintConflict(err, "chat_rooms_org_unit_uq")) throw err;
      const raced = await this.db.withTenant(companyId, (tx) =>
        this.repo.findRoomByOrgUnitId(tx, companyId, orgUnitId),
      );
      if (!raced) throw err;
      return raced.id;
    }
  }

  /** Như trên cho dự án (`chat_rooms.ref_id`, unique `chat_rooms_project_uq`). */
  async ensureProjectRoom(
    companyId: string,
    projectId: string,
    name: string,
    actor: ChatSyncActor,
  ): Promise<string> {
    const existing = await this.db.withTenant(companyId, (tx) =>
      this.repo.findRoomByRefId(tx, companyId, projectId),
    );
    if (existing) return this.reviveIfTombstoned(companyId, existing, actor);

    const roomCode = await this.roomCode.allocate(companyId);
    try {
      return await this.db.withTenant(companyId, async (tx) => {
        const again = await this.repo.findRoomByRefId(tx, companyId, projectId);
        if (again) return again.id;

        const room = await this.repo.insertRoom(tx, {
          companyId,
          roomType: "project",
          refId: projectId,
          name,
          description: null,
          roomCode,
          createdBy: actor.kind === "system" ? (actor.userId ?? null) : null,
        });
        await this.recordRoomAudit(tx, CHAT_AUDIT.ROOM_AUTO_CREATED, room.id, actor, {
          roomType: "project",
          projectId,
          name,
        });
        await this.applyJoinsTx(tx, companyId, { roomId: room.id }, actor);
        return room.id;
      });
    } catch (err) {
      if (!isConstraintConflict(err, "chat_rooms_project_uq")) throw err;
      const raced = await this.db.withTenant(companyId, (tx) =>
        this.repo.findRoomByRefId(tx, companyId, projectId),
      );
      if (!raced) throw err;
      return raced.id;
    }
  }

  /**
   * Phòng dẫn xuất bị xoá mềm = ngõ cụt nếu không xử lý: `findRoomBy*` CỐ Ý không lọc `deleted_at` (unique
   * partial phủ cả tombstone, nên INSERT phòng mới sẽ là `23505`), nên nếu ta trả thẳng id của tombstone
   * thì org_unit/dự án đó **vĩnh viễn không có phòng sống** và không nhịp nào phát hiện được.
   *
   * Hồi sinh đúng hàng cũ — mirror `resurrectDirect` của `openDirect` (BE-1). Hôm nay chưa đường code nào
   * set `deleted_at` cho phòng dẫn xuất, nên đây là lưới chờ sẵn cho WO thêm "xoá phòng" về sau; nó ghi
   * audit để việc hồi sinh không diễn ra âm thầm.
   */
  private async reviveIfTombstoned(
    companyId: string,
    room: { id: string; deletedAt: Date | null },
    actor: ChatSyncActor,
  ): Promise<string> {
    if (!room.deletedAt) return room.id;
    await this.db.withTenant(companyId, async (tx) => {
      await this.repo.restoreRoom(tx, companyId, room.id);
      await this.recordRoomAudit(tx, CHAT_AUDIT.ROOM_AUTO_CREATED, room.id, actor, {
        revivedFromTombstone: true,
      });
    });
    this.logger.warn(`CHAT: hồi sinh phòng dẫn xuất đã xoá mềm room=${room.id}`);
    return room.id;
  }

  /** Đóng phòng của dự án đã kết thúc/xoá. Idempotent: phòng đã lưu trữ ⇒ no-op, không ghi audit lần hai. */
  async archiveProjectRoom(
    companyId: string,
    projectId: string,
    actor: ChatSyncActor,
  ): Promise<void> {
    await this.db.withTenant(companyId, async (tx) => {
      const room = await this.repo.findRoomByRefId(tx, companyId, projectId);
      await this.archiveRoomIfOpen(tx, companyId, room, actor, { projectId });
    });
  }

  /**
   * Đối xứng cho phòng ban bị xoá mềm / chuyển `inactive` / đổi sang `type` không đủ điều kiện.
   *
   * Thiếu hàm này thì `deleteOrgUnit` để lại một phòng chat SỐNG — vẫn nhận tin mới, thành viên nguyên
   * vẹn, không dấu vết. Vị từ thành viên nối qua `r.org_unit_id = ep.org_unit_id` và không đọc bảng
   * `org_units` lần nào, nên nó cũng không tự thấy phòng ban đã biến mất.
   */
  async archiveOrgUnitRoom(
    companyId: string,
    orgUnitId: string,
    actor: ChatSyncActor,
  ): Promise<void> {
    await this.db.withTenant(companyId, async (tx) => {
      const room = await this.repo.findRoomByOrgUnitId(tx, companyId, orgUnitId);
      await this.archiveRoomIfOpen(tx, companyId, room, actor, { orgUnitId });
    });
  }

  private async archiveRoomIfOpen(
    tx: TenantTx,
    companyId: string,
    room: { id: string; isArchived: boolean; deletedAt: Date | null } | undefined,
    actor: ChatSyncActor,
    newValues: Record<string, unknown>,
  ): Promise<void> {
    if (!room || room.isArchived || room.deletedAt) return;
    await this.repo.archiveRoom(
      tx,
      companyId,
      room.id,
      actor.kind === "system" ? (actor.userId ?? null) : null,
    );
    await this.recordRoomAudit(tx, CHAT_AUDIT.ROOM_AUTO_ARCHIVED, room.id, actor, newValues);
  }

  // ═══════════════════ Vỏ best-effort cho writer nghiệp vụ ═══════════════════
  //
  // Đường TẠO/ĐÓNG phòng không phải đường quyền: hỏng ⇒ thiếu một phòng, nhịp job kế tiếp vá. Nuốt lỗi
  // ở ĐÚNG MỘT chỗ (đây) thay vì 5 khối try/catch chép tay rải khắp org/tasks — mỗi bản chép là một cơ
  // hội để ai đó vô tình biến nó thành fail-loud hoặc ngược lại.

  async tryEnsureOrgUnitRoom(
    companyId: string,
    orgUnitId: string,
    name: string,
    actor: ChatSyncActor,
  ): Promise<void> {
    try {
      await this.ensureOrgUnitRoom(companyId, orgUnitId, name, actor);
    } catch (err) {
      this.logger.warn(`CHAT: tạo phòng phòng-ban thất bại org=${orgUnitId}: ${messageOf(err)}`);
    }
  }

  async tryEnsureProjectRoom(
    companyId: string,
    projectId: string,
    name: string,
    actor: ChatSyncActor,
  ): Promise<void> {
    try {
      await this.ensureProjectRoom(companyId, projectId, name, actor);
    } catch (err) {
      this.logger.warn(`CHAT: tạo phòng dự án thất bại project=${projectId}: ${messageOf(err)}`);
    }
  }

  async tryArchiveProjectRoom(
    companyId: string,
    projectId: string,
    actor: ChatSyncActor,
  ): Promise<void> {
    try {
      await this.archiveProjectRoom(companyId, projectId, actor);
    } catch (err) {
      this.logger.warn(`CHAT: đóng phòng dự án thất bại project=${projectId}: ${messageOf(err)}`);
    }
  }

  // ═══════════════════ Kênh audit THẤT BẠI (transaction RIÊNG) ═══════════════════

  /**
   * Ghi dấu vết cho một lần THU HỒI hỏng. Gọi từ nhánh `catch` **NGOÀI** `withTenant` của writer — tại
   * đó tx gốc đã reject hẳn, nên `withTenant` mới ở đây KHÔNG lồng vào tx nào (lồng = xin connection thứ
   * hai trong lúc connection đầu còn giữ ⇒ treo trên PgBouncer transaction-mode).
   *
   * Bản thân nó best-effort: một lần ghi audit hỏng không được che mất lỗi GỐC mà writer sắp ném lên.
   */
  async recordRevokeFailureAudit(
    companyId: string,
    info: { userId: string | null; reason: string },
  ): Promise<void> {
    try {
      await this.db.withTenant(companyId, (tx) =>
        this.audit.record(tx, {
          action: CHAT_AUDIT.MEMBER_SYNC_FAILED,
          objectType: "chat_room",
          actorType: "System",
          moduleCode: CHAT_MODULE_CODE,
          resultStatus: "Failure",
          newValues: { userId: info.userId, reason: info.reason },
        }),
      );
    } catch (err) {
      this.logger.error(`CHAT: ghi audit thất-bại-thu-hồi KHÔNG thành công: ${messageOf(err)}`);
    }
  }

  /**
   * Vỏ dùng chung cho MỌI writer gọi sync: log ERROR (không phải WARN — WARN chìm dưới mức log mặc định
   * INFO+ của dashboard) rồi ghi audit `Failure`. KHÔNG nuốt lỗi: caller vẫn ném tiếp.
   */
  async reportRevokeFailure(companyId: string, err: ChatSyncRevokeError): Promise<void> {
    // Toàn văn CHỈ vào log; audit nhận PHÂN LOẠI ổn định. Lý do: drizzle bọc MỌI lỗi query thành
    // `DrizzleQueryError` với message `Failed query: <SQL>\nparams: <bind>` — ghi thẳng vào `audit_logs`
    // là chôn nguyên câu SQL kèm tham số bind vào một bảng KHÔNG sửa/xoá được. `AuditMaskerService` mask
    // theo TÊN KHOÁ nên chuỗi tự do đi qua nguyên vẹn, không có lưới nào phía sau.
    this.logger.error(
      `CHAT: THU HỒI phòng dẫn xuất THẤT BẠI — ghi nghiệp vụ đã rollback toàn bộ. user=${err.context.userId}: ${messageOf(err.reason)}`,
    );
    await this.recordRevokeFailureAudit(companyId, {
      userId: err.context.userId,
      reason: classifyFailure(err.reason),
    });
  }

  private async recordRoomAudit(
    tx: TenantTx,
    action: string,
    roomId: string,
    actor: ChatSyncActor,
    newValues: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.record(tx, {
      action,
      objectType: "chat_room",
      objectId: roomId,
      actorUserId: actor.kind === "system" ? (actor.userId ?? undefined) : undefined,
      actorType: actor.kind === "system" ? "System" : "Job",
      moduleCode: CHAT_MODULE_CODE,
      resultStatus: "Success",
      newValues,
    });
  }
}
