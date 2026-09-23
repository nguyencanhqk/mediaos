import { Injectable } from "@nestjs/common";
import type { TenantTx } from "../db/db.service";
import { auditLogs, type AuditObjectType } from "../db/schema";
import { AuditMaskerService } from "./audit-masker.service";

/**
 * 1 bản ghi audit. company_id KHÔNG truyền — lấy từ ngữ cảnh tenant (DB DEFAULT current_setting).
 *
 * v1 (GIỮ NGUYÊN — >100 caller phụ thuộc): action/objectType/objectId/actorUserId/before/after/ip/userAgent.
 * `objectType` BẮT BUỘC + giữ union `AuditObjectType` (KHÔNG nới — bất biến).
 *
 * v2 (FOUNDATION-BE-3, DB-08 §8.5 — TẤT CẢ OPTIONAL, additive): caller mới có thể điền cột DB-08; caller cũ
 * bỏ trống → cột v2 = null (nullable hợp lệ). Writer ghi ĐỒNG THỜI cặp v1 và v2 khi được cung cấp.
 */
export interface AuditEntry {
  action: string;
  objectType: AuditObjectType;
  objectId?: string;
  actorUserId?: string;
  before?: unknown;
  after?: unknown;
  ip?: string;
  userAgent?: string;
  // ── DB-08 §8.5 (optional, additive — mig 0432) ──
  moduleCode?: string;
  entityType?: string;
  entityId?: string;
  actorType?: string;
  oldValues?: unknown;
  newValues?: unknown;
  sensitivityLevel?: string;
  resultStatus?: string;
  requestId?: string;
  correlationId?: string;
  ipAddress?: string;
  // ── DB-08 §8.5 (optional, additive — mig 0438, 11 cột còn thiếu) ──
  actorEmployeeId?: string;
  actionGroup?: string;
  entityIdText?: string;
  entityCode?: string;
  permissionCode?: string;
  /** Phải ∈ {Own,Team,Department,Company,System} — ép enum ở tầng app (DB KHÔNG CHECK). */
  dataScope?: string;
  /** jsonb — MASK trước insert (có thể chứa token/ip nhạy cảm). */
  deviceInfo?: unknown;
  diffSummary?: string;
  errorCode?: string;
  errorMessage?: string;
  /** jsonb — MASK trước insert (có thể chứa khóa nhạy cảm tùy ngữ cảnh). */
  metadata?: unknown;
}

/**
 * Bộ enum hợp lệ ép ở TẦNG APP (fail-closed) TRƯỚC insert. 3 cột actor_type/sensitivity_level/
 * result_status có CHECK ở Postgres (mig 0432) — vỡ CHECK = lỗi 500 + xanh-giả, nên chặn ở app TRƯỚC.
 * data_scope KHÔNG có CHECK ở DB (mig 0438 note) → app là LỚP DUY NHẤT ép enum {Own,Team,Department,
 * Company,System}. NULL/undefined hợp lệ (additive — caller cũ không set).
 */
const AUDIT_ACTOR_TYPES = ["User", "System", "Job", "Integration"] as const;
const AUDIT_SENSITIVITY_LEVELS = ["Normal", "Sensitive", "HighlySensitive"] as const;
/**
 * EXPORT (S7-CHAT-CLEAN-2): đường ĐỌC cũng cần đúng danh sách này để nhãn hoá dòng audit
 * (`chat-oversight.mapper.ts`). Chép bản thứ hai là mời trôi — thêm giá trị ở đây mà quên bên kia thì
 * bên kia gán nhãn SAI, im lặng. Nguồn sự thật gốc vẫn là CHECK ở mig `0432`.
 */
export const AUDIT_RESULT_STATUSES = ["Success", "Failure", "Denied", "Error"] as const;
const AUDIT_DATA_SCOPES = ["Own", "Team", "Department", "Company", "System"] as const;

/**
 * Trần số hàng cho MỘT lượt `recordMany` — xem phép tính ở docblock của hàm.
 *
 * Đặt DƯỚI trần vỡ thật (2113) một quãng rộng để còn chỗ cho việc thêm cột vào `audit_logs` sau này:
 * mỗi cột mới kéo trần vỡ xuống, và một hằng sát mép sẽ biến một migration additive vô hại thành
 * lỗi driver giữa transaction nghiệp vụ.
 */
export const AUDIT_RECORD_MANY_MAX = 1000;

