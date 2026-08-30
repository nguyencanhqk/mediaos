import {
  ConflictException,
  type HttpException,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import type { ErrorDetail } from "@mediaos/contracts";

/**
 * S11-ASSET-BE-1 — mã lỗi ASSET (SPEC-13 §12 · API-14 §7.4 · quy ước SPEC-01 §9 `MODULE-ERR-XXX`).
 *
 * MỘT CHỖ duy nhất định nghĩa mã + thông điệp ⇒ int-spec assert theo MÃ (`error.code`), không theo câu chữ.
 *
 * Hình dạng ném: `new XxxException({ code, message, details })` — `AllExceptionsFilter` đọc `payload.code` làm
 * `error.code` và CHỈ cho `details` đi ra khi là mảng `ErrorDetail {field,message,rule}` (API-01). Vì thế
 * `details.kind` của SPEC-13 §12 được biểu diễn là phần tử `{ field: "kind", message: "<kind>", rule: "asset" }`
 * — test neo `details.find(d => d.field === "kind").message`. Đính chính API-14 §7.4 (ví dụ object) cùng PR.
 *
 * Ba sentinel đặt tên (không chiếm số trong dãy 001–016): `NOT-FOUND` (012/013 + vế 404 của 002/005),
 * `COUNTER-MISSING` và `INVENTORY-SNAPSHOT-INVALID` (plan §1.1 — hai nhánh `done_when` bắt "không 500" nhưng
 * SPEC-13 §12 chưa cấp số).
 */
export const ASSET_ERR_CODE = {
  TRANSITION: "ASSET-ERR-001",
  EMPLOYEE: "ASSET-ERR-002",
  NO_ACTIVE_ASSIGNMENT: "ASSET-ERR-003",
  MAINTENANCE_OPEN_EXISTS: "ASSET-ERR-004",
  MAINTENANCE_CLOSE: "ASSET-ERR-005",
  INVENTORY_OPEN_EXISTS: "ASSET-ERR-006",
  INVENTORY_CLOSED: "ASSET-ERR-007",
  ACTIVE_ASSIGNMENT_BLOCKS_DISPOSE: "ASSET-ERR-008",
  REASON_REQUIRED: "ASSET-ERR-009",
  CATEGORY: "ASSET-ERR-010",
  ASSET_UNIQUE: "ASSET-ERR-011",
  DATE: "ASSET-ERR-014",
  DELETE_BLOCKED: "ASSET-ERR-015",
  RETURN_CONDITION: "ASSET-ERR-016",
  NOT_FOUND: "ASSET-ERR-NOT-FOUND",
  COUNTER_MISSING: "ASSET-ERR-COUNTER-MISSING",
  INVENTORY_SNAPSHOT_INVALID: "ASSET-ERR-INVENTORY-SNAPSHOT-INVALID",
} as const;

export type AssetErrCode = (typeof ASSET_ERR_CODE)[keyof typeof ASSET_ERR_CODE];

export const ASSET_ERR = {
  TRANSITION: (from: string, action: string) =>
    `ASSET-ERR-001: tài sản đang ở trạng thái "${from}" — không thể ${actionLabel(action)}.`,
  EMPLOYEE_NOT_FOUND: "ASSET-ERR-002: không tìm thấy nhân viên trong công ty.",
  EMPLOYEE_INACTIVE:
    "ASSET-ERR-002: nhân viên không còn làm việc (không active) — không thể cấp phát.",
  NO_ACTIVE_ASSIGNMENT: "ASSET-ERR-003: tài sản không có lượt cấp phát đang hiệu lực để thu hồi.",
  MAINTENANCE_OPEN_EXISTS: "ASSET-ERR-004: tài sản đã có lượt bảo trì đang mở.",
  MAINTENANCE_ALREADY_CLOSED: "ASSET-ERR-005: lượt bảo trì này đã đóng.",
  MAINTENANCE_NOT_FOUND: "ASSET-ERR-005: không tìm thấy lượt bảo trì thuộc tài sản này.",
  INVENTORY_OPEN_EXISTS:
    "ASSET-ERR-006: công ty đang có một đợt kiểm kê mở — đóng đợt trước khi mở đợt mới.",
  INVENTORY_CLOSED: "ASSET-ERR-007: đợt kiểm kê đã đóng — không thể đánh dấu/đóng lại.",
  ACTIVE_ASSIGNMENT_BLOCKS_DISPOSE:
    "ASSET-ERR-008: tài sản còn lượt cấp phát đang hiệu lực — thu hồi trước khi thanh lý.",
  REASON_REQUIRED: "ASSET-ERR-009: cần lý do (tối thiểu 3 ký tự).",
  CATEGORY_CODE_TAKEN: (code: string) =>
    `ASSET-ERR-010: đã có loại tài sản mã "${code}" đang hoạt động — chọn mã khác.`,
  CATEGORY_PREFIX_TAKEN: (prefix: string) =>
    `ASSET-ERR-010: tiền tố "${prefix}" đã được dùng (kể cả loại đã xoá) — khôi phục loại cũ hoặc chọn tiền tố khác.`,
  CATEGORY_HAS_ASSETS:
    "ASSET-ERR-010: loại còn tài sản chưa thanh lý/mất — không thể xoá hoặc vô hiệu.",
  CATEGORY_PREFIX_LOCKED: "ASSET-ERR-010: loại đã sinh mã tài sản — không thể đổi tiền tố mã.",
  SERIAL_TAKEN: (serial: string) =>
    `ASSET-ERR-011: số serial "${serial}" đã tồn tại trong công ty.`,
  DATE: (detail: string) => `ASSET-ERR-014: ngày không hợp lệ — ${detail}`,
  DELETE_BLOCKED:
    "ASSET-ERR-015: chỉ xoá được hồ sơ đang 'In Stock' và chưa có lịch sử cấp phát/bảo trì — hồ sơ có lịch sử thì thanh lý.",
  RETURN_CONDITION: "ASSET-ERR-016: thu hồi cần tình trạng lúc thu (Good/Damaged/Lost).",
  NOT_FOUND: "ASSET-ERR-NOT-FOUND: không tìm thấy tài sản.",
  REF_NOT_FOUND: (what: string) => `ASSET-ERR-NOT-FOUND: không tìm thấy ${what} trong công ty.`,
  COUNTER_MISSING:
    "ASSET-ERR-COUNTER-MISSING: loại tài sản chưa có bộ đếm mã — liên hệ quản trị (bộ đếm được tạo cùng loại).",
  INVENTORY_SNAPSHOT_INVALID:
    "ASSET-ERR-INVENTORY-SNAPSHOT-INVALID: ảnh chụp đợt kiểm kê chứa tài sản đã thanh lý/mất — không mở được đợt.",
} as const;

function actionLabel(action: string): string {
  switch (action) {
    case "assign":
      return "cấp phát";
    case "revoke":
      return "thu hồi";
    case "openMaintenance":
      return "mở lượt bảo trì";
    case "closeMaintenance":
      return "đóng lượt bảo trì";
    case "dispose":
      return "thanh lý/ghi nhận mất";
    case "recover":
      return "ghi nhận tìm thấy lại";
    default:
      return action;
  }
}

/** `details` theo hợp đồng `ErrorDetail[]` — `kind` + các cặp phụ (categoryId · deleted · from …). */
export function assetDetails(
  kind: string,
  extra: Record<string, string | boolean | null> = {},
): ErrorDetail[] {
  const out: ErrorDetail[] = [{ field: "kind", message: kind, rule: "asset" }];
  for (const [field, value] of Object.entries(extra)) {
    if (value === null || value === undefined) continue;
    out.push({ field, message: String(value), rule: "asset" });
  }
  return out;
}

/** Payload chuẩn cho HttpException của ASSET (filter đọc `code` + `details`). */
export function assetErrorBody(
  code: AssetErrCode,
  message: string,
  details?: ErrorDetail[],
): { code: AssetErrCode; message: string; details?: ErrorDetail[] } {
  return details ? { code, message, details } : { code, message };
}

export const notFound = (message: string = ASSET_ERR.NOT_FOUND): NotFoundException =>
  new NotFoundException(assetErrorBody(ASSET_ERR_CODE.NOT_FOUND, message));

export const conflict = (
  code: AssetErrCode,
  message: string,
  details?: ErrorDetail[],
): ConflictException => new ConflictException(assetErrorBody(code, message, details));

export const unprocessable = (
  code: AssetErrCode,
  message: string,
  details?: ErrorDetail[],
): UnprocessableEntityException =>
  new UnprocessableEntityException(assetErrorBody(code, message, details));

// ── Lỗi Postgres → ASSET-ERR (API-14 §6.2) ───────────────────────────────────────────────────────

/**
 * Bóc lỗi Postgres THẬT ra khỏi vỏ của drizzle (khuôn `chat-calls.repository.ts#pgErrorOf`, ĐÃ hỏng thật một
 * lần): `drizzle-orm` bọc lỗi driver trong `DrizzleQueryError` ⇒ `err.code` lớp ngoài là `undefined`, mã
 * `23505`/`23514` nằm ở `err.cause`. Đi theo chuỗi `cause` có cận trên 5 tầng (chuỗi tự tham chiếu sẽ treo).
 */
export function pgErrorOf(err: unknown): { code?: unknown; constraint?: unknown } | null {
  let cur: unknown = err;
  for (let depth = 0; depth < 5 && cur; depth += 1) {
    const e = cur as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (typeof e.code === "string") return e;
    cur = e.cause;
  }
  return null;
}

/**
 * Map lỗi DB theo **TÊN CONSTRAINT**, không theo mã `23505`/`23514` trần: 6 bảng ASSET còn nhiều unique/CHECK
 * khác cùng mã (`*_company_id_id_uq` ống nước FK composite, `chk_*_pair`…). Nuốt mọi `23505` thành một mã 409
 * là báo sai nguyên nhân và làm nó biến mất khỏi log điều tra.
 *
 * Trả `null` khi KHÔNG phải lỗi ASSET đã biết ⇒ caller `throw err` nguyên bản (AllExceptionsFilter ⇒ 500 có
 * log). `serial`/`code`/`prefix` lấy từ `ctx` để thông điệp có ý — thiếu thì thông điệp chung.
 */
export function mapAssetPgError(
  err: unknown,
  ctx: { code?: string; codePrefix?: string; serialNumber?: string } = {},
): HttpException | null {
  const e = pgErrorOf(err);
  if (!e || typeof e.code !== "string") return null;
  const constraint = typeof e.constraint === "string" ? e.constraint : "";

  if (e.code === "23505") {
    switch (constraint) {
      case "uq_asset_assignments_active":
        return conflict(
          ASSET_ERR_CODE.TRANSITION,
          ASSET_ERR.TRANSITION("Assigned", "assign"),
          assetDetails("active-assignment-exists"),
        );
      case "uq_asset_maintenances_open":
        return conflict(ASSET_ERR_CODE.MAINTENANCE_OPEN_EXISTS, ASSET_ERR.MAINTENANCE_OPEN_EXISTS);
      case "uq_asset_inventories_open":
        return conflict(ASSET_ERR_CODE.INVENTORY_OPEN_EXISTS, ASSET_ERR.INVENTORY_OPEN_EXISTS);
      case "uq_assets_company_serial_active":
        return conflict(
          ASSET_ERR_CODE.ASSET_UNIQUE,
          ASSET_ERR.SERIAL_TAKEN(ctx.serialNumber ?? "?"),
          assetDetails("serial-taken"),
        );
      case "uq_assets_company_code_active":
        // MÃ TÀI SẢN trùng (counter/loại bị can thiệp tay) — họ mã 011 của hồ sơ, KHÔNG phải 010 của loại (gate MEDIUM).
        return conflict(
          ASSET_ERR_CODE.ASSET_UNIQUE,
          "ASSET-ERR-011: mã tài sản \"" + (ctx.code ?? "?") + "\" đã tồn tại trong công ty — bộ đếm/loại bị can thiệp.",
          assetDetails("code-taken"),
        );
      case "uq_asset_categories_company_code_active":
        return conflict(
          ASSET_ERR_CODE.CATEGORY,
          ASSET_ERR.CATEGORY_CODE_TAKEN(ctx.code ?? "?"),
          assetDetails("code-taken"),
        );
      case "uq_asset_inventory_items_inventory_asset":
        // Snapshot chạy 1 lần/tx — vỡ là đợt Open đã có dòng (đua mở đợt); báo 006 để không 500.
        return conflict(
          ASSET_ERR_CODE.INVENTORY_OPEN_EXISTS,
          ASSET_ERR.INVENTORY_OPEN_EXISTS,
          assetDetails("snapshot-duplicate"),
        );
      case "uq_asset_categories_company_prefix":
        // Caller bổ sung categoryId/deleted qua SELECT chẩn đoán (service) — ở đây chỉ có kind.
        return conflict(
          ASSET_ERR_CODE.CATEGORY,
          ASSET_ERR.CATEGORY_PREFIX_TAKEN(ctx.codePrefix ?? "?"),
          assetDetails("prefix-taken"),
        );
      default:
        return null;
    }
  }

  // 22003 numeric overflow — lưới thứ hai sau trần Zod (gate HIGH-2).
  if (e.code === "22003") return numericViolation("numeric_overflow");

  // LƯỚI THỨ HAI (review B12): service kiểm ngày/số trên giá trị HỢP NHẤT trước; CHECK DB chỉ bắt khi service sót.
  if (e.code === "23514") {
    switch (constraint) {
      case "chk_assets_warranty":
        return unprocessable(
          ASSET_ERR_CODE.DATE,
          ASSET_ERR.DATE("ngày hết bảo hành phải ≥ ngày mua"),
          assetDetails("warranty-before-purchase"),
        );
      case "chk_assets_price":
      case "chk_asset_maintenances_cost":
      case "chk_asset_categories_interval":
        return numericViolation(constraint);
      default:
        break;
    }
  }

  if (e.code === "23514" && constraint === "chk_asset_inventory_items_expected") {
    return conflict(
      ASSET_ERR_CODE.INVENTORY_SNAPSHOT_INVALID,
      ASSET_ERR.INVENTORY_SNAPSHOT_INVALID,
    );
  }

  return null;
}

/** Vi phạm SỐ (CHECK giá/chi phí/chu kỳ, 22003) — mã VALIDATION chung, KHÔNG mượn ASSET-ERR-014 của ngày (gate MEDIUM). */
function numericViolation(constraint: string): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code: "VALIDATION-ERR-001",
    message: "Giá trị số không hợp lệ hoặc vượt giới hạn (" + constraint + ").",
    details: [{ field: "amount", message: constraint, rule: "asset" }],
  });
}

/** `throw mapAssetPgError(err) ?? err` gọn cho repository/service. */
export function rethrowAssetPgError(
  err: unknown,
  ctx?: { code?: string; codePrefix?: string; serialNumber?: string },
): never {
  throw mapAssetPgError(err, ctx) ?? err;
}
