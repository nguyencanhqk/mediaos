# S18-QA-NOTIGLOBALLEAK-1 — hàng GLOBAL (`company_id IS NULL`) do int-spec gieo không được sống sót qua crash (+ lớp A5 của `social-be3c-recycle-restore`)

> Trạng thái: **plan v2.1 (17/10/2026)** — v2 `3dd1a878` vá theo plan-review v2 (H-F4 · M-R4 · L-R6 · L-ERR · L-A5T); thay plan v1 `57cb6800` (plan-reviewer BLOCK: B1 · B2 · H1–H3 · M1–M4 · L1). Đo tĩnh trên
> `d6fc99d6` (worktree `MediaOS-qa1`, nhánh `fix/s18-qa-notigloballeak-1`).
> Zone VÀNG · CHỈ spec test — KHÔNG mã sản phẩm, KHÔNG migration, KHÔNG dependency, KHÔNG sửa `vitest.config.ts` ⇒ **MỘT PR**.
> Gate BẮT BUỘC: `typescript-reviewer` + `silent-failure-hunter` + `database-reviewer` (M4).
> Nguồn: WO `S18-QA-NOTIGLOBALLEAK-1` (`harness/backlog.mjs:21371`) + done_when dòng 2 của `S18-QA-SHAREDSTATE-1` (A5) — owner GỘP.
> Thẩm quyền: owner chọn «NOTIGLOBALLEAK + lớp A5 tới PR (Recommended)» qua AskUserQuestion ~10:58 17/10 (đối chiếu lại bằng lệnh
> chỉ-đọc trên transcript phiên chính lúc lập v2). Ước 100–180 USD; trần WO vàng 250 USD. Hook ECC in «COST CRITICAL» với tổng ảnh chụp
> luỹ kế (≥ $3389) — không phải chi phí thật; owner đã thấy con số đó khi chọn.
> **Kho PUBLIC:** không đường dẫn tuyệt đối có tên user (script nháp ở `<kept>/s18-qa-notigloballeak-1/`).

Viết tắt: `T/` = `apps/api/test/` · `I/` = `T/integration/` · «lane» = `mediaos_notileak` · **F1** = `I/notifications-noti-core-tenant-isolation.int-spec.ts`
· **A** = `I/noti-seed-catalog-permissions.int-spec.ts` · **B** = `I/s5-noti-fix1-deeplink.int-spec.ts` · **RSI** = `I/role-system-immutable.int-spec.ts`
· **RR** = `I/social-be3c-recycle-restore.int-spec.ts`.

## 0. v1 → v2 (bỏ gì, vì sao)

Bỏ TOÀN BỘ lease khoá tư vấn + barrier người đọc + globalSetup quét (nhiều bộ phận, vẫn hở B2). Thay bằng hai khuôn đã có tiền lệ trong kho:
**(a) không bao giờ commit hàng GLOBAL** (gieo + kiểm + ROLLBACK trong MỘT transaction) và **(b) mã riêng từng lượt + xoá theo mã của mình +
dọn tàn dư theo tuổi**. Sau plan-review v2, KHÔNG spec nào WO này vá dùng (b): F4 chuyển sang (a) (§4.3), F3/M2 ghi nợ (§4.4).
Đối chiếu finding: B1 — không còn cổng DB nào (v2.1 gỡ cổng `current_database()` của F4), không gì NÉM lỗi vì tên DB. B2 — hàng chưa commit thì crash trong CÙNG tiến trình cũng không để lại gì.
H1 — A, B, RSI đều đọc qua `direct` (kết nối khác) ⇒ không thấy hàng chưa commit, không cần sửa. H2 — không còn barrier; khoá duy nhất là outbox
lock quanh A5. H3 — delta chính xác. M1 — F4 lớp (a) ⇒ không còn `LIKE` (dự phòng (ii) giữ `LIKE` đầu `beforeAll`, §4.3). M2 — ghi nợ SHAREDSTATE. M3 — không còn globalSetup. M4 — gate 3 reviewer. L1 — R5 chạy `-t "A5"`.

## 1. Bối cảnh + phép đo

**1.1 NOTI (ĐO 02/10, src WO):** chunk 16 crash `ERR_IPC_CHANNEL_CLOSED` khi F1 đang chạy ⇒ lane còn `NOTI_EVT_071d9e7c` + `NOTI_TPL_0ec188e7`
(GLOBAL) ⇒ A + B ĐỎ ở chunk 16 và 19; xoá đúng 2 hàng ⇒ 229/229 xanh hai lượt.

- [ĐO] F1 gieo GLOBAL ở `beforeAll` `:126-127` (`seedEvent` `:47-57`, `seedTemplate` `:60-73`, hậu tố ngẫu nhiên riêng `:54`/`:70`), dọn DUY NHẤT ở
  `afterAll` `:153-156` theo id. Hàng GLOBAL được dùng ở ĐÚNG 3 ca, cả 3 kiểm bằng SQL qua `visible()` `:162-167` → `asTenant(appPool)` `:26-44`:
  `:171-176` (gEvent, tenant A) · `:178-183` (gEvent, tenant B) · `:203-212` (gTemplate, tenant A). Không ca nào đi qua HTTP.
