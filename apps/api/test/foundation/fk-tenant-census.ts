import type { Pool } from "pg";

/**
 * S6-SEC-XTENANTFK-1 (KI-046) — BỘ QUÉT KHOÁ NGOẠI GIỮA HAI BẢNG TENANT.
 *
 * VÌ SAO CÓ FILE NÀY. Kiểm tra khoá ngoại của Postgres **chạy với quyền hệ thống và KHÔNG áp RLS**
 * (hành vi thiết kế của PG, không phải bug của ta). Nên một FK MỘT CỘT `child.x → parent(id)` giữa
 * hai bảng đều có `company_id` cho phép app role đứng trong ngữ cảnh tenant A ghi hàng
 * `company_id = A` nhưng `x` trỏ tới hàng của B — FK thấy hàng đó TỒN TẠI nên cho qua, còn RLS
 * `WITH CHECK` chỉ soi `company_id` (= A, hợp lệ). Đã tái lập đầu-cuối ở mig `0533` (`team_members`).
 * Cách bịt duy nhất ở tầng DB là **composite FK** `(company_id, x) → parent(company_id, id)`.
 *
 * BẤT BIẾN CỦA FILE NÀY: **0 regex trên mã nguồn, 0 danh sách bảng viết tay** — cùng bất biến với
 * `route-census.ts`. Mọi con số đọc thẳng từ `pg_constraint`/`pg_attribute`. Lý do: bộ phân loại
 * theo TÊN FILE schema đã được thử và tự nó SAI (`tasks`/`task_labels` khai trong `workflow.ts`,
 * `projects`/`project_members` khai trong `media.ts` — đúng những bảng MVP đang sống lại bị dán nhãn
 * "đã park"). Catalog không có bẫy đó.
 *
 * PHÂN LỚP THEO BẢNG ĐÍCH — điểm quan trọng nhất của file này:
 *   • lớp **T** (tenant thuần): `parent.company_id` NOT NULL ⇒ mọi hàng đích thuộc đúng 1 tenant
 *     ⇒ composite FK vá được, và PHẢI vá.
 *   • lớp **G** (catalog toàn cục): `parent.company_id` NULLABLE ⇒ bảng chứa hàng dùng chung
 *     (`roles` hệ thống, `dashboard_widgets`, `notification_events/templates`, `public_holidays`,
 *     `seed_batches`). Composite FK ở đây sẽ **PHÁ tham chiếu hợp lệ** — không gán được role hệ
 *     thống, không cấu hình được widget. Lớp G phải được KÝ WAIVER, không phải vá.
 * Phân lớp bằng `attnotnull` của catalog, KHÔNG bằng "hôm nay bảng đó có hàng NULL hay chưa": một
 * bảng đang 0 hàng NULL vẫn có thể nhận hàng toàn cục ngày mai, và lúc đó constraint đã đóng cửa.
 */

/** Một khoá ngoại một-cột nối hai bảng đều có `company_id`. */
export interface FkPair {
  /** Tên constraint của FK một-cột (để báo lỗi trỏ đúng chỗ). */
  constraintName: string;
  /** Bảng con. */
  srcTable: string;
  /** Cột FK ở bảng con. */
  srcColumn: string;
  /** Bảng cha. */
  tgtTable: string;
  /** Cột được tham chiếu ở bảng cha (thực tế luôn là `id` — có assert riêng, xem ratchet (f)). */
  tgtColumn: string;
  /** `c` CASCADE · `n` SET NULL · `a` NO ACTION · `r` RESTRICT · `d` SET DEFAULT. */
  onDelete: string;
  /** `parent.company_id` NOT NULL ⇒ lớp T; ngược lại lớp G. */
  targetTenantOnly: boolean;
  /**
   * `child.company_id` NOT NULL. FALSE ⇒ **lớp P (bịt một nửa)**: MATCH SIMPLE bỏ qua mọi hàng có
   * NULL trong tập cột FK, nên composite FK KHÔNG kiểm những hàng `company_id IS NULL`. `covered`
   * vẫn TRUE (constraint tồn tại thật) — đừng đọc nó thành "kín 100%".
   */
  sourceTenantOnly: boolean;
  /** Đã có composite FK `(company_id, srcColumn)` phủ lên cặp này chưa. */
  covered: boolean;
  /** Tên composite FK đang phủ (null nếu chưa có) — để test đối chiếu `err.constraint`. */
  coveringConstraint: string | null;
  /** `confdeltype` của composite FK đang phủ. */
  coveringOnDelete: string | null;
  /**
   * Composite `ON DELETE SET NULL` có kèm DANH SÁCH CỘT không (`confdelsetcols` khác rỗng).
   * FALSE + `coveringOnDelete = 'n'` ⇒ constraint đó sẽ set NULL **cả `company_id`** khi xoá cha —
   * hỏng hơn lỗ đang vá (xem `0503` header + `0535` header).
   */
  coveringSetNullHasColumnList: boolean;
  /** Composite FK có trỏ đúng `(company_id, id)` của bảng cha không. */
  coveringTargetsCompanyAndId: boolean;
  /**
   * S10-SEC-FKCATALOG-1 (KI-055) — guard trigger lớp G đang phủ cặp này, nếu có.
   *
   * KHÔNG do `CENSUS_SQL` sinh ra (query đó chốt trên `pg_constraint`; trigger sống ở `pg_trigger`).
   * Field này được `attachCatalogGuards()` gắn thêm — vì thế nó OPTIONAL: một `FkPair` lấy thẳng từ
   * `collectFkPairs()` mà chưa qua bước ghép sẽ có `undefined`, và **`undefined` KHÔNG có nghĩa
   * "không có guard"**. Nơi nào đọc field này phải chắc chắn đã ghép trước.
   */
  catalogGuard?: CatalogFkGuard | null;
}

