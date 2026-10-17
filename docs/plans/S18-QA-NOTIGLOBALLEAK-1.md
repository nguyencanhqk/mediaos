# S18-QA-NOTIGLOBALLEAK-1 — hàng GLOBAL (`company_id IS NULL`) do int-spec gieo không được sống sót qua crash (+ lớp A5 của `social-be3c-recycle-restore`)

> Trạng thái: **plan v1 (17/10/2026)** — đo tĩnh trên `d6fc99d6` (worktree `MediaOS-qa1`, nhánh `fix/s18-qa-notigloballeak-1`).
> Zone VÀNG · LIGHT gate (`typescript-reviewer` + `quality-gate`) · CHỈ test/helper/config test — KHÔNG mã sản phẩm, KHÔNG migration,
> KHÔNG dependency ⇒ **MỘT PR**.
> Nguồn: WO `S18-QA-NOTIGLOBALLEAK-1` (`harness/backlog.mjs:21371`) + lớp (0) của `S18-QA-SHAREDSTATE-1` (`harness/backlog.mjs:18532`,
> src «(0) ĐO 10/10/2026», done_when dòng 2) — owner GỘP.
> Thẩm quyền: owner chọn «NOTIGLOBALLEAK + lớp A5 tới PR (Recommended)» qua AskUserQuestion ~10:58 ngày 17/10 (đã đối chiếu lại bằng lệnh
> chỉ-đọc trên transcript phiên chính lúc lập plan). Ước 100–180 USD; trần WO vàng 250 USD (khung 16/10). Hook ECC in «COST CRITICAL»
> với tổng ảnh chụp luỹ kế — không phải chi phí thật; owner đã thấy con số đó khi chọn.
> **Kho PUBLIC:** không đường dẫn tuyệt đối có tên user; chuỗi giống-secret ghép chuỗi.

Viết tắt: `T/` = `apps/api/test/` · `I/` = `T/integration/` · «lane» = `mediaos_notileak` · «spec NOTI» = `I/notifications-noti-core-tenant-isolation.int-spec.ts`
· «spec A» = `I/noti-seed-catalog-permissions.int-spec.ts` · «spec B» = `I/s5-noti-fix1-deeplink.int-spec.ts` · «spec RR» = `I/social-be3c-recycle-restore.int-spec.ts`.

## 1. Bối cảnh + phép đo

**1.1 Lỗi NOTI (ĐO 02/10, src WO):** chunk 16 crash `ERR_IPC_CHANNEL_CLOSED` khi spec NOTI đang chạy ⇒ lane còn `NOTI_EVT_071d9e7c` +
`NOTI_TPL_0ec188e7` (GLOBAL) ⇒ spec A + spec B ĐỎ ở chunk 16 và 19; xoá đúng 2 hàng ⇒ 229/229 xanh hai lượt.

- [ĐO tĩnh] Spec NOTI gieo GLOBAL ở `beforeAll` `:126-127` qua `seedEvent` `:46-57` / `seedTemplate` `:59-74` — mỗi hàng một hậu tố ngẫu
  nhiên RIÊNG (`NOTI_EVT_${uuid8}` `:54`, `NOTI_TPL_${uuid8}` `:70`), template GLOBAL KHÔNG có `target_url_template`. Dọn DUY NHẤT ở
  `afterAll` `:155-156` (theo id). Hàng company-scoped `:130-133` dọn theo company `:146-152` (spec A/B lọc `company_id IS NULL` ⇒ không
  quan sát được chúng).
- [ĐO tĩnh] Spec A `:111-130` so tập `event_code` GLOBAL == registry, thông điệp `event LẠ trong DB (ngoài registry)` `:126`; `:207-216`
  đếm template GLOBAL `is_default=true` (fixture `is_default=false` ⇒ không chạm). Spec B `:153-169` đếm template GLOBAL
  `target_url_template IS NULL` = 0, thông điệp `KHÔNG template global nào được phép còn target_url NULL` `:162`, và tổng = 74.
- [SUY RA] Còn một cửa sổ THỨ HAI không cần crash: spec NOTI đang SỐNG (giữa `beforeAll` và `afterAll`) trong một fork khác cùng chunk ⇒
  spec A/B đọc đúng lúc đó cũng đỏ. Vá phải đóng cả hai (§4.3).

