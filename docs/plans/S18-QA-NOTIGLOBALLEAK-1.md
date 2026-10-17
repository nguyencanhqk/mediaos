# S18-QA-NOTIGLOBALLEAK-1 — hàng GLOBAL (`company_id IS NULL`) do int-spec gieo không được sống sót qua crash (+ lớp A5 của `social-be3c-recycle-restore`)

> Trạng thái: **plan v2 (17/10/2026)**, thay plan v1 `57cb6800` (plan-reviewer BLOCK: B1 · B2 · H1–H3 · M1–M4 · L1). Đo tĩnh trên
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
dọn tàn dư theo tuổi**. Đối chiếu finding: B1 — không còn cổng nào NÉM lỗi; cổng duy nhất (F4) là `current_database() = LANE_DB`, sai ⇒ bỏ qua +
log (CI `LANE_DB=mediaos` trên DB `mediaos` ⇒ khớp ⇒ chạy). B2 — hàng chưa commit thì crash trong CÙNG tiến trình cũng không để lại gì.
H1 — A, B, RSI đều đọc qua `direct` (kết nối khác) ⇒ không thấy hàng chưa commit, không cần sửa. H2 — không còn barrier; khoá duy nhất là outbox
lock quanh A5. H3 — delta chính xác. M1 — gỡ hai `LIKE`. M2 — ghi nợ SHAREDSTATE. M3 — không còn globalSetup. M4 — gate 3 reviewer. L1 — R5 chạy `-t "A5"`.

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
2. Không lệnh xoá nào nhắm hàng KHÔNG phải của lượt đang chạy, trừ dọn tàn dư theo tuổi ở F4 (§4.3), có cổng DB.
3. A5 vẫn ĐỎ khi lượt khôi phục thật sự sinh thông báo/event; không retry/skip/nới.
4. Không làm yếu `outbox-worker-lock` (key `962_059_001`, guard `T/helpers/outbox-worker-lock.unit-spec.ts:30-45`: file drain phải gọi `acquireOutboxWorkerLock(`).

## 3. Họ «gieo GLOBAL, chỉ dọn ở `afterAll`» — quyết định theo LỚP

Quét v1 (grep `VALUES (NULL` · `companyId: null` · `company_id IS NULL` trong `T/**` + `apps/api/src/**/*.int.spec.ts`). Lớp (a) = mọi ca dùng hàng
GLOBAL kiểm bằng SQL ⇒ rollback. Lớp (b) = cần hàng đã commit (HTTP / pool khác) ⇒ mã riêng + xoá theo mã + dọn theo tuổi.