/** Một trigger `enforce_company_id_catalog_fk` đang gắn trên một bảng con. */
export interface CatalogFkGuard {
  /** Bảng CON mang trigger. */
  childTable: string;
  tgname: string;
  /** `O` = enabled (origin) · `D` = disabled · `R`/`A` = replica-only. Chỉ `O` mới tính là đang chặn. */
  tgenabled: string;
  /** `TG_ARGV`: `[<bảng cha>, <cột FK>]`. */
  argv: [string, string];
}

/** Khoá ổn định của một cặp — dùng cho sổ phán quyết và thông điệp lỗi. */
export function pairKey(p: Pick<FkPair, "srcTable" | "srcColumn" | "tgtTable">): string {
  return `${p.srcTable}.${p.srcColumn} -> ${p.tgtTable}`;
}

/** Câu SQL vá sẵn cho một cặp còn hở — dán vào migration mới là chạy được. */
export function suggestedFix(p: FkPair): string {
  const action =
    p.onDelete === "c"
      ? "CASCADE"
      : p.onDelete === "n"
        ? // ⚠️ PHẢI kèm danh sách cột: composite `SET NULL` trần sẽ null LUÔN `company_id`.
          `SET NULL (${p.srcColumn})`
        : p.onDelete === "r"
          ? "RESTRICT"
          : "NO ACTION";
  let name = `${p.srcTable}_${p.srcColumn}_company_fk`;
  if (name.length > 63) name = `${p.srcTable}_${p.srcColumn}_cfk`;
  return (
    `ALTER TABLE ${p.tgtTable} ADD CONSTRAINT ${p.tgtTable}_company_id_id_uq UNIQUE (company_id, id); -- nếu chưa có\n` +
    `ALTER TABLE ${p.srcTable} ADD CONSTRAINT ${name} ` +
    `FOREIGN KEY (company_id, ${p.srcColumn}) REFERENCES ${p.tgtTable} (company_id, id) ON DELETE ${action};`
  );
}

/**
 * SQL census. Một truy vấn duy nhất; `covered` tính bằng "tồn tại FK 2 cột trên cùng cặp bảng mà tập
 * cột đúng bằng {company_id, srcColumn}" — so theo CỘT chứ KHÔNG theo tên constraint, nên đổi tên
 * hay thêm constraint tương đương bằng tay đều không lừa được nó.
 */
