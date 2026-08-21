import { eq, getTableName, sql, type SQL } from "drizzle-orm";
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
  /**
   * Bảng/alias mà vị từ này NÓI VỀ. `null` = vị từ vô điều kiện (`unconditional`), không ràng bảng nào.
   *
   * ⚠️ VÌ SAO CẦN (security-reviewer 2026-08-19): thiếu trường này thì `buildUserScopeConditionOn`
   * nhận cột bất kỳ và `identityColumns` bọc cột bất kỳ, nên dựng vị từ trên `users` rồi đem bọc
   * `SECURITY_EVENT_ACTOR.email` là **hợp kiểu và chạy được** — đúng lỗ B1 mà WO này tồn tại để đóng.
   * Hôm nay 4 call-site đều đúng, nhưng cái giữ chúng đúng là hai ca int-spec C2/C3, không phải cơ chế.
   */
  readonly table: string | null;
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
function grant(basis: IdentityBasis, cond: SQL, why: string, table: string | null): IdentityGrant {
  return { basis, cond, why, table } as IdentityGrant;
}

/** Tên bảng/alias mà một cột drizzle thuộc về. */
function tableOf(col: PgColumn): string {
  return getTableName(col.table);
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
  /** Bảng/alias mà `cond` nói về — lấy từ chính cột đã truyền cho `buildUserScopeConditionOn`. */
  target?: PgColumn,
): IdentityGrant {
  return grant(basis, cond ?? sql`false`, why, target ? tableOf(target) : null);
}

/** Căn cứ = tập hàng ghim vào chính actor. `idCol` là cột mang `users.id` của hàng. */
export function selfBound(actorUserId: string, idCol: PgColumn, why: string): IdentityGrant {
  return grant("self-bound-row", eq(idCol, actorUserId), why, tableOf(idCol));
}

/** Căn cứ = tư cách thành viên tài nguyên (phòng chat, dự án) — vị từ do caller dựng. */
export function byMembership(cond: SQL, why: string, target?: PgColumn): IdentityGrant {
  return grant("membership", cond, why, target ? tableOf(target) : null);
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
  // Vô điều kiện ⇒ không ràng bảng nào; `identityColumns` bỏ qua bước đối chiếu bảng cho nhóm này.
  return grant(basis, sql`true`, why, null);
}

/** Đọc basis của một grant — cho log/test; không có đường GHI ngược lại. */
export function basisOf(g: IdentityGrant): IdentityBasis {
  return g.basis;
}

/**
 * S10-SEC-AUDITLOGROW-1 (KI-070) — lấy vị từ của một grant để AND vào `WHERE`, tức chặn **TẬP HÀNG**
 * chứ không chỉ che CỘT.
 *
 * VÌ SAO nó ở đây chứ không phải một `SQL` trần truyền tay: `identityColumns` bên dưới ép mọi điểm
 * chiếu CỘT phải mang căn cứ, nhưng bound HÀNG thì trước WO này không có gì ép cả — `login_logs` và
 * `user_security_events` đọc trọn tenant cho mọi scope vì `buildWhere` chỉ nhận filter TỪ QUERY PARAM
 * của caller. Cho vị từ hàng đi qua CÙNG một brand nghĩa là nó cũng chỉ đúc được bằng bốn constructor
 * ở trên, và cũng mang theo `table` + `why`.
 *
 * Hai assert, cả hai đều SIẾT MỘT CHIỀU:
 *
 *   1. `basis === "scoped-predicate"` — nhánh basis này vốn được định nghĩa là "vị từ `data_scope`
 *      chặn TẬP HÀNG" (xem `IdentityBasis`), nên đem một grant `self-bound-route`/`waiver`
 *      (`cond = true`, ba căn cứ KHÔNG đo được bằng máy) vào `WHERE` là biến `WHERE` thành no-op mà
 *      typecheck vẫn xanh. ⚠️ TUYỆT ĐỐI KHÔNG thêm assert đối xứng vào `identityColumns`: sổ phán
 *      quyết có 21 điểm chiếu CỘT hợp lệ mang chính basis này, siết ở đó sẽ ĐỎ oan cả 21.
 *
 *   2. `table` khớp bảng của `target` — soi gương bước đối chiếu bảng trong `identityColumns`. Vị từ
 *      dựng trên `login_logs` đem AND vào truy vấn `user_security_events` là **hợp kiểu** với một
 *      `SQL` trần và cho ra `WHERE` luôn-sai hoặc luôn-đúng tuỳ join — im lặng cả hai chiều.
 *
 * ⚠️ RANH GIỚI THẬT của assert #2 — đừng đọc nó mạnh hơn thực tế (plan-review vòng 1): ở cả hai
 * repository nhật ký, nơi ĐÚC (service) và nơi TIÊU THỤ (repo) đều hard-code CÙNG một hằng cột, nên
 * assert này chỉ bắt được ca "đem grant của bảng KIA sang", KHÔNG bắt được ca "cả hai cùng trỏ sai
 * một bảng". Cái bắt ca đó là int-spec `audit-log-row-scope.int-spec.ts`, không phải hàm này.
 *
 * `table === null` bị chặn ở **assert #2**, không phải #1 (plan-review vòng 2 — đừng tin assert #1
 * mạnh hơn thực tế): `unconditional()` quả thật không đúc ra basis này, NHƯNG `fromScope(cond,
 * "scoped-predicate", why)` thiếu tham số thứ tư vẫn cho `table = null`, và cái bắt nó là phép so
 * `null !== "<tên bảng>"` ở dưới.
 */