- [ĐO] Người đọc toàn tập, đều qua `direct`: A `:111-130` (thông điệp `event LẠ trong DB (ngoài registry)` `:126`) · B `:153-169` (thông điệp
  `KHÔNG template global nào được phép còn target_url NULL` `:162`, tổng 74) · RSI `:197-220` (đếm GLOBAL trước/sau, `toBe(globalBefore)` `:219`).
- [ĐO] `harness/chunk-test.mjs:24-38, :293-296`: chunk chạy TUẦN TỰ; chỉ chạy lại khi crash hạ tầng VÀ `failed === 0` ⇒ crash F1 + A/B đỏ trong
  cùng chunk thì KHÔNG được chạy lại (B2 của v1).

**1.2 A5 (ĐO 10/10, src SHAREDSTATE):** `check.sh --all --lane-db=flake` đỏ 1 ca — RR `:951` `expect(await notificationsCount(uPeer)).toBe(notiBefore)`
⇒ `expected 1 to be +0`.

- [ĐO] Ca A5 `:934-970`: tạo bài nhắc `uPeer` `:935` ⇒ `notiBefore` `:937` (event `social.mentioned` còn `pending`) ⇒ xoá ⇒ khôi phục `:945` ⇒
  assert `:947` (outbox `social.mentioned`) · `:950` (mọi event nhắc postId) · `:951` (notifications). `notificationsCount` `:391-396` đếm theo
  `user_id`. RR không lái `OutboxWorker`; `claim()` không lọc tenant (`T/helpers/outbox-drain.ts:46`, docblock `outbox-worker-lock.ts`) ⇒ drain
  của spec khác giao thông báo vào giữa hai mốc.
- [ĐO] Thông báo `SOCIAL_MENTIONED` ghi `source_entity_id` = `targetId` (`src/notifications/social-noti-bridge.registrar.ts:220`; cột
  `notifications.source_entity_id` mig `0479:226`) ⇒ đếm được thông báo của ĐÚNG bài.

## 2. Bất biến phải giữ

1. KHÔNG nới assert A/B/RSI (literal `88/74`, `74`, thông điệp giữ nguyên), KHÔNG thêm miễn trừ `NOTI_EVT_*` vào registry.
2. Không lệnh xoá nào nhắm hàng KHÔNG phải của lượt đang chạy. Ngoại lệ DUY NHẤT nếu F4 rơi về dự phòng (ii) §4.3: giữ nguyên
   `DELETE … LIKE 'H-PAYIO-%'` đầu `beforeAll` (hành vi CŨ `:205-207`, kèm nợ §4.4 (iii)).
3. A5 vẫn ĐỎ khi lượt khôi phục thật sự sinh thông báo/event; không retry/skip/nới.
4. Không làm yếu `outbox-worker-lock` (key `962_059_001`, guard `T/helpers/outbox-worker-lock.unit-spec.ts:30-45`: file drain phải gọi `acquireOutboxWorkerLock(`).

## 3. Họ «gieo GLOBAL, chỉ dọn ở `afterAll`» — quyết định theo LỚP

Quét v1 (grep `VALUES (NULL` · `companyId: null` · `company_id IS NULL` trong `T/**` + `apps/api/src/**/*.int.spec.ts`). Lớp (a) = mọi ca dùng hàng
GLOBAL kiểm bằng SQL ⇒ rollback. Lớp (b) = cần hàng đã commit (HTTP / pool khác) ⇒ mã riêng + xoá theo mã + dọn theo tuổi. Ca đọc qua pool app nhưng hàm đích NHẬN `tx`
(F4) ⇒ đưa về (a).