const CENSUS_SQL = `
WITH tenant_tables AS (
  SELECT c.oid,
         c.relname,
         (SELECT a.attnotnull FROM pg_attribute a
           WHERE a.attrelid = c.oid AND a.attname = 'company_id') AS cid_not_null
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a2 ON a2.attrelid = c.oid AND a2.attname = 'company_id'
                        AND a2.attnum > 0 AND NOT a2.attisdropped
   -- 'p' = bảng phân mảnh. Hôm nay dự án có 0 bảng 'p', nhưng lọc chỉ 'r' là đúng lớp mù đã đẻ ra
   -- KI-041 (matview nằm ngoài mọi phép quét). Nhận cả hai để bảng phân mảnh đầu tiên không vô hình.
   WHERE c.relkind IN ('r', 'p') AND n.nspname = 'public'
),
single_col AS (
  SELECT con.oid,
         con.conname,
         con.conrelid,
         con.confrelid,
         src.relname AS src_table,
         tgt.relname AS tgt_table,
         src.cid_not_null AS src_cid_not_null,
         tgt.cid_not_null AS tgt_cid_not_null,
         con.confdeltype::text AS on_delete,
         (SELECT a.attname FROM pg_attribute a
           WHERE a.attrelid = con.conrelid AND a.attnum = con.conkey[1]) AS src_column,
         (SELECT a.attname FROM pg_attribute a
           WHERE a.attrelid = con.confrelid AND a.attnum = con.confkey[1]) AS tgt_column
    FROM pg_constraint con
    JOIN tenant_tables src ON src.oid = con.conrelid
    JOIN tenant_tables tgt ON tgt.oid = con.confrelid
   WHERE con.contype = 'f' AND array_length(con.conkey, 1) = 1
),
-- Composite FK đang phủ, nếu có. Lấy CẢ thuộc tính của nó (không chỉ "có/không") vì một composite FK
-- SAI KIỂU (SET NULL trần, hoặc trỏ tới cột khác) vẫn "tồn tại" mà không bịt đúng lỗ.
with_cover AS (
  SELECT s.*,
         cov.conname AS cov_name,
         cov.confdeltype::text AS cov_on_delete,
         cov.confdelsetcols AS cov_setcols,
         cov.confkey AS cov_confkey,
         cov.confrelid AS cov_confrelid
    FROM single_col s
    LEFT JOIN LATERAL (
      SELECT c2.* FROM pg_constraint c2
       WHERE c2.contype = 'f'
         AND c2.conrelid = s.conrelid
         AND c2.confrelid = s.confrelid
         AND array_length(c2.conkey, 1) = 2
         AND (SELECT count(*) FROM unnest(c2.conkey) k
               JOIN pg_attribute a ON a.attrelid = c2.conrelid AND a.attnum = k
              WHERE a.attname IN ('company_id', s.src_column)) = 2
       ORDER BY c2.conname
       LIMIT 1
    ) cov ON true
)
SELECT w.conname          AS "constraintName",
       w.src_table        AS "srcTable",
       w.src_column       AS "srcColumn",
       w.tgt_table        AS "tgtTable",
       w.tgt_column       AS "tgtColumn",
       w.on_delete        AS "onDelete",
       w.tgt_cid_not_null AS "targetTenantOnly",
       w.src_cid_not_null AS "sourceTenantOnly",
       (w.cov_name IS NOT NULL) AS "covered",
       w.cov_name         AS "coveringConstraint",
       w.cov_on_delete    AS "coveringOnDelete",
       -- SET NULL trần ⇒ confdelsetcols NULL/rỗng ⇒ Postgres null LUÔN company_id.
       (w.cov_on_delete IS DISTINCT FROM 'n'
        OR COALESCE(array_length(w.cov_setcols, 1), 0) > 0) AS "coveringSetNullHasColumnList",
       -- Composite FK phải trỏ tới ĐÚNG (company_id, id) của bảng cha.
       COALESCE((
         SELECT count(*) = 2 FROM unnest(w.cov_confkey) fk
          JOIN pg_attribute a ON a.attrelid = w.cov_confrelid AND a.attnum = fk
         WHERE a.attname IN ('company_id', 'id')
       ), false) AS "coveringTargetsCompanyAndId"
  FROM with_cover w
 WHERE w.src_column <> 'company_id'
 ORDER BY w.src_table, w.src_column
`;

/** Đọc catalog FK giữa các bảng tenant. Cần một pool DIRECT (chỉ đọc `pg_catalog`). */
export async function collectFkPairs(direct: Pool): Promise<FkPair[]> {
  const { rows } = await direct.query<FkPair>(CENSUS_SQL);
  return rows;
}

