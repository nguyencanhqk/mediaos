/**
 * S11-ASSET-FE-1 — bóc mã lỗi nghiệp vụ ASSET từ `ApiError` (SPEC-13 §12).
 *
 * `error.details` là **MẢNG** `ErrorDetail {field, message, rule?}` — hình DUY NHẤT mà
 * `AllExceptionsFilter` cho đi ra (API-01). Đọc `details.kind` như một OBJECT trả `undefined` và nuốt
 * lỗi trong im lặng: người dùng thấy thông điệp chung chung, không thấy vì sao. `kind` nằm ở phần tử có
 * `field === "kind"`, giá trị ở `message`. Cùng kỹ thuật `parseRoomConflictsDetail` của ROOM.
 *
 * ⚠️ Danh sách `kind` dưới đây đo TỪ CODE BE THẬT (`grep assetDetails(" apps/api/src/assets/`), KHÔNG
 * chép bảng SPEC-13 §12. Bảng spec mô tả Ý ĐỊNH và lệch với bản đã ship ở ba chỗ: `employee-not-found`,
 * `maintenance-not-found`, `readonly-field` **không bao giờ** được phát ra như `kind` — hai cái đầu đi
 * qua sentinel 404 chung (ASSET-ERR-012, cố ý không phân biệt "không tồn tại" với "ngoài scope" để
 * không thành oracle dò chéo tenant), cái cuối bị `.strict()` của Zod chặn thành 400
 * `VALIDATION-ERR-001`. Map theo bảng spec sẽ tạo 3 nhánh CHẾT và bỏ sót 9 kind có thật.
 *
 * Value ở `message` luôn là chuỗi (`assetDetails` gọi `String(value)`) — kể cả boolean và số.
 */
import { parseKindError, type KindErrorInfo } from "@mediaos/web-core";
// Mã lỗi idempotency lấy TỪ CONTRACTS (nguồn sự thật DTO) — gõ tay chuỗi ở đây là mời drift: mã thật là
// `REQUEST-ERR-IDEMPOTENCY-*`, KHÔNG phải `IDEMPOTENCY_*` như tên khoá của object hằng.
import { IDEMPOTENCY_ERROR_CODES } from "@mediaos/contracts";

/**
 * 19 `kind` mà backend ASSET thực sự phát ra. Union đóng để `switch` bên dưới được TS kiểm tra đủ nhánh
 * — thêm kind mới ở BE mà quên map ở đây sẽ KHÔNG đỏ (kind đến dưới dạng `string`), nên spec đi kèm neo
 * danh sách này bằng một ca "mọi kind đều có khoá i18n riêng".
 */
export const ASSET_ERROR_KINDS = [
  "prefix-locked",
  "code-taken",
  "prefix-taken",
  "has-assets",
  "already-closed",
  "employee-inactive",
  "expected-return-before-issue",
  "active-assignment",
  "active-assignment-exists",
  "stale",
  "open-exists",
  "next-due-not-after-close",
  "serial-taken",
  "snapshot-duplicate",
  "warranty-before-purchase",
  "not-in-stock",
  "has-history",
  "category-inactive",
  "purchase-in-future",
] as const;
export type AssetErrorKind = (typeof ASSET_ERROR_KINDS)[number];

/** Alias của `KindErrorInfo` (@mediaos/web-core) — giữ tên cũ để 0 call-site phải đổi. */
export type AssetErrorInfo = KindErrorInfo;

/** Bóc lỗi mang `kind` — dùng bản CHUNG; xem `parseKindError` ở @mediaos/web-core. */
export { parseKindError as parseAssetError };

/**
 * Loại đang chiếm tiền tố (vế `prefix-taken`) — để màn 007 gợi ý «Khôi phục loại» thay vì tạo mới. Đây
 * là đường DUY NHẤT dùng lại một tiền tố đã tiêu (unique KHÔNG partial: prefix từng dùng ⇒ mã
 * `TS-<PREFIX>-0001` đã tồn tại). Trả `null` khi lỗi không phải `prefix-taken`.
 */
export function readPrefixTakenHolder(
  info: AssetErrorInfo,
): { categoryId: string; deleted: boolean } | null {
  if (info.kind !== "prefix-taken") return null;
  const categoryId = info.fields.get("categoryId");
  if (!categoryId) return null;
  // `deleted` về dưới dạng CHUỖI ("true"/"false") — so khớp chuỗi, KHÔNG `Boolean(...)`:
  // `Boolean("false") === true` sẽ báo ngược hoàn toàn (gợi ý khôi phục một loại đang sống).
  return { categoryId, deleted: info.fields.get("deleted") === "true" };
}