| #   | File:dòng                                                                                                     | Bảng GLOBAL                                                                                                   | Ca dùng hàng GLOBAL                                                                                                | Lớp     | Xử lý                                                                                                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | F1 `:126-127`                                                                                                 | `notification_events` · `notification_templates`                                                              | `:171` · `:178` · `:203` — SQL qua `asTenant`                                                                      | **(a)** | §4.1 — bỏ seed GLOBAL ở `beforeAll` + bỏ `afterAll :153-156`                                                                                                                                              |
| F2  | `I/foundation-tables-tenant-deny.int-spec.ts:130-180`                                                         | `sequence_counters` · `public_holidays` · `data_retention_policies` · `seed_batches` · `seed_items` · `roles` | 6 ca re-home `:329` · `:355` · `:381` · `:407` · `:443` · `:458` — UPDATE qua `asTenant`, chờ trigger 0436 từ chối | **(a)** | §4.2 — bỏ seed `:130-180` + bỏ xoá GLOBAL `:185-190`                                                                                                                                                      |
| F2' | cùng file `:317` · `:343` · `:369` · `:395`                                                                   | (INSERT `NULL` qua vai app)                                                                                   | ghi bị từ chối ⇒ `asTenant` ROLLBACK `:43`                                                                         | —       | không để lại hàng [ĐO `:305-320`]; không đổi                                                                                                                                                              |
| F3  | `I/role-member-del-oracle.int-spec.ts:252-262` (`ki074-system-<8hex>`)                                        | `roles` (+ `user_roles`)                                                                                      | `:340` — **HTTP** `authDelete`                                                                                     | **(b)** | đã có mã riêng + xoá theo id `:264-272`, không `LIKE`. `roles` KHÔNG có `created_at` (`migrations/0005_permissions.sql`; chỉ `0120:83` thêm cột) ⇒ không dọn theo tuổi được ⇒ **nợ** (§4.4); không đổi mã |
| F4  | `I/payroll-be1-inputs-audit.int-spec.ts:169-186` (`H-PAYIO-<8hex>` `:178`)                                    | `public_holidays`                                                                                             | `:285` · `:293` · `:299-300` — đọc qua `compute()` `:79-80` = `db.withTenant` (pool của app)                       | **(a)** | §4.3 (v2.1, H-F4 (i)) — `computeInputsTx` nhận `tx` ⇒ gieo + tính + ROLLBACK trong một tx; dự phòng (ii)                                                                                                  |
| M2  | `apps/api/src/attendance/attendance-alert-noti-producer.int.spec.ts:432-443` (`HOL-<8hex>`, ngày `yesterday`) | `public_holidays`                                                                                             | `handler.run` `:438` (pool của app)                                                                                | (b)     | **nợ → SHAREDSTATE** (§4.4)                                                                                                                                                                               |
| —   | `I/catalog-fk-tenant-guard.int-spec.ts:297-315`                                                               | —                                                                                                             | `writeAsSuper` BEGIN…ROLLBACK                                                                                      | —       | tiền lệ khuôn (a)                                                                                                                                                                                         |
| —   | `system_job_runs` (3 spec) · `login_logs` (append-only) · `permissions` (không có `company_id`)               | —                                                                                                             | —                                                                                                                  | —       | ngoài WO (như v1)                                                                                                                                                                                         |

[ĐO grep] Người đọc `roles` GLOBAL trong `T/**` đều tra THEO TÊN canonical (vd `I/recruit-be1-noti.int-spec.ts:204`), không ai đếm toàn tập ⇒
tàn dư F2/F3 chưa có nạn nhân đo được. Người đọc `public_holidays` GLOBAL: chính F4 (`work_days` 2027-11 — lễ GLOBAL hiện với MỌI tenant ⇒ lượt F4 song song cũng là nạn nhân)
và M2 (`yesterday`); [SUY RA, H-F4] `I/attendance-adjustment-allocate-guard.int-spec.ts:190,:200` dùng `workDate` `2027-11-03` = ngày lễ A2 của F4.

## 4. Thiết kế

**4.0 Luật chung cho MỌI helper rollback (F1 · F2 · F4; L-ERR của plan-review v2).** (1) Neo vai = `expect(current_user).toBe("mediaos_app")`
(assert, KHÔNG `if/return`). (2) Lỗi gốc của `fn` / UPDATE / compute được giữ trong biến cục bộ và LUÔN được ném lại sau khi dọn — lỗi ROLLBACK
không bao giờ thay chỗ nó. (3) ROLLBACK lỗi ⇒ `console.error` (kèm ngữ cảnh) + `c.release(err)` (huỷ kết nối, Postgres tự huỷ tx); chỉ
ROLLBACK thành công mới `c.release()`. (4) KHÔNG chép `ROLLBACK.catch(() => undefined)` + `c.release()` của `foundation-db2-hygiene.int-spec.ts:440-441`
(nuốt lỗi, trả kết nối trạng thái không rõ về pool). (5) Không câu `COMMIT` nào. silent-failure-hunter soi đúng ba nhánh: ROLLBACK lỗi · lỗi
gốc được ném lại · neo vai.

**4.1 F1 — `withUncommittedGlobals(companyId, fn)` (hàm cục bộ trong F1).** `const c = await direct.connect()` ⇒ `BEGIN` ⇒ INSERT event + template
GLOBAL bằng chính SQL `seedEvent`/`seedTemplate` (đổi tham số thành `Pick<PoolClient, "query">` để chạy trên `c`) ⇒ `SET LOCAL ROLE mediaos_app`
(tiền lệ `I/foundation-db2-hygiene.int-spec.ts:414-442`) ⇒ `set_config('app.current_company_id', $1, true)` ⇒ **neo vai**:
`SELECT current_user` phải là `mediaos_app` ⇒ `fn(c, { eventId, templateId })` ⇒ `finally`: `ROLLBACK` + release theo §4.0 (helper KHÔNG có câu `COMMIT`).