/**
 * Ghi audit append-only (BẤT BIẾN #2). PHẢI gọi BÊN TRONG cùng transaction nghiệp vụ (`withTenant`)
 * để audit và thay đổi nghiệp vụ cùng commit/rollback — không ghi nửa vời.
 *
 * BẤT BIẾN #3: before/after/oldValues/newValues được MASK (AuditMaskerService) TRƯỚC insert — khóa nhạy cảm
 * (password/token/secret/secret_ref/identity_number/bank_account/storage_path/signed_url) → "***". changed_fields
 * tính TỪ giá trị đã mask ⇒ chỉ chứa TÊN field, không lộ value.
 */
@Injectable()
export class AuditService {
  private readonly masker: AuditMaskerService;

  // masker optional ở chữ ký để KHÔNG vỡ >40 call-site `new AuditService()` trong test/legacy. Nest DI
  // luôn truyền AuditMaskerService thật (đã đăng ký EventsModule); thiếu → tự dựng default (cùng hàm mask).
  constructor(masker?: AuditMaskerService) {
    this.masker = masker ?? new AuditMaskerService();
  }

  /**
   * Tên field có giá trị khác nhau giữa `oldValues` và `newValues` (UNION key 2 vế; so sánh bằng JSON
   * stringify để bắt cả thay đổi object lồng nhau). KHÔNG trả value — chỉ TÊN field (an toàn, bất biến #3).
   * Cả 2 vế nên là dữ liệu ĐÃ MASK để field nhạy cảm (đã thành "***" hai bên) không bị tính là "đổi".
   */
  computeChangedFields(oldValues: unknown, newValues: unknown): string[] {
    const oldObj = this.asRecord(oldValues);
    const newObj = this.asRecord(newValues);
    const keys = new Set<string>([...Object.keys(oldObj), ...Object.keys(newObj)]);
    const changed: string[] = [];
    for (const key of keys) {
      if (!this.deepEqual(oldObj[key], newObj[key])) changed.push(key);
    }
    return changed;
  }

  async record(tx: TenantTx, entry: AuditEntry): Promise<void> {
    await tx.insert(auditLogs).values(this.buildRow(entry));
  }

  /**
   * Ghi NHIỀU dòng audit bằng **MỘT** câu INSERT (S16-SOCIAL-BE-2B-1, quyết định owner O-1).
   *
   * ┌─ VÌ SAO PHẢI CÓ, KHÔNG PHẢI VÒNG `for` GỌI `record()` ────────────────────────────────────────┐
   * │ Người gọi đầu tiên là job đóng bình chọn: nó ghi một dòng cho MỖI poll của lô (tối đa 200)   │
   * │ trong khi transaction ĐANG giữ khoá ghi trên đúng ngần ấy hàng `feed_polls`. `N` round-trip  │
   * │ ở đó là **chính xác** hình dạng mà FULL gate 23/09/2026 đã chặn ở đường NOTI (`database-      │
   * │ reviewer` H-1 + 3 nguồn) và là luật thành văn của `OutboxService.enqueueMany`. Thêm một       │
   * │ writer audit theo lô mà không có hàm này thì lựa chọn duy nhất còn lại là dòng-gộp — thứ làm │
   * │ CÙNG một `action` có hai hình dạng, đúng finding O-1.                                          │
   * └──────────────────────────────────────────────────────────────────────────────────────────────┘
   *
   * 🔴 **Dùng CHUNG `buildRow` với `record()`** — enum guard, mask-at-write, `changed_fields` đi qua
   * đúng một đường. Chép lại pipeline ở đây là mở đường cho một lô audit KHÔNG được mask.
   *
   * Mảng rỗng ⇒ no-op (drizzle ném thật với `values([])`). Trả **số hàng đã ghi** để call-site đối
   * chiếu được — cùng khuôn `enqueuePollClosedNotiManyTx`; một hàm ghi theo lô trả `void` là đúng
   * hình dạng "thành công RỖNG" mà FULL gate đã bắt ba lần trong module này.
   *
   * ⚠️ **Trần `AUDIT_RECORD_MANY_MAX`, ném khi vượt** (FULL gate lượt 2 — BA nguồn hội tụ). Phép
   * tính: `buildRow` cấp **31 khoá** (34 cột − `id`/`company_id`/`created_at` đều có DEFAULT; khoá
   * vắng được drizzle 0.45.2 đẩy thành từ khoá `default`, KHÔNG tốn bind param), còn giao thức
   * extended của Postgres trần **65 535** param ⇒ vỡ cứng ở **2 113 hàng**. Người gọi hôm nay
   * (`SOCIAL_POLL_CLOSE_BATCH_SIZE = 200` ⇒ 6 200 param) dư 10×, nhưng trần đó nằm ở MODULE KHÁC,
   * trong khi docblock này lại mời gọi dùng theo lô. Người gọi thứ hai sẽ chết bằng một lỗi tầng
   * driver **bên trong tx đang giữ khoá hàng**, và không dòng nào ở đây cho họ biết trần là bao nhiêu.
   */
  async recordMany(tx: TenantTx, entries: readonly AuditEntry[]): Promise<number> {
    if (entries.length === 0) return 0;
    if (entries.length > AUDIT_RECORD_MANY_MAX) {
      throw new Error(
        `AuditService.recordMany: ${entries.length} dòng vượt trần ${AUDIT_RECORD_MANY_MAX} ` +
          `(31 bind param/hàng, trần giao thức PG 65535 ⇒ vỡ ở 2113). Hãy chia lô ở call-site.`,
      );
    }
    await tx.insert(auditLogs).values(entries.map((entry) => this.buildRow(entry)));
    return entries.length;
  }