| #   | File:dòng                                                                                                     | Bảng GLOBAL                                                                                                   | Ca dùng hàng GLOBAL                                                                                                | Lớp     | Xử lý                                                                                                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | F1 `:126-127`                                                                                                 | `notification_events` · `notification_templates`                                                              | `:171` · `:178` · `:203` — SQL qua `asTenant`                                                                      | **(a)** | §4.1 — bỏ seed GLOBAL ở `beforeAll` + bỏ `afterAll :153-156`                                                                                                                                              |
| F2  | `I/foundation-tables-tenant-deny.int-spec.ts:130-180`                                                         | `sequence_counters` · `public_holidays` · `data_retention_policies` · `seed_batches` · `seed_items` · `roles` | 6 ca re-home `:329` · `:355` · `:381` · `:407` · `:443` · `:458` — UPDATE qua `asTenant`, chờ trigger 0436 từ chối | **(a)** | §4.2 — bỏ seed `:130-180` + bỏ xoá GLOBAL `:185-190`                                                                                                                                                      |
| F2' | cùng file `:317` · `:343` · `:369` · `:395`                                                                   | (INSERT `NULL` qua vai app)                                                                                   | ghi bị từ chối ⇒ `asTenant` ROLLBACK `:43`                                                                         | —       | không để lại hàng [ĐO `:305-320`]; không đổi                                                                                                                                                              |
| F3  | `I/role-member-del-oracle.int-spec.ts:252-262` (`ki074-system-<8hex>`)                                        | `roles` (+ `user_roles`)                                                                                      | `:340` — **HTTP** `authDelete`                                                                                     | **(b)** | đã có mã riêng + xoá theo id `:264-272`, không `LIKE`. `roles` KHÔNG có `created_at` (`migrations/0005_permissions.sql`; chỉ `0120:83` thêm cột) ⇒ không dọn theo tuổi được ⇒ **nợ** (§4.4); không đổi mã |
| F4  | `I/payroll-be1-inputs-audit.int-spec.ts:169-186` (`H-PAYIO-<8hex>` `:178`)                                    | `public_holidays`                                                                                             | `:285` · `:293` · `:299-300` — đọc qua `compute()` `:79-80` = `db.withTenant` (pool của app)                       | **(b)** | §4.3 — gỡ hai `LIKE` `:204-207` / `:266-269` (M1)                                                                                                                                                         |
| M2  | `apps/api/src/attendance/attendance-alert-noti-producer.int.spec.ts:432-443` (`HOL-<8hex>`, ngày `yesterday`) | `public_holidays`                                                                                             | `handler.run` `:438` (pool của app)                                                                                | (b)     | **nợ → SHAREDSTATE** (§4.4)                                                                                                                                                                               |
| —   | `I/catalog-fk-tenant-guard.int-spec.ts:297-315`                                                               | —                                                                                                             | `writeAsSuper` BEGIN…ROLLBACK                                                                                      | —       | tiền lệ khuôn (a)                                                                                                                                                                                         |
| —   | `system_job_runs` (3 spec) · `login_logs` (append-only) · `permissions` (không có `company_id`)               | —                                                                                                             | —                                                                                                                  | —       | ngoài WO (như v1)                                                                                                                                                                                         |

[ĐO grep] Người đọc `roles` GLOBAL trong `T/**` đều tra THEO TÊN canonical (vd `I/recruit-be1-noti.int-spec.ts:204`), không ai đếm toàn tập ⇒
tàn dư F2/F3 chưa có nạn nhân đo được. Người đọc `public_holidays` GLOBAL: chính F4 (`work_days` 2027-11) và M2 (`yesterday`).

## 4. Thiết kế

**4.1 F1 — `withUncommittedGlobals(companyId, fn)` (hàm cục bộ trong F1).** `const c = await direct.connect()` ⇒ `BEGIN` ⇒ INSERT event + template
GLOBAL bằng chính SQL `seedEvent`/`seedTemplate` (đổi tham số thành `Pick<PoolClient, "query">` để chạy trên `c`) ⇒ `SET LOCAL ROLE mediaos_app`
(tiền lệ `I/foundation-db2-hygiene.int-spec.ts:414-442`) ⇒ `set_config('app.current_company_id', $1, true)` ⇒ **neo vai**:
`SELECT current_user` phải là `mediaos_app` ⇒ `fn(c, { eventId, templateId })` ⇒ `finally`: `ROLLBACK`; ROLLBACK lỗi ⇒ `console.error` + `c.release(err)`
(huỷ kết nối, Postgres tự huỷ transaction), không thì `c.release()`. Helper KHÔNG có câu `COMMIT`.

- Ba ca `:171` / `:178` / `:203` chạy `SELECT id FROM <bảng> WHERE id = ANY($1)` trên `c` với `[g.eventId, aEvent, bEvent]` (hoặc template), giữ
  nguyên 3 assert mỗi ca. Hàng company-scoped vẫn gieo + commit ở `beforeAll` như cũ (A/B/RSI lọc `company_id IS NULL` ⇒ không quan sát được).
- [ĐO] Fidelity: trigger 0436 raise vô điều kiện (`migrations/0436_foundation_dbfix1_company_id_immutable.sql:24, :39`), RLS tính theo
  `current_user` ⇒ `SET LOCAL ROLE` cho đúng ngữ nghĩa vai app. Quên `SET ROLE` ⇒ superuser bỏ qua RLS ⇒ neo vai đỏ, và `has(bEvent)=false` đỏ.