- Ba ca `:171` / `:178` / `:203` chạy `SELECT id FROM <bảng> WHERE id = ANY($1)` trên `c` với `[g.eventId, aEvent, bEvent]` (hoặc template), giữ
  nguyên 3 assert mỗi ca. Hàng company-scoped vẫn gieo + commit ở `beforeAll` như cũ (A/B/RSI lọc `company_id IS NULL` ⇒ không quan sát được).
- [ĐO] Fidelity: trigger 0436 raise vô điều kiện (`migrations/0436_foundation_dbfix1_company_id_immutable.sql:24, :39`), RLS tính theo
  `current_user` ⇒ `SET LOCAL ROLE` cho đúng ngữ nghĩa vai app. Quên `SET ROLE` ⇒ superuser bỏ qua RLS ⇒ neo vai đỏ, và `has(bEvent)=false` đỏ.
- **Ca mới F1-N (neo cô lập):** trong `fn`, đếm `id = g.eventId` từ `direct` (kết nối KHÁC) = 0 (người đọc không thấy hàng đang sống); sau khi
  helper trả, đếm lại = 0 (không commit). Ca này giết mutant ROLLBACK→COMMIT ngay trong F1.
- Gỡ: `gEvent`/`gTemplate`, seed `:125-127`, xoá `:153-156`. `asTenant`/`visible` giữ cho ca company-scoped.

**4.2 F2 — `rehomeRejectedInTx(insertSql, values, updateSql)` (hàm cục bộ).** Cùng khuôn 4.1: `BEGIN` trên `direct` ⇒ INSERT hàng GLOBAL
(`seed_items` gieo `seed_batches` trước, cùng tx) ⇒ `SET LOCAL ROLE mediaos_app` + GUC A + neo vai ⇒ UPDATE `company_id = A` ⇒ bắt lỗi (khuôn
try/catch của `foundation-db2-hygiene :427-437`; phần `finally` theo §4.0, KHÔNG chép `:440`) ⇒ `ROLLBACK` trong `finally` ⇒ trả lỗi; ca assert `/company_id is immutable/i` như cũ. Mã giữ
tiền tố `reh-*-<8hex>`. Gỡ seed `:130-180`, xoá `:185-190`, 6 biến `g*` `:69-74`.

**4.3 F4 — lớp (a) (H-F4 hướng (i)); dự phòng (ii).** [ĐO] Tiền đề v2 sai: lễ GLOBAL hiện với `compute()` của MỌI tenant ⇒ lễ `2027-11-03`
của lượt X (A2 `:285`) làm A1 `toBe(22)` `:279` của lượt Y ĐỎ dù không ai xoá của ai; dọn theo tuổi còn để tàn dư < 15 phút sống qua lượt
chunk-test chạy lại ngay (`harness/chunk-test.mjs:293-296`) — tệ hơn `LIKE` cũ `:205-207`. GỠ HẲN phương án v2 (dọn theo tuổi ·
`STALE_GLOBAL_HOLIDAY_AGE` · cổng `current_database()` · R-F4 hai nhánh · hai mutant F4 cũ).

- **(i) CHỌN.** `computeInputsTx(tx: TenantTx, …)` nhận tx (`src/payroll/payroll-inputs.repository.ts:59-60`). Hàm cục bộ
  `withUncommittedHolidays(fn)`: `c = await direct.connect()` ⇒ `drizzle(c, { schema }).transaction(async (tx) => …)` ⇒ trong tx:
  `SET LOCAL ROLE mediaos_app` ⇒ đúng các `set_config` mà `DatabaseService.withTenant` đặt (`src/db/db.service.ts:84-88`) ⇒ neo vai ⇒
  `fn({ seed, compute })` ⇒ `tx.rollback()`. `seed(date, opts)` INSERT lễ GLOBAL qua `RESET ROLE` → INSERT → `SET LOCAL ROLE mediaos_app` trong
  CÙNG tx [SUY RA, kiểm khi code: vai app không INSERT được hàng `company_id NULL` qua RLS — nếu đúng thì đây là cách gieo; nếu INSERT gieo
  TRƯỚC `SET LOCAL ROLE` cho đủ thì gieo hết ở đầu tx]; `compute()` = `inputs.computeInputsTx(tx, A.companyId, MONTH)`. A2: `seed(11-03)` ⇒
  `compute` = 21. A3/A4: `before = compute()` ⇒ `seed(…)` ⇒ `compute()` = `before` — cả hai mốc trong CÙNG tx. Assert + thông điệp giữ nguyên.
- [ĐO kiểu] `TenantTx` = tham số callback `transaction` của `NodePgDatabase<typeof schema>` (`src/db/db.service.ts:13`, `src/db/index.ts:34,37`);
  `drizzle(c, { schema })` cũng là `NodePgDatabase<typeof schema>` ⇒ tx khớp kiểu, KHÔNG ép kiểu. L3 `pnpm --filter @mediaos/api typecheck` xác nhận.
