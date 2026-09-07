# S18-QA-ASSETFLAKE-1 — `s11-asset-db1-invariants` H1 đỏ trong lane chung, xanh khi chạy riêng

> 🟡 LIGHT gate. WO này **bắt đầu bằng ĐO, không bằng vá** (done_when #1). Mọi kết luận dưới đây
> phải có số hoặc dòng code chống lưng; chỗ nào chưa đo thì ghi thẳng là chưa đo.

## 1. Bối cảnh — vì sao WO này tồn tại

Ca `H1` của `apps/api/test/integration/s11-asset-db1-invariants.int-spec.ts` đã ĐỎ **hai wave liên
tiếp** trong lượt `check.sh --all --lane-db=…`, và **cả hai lần chạy riêng đều 22/22 XANH**:

| Lần        | WO đang chạy lúc đó      | Ghi ở                | Diff của WO đó              |
| ---------- | ------------------------ | -------------------- | --------------------------- |
| 03/09/2026 | `S18-AUTH-UNLOCK429-1`   | `harness/handoff.md` | AUTH (rate-limit đăng nhập) |
| 05/09/2026 | `S18-AUTH-RESETCLEARS-1` | `harness/handoff.md` | AUTH (reset mật khẩu)       |

Không lần nào diff chạm ASSET (mig 0549–0551). Hai phiên đó đều **miễn trừ bằng tay** ("flake lane
chung") rồi đi tiếp. Cái giá: mọi phiên sau gặp ca này đỏ đều phải tự hỏi _"flake hay hồi quy thật"_
— đó là thuế đánh vào mọi WO, và là lý do WO này được seed.

**Bằng chứng hiện có là GHI TAY, chưa ai đo lại có kiểm soát.** Không có log diff của lần đỏ nào ⇒
không biết trường nào trong phép so lệch.

## 2. Ca H1 làm gì (đọc code, không suy đoán)

`apps/api/test/integration/s11-asset-db1-invariants.int-spec.ts:856-889`:

1. chụp `before` = một hàng 6 trường qua `direct` (superuser, KHÔNG đặt GUC company):
   - `roles` — `count(*) FROM roles WHERE name='asset-manager' AND company_id IS NULL AND deleted_at IS NULL`
   - `perms` — `count(*) FROM permissions WHERE resource_type IN ('asset','asset-category','asset-maintenance','asset-inventory')`
   - `grants` — `count(*) FROM role_permissions rp JOIN permissions p … WHERE p.resource_type IN (4 giá trị trên)`
   - `events` — `notification_events` global `module_code='ASSET'`
   - `templates` — template của các event đó (global)
   - `audit_def` — `pg_get_constraintdef` của `audit_logs_object_type_chk`
2. **replay NGUYÊN** hai file `0550_s11assetdb1_seed_role_perms_audit.sql` + `0551_s11assetdb1_noti_asset.sql`,
   tách theo `--> statement-breakpoint`, chạy từng câu qua `direct`;
3. chụp `after` rồi `expect(after).toEqual(before)`.

Ý nghĩa ca: **replay hai migration đó là idempotent**. Cửa sổ giữa hai lần chụp = thời gian chạy
hết hai file SQL (nhiều câu, cỡ giây) — trong cửa sổ đó, **bất kỳ ai** đổi 6 trường trên đều làm ca
đỏ mà không liên quan gì tới tính idempotent.

## 3. Giả thuyết (bằng chứng TĨNH, chưa phải kết luận)

### H-A — `grants` bị fixture của spec ASSET khác đẩy lên/xuống trong cửa sổ

`grants` là trường DUY NHẤT trong 6 trường **không có vế lọc phạm vi sở hữu**: nó đếm mọi
`role_permissions` trỏ tới permission asset, **kể cả của role thuộc công ty test**.

`test/integration/s11-asset-qa1-permission-matrix.int-spec.ts:110-160` dựng, trong `beforeAll`:

- 1 role `assetqa-full` với **11 cặp** (`access:asset` + 10 `ROUTE_PAIRS`, `:73-85`);
- **10 role** `assetqa-no-…`, mỗi role 10 cặp.

⇒ tối đa **111 hàng `role_permissions`** trỏ tới permission có `resource_type` asset\*, sống suốt
spec đó rồi biến mất ở `cleanupTenants`. Bốn spec `asset-be1-*` và `dashboard-office-widgets` cũng
theo khuôn này.

**Vì sao chỉ đỏ ở lane chung mà KHÔNG đỏ ở CI** — đây là điểm khớp mạnh nhất của H-A:

| Spec                                                         | Cổng chạy                                               | LANE_DB local | CI                                |
| ------------------------------------------------------------ | ------------------------------------------------------- | ------------- | --------------------------------- |
| `s11-asset-db1-invariants` (H1)                              | `skipIf(!hasDb)`                                        | CHẠY          | CHẠY                              |
| `s11-asset-qa1-*`, `asset-be1-*`, `dashboard-office-widgets` | `skipIf(!hasLaneDb)` — `hasDb && !!process.env.LANE_DB` | CHẠY          | **SKIP** (CI không đặt `LANE_DB`) |

⇒ CI chưa bao giờ có kẻ đẩy `grants`, nên CI luôn xanh; local có `LANE_DB` thì có, nên local đỏ.
Chạy riêng 1 file thì cũng không có ai ⇒ 22/22 xanh. **Ba quan sát khớp cả ba.**

### H-B — `audit_def` đua đọc-sửa-ghi giữa các spec cùng replay migration

`0550` đọc định nghĩa CHECK hiện tại rồi ghi lại bản UNION-ADD (`0550_…sql`, khối `DO $$`). Bốn spec
khác cũng replay migration có cùng thao tác trên **cùng một constraint**:

| Spec                         | File replay    | Cổng chạy                |
| ---------------------------- | -------------- | ------------------------ |
| `s11-room-db1-invariants`    | `0554`, `0555` | `skipIf(!hasDb)`         |
| `s12-recruit-db1-invariants` | `0560`, `0561` | `skipIf(!hasDb)`         |
| `goal-db2-templates`         | `0528`         | `skipIf(!runIsolatedDb)` |
| `lms-audit-object-types`     | `0509`         | `skipIf(!runIsolatedDb)` |

Hai tiến trình đọc-sửa-ghi cùng constraint có thể làm `after.audit_def ≠ before.audit_def`. Nhưng
`room`/`recruit` chạy **cả trên CI** mà CI chưa từng đỏ ⇒ nếu H-B là gốc thì CI cũng phải flake.
Vì vậy H-B là giả thuyết **phụ**, chỉ nhận nếu số đo chỉ đúng vào `audit_def`.

### H-C — `perms` bị fixture chế cặp asset mới

`seedPermissionCatalog` (`test/helpers/seed.ts:155`) được phép tạo cặp MỚI (catalog-fence coi cặp
mới là hợp lệ). Nếu spec nào chế một cặp có `resource_type` bắt đầu bằng `asset`, `perms` tăng vĩnh
viễn. Đo mới biết — các spec ASSET hiện đọc đúng 11 cặp sản phẩm nên khả năng thấp.

### Loại trừ sẵn

`roles` · `events` · `templates` đều có vế `company_id IS NULL` ⇒ fixture theo tenant không đụng
được. Chỉ đổi được bởi chính migration hoặc bởi spec ghi thẳng hàng global.

## 4. Giao thức đo (done_when #1)

- lane DB riêng, dựng sạch: `bash scripts/lane-db-setup.sh s18assetflake --reset`
- chạy **đúng bước test của `check.sh` trên Windows**: `node harness/chunk-test.mjs --packages=@mediaos/api`
  với `LANE_DB=mediaos_s18assetflake`, `TURBO_FORCE=1` — KHÔNG chạy riêng file, vì hiện tượng chỉ
  xuất hiện ở lane chung.
- **n = 5** lượt, ghi mã thoát + thời lượng + danh sách ca đỏ của từng lượt.
- Với mỗi lượt H1 đỏ: giữ nguyên **diff của `expect(after).toEqual(before)`** — trường nào lệch và
  lệch bao nhiêu. Đây là thứ phân biệt H-A với H-B/H-C; không có nó thì mọi kết luận là suy đoán.

### 4.1 Kết quả đo — TRƯỚC KHI VÁ (07/09/2026, lane `mediaos_s18assetflake` dựng mới)

| Lượt | rc    | thời lượng | H1     | trường lệch                       | before → after      |
| ---- | ----- | ---------- | ------ | --------------------------------- | ------------------- |
| 1    | 0     | 413s       | xanh   | —                                 | —                   |
| 2    | 0     | 531s       | xanh   | —                                 | —                   |
| 3    | **1** | 421s       | **ĐỎ** | `grants` (5 trường kia GIỐNG HỆT) | **116 → 105** (−11) |
| 4    | 0     | 472s       | xanh   | —                                 | —                   |
| 5    | 0     | 398s       | xanh   | —                                 | —                   |

**Tỉ lệ đỏ đo được: 1/5 (20%).** Đây là con số thay cho "ghi tay 2 lần" của hai phiên trước.

Hai điều lượt 3 nói ra mà ghi chép tay không nói được:

1. **`audit_def` KHÔNG lệch** ⇒ loại H-B (đua đọc-sửa-ghi CHECK) khỏi ca này.
2. **`perms`, `roles`, `events`, `templates` không lệch** ⇒ loại H-C, và quan trọng hơn: **replay
   0550+0551 VẪN idempotent**. Ca H1 đỏ mà thứ nó định đo thì vẫn đúng — đúng định nghĩa nhiễu.

Lượt 3 cũng cho biết ai chạy cùng chunk: `s11-asset-db1-invariants` nằm **chunk 15/17** cùng
`s11-asset-qa1-permission-matrix`, `s11-room-qa1-*`, `s12-recruit-qa1-*`. Ranh giới chunk phụ thuộc
TỔNG SỐ FILE của package, nên nó **trôi mỗi lần thêm/bớt một spec** — đó là lý do ca này lúc đỏ lúc
xanh giữa các wave mà chẳng ai đụng vào ASSET.

## 5. Gốc — `grants` là trường DUY NHẤT không có vế SỞ HỮU

Phép đếm tất định trên chính lane DB (đọc thuần, không đổi dữ liệu):

| Phép đếm                                             | Số           |
| ---------------------------------------------------- | ------------ |
| counter cũ (không lọc)                               | **105**      |
| hàng DO 0550 sở hữu (`roles.company_id IS NULL`)     | **28**       |
| role `assetqa2-a1` / `-a2` / `-b1` (công ty fixture) | 22 + 22 + 22 |
| role **`super-admin` company-scoped**                | **11**       |

Khớp con số lệch của lượt 3: **−11 = đúng một role `super-admin` của một công ty test biến mất.**
`SuperAdminBootstrapService` (`apps/api/src/permission/super-admin-bootstrap.service.ts:94-113`)
UPSERT role `super-admin` **company-scoped** rồi cấp **trọn catalog** (log: `granted 411 catalog
permissions`) — trong đó có **đúng 11 cặp asset**. Mọi int-spec boot `AppModule` + seed công ty đều
đẻ một role như vậy, và `cleanupTenants` của spec đó xoá nó đi. Trúng cửa sổ giữa hai lần chụp của
H1 (thời gian chạy hết 2 file SQL) ⇒ `grants` lệch ±11.

Còn `roles`/`events`/`templates` có vế `company_id IS NULL`, `perms` là catalog toàn cục — nên chỉ
`grants` hở. Comment cũ ngay trên câu SQL tự nhận là "CHỈ đếm hàng DO WO NÀY sở hữu" — **nó không
làm đúng điều nó nói**.

**Vì sao CI chưa từng đỏ:** không phải vì CI sạch hơn. `super-admin` sinh ra ở CI y hệt. Khác biệt
là _khối lượng_: local `LANE_DB` mở thêm cả họ spec `skipIf(!hasLaneDb)` (`s11-asset-qa1-*`,
`asset-be1-*`, `dashboard-office-widgets`, …) ⇒ nhiều vòng seed/cleanup công ty hơn hẳn trong cùng
một chunk ⇒ cửa sổ dễ trúng hơn. Xanh ở CI là **may**, không phải bằng chứng.

Kết luận theo done_when #5: **KHÔNG phải hồi quy của ASSET.** Migration 0550/0551 idempotent đúng
như F1/F2 và như chính lượt 3 chứng minh. Hỏng nằm ở **phép đo của ca test**, giữ nguyên zone 🟡.

## 6. Bản vá — siết phạm vi sở hữu, không nới assert

`s11-asset-db1-invariants.int-spec.ts` H1 — thêm `JOIN roles r` + `r.company_id IS NULL` vào
`grants`. Đây **không phải nới**: 0550 chỉ cấp cho role hệ thống (`0550:105-112` resolve role bằng
`name = … AND company_id IS NULL AND deleted_at IS NULL`, không thấy thì `RAISE EXCEPTION`), nên vế
mới **loại đúng những hàng migration không bao giờ đụng tới**. Khuôn không phải tự chế:
`s12-recruit-db1-invariants.int-spec.ts:1000-1003` (WO sau, S12) đã dùng đúng hình dạng này.

Kèm **neo chống xanh-RỖNG** ngay sau lần chụp `before`: `expect(Number(before.grants)).toBeGreaterThan(0)`
— nếu vế lọc mới trượt hết (đổi tên role, đổi `resource_type`) thì `0 === 0` vẫn xanh và ca chết âm
thầm. Con số CHÍNH XÁC 28 đã do F1 ghim, nên ở đây chỉ neo "khác 0", không ghim lần hai.

`s11-room-db1-invariants.int-spec.ts` H1 mang **y hệt lỗ đó** (`grants` cho `room`/`room-booking`
không lọc role). Vá cùng lớp lỗi, cùng khuôn, cùng neo. Nói thẳng: ca ROOM **chưa từng quan sát
thấy đỏ** — vá theo lớp lỗi, không theo sự cố. `s13-payroll-db1-invariants` và
`s7-chat-db1-invariants` **không có** ca replay/snapshot kiểu này (đã kiểm) ⇒ không đụng.

### 6.1 Đối chứng đột biến — ca có còn bắt được lỗi THẬT không

Thêm TẠM vào cuối `0550` một câu `INSERT … 'DENY'` cấp cho role hệ thống `asset-manager` (⇒ replay
mất tính idempotent trên hàng **sở hữu**), chạy riêng spec:

```text
AssertionError: -   "grants": "28"      (before)
                +   "grants": "29"      (after)   ⇒ H1 ĐỎ
```

⇒ counter đã siết vẫn **nhìn thấy** thay đổi thật trên hàng migration sở hữu. Sau đó: `git checkout`
file 0550 (đối chiếu `diff` với bản chép trước khi đột biến — **byte-giống**), `DELETE` hàng DENY
khỏi lane DB, đếm lại về **28**.

### 7.0 Cổng chính thức

`bash harness/check.sh --all --lane-db=s18assetflake` trên lane **vừa `--reset`**: **XANH 9/9**
(secret-literals · lint · typecheck · migration-no-drop · tooling-tests · test [chunked, 661/661
file `@mediaos/api` + 6 package FE] · build · prod-tenant-check · db-readiness), không banner
"XANH KHÔNG ĐỦ BẰNG CHỨNG". Lượt `--all` TRƯỚC đó (trên lane đã tích rác) đỏ 1 ca — là ca §9, không
phải H1.

## 7. Đo lại sau vá (done_when #4)

Cùng giao thức §4, cùng lane DB, 5 lượt:

| Lượt | rc  | thời lượng | H1 (asset) | ca đỏ khác                                       |
| ---- | --- | ---------- | ---------- | ------------------------------------------------ |
| 1    | 1   | 492s       | **xanh**   | `task-pipeline-backfill-0500` (§9 — cơ chế KHÁC) |
| 2    | 0   | 445s       | **xanh**   | —                                                |
| 3    | 0   | 430s       | **xanh**   | —                                                |
| 4    | 0   | 392s       | **xanh**   | —                                                |
| 5    | 0   | 424s       | **xanh**   | —                                                |

**H1: 0/5 đỏ** (trước vá 1/5).

⚠️ **Đừng đọc "0/5" như bằng chứng chính.** 20% → 0% qua 5 lượt, tự nó, là số yếu — thiếu sức mạnh
thống kê để phân biệt với may mắn. Sức nặng nằm ở ba thứ KHÁC, và đó mới là lý do tin bản vá:

1. **Cơ chế đã đóng bằng cấu tạo**, không bằng xác suất: hàng của công ty fixture giờ nằm NGOÀI phép
   đếm, nên `super-admin` sinh/xoá bao nhiêu lần cũng không chạm được `grants` nữa.
2. **Phép đếm tất định §5** (28 sở hữu vs 105 không lọc) chỉ đúng vào phần đã cắt.
3. **Đột biến §6.1** chứng minh phần GIỮ LẠI vẫn bắt lỗi thật (28 → 29 ⇒ đỏ).

## 9. Phát hiện mới trong lúc đo — KHÔNG vá ở WO này

Lượt 1 sau vá đỏ ở một spec khác, cơ chế khác:

```text
FAIL test/integration/task-pipeline-backfill-0500.int-spec.ts
error: insert or update on table "project_states" violates foreign key constraint
       "project_states_project_id_fkey"   ❯ run0500 …:150
```

Spec đó replay `0500` — một backfill **TOÀN CỤC**, không giới hạn tenant của spec — nên nó GHI lên
project của spec khác; trúng lúc `cleanupTenants` của spec kia xoá project thì FK vỡ. Cùng HỌ
("spec replay migration × fixture chạy song song"), **khác cơ chế** (ghi/FK, không phải đếm), nên
sửa ở đây là mở rộng phạm vi một WO 🟡 sang một gốc chưa đo. Đã seed **`S18-QA-PIPELINEREPLAY-1`**
với đúng bằng chứng này.

### 9.1 Manh mối kèm theo: tỉ lệ đỏ của nó đi theo ĐỘ BẨN của lane DB

Phân bố quan sát được **không** đều theo thời gian:

| Giai đoạn                                                 | Số lượt | Lần dính FK      |
| --------------------------------------------------------- | ------- | ---------------- |
| 5 lượt TRƯỚC vá (lane vừa dựng)                           | 5       | **0**            |
| 6 lượt sau đó (5 lượt xác minh + 1 lượt `check.sh --all`) | 6       | **2**            |
| 1 lượt `check.sh --all` sau khi `--reset` lane            | 1       | **0** (XANH 9/9) |

Đo lane DB sau 11 lượt: **681 `companies` · 80 `projects` · 143 `project_states` · 999 role tenant**
— rác tồn từ những chunk crash hạ tầng (chunk chết giữa chừng thì `afterAll`/`cleanupTenants` không
bao giờ chạy). Vì `0500` backfill **mọi** project trong DB, bán kính ghi của nó **phình theo rác
tích luỹ** ⇒ xác suất trúng một project đang bị spec khác xoá cũng phình theo. Đây là **giả thuyết
có số chống lưng, chưa phải kết luận** — `S18-QA-PIPELINEREPLAY-1` phải đo lại có kiểm soát.

Hệ quả thực dụng, đúng cho MỌI WO chứ không riêng cái này: **"lane DB dùng lại" và "lane DB vừa
dựng" KHÔNG cho cùng một tỉ lệ đỏ.** Chạy nhiều lượt trên một lane là đang chạy trên một DB mỗi lúc
một khác.

## 8. Giới hạn — nói thẳng để không ai đọc quá lên

- **Phép đếm mù với "đổi scope".** 0550 re-scope bằng `DELETE … WHERE data_scope <> g[4]` rồi
  `INSERT` ⇒ tổng số hàng KHÔNG đổi. Nếu ai sửa `data_scope` trong ma trận §9d, H1 vẫn xanh. Đây là
  giới hạn CÓ SẴN của ca (đếm, không so nội dung), bản vá này không làm nó tệ hơn cũng không sửa nó.
  F1 mới là chỗ ghim ma trận.
- **H-B (đua đọc-sửa-ghi `audit_logs_object_type_chk` giữa 4 spec cùng replay) chưa được loại trừ,
  chỉ là chưa nổ ở 5 lượt đo.** Không vá đón đầu trong WO này; nếu về sau `audit_def` lệch thì đã có
  §3 H-B ghi sẵn giả thuyết + danh sách spec.
- **Lane DB còn rác fixture** (66 hàng của `assetqa2-*` sót lại từ chunk từng crash). Không ảnh
  hưởng counter đã siết, nhưng là lý do KHÔNG đọc số tuyệt đối của counter cũ như dữ liệu sạch.