- **Ca mới F1-N (neo cô lập):** trong `fn`, đếm `id = g.eventId` từ `direct` (kết nối KHÁC) = 0 (người đọc không thấy hàng đang sống); sau khi
  helper trả, đếm lại = 0 (không commit). Ca này giết mutant ROLLBACK→COMMIT ngay trong F1.
- Gỡ: `gEvent`/`gTemplate`, seed `:125-127`, xoá `:153-156`. `asTenant`/`visible` giữ cho ca company-scoped.

**4.2 F2 — `rehomeRejectedInTx(insertSql, values, updateSql)` (hàm cục bộ).** Cùng khuôn 4.1: `BEGIN` trên `direct` ⇒ INSERT hàng GLOBAL
(`seed_items` gieo `seed_batches` trước, cùng tx) ⇒ `SET LOCAL ROLE mediaos_app` + GUC A + neo vai ⇒ UPDATE `company_id = A` ⇒ bắt lỗi (khuôn
try/catch của `foundation-db2-hygiene :427-437`) ⇒ `ROLLBACK` trong `finally` ⇒ trả lỗi; ca assert `/company_id is immutable/i` như cũ. Mã giữ
tiền tố `reh-*-<8hex>`. Gỡ seed `:130-180`, xoá `:185-190`, 6 biến `g*` `:69-74`.

**4.3 F4 — mã riêng + xoá theo id + dọn theo tuổi.**

- `seedHoliday` thêm `RETURNING id`; hàng GLOBAL đẩy vào `globalHolidayIds`; `afterAll` `DELETE … WHERE id = ANY($1)` thay `:266-269`.
- Đầu `beforeAll` thay `:204-207` bằng dọn tàn dư: `DELETE FROM public_holidays WHERE company_id IS NULL AND holiday_code ~ '^H-PAYIO-[0-9a-f]{8}$'
AND created_at < now() - interval '15 minutes'` (`created_at` có sẵn, `migrations/0434_foundation_db4_sequences_holidays.sql:155`).
  Hằng `STALE_GLOBAL_HOLIDAY_AGE`, lý do ghi ở comment: tuổi sống tối đa của một hàng ≈ 25 ca × `testTimeout` 20 s + `hookTimeout` 30 s ≈ 9 phút
  (`apps/api/vitest.config.ts:82-83`).
- Cổng (luật B1): chỉ dọn khi `current_database() = process.env.LANE_DB`; sai ⇒ `console.warn` + bỏ qua, KHÔNG ném. Cả hai nhánh in một dòng
  `[payroll-be1 stale-holiday] deleted N | skipped (<lý do>)` (soi lỗi im lặng). CI: `LANE_DB=mediaos` trên DB `mediaos` ⇒ chạy.
- **Đánh đổi [ĐO chunk-test.mjs:24-38]:** crash trong cửa sổ A2→`afterAll` của F4 rồi chunk-test chạy lại NGAY ⇒ hàng < 15 phút còn ⇒ A1 ĐỎ ở
  lượt chạy lại (mã cũ `LIKE` dọn được ngay). Đổi lại, hai lượt F4 song song trên một lane không còn xoá lễ của nhau. Ghi ở câu hỏi mở #1.

**4.4 Nợ (L0 ghi vào notes SHAREDSTATE, lớp S7 «int-spec cạnh mã nguồn · ghi vào catalog toàn cục»):**
(i) M2: lễ GLOBAL `HOL-<8hex>` ngày `yesterday`, dọn trong `finally`; crash ⇒ các ca ALLOW cùng file ĐỎ tới hết ngày khi chạy lại cùng ngày
[SUY RA]. Lý do không vá ở đây: done_when (3) giới hạn `apps/api/test/**`, file ngoài `paths`, và S7 của SHAREDSTATE đã sở hữu đúng lớp này.
(ii) F3: `roles` không có `created_at` ⇒ không dọn theo tuổi; không có người đọc toàn tập ⇒ ưu tiên thấp.