**1.2 Lỗi A5 (ĐO 10/10, src SHAREDSTATE (0)):** `check.sh --all --lane-db=flake` đỏ đúng 1 ca — spec RR `:951`
`expect(await notificationsCount(uPeer)).toBe(notiBefore)` ⇒ `expected 1 to be +0`.

- [ĐO tĩnh] Ca A5 `:934-970`: tạo bài nhắc `uPeer` `:935` ⇒ `notiBefore` `:937` ⇒ xoá ⇒ khôi phục ⇒ so lại `:951`. `notificationsCount`
  `:391-396` đếm theo `user_id`. Spec RR KHÔNG lái `OutboxWorker` (không `acquireOutboxWorkerLock`, không drain) ⇒ event
  `social.mentioned` của lượt TẠO nằm `pending` tới khi spec KHÁC drain.
- [ĐO tĩnh] `T/helpers/outbox-drain.ts:33-80` gọi `processBatch()` — `claim()` KHÔNG lọc tenant (docblock `T/helpers/outbox-worker-lock.ts`)
  ⇒ drain của spec khác (vd `I/task-noti-e2e.int-spec.ts:243`) giao thông báo nhắc tên cho `uPeer` vào giữa hai mốc. Mốc phụ thuộc thời
  điểm, không phụ thuộc hành vi khôi phục.

## 2. Bất biến phải giữ

1. KHÔNG nới assert spec A/B (literal `88/74`, `74`, thông điệp giữ nguyên), KHÔNG thêm miễn trừ `NOTI_EVT_*` vào registry.
2. Mọi phép xoá tàn dư chỉ chạy trên **DB lane** (tên DB = `LANE_DB`, tiền tố `mediaos_`, ≠ `mediaos`) — DB mặc định là PRODUCTION.
3. Xoá tàn dư KHÔNG BAO GIỜ xoá hàng của một lượt còn SỐNG (hai lượt cùng spec song song trên MỘT lane).
4. A5 vẫn ĐỎ khi khôi phục thật sự sinh thông báo; không retry/skip/nới.
5. Không làm yếu `outbox-worker-lock`: key `962_059_001` duy nhất (`T/helpers/outbox-worker-lock.unit-spec.ts:47-57`), mọi file drain phải
   gọi `acquireOutboxWorkerLock(` (`:30-45`).

## 3. Họ «gieo GLOBAL, chỉ dọn ở `afterAll`» trong `T/**` (quét 17/10)

Lệnh quét: grep `VALUES (NULL` · `companyId: null` · `seed*(…, null` · `company_id IS NULL` trong `T/**/*.ts` (61 file khớp, đa số CHỈ ĐỌC
catalog). Bảng dưới chỉ gồm file GHI hàng `company_id IS NULL`:

