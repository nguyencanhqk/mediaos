# S16-SOCIAL-TESTISO-1 — vá CÁCH LY TEST cho ca đua `40001` của `s16-social-db2-invariants`

> Zone **amber** · gate **LIGHT** (chỉ chạm spec test, KHÔNG chạm code sản phẩm) · WO tách ra từ
> `docs/plans/S16-SOCIAL-BE-2B-2.md` §14.5 (nơi truy ra nguyên nhân gốc, 24/09/2026).

---

## §1. Triệu chứng

`bash harness/check.sh --all --lane-db` đỏ **ngẫu nhiên** đúng một ca, ở một spec KHÔNG thuộc WO đang
làm: `s16-social-db2-invariants.int-spec.ts` › «Nhóm 13 · thân SQL của `0582` trên company THẬT»:

```
ERROR:  could not serialize access due to concurrent update   -- SQLSTATE 40001
```

⚠️ **Vì sao gấp dù "chỉ là test".** Một cổng xác minh đỏ-ngẫu-nhiên là cổng **fail-open**: một lượt đỏ
có thể là nó, che mất một ĐỎ THẬT. Flake này làm `check.sh --all` mất độ tin cho **mọi** WO sau.

**PROD/CI KHÔNG dính:** migrate chạy TRƯỚC khi boot app, `companies` rỗng lúc `0582` chạy, và không có
phiên nào ghi `feed_kudos_badges` đồng thời. Rủi ro thuần tuý của môi trường test.

---

## §2. Nguyên nhân gốc

`0582` là `INSERT … CROSS JOIN companies … ON CONFLICT (company_id, code) DO NOTHING` — phạm vi **TOÀN
DB**, không giới hạn ở tenant của spec. Nhóm 13 (và Nhóm 10) chạy thân nó bên trong một tx
**REPEATABLE READ dài** trên lane DB **dùng chung**.

Khi một phiên KHÁC commit một hàng `feed_kudos_badges` cho một company **đã hiện diện trong snapshot**,
PostgreSQL **KHÔNG "skip im lặng"** như trực giác về `DO NOTHING` mách bảo: `ON CONFLICT` dò xung đột
trên hàng **MỚI NHẤT** (ngoài snapshot) trong khi tx bị ràng ở snapshot cũ ⇒ RR không hoà giải được ⇒
`40001`.

**Ba nguồn ghi đồng thời** trong cây test, đều theo đúng hình dạng nguy hiểm «tạo company (commit) →
chèn huy hiệu (commit)»:

| #   | Nguồn                                                                    |
| --- | ------------------------------------------------------------------------ |
| 1   | `apps/api/test/integration/rls-registry.ts`                              |
| 2   | `apps/api/src/social/social-master-data.seeder.ts` (qua int-spec của nó) |
| 3   | `apps/api/test/integration/social-be2b2-kudos.int-spec.ts`               |

---

## §3. Bản vá

Helper `lockAgainstConcurrentKudosSeed(c)` trong chính spec, gọi **NGAY SAU**
`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ` và **TRƯỚC câu `SELECT` đầu tiên**:

```sql
LOCK TABLE companies         IN SHARE MODE;      -- chặn tạo company mới
LOCK TABLE feed_kudos_badges IN EXCLUSIVE MODE;  -- chặn mọi commit huy hiệu
```

`LOCK TABLE` là **utility statement** nên KHÔNG lấy snapshot; snapshot RR chỉ hình thành ở câu đầu tiên
CẦN nó ⇒ đặt trước câu `SELECT` đầu tiên thì khoá đã cầm lúc snapshot chốt. Gọi SAU câu `SELECT` đầu
tiên là **vô dụng**.

**Hai nơi gọi** (cùng một hình dạng phơi nhiễm — Nhóm 10 cũng phát lại `0582` trong tx RR):

| Nơi                                                        | Ghi chú                                               |
| ---------------------------------------------------------- | ----------------------------------------------------- |
| **Nhóm 13** · «seed 5 huy hiệu hệ thống trên company THẬT» | ca ĐỎ đã quan sát                                     |
| **Nhóm 10** · «`0581` + `0582` phát lại 2 lần»             | **cùng lớp lỗi, chưa nổ** — vá luôn trong cùng commit |

Comment cũ của Nhóm 10 khẳng định «REPEATABLE READ giữ MỘT ảnh chụp cho cả khối ⇒ không đỏ-giả» —
đúng một nửa và **gây hiểu nhầm**: RR đổi đỏ-giả lấy `40001`. Đã sửa comment tại chỗ.

---

## §4. PHÉP ĐO CỔNG (24/09/2026, lane `mediaos_testiso`)

### 4.1 Tầng SQL — 2 phiên tự canh giờ

Kịch bản: A lấy snapshot RR → B commit 5 huy hiệu cho **chính** company đó → A chạy thân `0582`.

| Biến thể       | Phiên B                       | Phiên A           |
| -------------- | ----------------------------- | ----------------- |
| **KHÔNG khoá** | ghi + commit được sau **6ms** | **`ERROR 40001`** |
| **CÓ khoá**    | **bị chặn >3s**               | **PASS**          |

### 4.2 Tầng SPEC — chạy spec THẬT dưới một _chaos writer_ chạy song song