/**
 * S10-SEC-FKCATALOG-1 (KI-055) — QUÉT GUARD LỚP G từ `pg_trigger`.
 *
 * Bịt 11 cặp lớp G không dùng composite FK (composite FK phá tham chiếu toàn cục — xem
 * `fk-tenant-verdicts.ts`), mà dùng trigger `enforce_company_id_catalog_fk` do mig `0547` tạo. Vì thế
 * `covered` của census (đọc `pg_constraint`) **vĩnh viễn FALSE** cho 11 cặp đó, và lưới ratchet cần
 * nguồn thứ hai này để biết chúng đã được vá.
 *
 * GIỮ ĐÚNG BẤT BIẾN CỦA FILE: đọc thẳng `pg_trigger`/`pg_proc`/`pg_class` — **0 regex trên mã nguồn,
 * 0 danh sách bảng viết tay**. `tgargs` là bytea các tham số ngăn cách bằng NUL ⇒ decode `escape` rồi
 * tách theo `\000` (giữ THỨ TỰ bằng `WITH ORDINALITY`; `argv[0]` = bảng cha, `argv[1]` = cột FK).
 *
 * ⛔ TUYỆT ĐỐI KHÔNG dùng hàm này làm nguồn sinh ca test HÀNH VI: nó đọc `pg_trigger` nên **trước khi
 * áp `0547` nó trả 0 hàng** ⇒ bước RED sẽ sinh 0 ca và cả bộ test hành vi thành xanh-rỗng. Nguồn sinh
 * ca hành vi phải là `collectFkPairs` (đọc `pg_constraint`, có đủ 11 cặp ở CẢ HAI phía migration).
 */
export async function collectCatalogFkGuards(direct: Pool): Promise<CatalogFkGuard[]> {
  const { rows } = await direct.query<CatalogFkGuard>(
    `SELECT c.relname          AS "childTable",
            t.tgname           AS "tgname",
            t.tgenabled::text  AS "tgenabled",
            (SELECT array_agg(u.a ORDER BY u.ord)
               FROM unnest(string_to_array(encode(t.tgargs, 'escape'), '\\000'))
                    WITH ORDINALITY AS u(a, ord)
              WHERE u.a <> '') AS "argv"
       FROM pg_trigger t
       JOIN pg_proc p ON p.oid = t.tgfoid
       JOIN pg_class c ON c.oid = t.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE p.proname = 'enforce_company_id_catalog_fk'
        AND n.nspname = 'public'
        AND NOT t.tgisinternal
      ORDER BY c.relname, t.tgname`,
  );
  return rows;
}

/**
 * Ghép guard vào từng cặp. So khớp bằng **CẢ `argv[0]` (bảng cha) LẪN `argv[1]` (cột FK)** — chỉ so
 * bảng cha thì một ký tự gõ nhầm trong tên cột ở `CREATE TRIGGER` sẽ vẫn "khớp" và lọt lưới, đúng lớp
 * hỏng-im-lặng mà chính hàm guard phải `RAISE` để chặn.
 *
 * Trả về MẢNG MỚI (không mutate đầu vào — bất biến immutability của dự án).
 */
export function attachCatalogGuards(
  pairs: readonly FkPair[],
  guards: readonly CatalogFkGuard[],
): FkPair[] {
  const byPair = new Map<string, CatalogFkGuard>();
  for (const g of guards) {
    byPair.set(`${g.childTable}.${g.argv?.[1]} -> ${g.argv?.[0]}`, g);
  }
  return pairs.map((p) => ({ ...p, catalogGuard: byPair.get(pairKey(p)) ?? null }));
}

/**
 * Hàm `enforce_company_id_catalog_fk` có còn giữ đúng tư thế bảo mật không.
 *
 * `ownerBypassesRls` là vế SỐNG-CÒN: cả 8 bảng con đều `relforcerowsecurity = on`, mà **FORCE RLS áp
 * cả lên CHỦ BẢNG**. Hàm `SECURITY DEFINER` thuộc một role KHÔNG BYPASSRLS (kịch bản thật:
 * `pg_restore --no-owner` khi clone PROD, hoặc migration chạy bằng `mediaos_owner`) sẽ bị RLS che hàng
 * cha của tenant khác ⇒ guard rơi vào nhánh "cha không tồn tại" ⇒ `RETURN NEW` ⇒ **fail-open IM LẶNG**,
 * trong khi trigger vẫn tồn tại và ACTIVE nên mọi lưới khác vẫn xanh.
 */