  private buildRow(entry: AuditEntry) {
    // Enum guard fail-closed TRƯỚC mọi mask/insert: giá trị sai → throw NGAY (KHÔNG để vỡ CHECK Postgres
    // = lỗi 500 mờ + xanh-giả). NULL/undefined hợp lệ (additive). data_scope: app là lớp duy nhất ép enum.
    this.assertEnum("actor_type", entry.actorType, AUDIT_ACTOR_TYPES);
    this.assertEnum("sensitivity_level", entry.sensitivityLevel, AUDIT_SENSITIVITY_LEVELS);
    this.assertEnum("result_status", entry.resultStatus, AUDIT_RESULT_STATUSES);
    this.assertEnum("data_scope", entry.dataScope, AUDIT_DATA_SCOPES);

    // Mask diff TRƯỚC insert (mask-at-write). undefined → null để cột nullable nhận giá trị tường minh.
    const before = entry.before === undefined ? null : this.masker.mask(entry.before);
    const after = entry.after === undefined ? null : this.masker.mask(entry.after);

    const hasV2 = entry.oldValues !== undefined || entry.newValues !== undefined;
    const oldValues = entry.oldValues === undefined ? null : this.masker.mask(entry.oldValues);
    const newValues = entry.newValues === undefined ? null : this.masker.mask(entry.newValues);
    // changed_fields chỉ tính khi có cặp v2 (tránh ghi [] vô nghĩa cho writer chỉ-v1).
    const changedFields = hasV2 ? this.computeChangedFields(oldValues, newValues) : null;

    // device_info/metadata là jsonb tự do → MASK (bất biến #3): có thể chứa token/ip/khóa nhạy cảm.
    const deviceInfo = entry.deviceInfo === undefined ? null : this.masker.mask(entry.deviceInfo);
    const metadata = entry.metadata === undefined ? null : this.masker.mask(entry.metadata);

    return {
      // ── v1 (GIỮ) ──
      action: entry.action,
      objectType: entry.objectType,
      objectId: entry.objectId,
      actorUserId: entry.actorUserId,
      before,
      after,
      ip: entry.ip,
      userAgent: entry.userAgent,
      // ── v2 mig 0432 (null khi caller cũ không cung cấp) ──
      moduleCode: entry.moduleCode ?? null,
      entityType: entry.entityType ?? null,
      entityId: entry.entityId ?? null,
      actorType: entry.actorType ?? null,
      oldValues,
      newValues,
      changedFields,
      sensitivityLevel: entry.sensitivityLevel ?? null,
      resultStatus: entry.resultStatus ?? null,
      requestId: entry.requestId ?? null,
      correlationId: entry.correlationId ?? null,
      ipAddress: entry.ipAddress ?? null,
      // ── v2 mig 0438 (11 cột — null khi caller cũ không cung cấp) ──
      actorEmployeeId: entry.actorEmployeeId ?? null,
      actionGroup: entry.actionGroup ?? null,
      entityIdText: entry.entityIdText ?? null,
      entityCode: entry.entityCode ?? null,
      permissionCode: entry.permissionCode ?? null,
      dataScope: entry.dataScope ?? null,
      deviceInfo,
      diffSummary: entry.diffSummary ?? null,
      errorCode: entry.errorCode ?? null,
      errorMessage: entry.errorMessage ?? null,
      metadata,
    };
  }

  /**
   * Ép `value` ∈ `allowed` (fail-closed). undefined/null → bỏ qua (additive, hợp lệ). Sai enum → throw
   * (tên cột trong message để debug nhanh) TRƯỚC insert ⇒ không bao giờ chạm CHECK Postgres với giá trị sai.
   */
  private assertEnum(column: string, value: string | undefined, allowed: readonly string[]): void {
    if (value === undefined || value === null) return;
    if (!allowed.includes(value)) {
      throw new Error(`Invalid audit ${column} "${value}" — must be one of: ${allowed.join(", ")}`);
    }
  }

  private asRecord(value: unknown): Record<string, unknown> {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return {};
  }

  private deepEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  }
}