/** Ánh xạ `kind` → khoá i18n. Tách riêng để spec neo được "mọi kind có khoá", không lẫn nhánh `code`. */
const KIND_TO_I18N_KEY: Readonly<Record<AssetErrorKind, string>> = {
  "prefix-locked": "errors.prefixLocked",
  "code-taken": "errors.codeTaken",
  "prefix-taken": "errors.prefixTaken",
  "has-assets": "errors.hasAssets",
  "already-closed": "errors.alreadyClosed",
  "employee-inactive": "errors.employeeInactive",
  "expected-return-before-issue": "errors.expectedReturnBeforeIssue",
  "active-assignment": "errors.activeAssignment",
  "active-assignment-exists": "errors.activeAssignmentExists",
  stale: "errors.stale",
  "open-exists": "errors.maintenanceAlreadyOpen",
  "next-due-not-after-close": "errors.nextDueNotAfterClose",
  "serial-taken": "errors.serialTaken",
  "snapshot-duplicate": "errors.snapshotDuplicate",
  "warranty-before-purchase": "errors.warrantyBeforePurchase",
  "not-in-stock": "errors.notInStock",
  "has-history": "errors.hasHistory",
  "category-inactive": "errors.categoryInactive",
  "purchase-in-future": "errors.purchaseInFuture",
};

/** Ánh xạ `error.code` → khoá i18n, cho các lỗi backend KHÔNG kèm `kind`. */
const CODE_TO_I18N_KEY: Readonly<Record<string, string>> = {
  "ASSET-ERR-001": "errors.fsm",
  "ASSET-ERR-003": "errors.noActiveAssignment",
  "ASSET-ERR-004": "errors.maintenanceAlreadyOpen",
  "ASSET-ERR-006": "errors.inventoryAlreadyOpen",
  "ASSET-ERR-007": "errors.inventoryClosed",
  "ASSET-ERR-008": "errors.disposeHasActiveAssignment",
  "ASSET-ERR-009": "errors.reasonRequired",
  "ASSET-ERR-012": "errors.notFound",
  "ASSET-ERR-013": "errors.notFound",
  "ASSET-ERR-014": "errors.dateInvalid",
  "ASSET-ERR-015": "errors.deleteBlocked",
  "ASSET-ERR-016": "errors.returnConditionRequired",
  "ASSET-ERR-COUNTER-MISSING": "errors.counterMissing",
  "ASSET-ERR-NOT-FOUND": "errors.notFound",
  [IDEMPOTENCY_ERROR_CODES.IN_PROGRESS]: "errors.idempotencyInProgress",
  [IDEMPOTENCY_ERROR_CODES.KEY_REUSED]: "errors.idempotencyKeyReused",
};

/**
 * Ánh xạ lỗi → khoá i18n trong namespace `assets`. Trả khoá TƯƠNG ĐỐI (chưa có tiền tố `assets:`) để
 * phía gọi tự ghép — giữ hàm này thuần, test được mà không cần i18n instance.
 *
 * Thứ tự tra: `kind` (chính xác nhất) → `code` (mã nghiệp vụ) → `generic`. KHÔNG tra theo HTTP status:
 * một mã 409 phủ tới 7 lỗi khác nhau, và ASSET-ERR-002 cố ý dùng HAI status (404/422) cho cùng một chỗ
 * hỏng — nên status không phân biệt được gì hữu ích.
 */
export function assetErrorI18nKey(info: AssetErrorInfo): string {
  if (info.kind && info.kind in KIND_TO_I18N_KEY) {
    return KIND_TO_I18N_KEY[info.kind as AssetErrorKind];
  }
  if (info.code && info.code in CODE_TO_I18N_KEY) {
    return CODE_TO_I18N_KEY[info.code];
  }
  return "errors.generic";
}

/**
 * `true` khi lỗi là tranh chấp trạng thái (race) — SPEC-13 §14 buộc: hiện thông điệp + **tải lại chi
 * tiết**, KHÔNG mất form.
 *
 * Nhận diện theo `kind` nghiệp vụ, KHÔNG theo status 409 chung: 409 cũng phủ trùng mã loại/serial
 * (`code-taken`/`serial-taken`/`prefix-taken`) — những lỗi đó người dùng sửa được ngay trong form, tải
 * lại chi tiết là vô nghĩa và làm mất cái họ vừa gõ.
 */
const STATE_CONFLICT_KINDS: ReadonlySet<string> = new Set<AssetErrorKind>([
  "stale",
  "not-in-stock",
  "already-closed",
  "open-exists",
  "active-assignment",
  "active-assignment-exists",
  "has-history",
]);

export function isAssetStateConflict(info: AssetErrorInfo): boolean {
  if (info.kind && STATE_CONFLICT_KINDS.has(info.kind)) return true;
  // Ô FSM chung: BE trả ASSET-ERR-001 kèm kind `stale`, nhưng giữ nhánh theo code phòng route nào ném
  // mã này mà quên details (fail-safe: tải lại chi tiết thừa còn hơn để người dùng nhìn form đã cũ).
  return info.code === "ASSET-ERR-001" || info.code === "ASSET-ERR-003";
}

/**
 * Khoá `Idempotency-Key` phải sinh MỚI sau khi gửi thành công và sau `KEY_REUSED` (SPEC-13 §12). Giữ
 * khoá cũ sau `KEY_REUSED` là kẹt vòng lặp: server đã ghim khoá đó cho một payload khác trong 15′.
 *
 * `IN_PROGRESS` thì NGƯỢC LẠI — phải giữ nguyên khoá và chờ: đổi khoá lúc đó tạo bản ghi THỨ HAI
 * (đúng cảnh báo ở `idempotency.interceptor.ts:30`).
 */
export function shouldRotateIdempotencyKey(info: AssetErrorInfo): boolean {
  return info.code === IDEMPOTENCY_ERROR_CODES.KEY_REUSED;
}