export async function collectCatalogGuardFunction(direct: Pool): Promise<{
  exists: boolean;
  securityDefiner: boolean;
  searchPathLocked: boolean;
  ownerBypassesRls: boolean;
  owner: string | null;
}> {
  const { rows } = await direct.query<{
    securityDefiner: boolean;
    searchPathLocked: boolean;
    ownerBypassesRls: boolean;
    owner: string;
  }>(
    `SELECT p.prosecdef AS "securityDefiner",
            COALESCE((SELECT bool_or(c LIKE 'search_path=%') FROM unnest(p.proconfig) c), false)
                       AS "searchPathLocked",
            (r.rolsuper OR r.rolbypassrls) AS "ownerBypassesRls",
            r.rolname  AS "owner"
       FROM pg_proc p
       JOIN pg_roles r ON r.oid = p.proowner
      WHERE p.proname = 'enforce_company_id_catalog_fk'
        AND p.pronamespace = 'public'::regnamespace`,
  );
  const row = rows[0];
  if (!row) {
    return {
      exists: false,
      securityDefiner: false,
      searchPathLocked: false,
      ownerBypassesRls: false,
      owner: null,
    };
  }
  return { exists: true, ...row };
}

/** Trigger bất biến `company_id` (hàm `enforce_company_id_immutable` của mig `0436`) đang gắn ở đâu. */
export async function collectCompanyImmutableTriggers(direct: Pool): Promise<
  { table: string; tgname: string; tgenabled: string }[]
> {
  const { rows } = await direct.query<{ table: string; tgname: string; tgenabled: string }>(
    `SELECT c.relname AS "table", t.tgname AS "tgname", t.tgenabled::text AS "tgenabled"
       FROM pg_trigger t
       JOIN pg_proc p ON p.oid = t.tgfoid
       JOIN pg_class c ON c.oid = t.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE p.proname = 'enforce_company_id_immutable'
        AND n.nspname = 'public'
        AND NOT t.tgisinternal
      ORDER BY c.relname`,
  );
  return rows;
}

/**
 * ĐIỂM MÙ CỦA CENSUS, đo được thay vì bỏ qua (security-reviewer FULL gate 2026-07-31, MEDIUM).
 *
 * `collectFkPairs` chỉ thấy bảng CÓ cột `company_id`. Một bảng bật RLS nhưng KHÔNG có cột đó (cô lập
 * tenant qua tương quan, vd `role_permissions` ép qua `roles.company_id`) sẽ **vô hình** với lưới —
 * cùng lớp mù đã đẻ ra KI-041 (matview nằm ngoài mọi phép quét).
 *
 * Hàm này liệt kê chúng để ratchet bắt ký nhận: hôm nay có 2 (`companies` là bảng gốc tenant,
 * `role_permissions` an toàn nhờ policy tương quan). Bảng thứ ba xuất hiện = phải xem xét, không được
 * lặng lẽ nằm ngoài mọi lưới.
 */
export async function collectRlsTablesWithoutCompanyId(direct: Pool): Promise<string[]> {
  const { rows } = await direct.query<{ relname: string }>(
    `SELECT c.relname
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('r', 'p')
        AND n.nspname = 'public'
        AND c.relrowsecurity
        AND NOT EXISTS (
          SELECT 1 FROM pg_attribute a
           WHERE a.attrelid = c.oid AND a.attname = 'company_id'
             AND a.attnum > 0 AND NOT a.attisdropped
        )
      ORDER BY c.relname`,
  );
  return rows.map((r) => r.relname);
}

/**
 * Đếm hàng ĐANG lệch tenant cho từng cặp, theo **đúng ngữ nghĩa MATCH SIMPLE** của Postgres: hàng có
 * `company_id` HOẶC cột FK là NULL thì FK KHÔNG kiểm, nên cũng không được tính là lệch. Đếm rộng hơn
 * sẽ báo động giả trên chính những bảng có hàng hệ thống (`company_id IS NULL`).
 */
export async function countTenantDrift(
  direct: Pool,
  pairs: readonly FkPair[],
): Promise<{ pair: FkPair; rows: number }[]> {
  const out: { pair: FkPair; rows: number }[] = [];
  for (const p of pairs) {
    const { rows } = await direct.query<{ n: string }>(
      `SELECT count(*)::text AS n
         FROM "${p.srcTable}" s
         JOIN "${p.tgtTable}" t ON s."${p.srcColumn}" = t."${p.tgtColumn}"
        WHERE s.company_id IS NOT NULL
          AND s."${p.srcColumn}" IS NOT NULL
          AND s.company_id <> t.company_id`,
    );
    const n = Number(rows[0]?.n ?? 0);
    if (n > 0) out.push({ pair: p, rows: n });
  }
  return out;
}