**4.5 A5 (RR, chỉ ca A5).** Ca bọc `const lock = await acquireOutboxWorkerLock("social-be3c-recycle-restore A5")` ⇒ `try { … } finally { await
lock.release() }`; timeout của `it` = `OUTBOX_WORKER_LOCK_HOOK_TIMEOUT_MS` (`outbox-worker-lock.ts:75`). RR không giữ khoá nào khác khi chờ (H2).
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
- **R4 (done_when 2 «ĐO hai lượt song song trên MỘT lane»):** 2 tiến trình vitest chạy F1 cùng lúc ×3 ⇒ 6/6 xanh, `Q-NOTI` = 0. F4 ×2 tương tự ⇒ 4/4 xanh.
- **R-F2:** sau F2 mới, đếm hàng GLOBAL mã `reh-*` ở 6 bảng = 0.
- **R-F4 (hai nhánh dọn theo tuổi):** superuser gieo 2 hàng GLOBAL `H-PAYIO-<8hex>`: một `created_at = now() - interval '1 hour'`, một `now()` ⇒ chạy F4 ⇒
  hàng cũ MẤT, hàng mới CÒN, log `deleted 1` ⇒ xoá hàng mới theo id.
- **R5 (done_when A5, mã CŨ):** sửa TẠM RR chèn lock + `drainOutboxUntilSettled` giữa `:937` và `:951` ⇒ chạy `-t "A5"` ⇒ ĐỎ `expected 1 to be +0`. Sau vá:
  chèn y hệt một drain thêm giữa `notiBefore` và `:951` ⇒ XANH.

## 6. Mutant (sửa tạm, không commit) + kỳ vọng

| Mutant                                                   | Bị giết bởi                                                                             |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| F1: bỏ `SET LOCAL ROLE`                                  | neo vai + `:175` `has(bEvent)` ĐỎ                                                       |
| F1: `ROLLBACK` → `COMMIT`                                | F1-N ĐỎ; chạy A sau đó ⇒ ĐỎ `:126`                                                      |
| F2: bỏ `SET LOCAL ROLE`                                  | neo vai ĐỎ (superuser vẫn bị trigger chặn nên assert lỗi KHÔNG đủ — neo vai là chỗ bắt) |
| F4: dọn tàn dư trở lại `LIKE` không điều kiện tuổi       | R-F4: hàng mới bị xoá                                                                   |
| F4: cổng luôn bỏ qua                                     | R-F4: hàng cũ còn, log `skipped`                                                        |
| A5: bỏ `drain` sau khi tạo bài (thay M5c, H3)            | `toBe(base0 + 1)` ĐỎ (delta 0)                                                          |
| A5 SẢN PHẨM (tạm): khôi phục phát lại `social.mentioned` | `:947` ĐỎ; lượt phụ tắt `:947`/`:950` ⇒ `:951` ĐỎ `expected base0+2 to be base0+1`      |
| A5: bỏ `acquireOutboxWorkerLock`                         | `outbox-worker-lock.unit-spec.ts:30-45` ĐỎ                                              |

## 7. Lát thi công · gate · verify

| Lát | Việc                                                                                                                                                                                                                                                                                                                                                                                        | Commit                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| L0  | Backlog NOTIGLOBALLEAK: title nối « + lớp A5 (gộp từ S18-QA-SHAREDSTATE-1)»; THÊM done_when A5 (nguyên văn SHAREDSTATE dòng 2); THÊM note «v2: khuôn rollback (lớp a) / mã riêng + dọn theo tuổi (lớp b), không lease». `paths` đủ (RR nằm trong `apps/api/test/integration/**`). SHAREDSTATE: THÊM notes «A5 chuyển sang NOTIGLOBALLEAK (17/10)» + nợ §4.4 (i)(ii). Không viết lại dòng cũ | `chore(docs): …` (chỉ `harness/backlog.mjs`) |
| L1  | R1 + R1k + R5 trên mã CŨ ⇒ ĐỎ đúng thông điệp (ghi Sổ vết)                                                                                                                                                                                                                                                                                                                                  | —                                            |
| L2  | F1 §4.1 (+ F1-N) · F2 §4.2                                                                                                                                                                                                                                                                                                                                                                  | `test(qa): S18-QA-NOTIGLOBALLEAK-1 — …`      |
| L3  | F4 §4.3 · A5 §4.5                                                                                                                                                                                                                                                                                                                                                                           | `test(qa): …`                                |
| L4  | R1' · R6/R6b · R4 · R-F2 · R-F4 · R5 sau vá · mutant §6 · chạy nhóm file chạm + A/B/RSI + `outbox-worker-lock.unit-spec` trên lane                                                                                                                                                                                                                                                          | (ghi Sổ vết)                                 |

