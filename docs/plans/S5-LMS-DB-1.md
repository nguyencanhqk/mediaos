# S5-LMS-DB-1 — Micro-plan v2 (🔴 crown · zone=red · gate FULL)

> WO: `harness/backlog.mjs` → `S5-LMS-DB-1`. Wave: [S5-LMS-WAVE.md](S5-LMS-WAVE.md) §4 B03.
> Mục tiêu: mở CHECK `audit_logs.object_type` cho 2 giá trị `lms_sso` + `lms_sync` (UNION ADD-only)
> và đồng bộ `AUDIT_OBJECT_TYPES` (TS) **cùng commit** — để BE-2 (audit mint SSO) và BE-1 (audit
> summary sync) ghi audit mà KHÔNG vỡ constraint trên Postgres thật.
>
> **v2 (2026-07-22)** — vá 8 must-fix của `plan-reviewer` (verdict PASS-with-fixes). Thay đổi lớn:
> DO-block chuyển **fail-closed** (§0 D3/D3b), ca test "idempotent" chuyển sang **probe-table**
> (§3 ca 5 — cấm DDL lên `audit_logs` thật trong test), thêm ca **no-loss** + ca **journal integrity**.

---

## 0. Quyết định chốt (trước khi code)

| # | Quyết định | Lý do |
| --- | --- | --- |
| **D1** | **1 migration duy nhất**, 2 giá trị trong CÙNG một DO-block (`ARRAY['lms_sso','lms_sync']`) | Cùng wave; tách 2 file = 2 lần DROP/ADD CONSTRAINT vô ích |
| **D2** | Số **0509**, tên `0509_s5_lmsdb1_audit_lms_object_types.sql`; journal idx **189**, `when` **1717587311000** | Head = idx 188 / `0508_lms_access_permission` / when 1717587310000 (kiểm `_journal.json` 2026-07-22). §2 Bước 0 BẮT BUỘC kiểm lại ngay trước commit |
| **D3** | Đọc `pg_get_constraintdef` THẬT từ `pg_constraint`, union cộng dồn. **KHÔNG** rewrite CHECK từ snapshot TS/file cũ | Bất biến #2 append-only. Đo thật: CHECK hiện có **101** giá trị, trong đó `defect` **chỉ có ở DB, KHÔNG có trong mảng TS** (0086 thêm; ghi chú `audit.ts:159-160`) ⇒ rewrite từ TS sẽ **xoá mất** nó |
| **D3b** | **Parse 2 tầng + fail-closed** (sửa must-fix #1/#2 — mẫu 0506 có 2 đường fail-open im lặng): ① thử dạng bare `'{a,b}'::text[]`; ② không match → fallback regex nháy đơn (bắt `= ANY (ARRAY['a'::text,…])`); ③ vẫn NULL → **`RAISE EXCEPTION`**. Constraint: ưu tiên tên chính xác `audit_logs_object_type_chk`, không thấy thì `LIKE '%object_type%'` **và RAISE nếu số match ≠ 1**; `v_oid IS NULL` → **RAISE EXCEPTION** (mẫu cũ chỉ `RAISE NOTICE` + `RETURN`) | `pg_get_constraintdef` **luôn** render `= ANY(...)` (không bao giờ `IN (…)`) ⇒ nhánh `position('ANY'…)` của 0506 luôn true và nhánh ELSE là dead code. Dạng `ARRAY['x'::…]` **có thật trên chính bảng này** (`chk_audit_logs_actor_type`) và làm `substring(FROM '\{[^}]*\}')` trả NULL ⇒ `NOT (NULL @> …)` = NULL ⇒ `v_add` NULL ⇒ block báo *"đã có sẵn — skip"* trong khi thực chất **parse hỏng**. Migration đỏ còn hơn im lặng không làm gì |
| **D3c** | Trước khi swap: assert `v_union @> v_cur` (union PHẢI là superset); sau khi swap: **đọc lại def** và assert chứa đủ `v_cur ∪ v_new`, thiếu → `RAISE EXCEPTION` | Verify no-loss ngay trong cùng DO-block (không cần state cross-statement). Migration chạy trong **1 transaction chung** (`apps/api/src/db/migrate.ts`) ⇒ EXCEPTION = rollback sạch, không có cửa sổ CHECK bị mất |
| **D4** | Giữ `DROP CONSTRAINT` + `ADD CONSTRAINT` validate ngay, **KHÔNG** `NOT VALID` + `VALIDATE` | Đo thật: `audit_logs` = **4.699 dòng / 1.5 MB** ⇒ full-scan tức thời. Union là **superset** ⇒ validate chắc chắn pass |
| **D5** | **Thuần DB**: KHÔNG đụng `AuditService`, masker, controller, module | Writer thật là BE-1/BE-2. Đã kiểm ripple: `AuditObjectType` chỉ dùng ở `src/events/audit.service.ts`; `packages/contracts/src/observability.ts` là `z.string()` (không phải enum) ⇒ **không có ripple FE/DTO** |
| **D6** | Cập nhật comment danh sách migration `audit.ts:98` thêm `+0506+0509` | Comment đang dừng ở `+0496` (0506 quên) — vá drift 1 dòng, additive |
| **D7** | **Pin cho BE-2:** `objectId = jti` phải là **UUID** (`lms-sso.service.ts` dùng `randomUUID()`) vì `audit_logs.object_id` kiểu `uuid`. Đổi jti sang chuỗi non-UUID ⇒ BE-2 phải rơi về `entity_id_text` | Chặn trước một vòng review lại ở BE-2 |

---

## 1. Phạm vi

**TRONG — 4 file:**

1. `apps/api/migrations/0509_s5_lmsdb1_audit_lms_object_types.sql` (mới)
2. `apps/api/migrations/meta/_journal.json` (+1 entry)
3. `apps/api/src/db/schema/audit.ts` (append 2 giá trị + comment D6)
4. `apps/api/test/integration/lms-audit-object-types.int-spec.ts` (mới)

**NGOÀI (không đụng):** `db:generate` (migration thuần DDL-CHECK viết tay — `migrations/meta/` chỉ có
`0000_snapshot.json`, không có snapshot per-migration) · bảng/cột mới · quyền mới · seed · `AuditService` ·
allowlist sensitive FE · pin `auth-seed-canonical-roles` · `apps/lms`.

---

## 2. Các bước

**Bước 0 — chống va số (BẮT BUỘC, ngay trước commit):**
`node -e "const j=require('./apps/api/migrations/meta/_journal.json'); console.log(j.entries.at(-1))"`
Nếu head ≠ `0508_lms_access_permission` (tức **S5-GOAL-DB-2** đã chiếm 0509) → đổi sang số kế tiếp.
Hai migration cùng UNION-ADD vào một CHECK là **giao hoán** (mỗi cái đọc def THẬT rồi cộng dồn) ⇒ thứ tự
chạy không quan trọng, chỉ **số file** xung đột. Checklist renumber (must-fix #7c) — đổi ĐỒNG THỜI:
tên file · entry `_journal.json` (`idx` **và** `when`) · band ghi ở header SQL · **mọi chuỗi `[0509]`**
trong RAISE · chuỗi `+0506+0509` ở `audit.ts:98` · hằng tên file mà ca test #5 đọc.

> **Luật giải conflict với S5-GOAL-DB-2** (must-fix #7b): bề mặt va chạm thứ hai là `audit.ts` —
> WO kia cũng append (`'task_template'`) ngay trước `] as const;` và cũng sửa comment `:98`.
> Khi conflict: **GIỮ CẢ HAI**, không bao giờ chọn một bên.

**Bước 1 — RED:** viết int-spec TRƯỚC, chạy trên lane DB → phải ĐỎ (ca 1/2/3/6 đỏ vì CHECK chưa có
2 giá trị). *Ghi chú:* ca 5 (probe-table) đỏ vì `ENOENT` — "đỏ đúng nhưng sai lý do", bằng chứng RED
do ca 1–3 gánh.

**Bước 2 — GREEN:** migration 0509 (DO-block theo D3/D3b/D3c) + journal entry + append 2 giá trị vào
`AUDIT_OBJECT_TYPES` kèm comment kiểu 0506 (nêu writer BE-1/BE-2, cấm token/secret vào before/after).

**Bước 3 — verify (vùng đỏ, must-fix #6):**

```bash
bash scripts/lane-db-setup.sh lmsdb1
export LANE_DB=mediaos_lmsdb1
TURBO_FORCE=1 pnpm --filter @mediaos/api test    # int-spec mới + migration-smoke 0000→head
pnpm typecheck && pnpm lint
bash harness/check.sh --all                      # BẮT BUỘC trước PR vùng đỏ (ép int-spec chạy thật)
```

Sau khi xong: **drop lane DB** `mediaos_lmsdb1` (memory `pgdata-bloat` — vừa purge 325 lane DB ngày 2026-07-22).

**Bước 4 — gate FULL:** `database-reviewer` + `security-reviewer` + `silent-failure-hunter`.
**Bước 5 — PR:** nhánh `wo/S5-LMS-DB-1`, KHÔNG push master, **KHÔNG gắn nhãn `auto-merge`**
(vùng 🔴 — `harness/policy.md`; memory `automerge-label-bypasses-classifier`: nhãn lách được classifier).

---

## 3. Test plan — `lms-audit-object-types.int-spec.ts`

Gate CỨNG `hasDb && !!process.env.LANE_DB` cho các ca chạm DB (memory `integration-test-lane-db-gate`).
Colocated `test/integration/` (vitest include `test/**/*.int-spec.ts` — đã kiểm). Helper:
`../helpers/integration-db` (`appPool`/`directPool`/`hasDb`) + `../helpers/seed`
(`seedCompany`/`cleanupTenants` — `cleanupTenants` xoá cả audit bằng direct role).

| # | Ca | Kỳ vọng | RED? |
| --- | --- | --- | --- |
| 1 | def của `audit_logs_object_type_chk` | khớp `/[,{']lms_sso[',}]/` **và** `/[,{']lms_sync[',}]/` (biên — phủ cả dạng bare `{a,b}` lẫn quoted) | ✅ |
| 2 | **no-loss (must-fix #3)** — def sau migration | chứa **mọi** giá trị của `AUDIT_OBJECT_TYPES` (import từ `src/db/schema/audit.ts`) **+ canary `defect`** (đã xác minh có trong DB, KHÔNG có trong TS) | ✅ |
| 3 | app role INSERT `audit_logs` `object_type='lms_sso'` rồi `'lms_sync'` | thành công **và** row có `company_id` = company đã seed | ✅ 23514 |
| 4 | INSERT `object_type='lms_bogus'` | **23514** (CHECK vẫn siết, không nới thành free-text) | ❌ |
| 5 | **Idempotent trên artifact thật, qua PROBE TABLE (must-fix #4)**: đọc file `0509_*.sql` (`__dirname` + split `--> statement-breakpoint` — tiền lệ `task-pipeline-backfill-0500.int-spec.ts`), `replaceAll("audit_logs", <probe_unique>)`, dựng probe table với CHECK ở **cả 2 dạng thật** (`'{…}'::text[]` và `ARRAY['x'::text,…]`), chạy **2 lần** | không throw; union = cũ ∪ {lms_sso, lms_sync}; lần 2 không đổi gì | ✅ ENOENT |
| 6 | **Journal integrity (must-fix #7a)** — describe thuần-fs, **KHÔNG** gate DB | `idx` liên tục · `when` **tăng ngặt + duy nhất** · mỗi `tag` có file `.sql` tồn tại | ✅ |
| 7 | Grant/trigger append-only còn nguyên sau DROP+ADD CONSTRAINT | `has_table_privilege('mediaos_app','audit_logs','UPDATE'/'DELETE')` = **false** và trigger `trg_audit_logs_block_mutation` (0472) vẫn tồn tại | ❌ |
| 8 | **(v2.1)** probe tên constraint KHÔNG chuẩn nhưng khớp `LIKE` (đúng 1) | vẫn union đúng (nhánh fallback hoạt động) | ✅ |
| 9 | **(v2.1)** probe **0 match** / **2 match** constraint | migration **THROW** — pin nhánh fail-closed (khác biệt cốt lõi vs mẫu 0506; trước đó không test nào giữ, một lần sửa sau có thể lặng lẽ đưa fail-open trở lại mà suite vẫn xanh) | ✅ |
| 10 | **(v2.1)** probe CHECK hợp thành có vế **phủ định** (`… = ANY(ARRAY[…]) AND object_type <> 'ghost_value'`) | `ghost_value` **KHÔNG** được đưa vào danh sách cho phép (no-gain) | ✅ |

**Vì sao ca 5 KHÔNG được chạm `audit_logs` thật:** CI đặt `LANE_DB=mediaos` — **một** DB dùng chung cho
~128 file int-spec chạy song song. Mọi `ALTER TABLE audit_logs DROP CONSTRAINT` trong test sẽ lấy
ACCESS EXCLUSIVE và chặn/deadlock INSERT audit của suite khác ⇒ **đỏ-giả ngẫu nhiên ở spec không liên quan**.

**Vì sao ca 7 thay cho "UPDATE/DELETE → 42501":** 42501 đã được phủ ở `migration-smoke.int-spec.ts`;
append-only thực chất do **0472** ép (REVOKE + trigger), không phải 0003. Assert quyền + trigger là bằng
chứng trực tiếp hơn cho "swap constraint không đụng gì khác" và không tốn tx ghi.

---

## 4. Rủi ro / bẫy

- **Va số + conflict `audit.ts` với S5-GOAL-DB-2** → Bước 0 + luật "giữ cả hai".
- **`when` TRÙNG = migration bị bỏ qua VĨNH VIỄN, im lặng** (drizzle áp theo `folderMillis` tăng ngặt):
  CI xanh mà PROD 23514. Ca test 6 canh việc này — trước WO này **không có test nào canh**.
- **Rewrite CHECK từ mảng TS** = xoá mất `defect` ⇒ audit cũ vỡ. D3 + ca 2 chặn.
- **Fail-open im lặng của mẫu 0506** (parse hỏng → báo "đã có sẵn") → D3b chuyển fail-closed.
- **Thứ tự lên PROD vs BE-2:** BE-2 chốt **fail-closed** ⇒ nếu BE-2 lên trước 0509, user **mất luôn link
  SSO** (không chỉ mất audit). **0509 PHẢI lên PROD trước BE-2.** Ghi vào phần bàn giao PR.
- **PROD + dev-online lệch migration** (memory `prod-3-way-drift`, `dev-online-db-migration-drift`):
  0509 lên PROD theo đường psql thủ công như 0508; dev-online chạy `m dev-online-db`. Cả hai vào bàn giao PR.
- **Đỏ-giả/xanh-giả khi verify:** bắt buộc `LANE_DB` + `TURBO_FORCE=1` (memory `turbo-cache-false-green`).

## 4b. Vá sau security-review (v2.1 — verdict PASS, 0 CRITICAL/0 HIGH)

Gate FULL đã chạy trên commit đầu; 2 MEDIUM đều là khiếm khuyết của **template** (DO-block này là bản
mẫu S5-GOAL-DB-2 sắp clone) nên vá ngay tại WO này:

- **no-gain**: tầng-2 quét nháy đơn trên CẢ `constraintdef` có thể hút giá trị từ **vế phủ định** của
  CHECK hợp thành ⇒ giá trị đang bị CẤM tường minh lọt vào danh sách cho phép (nới CHECK âm thầm).
  Vá: tầng-2 **neo vào đoạn `ARRAY[…]`** + thêm assert **NO-GAIN** sau swap (đối xứng với no-loss).
- **rỗng ≠ hỏng**: dùng cờ `v_matched` thay vì suy ra "parse hỏng" từ `array_length` (CHECK rỗng hợp lệ
  cũng cho `array_length` NULL).
- `lock_timeout = 5s` quanh ALTER: thà migration đỏ còn hơn xếp hàng ACCESS EXCLUSIVE làm kẹt **mọi**
  INSERT audit (= mọi request ghi) trên PROD.
- Test: escape giá trị trong regex `inCheck`; thêm 4 ca (8/9/10 ở bảng trên).

**Ghi nhận flake CÓ SẴN trên master (KHÔNG kéo vào PR vùng đỏ này):**
`notifications-noti-core-tenant-isolation.int-spec.ts:54` seed `notification_event` **GLOBAL**
(`company_id NULL`, mã `NOTI_EVT_<random>`) trong khi `noti-seed-catalog-permissions.int-spec.ts:109`
assert "không có mã GLOBAL lạ" ⇒ chạy song song thì đỏ (xanh khi chạy cô lập). Độc lập hoàn toàn với
0509. Nên seed 1 WO nhỏ: lọc mã dạng fixture khỏi assert, hoặc cho spec isolation dọn ngay trong tx.

## 5. Definition of Done

`done_when` của WO + typecheck/lint xanh + int-spec mới xanh trên lane DB + `migration-smoke` 0000→head
xanh + `harness/check.sh --all` xanh + FULL gate PASS + **cập nhật `harness/backlog.mjs`/ledger** (CLAUDE.md §8)
+ PR mở **không nhãn auto-merge**, có ghi chú bàn giao: *0509 phải áp PROD + dev-online TRƯỚC khi BE-2 merge*.
