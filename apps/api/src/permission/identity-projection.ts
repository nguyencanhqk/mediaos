import { eq, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

/**
 * S6-SEC-IDENTITY-PROJ-1 — L1: tầng chiếu danh tính người phải mang một CĂN CỨ.
 *
 * Vì sao WO này tồn tại: N-1 (`/org/employees`, #302) · N-1c (`/org/teams/:id/members`, KI-049) ·
 * N-1d (`/recycle-bin/employees`, KI-051) · N-1e (`/org/teams` `leaderUserName`, KI-052) là BỐN lần vá
 * CÙNG một lớp lỗi ở bốn đường khác nhau. Gốc: `PermissionGuard` chỉ trả lời "CÓ cặp quyền không",
 * nó KHÔNG đọc `data_scope` lần nào — nên mọi route chỉ dựa vào guard đều thừa hưởng khoảng hở, và vá
 * lẻ theo route thì không hội tụ.
 *
 * ⚠️ ĐƯỜNG ĐÃ LOẠI (đừng mở lại): cho guard tự phơi `data_scope` ra request. Guard phơi ra thì handler
 * VẪN tự chọn dùng hay không — N-1c chính là ca guard gate đúng / handler không bound. Thêm một thứ
 * TUỲ CHỌN không biến bug im lặng thành bug ồn ào.
 *
 * ── Cái file này ép, và cái nó KHÔNG ép ───────────────────────────────────────────────────────────
 * ÉP: đã đi qua `identityColumns()` thì bắt buộc có `IdentityGrant`, mà `IdentityGrant` chỉ dựng được
 * bằng bốn constructor dưới đây — không có đường thứ năm để "tạm thời chưa bound".
 *
 * KHÔNG ÉP (nói thẳng, đừng để docblock hứa quá):
 *   1. Một repository mới viết `.select({ email: users.email })` thẳng sẽ **không chạm file này lần
 *      nào**. Đường đó bị chặn ở L2 — `test/foundation/identity-projection-ratchet.unit-spec.ts` bắt
 *      mọi điểm chiếu phải có một dòng phán quyết đã ký.
 *   2. Brand `unique symbol` chặn object literal thuần, **KHÔNG chặn toán tử ép kiểu**: một lời ép
 *      `{ cond, why }` sang `IdentityGrant` là hợp lệ với TypeScript. Đường đó cũng bị chặn ở L2
 *      (`blindSpots().asIdentityGrant` phải bằng 0), không ở đây.
 * Nói cách khác: tầng type làm đường VÁ không thể viết sai; ratchet làm đường NÉ không thể im lặng.
 * Thiếu một trong hai là quay lại quy ước.
 */

declare const IDENTITY_BASIS: unique symbol;

/**
 * Tám hình dạng căn cứ ĐANG TỒN TẠI trong cây code (đo 2026-08-19 trên 71 điểm chiếu). Đây không phải
 * một phân loại lý thuyết — mỗi giá trị có ít nhất một điểm thật đứng sau nó, ghi ở sổ phán quyết.
 *
 * Vì sao KHÔNG phải "mọi điểm chiếu PHẢI nhận vị từ scope": hai module đã được kiểm chứng là kín thì
 * kín bằng **assert thứ hai trong service** hoặc bằng **tự-bound theo `actor.id`**, KHÔNG bằng vị từ
 * scope. Một cơ chế chỉ nhận một dạng căn cứ sẽ bắt SAI hàng loạt call-site vốn đã an toàn, và cái
 * giá của việc bắt sai là người ta gỡ cơ chế.
 *
 * `second-assert` CỐ Ý không có constructor: xem khối `IdentityGrant` bên dưới.
 */
export type IdentityBasis =
  /** Vị từ `data_scope` chặn TẬP HÀNG (`buildEmployeeScopeCondition` / `buildUserScopeConditionOn`). */
  | "scoped-predicate"
  /** Riêng CỘT danh tính bị chặn bởi vị từ của cặp danh bạ, trong khi tập hàng theo cặp khác. */
  | "identity-gated"
  /** Tập hàng ghim vào `actor.id` bằng một vị từ SQL. */
  | "self-bound-row"
  /** Route theo ĐỊNH NGHĨA chỉ phục vụ chính chủ (`/me/*`, `/auth/me`) — không đo được bằng SQL. */
  | "self-bound-route"
  /** Nới rộng đòi một assert quyền THỨ HAI trong service. Chỉ sống ở sổ phán quyết. */
  | "second-assert"
  /** Tập hàng bị chặn bởi tư cách thành viên tài nguyên (phòng chat, dự án). */
  | "membership"
  /** Job máy / producer outbox — không có actor HTTP để resolve scope. */
  | "no-actor"
  /** Phơi CÓ CHỦ ĐÍCH, đã ký. */
  | "waiver";

/**
 * Căn cứ để chiếu danh tính. KHÔNG dựng được bằng object literal — brand là một `unique symbol` không
 * export, nên chỉ bốn constructor dưới đây tạo ra được giá trị hợp kiểu.
 *
 * ⚠️ `second-assert` KHÔNG có constructor, và đó là quyết định thiết kế, không phải thiếu sót
 * (plan-review vòng 1, B3). Một `afterAssert(token)` sẽ RỖNG NGHĨA: trong cây code không tồn tại
 * `assertCan` dùng chung — `role-admin.service.ts`, `leave.service.ts`, `attendance.service.ts` mỗi
 * nơi một private helper trả `Promise<void>` — nên token sẽ không mang được CẶP QUYỀN nào đã assert.
 * Nó chỉ chứng minh "có một assert nào đó đã chạy", không phải "assert ĐÚNG cặp": một call-site assert
 * một cặp ai-cũng-có rồi lấy token là mở toang cột danh tính mà typecheck vẫn xanh. Một brand chứng
 * minh sai thứ còn tệ hơn không có brand, vì nó tạo cảm giác đã được ép.
 * ⇒ `second-assert` chỉ sống ở sổ phán quyết L2, nơi nó là một câu người viết và người ký.
 */
interface IdentityGrantFields {
  readonly basis: IdentityBasis;
  /** Vị từ quyết định cột danh tính có hiện hay không. */
  readonly cond: SQL;
  /** Câu cho người đọc — đi vào log ở nhánh fail-closed, nên viết như viết cho người trực ca. */
  readonly why: string;
}

export type IdentityGrant = IdentityGrantFields & { readonly [IDENTITY_BASIS]: true };

/**
 * ĐIỂM ĐÚC DUY NHẤT. Brand là kiểu-thời-biên-dịch nên vẫn cần một lời ép kiểu ở đây — và đó là lời ép
 * DUY NHẤT được phép trong toàn bộ `apps/api/src`: ratchet (`blindSpots().asIdentityGrant`) đếm mọi
 * lời ép sang `IdentityGrant` NGOÀI file này và bắt buộc bằng 0. Không có ngoại lệ ngầm — nếu bạn đang
 * định thêm một lời ép ở nơi khác thì thứ bạn cần là một constructor mới ở đây, có tên và có docblock.
 */
function grant(basis: IdentityBasis, cond: SQL, why: string): IdentityGrant {
  return { basis, cond, why } as IdentityGrant;
}

/**
 * Căn cứ = vị từ `data_scope` do `DataScopeService` dựng.
 *
 * ⚠️ `cond === null` ⇒ `false`, TUYỆT ĐỐI không `true`. `null` nghĩa là actor **không có grant nào**
 * cho cặp danh bạ (`DataScopeService.resolveOrNull` trả `null`) — fail-closed. Đây là nhánh dễ viết
 * ngược nhất của cả cơ chế: một `cond ?? sql\`true\`` trông vô hại và mở toang mọi hàng.
 *
 * Dùng `basis: "identity-gated"` khi cặp GATE của route khác cặp BOUND cột danh tính (khuôn N-1c);
 * `"scoped-predicate"` khi cùng một cặp chặn cả tập hàng lẫn cột.
 */
export function fromScope(
  cond: SQL | null,
  basis: Extract<IdentityBasis, "scoped-predicate" | "identity-gated">,
  why: string,
): IdentityGrant {
  return grant(basis, cond ?? sql`false`, why);
}

/** Căn cứ = tập hàng ghim vào chính actor. `idCol` là cột mang `users.id` của hàng. */
export function selfBound(actorUserId: string, idCol: PgColumn, why: string): IdentityGrant {
  return grant("self-bound-row", eq(idCol, actorUserId), why);
}

/** Căn cứ = tư cách thành viên tài nguyên (phòng chat, dự án) — vị từ do caller dựng. */
export function byMembership(cond: SQL, why: string): IdentityGrant {
  return grant("membership", cond, why);
}

/**
 * Căn cứ KHÔNG mang vị từ: job máy · waiver đã ký · route theo định nghĩa chỉ phục vụ chính chủ.
 *
 * `cond` luôn là `true` — nghĩa là ba căn cứ này **không đo được bằng máy**, chúng là câu người viết.
 * Vì thế cả ba đều bị TRẦN ĐẾM ở `identity-projection-verdicts.ts` (`BASIS_CEILINGS`): thêm một điểm
 * mang nhãn này là ĐỎ cho tới khi ai đó sửa con số một cách có chủ đích, đi qua FULL gate. Không có
 * trần thì đây là đường né rẻ nhất của cả cơ chế.
 */
export function unconditional(
  basis: Extract<IdentityBasis, "no-actor" | "waiver" | "self-bound-route">,
  why: string,
): IdentityGrant {
  return grant(basis, sql`true`, why);
}

/** Đọc basis của một grant — cho log/test; không có đường GHI ngược lại. */
export function basisOf(g: IdentityGrant): IdentityBasis {
  return g.basis;
}

export type IdentityColumnSpec = Readonly<Record<string, PgColumn>>;

/**
 * Cờ nội bộ của repository — service dùng nó để quyết định BỎ KHOÁ hay giữ. **KHÔNG được lọt ra
 * response**: nó là siêu dữ liệu phân quyền, và một FE thấy `identityInScope: false` biết chắc "có dữ
 * liệu ở đây nhưng bạn không được xem" — nhiều hơn cần thiết.
 *
 * ⚠️ Tên cờ là THAM SỐ, không phải hằng: một truy vấn chiếu HAI nhóm danh tính (chủ thể / người gây
 * ra) sẽ spread hai kết quả vào cùng một object `select`, và cờ sau ĐÈ cờ trước trong im lặng — cả
 * hai nhóm sẽ đọc chung một cờ, tức nhóm thứ nhất bị quyết định bởi vị từ của nhóm thứ hai. Đặt tên
 * riêng cho từng nhóm là điều kiện để `identityColumns` gọi được nhiều lần.
 */
export type IdentityProjection<T extends IdentityColumnSpec, F extends string> = {
  [K in F]: SQL<boolean>;
} & { [K in keyof T]: SQL<string | null> };

/**
 * Bọc một NHÓM cột danh tính bằng `case when` theo `grant.cond`.
 *
 * ⚠️ VÌ SAO khử ở tầng SQL chứ không chỉ xoá khoá ở service: nếu phiên sau ai đó quên bước xoá khoá
 * thì hàng ngoài scope trả `null` thay vì rò email im lặng — chọn chế độ hỏng ỒN ÀO có chủ đích. Cùng
 * lý do đã ghi ở `org.repository.listTeamMembers` và `recycle-bin.repository.deletedColumns`.
 *
 * ⚠️ MỘT NHÓM = MỘT GRANT. Một truy vấn join `users` hai lần cho hai vai (chủ thể / người gây ra) thì
 * phải gọi hàm này HAI LẦN với hai grant khác nhau — xem `security-event.repository.findManyTx`. Dùng
 * chung một grant cho hai vai vừa đẻ lỗ mới vừa hồi quy allow-path (plan-review vòng 1, B1).
 *
 * ⚠️ Ở phía service: BỎ HẲN khoá khi contract khai `.optional()`. Chỉ giữ `null` khi contract khai
 * `.nullable()` VÀ `null` không lẫn nghĩa với "chưa có" — `leaderUserName` là ca `null` lẫn nghĩa
 * (team chưa có trưởng nhóm), nên nó BẮT BUỘC phải bỏ khoá (bẫy KI-052). Và FE phải `.optional()`
 * tương ứng: thiếu là ZodError runtime dù HTTP 200, tức vỡ TRẮNG trang cho đúng vai mà bản vá bảo vệ.
 */
export function identityColumns<T extends IdentityColumnSpec, F extends string = "identityInScope">(
  grantArg: IdentityGrant,
  spec: T,
  flagKey: F = "identityInScope" as F,
): IdentityProjection<T, F> {
  const cond = grantArg.cond;
  const wrapped = Object.fromEntries(
    Object.entries(spec).map(([key, col]) => [
      key,
      // `::text` giữ NGUYÊN hành vi của call-site đầu tiên (`role-admin.repository` vốn cast vì
      // `users.email` ở DB là `citext`), và làm nhánh `else null` có kiểu xác định thay vì `unknown`.
      sql<string | null>`case when (${cond}) then ${col}::text else null end`,
    ]),
  ) as { [K in keyof T]: SQL<string | null> };

  return { [flagKey]: sql<boolean>`(${cond})`, ...wrapped } as IdentityProjection<T, F>;
}