- CẤM chạy int-spec thiếu `LANE_DB` (DB mặc định là PRODUCTION); CẤM `pnpm test -- <path>`. Suite đầy đủ: `node harness/chunk-test.mjs --packages=@mediaos/api` (KI-014).
- Sau mỗi lần sửa tệp: đọc 5 dòng cuối `harness/activity.jsonl` ở checkout chính; dấu «started» auto cho WO khác (RR thuộc cả SHAREDSTATE) ⇒
  `node harness/ledger.mjs event <WO> reset "dấu start-on-touch nhầm do sửa tệp của S18-QA-NOTIGLOBALLEAK-1"`.
- Gate: `typescript-reviewer` + `silent-failure-hunter` (nhánh `catch`/`skipped`, ROLLBACK lỗi) + `database-reviewer` (SET LOCAL ROLE, DELETE theo tuổi, cổng DB).
- Verify (luồng chính): `bash harness/check.sh --all --lane-db=notileak` + gitleaks trên các commit; trên PR xem log step Test của `api.yml`: F1/F2/F4/RR/A/B/RSI CHẠY (không skip) và XANH (B1).

## 8. Rủi ro + câu hỏi mở

1. **F4 đánh đổi (§4.3):** dọn theo tuổi làm lượt chunk-test chạy lại ngay sau crash trong cửa sổ F4 đỏ A1 (≤ 15 phút); mã cũ thì an toàn crash nhưng
   hở song song. Luồng chính chọn: giữ v2 (theo quyết định) hay giữ dọn `LIKE` ở đầu `beforeAll` cho riêng F4 và ghi nợ phần song song.
2. Tàn dư CŨ `NOTI_EVT_<8hex>` trên lane có sẵn KHÔNG được v2 dọn (v2 không quét) ⇒ `bash scripts/lane-db-setup.sh <lane> --reset`. CI dùng DB ephemeral nên sạch.
3. Drain trong A5 giao cả event `pending` của spec khác (`claim()` không lọc tenant) — y như ~20 spec drain hiện có, dưới cùng mutex; L4 chạy chunk-test đầy đủ để quan sát.
4. Hard-code `mediaos_app` theo tiền lệ `foundation-db2-hygiene`; neo `current_user` bắt lệch nếu vai app đổi tên.

## 9. Ghi chú

### 9.3 Sổ vết

| Bước            | Ngày  | Kết quả                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plan v1 (BLOCK) | 17/10 | `57cb6800` — lease khoá tư vấn + barrier + globalSetup quét. BLOCK: B1 cổng ném lỗi trong CI (`LANE_DB=mediaos`) · B2 crash cùng tiến trình vẫn đỏ (chunk-test không chạy lại chunk có đỏ thật) · H1 sót RSI · H2 barrier + outbox lock nối chuỗi · H3 neo A5 `≥ 1` yếu, M5c không giết được · M1 F4 `LIKE` · M2 sót M2 · M3 globalSetup im lặng · M4 thiếu database-reviewer · L1 tất định R5/R3 |
| Plan v2         | 17/10 | (commit này)                                                                                                                                                                                                                                                                                                                                                                                      |
| L0              |       |                                                                                                                                                                                                                                                                                                                                                                                                   |
| L1 RED          |       |                                                                                                                                                                                                                                                                                                                                                                                                   |
| L2              |       |                                                                                                                                                                                                                                                                                                                                                                                                   |
| L3              |       |                                                                                                                                                                                                                                                                                                                                                                                                   |
| L4 đo           |       |                                                                                                                                                                                                                                                                                                                                                                                                   |
| Gate            |       |                                                                                                                                                                                                                                                                                                                                                                                                   |
| Verify          |       |                                                                                                                                                                                                                                                                                                                                                                                                   |
| PR              |       |                                                                                                                                                                                                                                                                                                                                                                                                   |