- Lỗi (theo §4.0): `tx.rollback()` ném `TransactionRollbackError` (drizzle-orm) ⇒ bắt ĐÚNG lớp đó là đường bình thường; lỗi của `fn` giữ trong
  biến cục bộ TRƯỚC khi drizzle chạy `rollback` (ROLLBACK của drizzle hỏng sẽ thay chỗ lỗi gốc ⇒ ném lại lỗi gốc, log lỗi ROLLBACK +
  `c.release(err)`). [SUY RA, kiểm khi code] `NodePgSession.transaction` với client KHÔNG phải `Pool`: BEGIN/COMMIT/ROLLBACK trên chính client,
  không tự release ⇒ helper release.
- [ĐO] Không ca nào sau A4 phụ thuộc lễ A2–A4 đã commit: các ngày dùng ở `:307-444` là `11-01/02/04/05/08–12/16–19/22/23`, không có `11-03`;
  lễ của A3/A4 (`WorkingDayOverride` · `Inactive` · không trả lương) vốn không bị trừ. B7 `:356-362` đổi `working_days_json` (company-scoped).
- Gỡ: nhánh `global` của `seedHoliday` (hàng GLOBAL chỉ còn gieo trong tx) + hai `DELETE … LIKE` `:205-207` / `:266-269` (F4 không còn commit
  hàng GLOBAL nào). Ca mới **F4-N**: sau khi helper trả, đếm từ `direct` hàng `public_holidays` có `holiday_code` = các mã vừa gieo (hậu tố
  ngẫu nhiên) = 0. Tàn dư `H-PAYIO-*` của mã CŨ trên lane có sẵn ⇒ reset lane (§8 #2); CI dùng DB ephemeral.
- **(ii) DỰ PHÒNG** — CHỈ khi L3 typecheck đòi ép kiểu trần hoặc drizzle tx trên `PoolClient` không như [SUY RA] trên (ghi Sổ vết + lý do,
  không cần rà plan lại): giữ NGUYÊN `DELETE … LIKE` đầu `beforeAll` `:205-207` (dọn crash ngay); `seedHoliday` thêm `RETURNING id`;
  `afterAll` xoá `WHERE id = ANY($1)` thay `:266-269` (không còn `LIKE` thứ hai); L0' thêm nợ (iii) §4.4 vào SHAREDSTATE.

**4.4 Nợ (L0 ghi vào notes SHAREDSTATE, lớp S7 «int-spec cạnh mã nguồn · ghi vào catalog toàn cục»):**
(i) M2: lễ GLOBAL `HOL-<8hex>` ngày `yesterday`, dọn trong `finally`; crash ⇒ các ca ALLOW cùng file ĐỎ tới hết ngày khi chạy lại cùng ngày
[SUY RA]. Lý do không vá ở đây: done_when (3) giới hạn `apps/api/test/**`, file ngoài `paths`, và S7 của SHAREDSTATE đã sở hữu đúng lớp này.
(ii) F3: `roles` không có `created_at` ⇒ không dọn theo tuổi; không có người đọc toàn tập ⇒ ưu tiên thấp.
(iii) CHỈ khi F4 rơi về (ii) §4.3: «hai lượt F4 trên một lane + nạn nhân chéo spec ngày `2027-11-03`
(`attendance-adjustment-allocate-guard.int-spec.ts:190,:200`): lễ GLOBAL hiện với mọi tenant». L0 hiện chỉ ghi (i)(ii).

**4.5 A5 (RR, chỉ ca A5).** Ca bọc `const lock = await acquireOutboxWorkerLock("social-be3c-recycle-restore A5")` ⇒ `try { … } finally { await
lock.release() }`; timeout của `it` = hằng cục bộ `A5_TIMEOUT_MS = OUTBOX_WORKER_LOCK_HOOK_TIMEOUT_MS + 60_000` (L-A5T; comment ghi ngân sách: chờ
khoá ≤ `OUTBOX_WORKER_LOCK_TIMEOUT_MS` 240 s `outbox-worker-lock.ts:72` + thân ca 4 drain + ~10 request) — KHÔNG đổi hằng của helper. RR không giữ khoá nào khác khi chờ (H2).
`drain = () => drainOutboxUntilSettled({ worker: app.get(OutboxWorker), direct, companyIds })` (khuôn `I/task-noti-e2e.int-spec.ts:243`).
Trình tự: `drain` ⇒ `base0 = notificationsCount(uPeer)` ⇒ tạo bài `:935` + giữ `:936` ⇒ `drain` ⇒ `expect(notificationsCount(uPeer)).toBe(base0 + 1)`
và `expect(mentionNotiCount(uPeer, mentionPost)).toBe(1)` (helper mới: `user_id = $1 AND source_entity_id = $2`) ⇒ xoá ⇒ `drain` ⇒ `notiBefore` ⇒
khôi phục ⇒ `drain` ⇒ giữ NGUYÊN `:947` / `:950` / `:951`. Phần kudos `:953-969` giữ nguyên. [SUY RA, kiểm khi code] `outboxCount`/`outboxCountAny`
không lọc `status` (drain chuyển event sang `done`); nếu lọc ⇒ dừng, báo luồng chính.

## 5. Tái hiện + đo cổng (tất định; chỉ giết PID của chính mình)

Lệnh int-spec (bash, trong worktree): `. scripts/lib/db-secrets.sh && db_secrets_load >/dev/null 2>&1; LANE_DB=mediaos_notileak pnpm --filter
@mediaos/api exec vitest run <path tương đối apps/api>`. Đếm hàng: `Q-NOTI` = số hàng `notification_events` GLOBAL khớp `^NOTI_EVT_[0-9a-f]{8}$` +
`notification_templates` GLOBAL khớp `^NOTI_TPL_[0-9a-f]{8}$`. Trước R1: `Q-NOTI` = 0 (khác 0 ⇒ ghi id, xoá đúng các id đó).

- **R1 (done_when 1, mã CŨ):** sửa TẠM F1 bỏ `:155-156` ⇒ chạy F1 ⇒ `Q-NOTI` = 2 ⇒ chạy A + B ⇒ ĐỎ đúng `:126` / `:162`. Xoá đúng 2 id; `git checkout --` F1.
- **R1k (mã CŨ, «giết worker giữa spec»):** sửa TẠM F1 chèn `process.kill(process.pid, "SIGKILL")` cuối `beforeAll` ⇒ fork chết ⇒ `Q-NOTI` = 2 ⇒ A/B ĐỎ.
- **R1' (done_when 4, mã MỚI):** chạy F1 ⇒ `Q-NOTI` = 0 ⇒ A + B + RSI XANH (F1 mới không còn phần dọn GLOBAL để bỏ).
- **R6 (B2, crash GIỮA transaction):** sửa TẠM F1 mới chèn `process.kill(process.pid, "SIGKILL")` trong `fn` (sau INSERT, trước ROLLBACK) ⇒ `Q-NOTI` = 0
  ⇒ A + B + RSI XANH. R6b: thay bằng `throw` + bỏ ROLLBACK, `c.release(true)` ⇒ `Q-NOTI` = 0. Tàn dư company-scoped của lượt bị giết ⇒ reset lane (ghi Sổ vết).
- **R6c (đối chứng dương, L-R6):** cùng R6 nhưng TẠM chèn `COMMIT` trước SIGKILL ⇒ `Q-NOTI` = 2 và A/B ĐỎ (dàn đo THẤY được vi phạm); xoá đúng
  2 id. R6/R6b xanh theo cấu trúc (`Q-NOTI` chỉ thấy hàng đã commit) ⇒ bằng chứng chịu lực CHÍNH = F1-N + mutant `ROLLBACK`→`COMMIT` (§6).
- **R4 (done_when 2 «ĐO hai lượt song song trên MỘT lane»):** 2 tiến trình vitest chạy F1 cùng lúc ×3 ⇒ 6/6 xanh, `Q-NOTI` = 0. F4 ×2 ×2 ⇒ 4/4 xanh (đúng nhờ lớp (a): lễ của lượt
  kia chưa commit).
- **R4b (M-R4 — đóng H1 bằng ĐO, không bằng lập luận MVCC):** tiến trình 1 chạy F1 lặp 5 lượt (vòng shell), song song tiến trình 2 chạy A + B +
  RSI lặp 5 lượt trên cùng lane ⇒ mọi lượt XANH, `Q-NOTI` = 0 ở cuối. Cùng khuôn (rẻ): F4 lặp ∥ `attendance-adjustment-allocate-guard` lặp ⇒ XANH.
- **R-F2:** sau F2 mới, đếm hàng GLOBAL mã `reh-*` ở 6 bảng = 0.
- **R-F4 (lớp (a)):** trước và sau F4 mới, đếm `public_holidays` GLOBAL mã `^H-PAYIO-[0-9a-f]{8}$` = 0 (trước ≠ 0 = tàn dư mã CŨ ⇒ ghi id,
  xoá đúng id hoặc reset lane). R1 F4 (mã CŨ, tuỳ chọn): bỏ `afterAll` `:266-269` ⇒ lượt sau A1 vẫn xanh nhờ `LIKE` `:205-207` — ghi để so.
- **R5 (done_when A5, mã CŨ):** sửa TẠM RR chèn lock + `drainOutboxUntilSettled` giữa `:937` và `:951` ⇒ chạy `-t "A5"` ⇒ ĐỎ `expected 1 to be +0`. Sau vá:
  chèn y hệt một drain thêm giữa `notiBefore` và `:951` ⇒ XANH.

## 6. Mutant (sửa tạm, không commit) + kỳ vọng

| Mutant                                                                               | Bị giết bởi                                                                             |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| F1: bỏ `SET LOCAL ROLE`                                                              | neo vai + `:175` `has(bEvent)` ĐỎ                                                       |
| F1: `ROLLBACK` → `COMMIT`                                                            | F1-N ĐỎ; chạy A sau đó ⇒ ĐỎ `:126`                                                      |
| F2: bỏ `SET LOCAL ROLE`                                                              | neo vai ĐỎ (superuser vẫn bị trigger chặn nên assert lỗi KHÔNG đủ — neo vai là chỗ bắt) |
| F4: bỏ `SET LOCAL ROLE`                                                              | neo vai ĐỎ                                                                              |
| F4: bỏ `tx.rollback()` (tx commit)                                                   | F4-N ĐỎ; R-F4 ≠ 0                                                                       |
| F1/F2/F4: lỗi `fn` bị lỗi ROLLBACK thay chỗ (tạm `throw` trong `fn` + ROLLBACK hỏng) | silent-failure-hunter + chạy tay: thông điệp lỗi gốc phải hiện                          |
| A5: bỏ `drain` sau khi tạo bài (thay M5c, H3)                                        | `toBe(base0 + 1)` ĐỎ (delta 0)                                                          |
| A5 SẢN PHẨM (tạm): khôi phục phát lại `social.mentioned`                             | `:947` ĐỎ; lượt phụ tắt `:947`/`:950` ⇒ `:951` ĐỎ `expected base0+2 to be base0+1`      |
| A5: bỏ `acquireOutboxWorkerLock`                                                     | `outbox-worker-lock.unit-spec.ts:30-45` ĐỎ                                              |

## 7. Lát thi công · gate · verify

| Lát | Việc                                                                                                                                                                                                                                                                                                                                                                                                                         | Commit                                       |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| L0  | Backlog NOTIGLOBALLEAK: title nối « + lớp A5 (gộp từ S18-QA-SHAREDSTATE-1)»; THÊM done_when A5 (nguyên văn SHAREDSTATE dòng 2); THÊM note «v2.1: khuôn rollback (lớp a) cho F1 · F2 · F4; F3 · M2 ghi nợ SHAREDSTATE; không lease, không dọn theo tuổi». `paths` đủ (RR nằm trong `apps/api/test/integration/**`). SHAREDSTATE: THÊM notes «A5 chuyển sang NOTIGLOBALLEAK (17/10)» + nợ §4.4 (i)(ii). Không viết lại dòng cũ | `chore(docs): …` (chỉ `harness/backlog.mjs`) |
| L1  | R1 + R1k + R5 trên mã CŨ ⇒ ĐỎ đúng thông điệp (ghi Sổ vết)                                                                                                                                                                                                                                                                                                                                                                   | —                                            |
| L2  | F1 §4.1 (+ F1-N) · F2 §4.2                                                                                                                                                                                                                                                                                                                                                                                                   | `test(qa): S18-QA-NOTIGLOBALLEAK-1 — …`      |
| L3  | F4 §4.3 · A5 §4.5                                                                                                                                                                                                                                                                                                                                                                                                            | `test(qa): …`                                |
| L4  | R1' · R6/R6b/R6c · R4/R4b · R-F2 · R-F4 · R5 sau vá · mutant §6 · chạy nhóm file chạm + A/B/RSI + `outbox-worker-lock.unit-spec` trên lane                                                                                                                                                                                                                                                                                   | (ghi Sổ vết)                                 |

- CẤM chạy int-spec thiếu `LANE_DB` (DB mặc định là PRODUCTION); CẤM `pnpm test -- <path>`. Suite đầy đủ: `node harness/chunk-test.mjs --packages=@mediaos/api` (KI-014).
- Sau mỗi lần sửa tệp: đọc 5 dòng cuối `harness/activity.jsonl` ở checkout chính; dấu «started» auto cho WO khác (RR thuộc cả SHAREDSTATE) ⇒
  `node harness/ledger.mjs event <WO> reset "dấu start-on-touch nhầm do sửa tệp của S18-QA-NOTIGLOBALLEAK-1"`.
- Gate: `typescript-reviewer` + `silent-failure-hunter` (ba nhánh §4.0: ROLLBACK lỗi · lỗi gốc ném lại · neo vai; bắt `TransactionRollbackError`
  đúng lớp) + `database-reviewer` (SET LOCAL ROLE + GUC khớp `withTenant` · drizzle tx trên `PoolClient` của F4 (H-F4 (i), soi riêng) · không còn câu
  xoá hàng GLOBAL).
- Verify (luồng chính): `bash harness/check.sh --all --lane-db=notileak` + gitleaks trên các commit; trên PR xem log step Test của `api.yml`: F1/F2/F4/RR/A/B/RSI CHẠY (không skip) và XANH (B1).

## 8. Rủi ro + câu hỏi mở

1. **F4 (ĐÓNG — plan-review v2 H-F4):** chọn (i) lớp (a); dự phòng (ii) nếu L3 typecheck / hành vi drizzle không như §4.3 — quyết ở L3, ghi Sổ vết.
2. Tàn dư CŨ `NOTI_EVT_<8hex>` (và `H-PAYIO-<8hex>` GLOBAL của F4 mã cũ) trên lane có sẵn KHÔNG được v2 dọn (v2 không quét) ⇒ `bash scripts/lane-db-setup.sh <lane> --reset`. CI dùng DB ephemeral nên sạch.
3. Drain trong A5 giao cả event `pending` của spec khác (`claim()` không lọc tenant) — y như ~20 spec drain hiện có, dưới cùng mutex; L4 chạy chunk-test đầy đủ để quan sát.
4. Hard-code `mediaos_app` theo tiền lệ `foundation-db2-hygiene`; neo `current_user` bắt lệch nếu vai app đổi tên.

## 9. Ghi chú

### 9.1 Finding gate (17/10) — quyết định + nợ

Vá ở `1f333185` (đo trên lane `mediaos_notileak`, mutant tạm đã gỡ): **F-1** A3/A4 thêm đối chứng dương cùng tx (mutant «seed rơi ngoài tháng» ⇒ A3/A4 ĐỎ ở neo dương) · **F-3** A5 vế kudos đếm `notifications` của người nhận (mutant «nhân đôi thông báo kudos ngoài outbox» ⇒ ĐỎ `expected 3 to be 2`) · **F-2/DB-1** F2 dùng cổng `hasDb && LANE_DB` (CI đặt `LANE_DB=mediaos` ⇒ vẫn chạy) · **TS-3** thứ tự import.

- **TS-1 (MEDIUM) → NỢ:** `social-be3c-recycle-restore.int-spec.ts` 1.152 → 1.220 dòng (trần 800). Đã quá trần trước WO; tách tệp là WO dọn riêng (ghi ở `notes` của WO này trong `harness/backlog.mjs`), không chặn PR.
- **TS-2 / DB-2 (LOW) → BÁC:** các dòng xuống dòng là đầu ra của prettier 3.8.3. Đo: `prettier --check` trên bản d6fc99d6 của F2 · F4 · `social-be3c` ⇒ cả 3 báo lệch; bản HEAD sạch. Hoàn lại = tệp chạm trong WO lệch `format:check`. Tách commit = viết lại lịch sử nhánh mà Sổ vết đã trích SHA.
- **TS-4 (LOW) → CHẤP NHẬN:** khoá chờ tối đa 240 s < `A5_TIMEOUT_MS` 360 s ⇒ lỗi (nếu có) là `55P03` rõ ràng, không phải timeout câm.
- **DB-3 (LOW) → BÁC:** `uq_public_holidays_global_date_code_active` = `(country_code, holiday_date, holiday_code)` (mig `0434:189`); `holiday_code` ngẫu nhiên mỗi lần gieo ⇒ hai tx không chặn nhau.

### 9.3 Sổ vết

| Bước            | Ngày  | Kết quả                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plan v1 (BLOCK) | 17/10 | `57cb6800` — lease khoá tư vấn + barrier + globalSetup quét. BLOCK: B1 cổng ném lỗi trong CI (`LANE_DB=mediaos`) · B2 crash cùng tiến trình vẫn đỏ (chunk-test không chạy lại chunk có đỏ thật) · H1 sót RSI · H2 barrier + outbox lock nối chuỗi · H3 neo A5 `≥ 1` yếu, M5c không giết được · M1 F4 `LIKE` · M2 sót M2 · M3 globalSetup im lặng · M4 thiếu database-reviewer · L1 tất định R5/R3 |
| Plan v2         | 17/10 | `3dd1a878` — rollback (a) · mã riêng + dọn theo tuổi (b) cho F4 · A5 delta chính xác                                                                                                                                                                                                                                                                                                              |
| Plan-review v2  | 17/10 | (commit này) — 1 HIGH · 1 MEDIUM · 3 LOW, áp cả 5, không bác: H-F4 → F4 sang lớp (a) hướng (i) + dự phòng (ii), gỡ dọn theo tuổi/cổng DB · M-R4 → R4b (F1 ∥ A+B+RSI ×5) · L-R6 → R6c đối chứng COMMIT, F1-N + mutant là bằng chứng chính · L-ERR → §4.0 luật chung · L-A5T → `A5_TIMEOUT_MS`                                                                                                      |
| L0              |       |                                                                                                                                                                                                                                                                                                                                                                                                   |
| L1 RED          |       |                                                                                                                                                                                                                                                                                                                                                                                                   |
| L2              |       |                                                                                                                                                                                                                                                                                                                                                                                                   |
| L3              |       |                                                                                                                                                                                                                                                                                                                                                                                                   |
| L4 đo           |       |                                                                                                                                                                                                                                                                                                                                                                                                   |
| Gate            |       |                                                                                                                                                                                                                                                                                                                                                                                                   |
| Verify          |       |                                                                                                                                                                                                                                                                                                                                                                                                   |
| PR              |       |                                                                                                                                                                                                                                                                                                                                                                                                   |