⚠️ Phép đo **tuần tự** (chạy spec một mình) **KHÔNG bác được** giả thuyết về ca ĐUA — phiên kia không
thể commit vào GIỮA cửa sổ snapshot. Đó chính là bẫy đã làm 2 giả thuyết trước bị bác OAN
(`gate-measurement-row-can-be-unsatisfiable`). Nên phép đo dưới đây chạy spec **dưới tải ghi đồng thời**
mô phỏng đúng hình dạng của 3 nguồn ở §2 (tạo company → chèn huy hiệu, lặp liên tục).

| Biến thể             | Kết quả                                                                 |
| -------------------- | ----------------------------------------------------------------------- |
| **GỠ 2 dòng LOCK**   | **4/8 lượt ĐỎ** — `could not serialize access due to concurrent update` |
| **GIỮ (hiện trạng)** | **0/10 lượt ĐỎ**                                                        |

**Bằng chứng chaos writer THỰC SỰ sống trong lượt xanh** (chống kết luận xanh-rỗng): heartbeat in kèm
mỗi lượt, `n` leo **1400 → 4200** và mốc thời gian tiến đều suốt 10 lượt; quan trọng hơn, bộ đếm
`blocked` (vòng ghi bị chặn >500ms) leo **0 → 18** — tức chính hai khoá bảng đang **chặn** phiên kia,
không phải chaos đã tắt.

### 4.3 Thứ tự khoá — census toàn repo

`grep -rniE "LOCK[[:space:]]+(TABLE|ONLY)|IN … MODE"` trên `apps/ packages/ scripts/ harness/`
(`*.ts` · `*.sql` · `*.mjs` · `*.js`): **chỉ 2 dòng của chính bản vá này**. Mọi chỗ khác dùng
`pg_advisory_*` — không nằm chung đồ thị chờ với khoá bảng ⇒ **chưa có vòng chờ nào để sinh deadlock**.

**Hợp đồng:** `companies` TRƯỚC → `feed_kudos_badges` SAU. Thêm `LOCK TABLE` ở bất kỳ đâu khác ⇒ PHẢI
theo đúng thứ tự này. Hợp đồng được ghi trong docblock của helper, cạnh chỗ dễ bị sửa nhất.

### 4.4 Cổng đầy đủ

`bash harness/check.sh --all --lane-db=testiso` trên lane vừa `--reset` (chain 0000→latest sạch):
**XANH ✅ cả 9 bước** — secret-literals · lint · typecheck · migration-no-drop · tooling-tests ·
test · build · prod-tenant-check · db-readiness. Bước test chạy NHƯ CI: **775/775 file spec của
`@mediaos/api`** đều CHẠY (không bị skip) ⇒ `lane-db-guard` không escalate. Không còn ca đỏ Nhóm 13.

⚠️ Đọc KẾT LUẬN IN RA, đừng tin exit code — `check.sh` từng in ĐỎ mà vẫn thoát 0 (§14.5 của BE-2B-2).

---

---

## §5. Hai đường BỊ CẤM

| Đường                       | Vì sao cấm                                                                                                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **retry `40001`**           | giấu triệu chứng, và che luôn một ca `40001` THẬT nếu sau này có                                                                                                                |
| **hạ xuống READ COMMITTED** | chỉ thu hẹp cửa sổ chứ không đóng: một company commit vào giữa câu `INSERT` và câu `VERIFY` của `0582` vẫn làm vỡ đẳng thức `v_left = 5 * v_co` (v_co đếm nó, v_left thì không) |

Cả hai đã ghi thẳng vào docblock của helper để lượt sửa sau không "sửa" ngược lại.

---

## §6. Giá phải trả (chấp nhận được, có chủ ý)

Mọi spec chạy song song mà **tạo company** hoặc **ghi huy hiệu** sẽ **xếp hàng** trong lúc hai khối này
chạy. Đo được ở §4.2: 18 vòng ghi bị chặn trên ~4200 vòng trong 10 lượt spec — nhiễu không đáng kể, và
hai khối đều ngắn. Đổi lại `check.sh --all` hết đỏ ngẫu nhiên.

---

## §7. Đối chiếu `done_when`

| #   | Yêu cầu                                                        | Trạng thái                      |
| --- | -------------------------------------------------------------- | ------------------------------- |
| 1   | Nhóm 13 lấy khoá TRƯỚC câu SELECT đầu tiên + ĐO CỔNG hai chiều | ✅ §3 · §4.1 · §4.2             |
| 2   | CẤM retry 40001 · CẤM hạ READ COMMITTED                        | ✅ §5 (ghi cả trong docblock)   |
| 3   | Census thứ tự khoá toàn cây test                               | ✅ §4.3 — chỉ 2 dòng của bản vá |
| 4   | `check.sh --all --lane-db` XANH trên lane SẠCH (`--reset`)     | ✅ §4.4                         |

**Vượt ngoài `done_when` (có chủ ý):** `done_when` chỉ nêu Nhóm 13; Nhóm 10 phát lại `0582` trong đúng
hình dạng RR ấy nên mang **cùng lớp lỗi** — vá luôn thay vì để lại quả bom hẹn giờ trong cùng file.