| #   | File:dòng                                                                                             | Bảng GLOBAL                                                                                                                        | Dọn                                      | Nạn nhân                                                                     | Xử lý                                                                            |
| --- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| F1  | spec NOTI `:126-127`                                                                                  | `notification_events` · `notification_templates`                                                                                   | `afterAll` theo id                       | spec A + spec B [ĐO 02/10]                                                   | **VÁ** (lease + quét)                                                            |
| F2  | `I/foundation-tables-tenant-deny.int-spec.ts:130-180` (`sfx` chung `:132`)                            | `sequence_counters` · `public_holidays` (2099) · `data_retention_policies` · `seed_batches` · `seed_items` · `roles` (`is_system`) | `afterAll` `:182-190` theo id            | chưa thấy assert toàn tập [SUY RA: role GLOBAL hiện cho MỌI tenant qua RLS]  | **VÁ** cùng lớp (rẻ: đã có tag `sfx`)                                            |
| F3  | `I/role-member-del-oracle.int-spec.ts:252-262` (`ki074-system-<8hex>`)                                | `roles` (+ `user_roles`)                                                                                                           | `afterAll` `:264-272`                    | như F2                                                                       | **VÁ** cùng lớp                                                                  |
| F4  | `I/payroll-be1-inputs-audit.int-spec.ts:202-207, :268` (`H-PAYIO-%`)                                  | `public_holidays`                                                                                                                  | ĐẦU + cuối theo tiền tố (đã chống crash) | [SUY RA] lượt song song thứ hai XOÁ lễ của lượt đang chạy ⇒ `work_days` lệch | **VÁ** cùng lớp (bất biến 3); L2 đọc lại mã lễ — mã cố định ⇒ thêm tag theo lượt |
| —   | `I/catalog-fk-tenant-guard.int-spec.ts:424`                                                           | (ghi bị từ chối)                                                                                                                   | `writeAsSuper` BEGIN…ROLLBACK `:300-302` | —                                                                            | ngoài họ: không để lại hàng                                                      |
| —   | `I/job-runner-worker-role:50-90` · `I/system-jobs-schema:74,98` · `I/system-job-runs-retention:28,69` | `system_job_runs`                                                                                                                  | `afterAll` / cuối ca                     | không: mã theo lượt, assert theo id/company                                  | ghi nhận, KHÔNG vá (ngoài WO)                                                    |
| —   | `I/me-security-activity:418-419` · `I/rls-registry.ts:2729`                                           | `login_logs` (append-only)                                                                                                         | không xoá được (bất biến #2)             | thuộc SHAREDSTATE lớp (2)                                                    | ngoài WO                                                                         |
| —   | `T/helpers/permission-catalog-fixture.ts` · `seed.ts`                                                 | `permissions` (không có `company_id`)                                                                                              | —                                        | cặp MỚI hợp lệ theo thiết kế (`T/global-catalog-fence.ts` docblock)          | ngoài họ                                                                         |

## 4. Thiết kế — `T/helpers/global-fixture-lease.ts` (helper chung, một lớp cho F1–F4)

**4.1 Hợp đồng «lease».** Mỗi lượt spec gieo GLOBAL giữ một **lease** suốt vòng đời hàng GLOBAL của nó:

- `acquireGlobalFixtureLease(label)` mở `Client` riêng (khuôn `outbox-worker-lock.ts`: khoá tầm-session phải nằm trên ĐÚNG một kết nối),
  `SET lock_timeout`, rồi: (a) `pg_advisory_lock_shared(GLOBAL_FIXTURE_BARRIER_KEY)`; (b) sinh `tag` = 8 hex; (c)
  `pg_advisory_lock(tagKey(tag))`. Trả `{ tag, release() }`; `release()` mở hai khoá + `client.end()`, gọi lần hai vô hại.
- Fork chết ⇒ kết nối đứt ⇒ Postgres TỰ trả cả hai khoá ⇒ hàng của lượt đó thành «hàng chết» đo được bằng khoá, KHÔNG bằng đồng hồ.
- Key: `GLOBAL_FIXTURE_BARRIER_KEY` dạng 1 tham số trong dải int4, khác `962_059_001` (outbox) · `962_006_002` (encryption) ·
  `hashtext('ensure_default_company')`; `tagKey(tag) = (962_180n << 32n) | BigInt('0x'+tag)` — nằm NGOÀI dải int4 ⇒ không trùng mọi
  khoá `hashtext`/hằng nhỏ. Dạng 2 tham số của `task-file.service.ts` là không gian khác. Tên hằng KHÁC `OUTBOX_WORKER_LOCK_KEY` ⇒ không
  làm đỏ guard `:47-57`.

**4.2 Quét hàng chết** — `sweepDeadGlobalFixtures(client, families)`: với mỗi «họ» (mô tả: bảng + regex tag trên cột mã + thứ tự FK), lấy
các `tag` tồn tại ở hàng `company_id IS NULL` khớp regex CHÍNH XÁC (vd `^NOTI_EVT_([0-9a-f]{8})$`); từng tag: `pg_try_advisory_lock(tagKey)`
— `true` ⇒ chủ đã chết ⇒ xoá hàng của tag theo thứ tự FK (template → event; `user_roles` → `roles`; `seed_items` → `seed_batches`) trong
một transaction rồi `pg_advisory_unlock`; `false` ⇒ lượt còn sống ⇒ BỎ QUA. Hàng tàn dư kiểu CŨ (hai hậu tố khác nhau, không ai giữ khoá)
cũng bị quét: xoá template theo tag của nó VÀ template trỏ `event_id` vào event của tag đang xoá. Quét chạy TRƯỚC khi lượt gieo hàng của
mình (tag của mình chưa có hàng).

- Cổng an toàn (bất biến 2): hàm quét TỰ kiểm `current_database()` = `process.env.LANE_DB`, khớp `^mediaos_[a-z0-9_]+$` và ≠ `mediaos`; sai
  ⇒ ném lỗi, KHÔNG xoá. Phần kiểm tách thành hàm thuần ⇒ unit-test được (khuôn `diffCatalogFlags`).

**4.3 Ba điểm gọi** (đóng cả hai cửa sổ §1.1):

1. **Chủ (F1–F4)**: đầu `beforeAll` — `lease = acquire…; sweep(…); seed với tag của lease`; `afterAll` — xoá hàng của mình như hiện nay
   rồi `lease.release()` CUỐI CÙNG. Spec NOTI: CẢ event lẫn template GLOBAL dùng CHUNG `tag` (`NOTI_EVT_<tag>`/`NOTI_TPL_<tag>`); hàng
   company-scoped giữ hậu tố riêng (regex quét có `company_id IS NULL` ⇒ không chạm).
2. **globalSetup** `T/global-fixture-sweep.ts` (append vào `globalSetup` ở `apps/api/vitest.config.ts:55`, sau `global-catalog-fence`): mỗi
   tiến trình vitest (mỗi chunk của `harness/chunk-test.mjs`, mỗi lượt chạy lại sau crash) quét hàng chết của mọi họ đăng ký. Không có
   `DATABASE_DIRECT_URL` hoặc không phải DB lane ⇒ `return undefined` (không quét, không đỏ unit-only). Đây là điểm làm done_when (4)
   đúng NGUYÊN VĂN: sau crash, lượt chạy spec A/B kế tiếp là một tiến trình mới ⇒ sạch trước khi spec A/B đọc.
3. **Người đọc toàn tập** (spec A, spec B): `beforeAll` lấy `acquireGlobalCatalogReadBarrier(label)` = `pg_advisory_lock(BARRIER)`
   ĐỘC QUYỀN (chờ mọi lease SỐNG trả), `afterAll` trả. KHÔNG quét ở phía người đọc (giữ tinh thần «không miễn trừ»: người đọc không xoá gì).
   Thứ tự khoá: spec B đã giữ outbox lock — chủ (spec NOTI) KHÔNG BAO GIỜ lấy outbox lock ⇒ không có chu trình. Hook có bước chờ nới timeout
   (khuôn `OUTBOX_WORKER_LOCK_HOOK_TIMEOUT_MS`).

[SUY RA] Còn lại một ca hẹp: crash GIỮA chunk mà spec A/B chạy SAU đó trong CÙNG tiến trình ⇒ lượt đó đỏ, nhưng chunk crash luôn bị
`chunk-test.mjs` chạy lại (tiến trình mới ⇒ globalSetup quét) ⇒ kết luận cuối không đỏ oan. L4 đo bằng số liệu, không tin suy luận này.

**4.4 A5** (spec RR, chỉ ca A5): ngay đầu ca `acquireOutboxWorkerLock("social-be3c-recycle-restore A5")` (try/finally `release()`; timeout
của `it` = `OUTBOX_WORKER_LOCK_HOOK_TIMEOUT_MS` — lệch có chủ ý khỏi khuôn «cuối beforeAll» vì chỉ A5 đếm `notifications`, khoá cả spec 24
ca là nối đuôi vô ích với 20 spec drain). Trình tự: tạo bài → `drainOutboxUntilSettled({ worker: app.get(OutboxWorker), direct,
companyIds: <công ty spec RR> })` → **neo dương** `notiBefore ≥ 1` (thông báo nhắc tên của lượt TẠO đã tới — đường bridge sống) → xoá →
drain → lấy `notiBefore` → khôi phục → drain → assert hiện có `:947`/`:950`/`:951` giữ nguyên. Mọi event `pending` của công ty spec RR đều
terminal TRƯỚC mỗi mốc ⇒ drain của spec khác không còn gì để giao. Guard `:30-45` tự bắt nếu quên khoá.

## 5. Kịch bản tái hiện TẤT ĐỊNH (không giết tiến trình)

- **R1 (NOTI, đúng done_when «bỏ afterAll»)**: trên lane, sửa TẠM (không commit) spec NOTI bỏ `:155-156` ⇒ chạy spec NOTI ⇒ `SELECT` thấy
  đúng 2 hàng GLOBAL mới ⇒ chạy spec A + spec B ⇒ ĐỎ đúng hai thông điệp `:126` / `:162`. `git checkout --` tệp.
- **R2 (NOTI, mô phỏng crash thật)**: script `<kept>/s18-qa-notigloballeak-1/bin/plant-dead.mjs` (nạp mật khẩu qua
  `scripts/lib/db-secrets.sh`, không in): sau vá — `acquire` lease, gieo event+template GLOBAL đúng khuôn, `process.exit(1)` KHÔNG release
  (kết nối đứt ⇒ khoá tự trả = y hệt fork chết). Trước vá — chỉ gieo rồi thoát.
- **R3 (cửa sổ sống)**: script giữ lease + hàng GLOBAL 60 s rồi tự dọn/release; trong lúc đó chạy spec A ⇒ trước vá ĐỎ `:126`; sau vá spec A
  CHỜ barrier rồi XANH.
- **R4 (đồng thời)**: script giữ lease SỐNG cho tag X (có hàng) ⇒ chạy spec NOTI (quét đầu `beforeAll`) + gọi globalSetup ⇒ hàng X CÒN; thả
  lease ⇒ chạy lại ⇒ hàng X MẤT. Thêm: hai tiến trình vitest chạy spec NOTI CÙNG LÚC trên lane ×3 lượt ⇒ 6/6 xanh, 0 hàng GLOBAL còn lại.
- **R5 (A5, đúng done_when)**: sửa TẠM spec RR CŨ chèn một `drainOutboxUntilSettled` giữa `:937` và `:951` ⇒ chạy riêng spec RR ⇒ ĐỎ
  `expected 1 to be +0`. Sau vá: chèn y hệt giữa mốc mới và assert ⇒ XANH.
- Lane bẩn sau tái hiện ⇒ dọn bằng chính cơ chế vá (globalSetup/quét), không thì `bash scripts/lane-db-setup.sh notileak --reset` (ghi Sổ vết).

## 6. Ca test viết TRƯỚC + mutant

**Spec mới `T/helpers/global-fixture-lease.int-spec.ts`** (`describe.skipIf(!hasLaneDb)`, gieo theo họ NOTI với tag riêng):
L-1 lease SỐNG ⇒ quét từ kết nối khác KHÔNG xoá · L-2 lease chết (client `end()` không release) ⇒ quét XOÁ đủ event+template · L-3
barrier: lease đang giữ ⇒ `pg_try_advisory_lock(BARRIER)` từ kết nối khác = `false`; thả ⇒ `true` · L-4 tàn dư kiểu CŨ (hai hậu tố, template
trỏ event) ⇒ quét xoá cả hai, không lỗi FK · L-5 neo dương: quét trả số hàng đã xoá > 0 ở L-2 (chống xanh-rỗng).
**Unit `T/helpers/global-fixture-lease.unit-spec.ts`**: U-1 cổng DB lane — `mediaos` / rỗng / `postgres` / `LANE_DB` ≠ tên DB ⇒ từ chối;
`mediaos_notileak` ⇒ cho · U-2 `tagKey` ngoài dải int4 và đơn ánh trên 8 hex · U-3 regex họ chỉ khớp `^…_[0-9a-f]{8}$` (mã registry
`TASK_ASSIGNED`, `NOTI_EVT_TFX` ⇒ không khớp).

| Mutant (sửa tạm, không commit)                                              | Kỳ vọng bị giết bởi                                                                          |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| M1 quét bỏ `pg_try_advisory_lock` (xoá mọi tag)                             | L-1 · R4                                                                                     |
| M2 quét bỏ cổng DB lane                                                     | U-1                                                                                          |
| M3 spec NOTI bỏ `sweep` đầu `beforeAll` + globalSetup không đăng ký họ NOTI | R1/R2 ⇒ spec A/B ĐỎ lại                                                                      |
| M4 spec A bỏ barrier                                                        | R3 ⇒ ĐỎ `:126`                                                                               |
| M5a SẢN PHẨM: đường khôi phục phát lại `social.mentioned`                   | A5 ĐỎ (ghi assert nào đỏ trước; lượt phụ tắt `:947`/`:950` ⇒ `:951` ĐỎ `expected 2 to be 1`) |
| M5b bỏ drain trong A5 (về mã cũ) + chèn drain R5                            | A5 ĐỎ `expected 1 to be +0`                                                                  |
| M5c neo dương: bridge không sinh thông báo (drain với `companyIds` sai)     | neo `notiBefore ≥ 1` ĐỎ                                                                      |

## 7. Lát thi công · gate · verify

| Lát | Việc                                                                                                                                                                                                                                                                                                                                                                                                                                 | Commit                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| L0  | Backlog: NOTIGLOBALLEAK — title nối « + lớp A5 (gộp từ SHAREDSTATE (0))»; THÊM done_when: A5 (nguyên văn SHAREDSTATE done_when dòng 2) · globalSetup quét chỉ trên DB lane · barrier người đọc; THÊM paths `apps/api/test/global-fixture-sweep.ts`, `apps/api/vitest.config.ts`. SHAREDSTATE: THÊM note «lớp (0) chuyển sang S18-QA-NOTIGLOBALLEAK-1 (17/10/2026); WO còn 4 lớp (1)–(4)». Không viết lại dòng cũ; kiểm id-uniqueness | `chore(docs): …` (chỉ `harness/backlog.mjs`)     |
| L1  | R1 + R5 trên mã CŨ ⇒ ĐỎ đúng thông điệp; viết spec/unit §6 ⇒ ĐỎ (helper chưa có)                                                                                                                                                                                                                                                                                                                                                     | `test(qa): S18-QA-NOTIGLOBALLEAK-1 — …` (ca RED) |
| L2  | Helper §4.1-4.2 · globalSetup §4.3.2 · spec NOTI §4.3.1 · barrier spec A/B · F2/F3/F4 chuyển sang lease (F4: đọc lại mã lễ)                                                                                                                                                                                                                                                                                                          | `test(qa): …`                                    |
| L3  | A5 §4.4                                                                                                                                                                                                                                                                                                                                                                                                                              | `test(qa): …`                                    |
| L4  | Đo cổng: R1/R2 ⇒ spec A/B XANH · R3 · R4 (×3 song song) · R5 sau vá XANH · mutant M1–M5c · `vitest run` nhóm file chạm + `outbox-worker-lock.unit-spec` + `global-catalog-fence.unit-spec` trên lane                                                                                                                                                                                                                                 | (ghi Sổ vết)                                     |

- Lệnh int-spec (bash, trong worktree): `. scripts/lib/db-secrets.sh && db_secrets_load >/dev/null 2>&1; LANE_DB=mediaos_notileak pnpm
--filter @mediaos/api exec vitest run <path tương đối apps/api>`. CẤM chạy thiếu `LANE_DB`; CẤM `pnpm test -- <path>`.
- Sửa spec RR (path thuộc cả SHAREDSTATE) ⇒ đọc 5 dòng cuối `harness/activity.jsonl` ở checkout chính; dấu «started» auto cho WO khác ⇒
  `node harness/ledger.mjs event <WO> reset "dấu start-on-touch nhầm do sửa tệp của S18-QA-NOTIGLOBALLEAK-1"`.
- Gate LIGHT: `typescript-reviewer` (diff test/helper/config) + `quality-gate`. `database-reviewer` tuỳ chọn (helper chạy DELETE trên bảng
  GLOBAL — chỉ lane). Verify cuối (luồng chính): `bash harness/check.sh --all --lane-db=notileak` + gitleaks trên các commit.

## 8. Rủi ro + đường lùi

- Barrier làm spec A/B CHỜ spec NOTI (vài giây) — chấp nhận; `lock_timeout` cho lỗi 55P03 chỉ đúng nguyên nhân thay vì hook treo.
- Sửa `vitest.config.ts` (tệp nóng) = THÊM một phần tử mảng, không đổi gì khác. Nếu owner/reviewer không muốn đụng config ⇒ lùi: gọi quét
  ở `beforeAll` spec A/B (người đọc xoá hàng chết) — chỉ làm khi owner chốt (đụng tinh thần «không miễn trừ»).
- Mẫu quét theo regex về lý thuyết che một mã SẢN PHẨM dạng `NOTI_EVT_<8hex>` — mã registry là UPPER_SNAKE nghiệp vụ; U-3 ghim regex.
- Ngoài phạm vi: hàng company-scoped của spec NOTI sống sót qua crash (`cleanupTenants` chưa biết 3 bảng NOTI) — không ai đọc toàn tập; ghi nợ.

## 9. Ghi chú

### 9.3 Sổ vết

| Bước    | Ngày | Kết quả |
| ------- | ---- | ------- |
| Plan v1 |      |         |
| L0      |      |         |
| L1 RED  |      |         |
| L2      |      |         |
| L3 A5   |      |         |
| L4 đo   |      |         |
| Gate    |      |         |
| Verify  |      |         |
| PR      |      |         |