export function rowScopeSql(grantArg: IdentityGrant, target: PgColumn): SQL {
  if (grantArg.basis !== "scoped-predicate") {
    throw new Error(
      `rowScopeSql: vị từ chặn TẬP HÀNG phải mang basis "scoped-predicate", nhận "${grantArg.basis}". ` +
        "Các basis khác không hứa gì về tập hàng — `unconditional()` còn cho `cond = true` " +
        '(WHERE thành no-op). Dựng bằng `fromScope(cond, "scoped-predicate", why, targetCol)`.',
    );
  }
  const want = tableOf(target);
  if (grantArg.table !== want) {
    throw new Error(
      `rowScopeSql: vị từ nói về bảng "${grantArg.table}" nhưng đang chặn hàng của "${want}". ` +
        "Mỗi BẢNG cần MỘT grant dựng trên cột của chính bảng đó (KI-070).",
    );
  }
  return grantArg.cond;
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

  // ĐỐI CHIẾU BẢNG — biến lỗi im lặng thành lỗi ồn ào (security-reviewer 2026-08-19, F1).
  // Vị từ dựng trên `users` mà đem bọc cột của `alias(users,"sec_event_actor")` là **hợp kiểu**, chạy
  // được, và cho ra đúng hai chiều sai của lỗ B1: lộ danh tính vai kia, hoặc giấu danh tính chính chủ.
  // Ném ở đây thì nó vỡ ngay lần chạy đầu tiên của truy vấn, thay vì đợi một ca test tồn tại.
  if (grantArg.table !== null) {
    const mismatched = Object.entries(spec).filter(([, col]) => tableOf(col) !== grantArg.table);
    if (mismatched.length > 0) {
      throw new Error(
        `identityColumns: vị từ nói về bảng "${grantArg.table}" nhưng đang bọc cột của ` +
          `${mismatched.map(([k, col]) => `${k}@${tableOf(col)}`).join(", ")}. ` +
          "Mỗi VAI trong truy vấn cần MỘT grant dựng trên cột của chính vai đó (KI-054 / B1).",
      );
    }
  }

  const wrapped = Object.fromEntries(
    Object.entries(spec).map(([key, col]) => [
      key,
      // `::text` giữ NGUYÊN hành vi của call-site đầu tiên (`role-admin.repository` vốn cast vì
      // `users.email` ở DB là `citext`), và làm nhánh `else null` có kiểu xác định thay vì `unknown`.
      sql<string | null>`case when (${cond}) then ${col}::text else null end`,
    ]),
  ) as { [K in keyof T]: SQL<string | null> };

  // ⚠️ `coalesce(…, false)` chứ không `(${cond})` trần (security-reviewer 2026-08-19, F2): khi
  // `leftJoin` TRƯỢT (hàng trỏ tới user đã bị xoá cứng) thì mọi cột của bảng là NULL, nên một vị từ
  // dạng `users.company_id = $1` cho ra **NULL**, không phải `false`. Cờ khi đó là `null` trong khi
  // kiểu khai là `boolean` — kiểu NÓI DỐI, và mọi nhánh `if (flag)` phía service im lặng đi vào
  // đường "ngoài scope". `coalesce` làm kiểu thành sự thật; ngữ nghĩa vẫn fail-closed.
  return { [flagKey]: sql<boolean>`coalesce((${cond}), false)`, ...wrapped } as IdentityProjection<
    T,
    F
  >;
}
