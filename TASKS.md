# MediaOS — LỘ TRÌNH SOLO (Task Tracker)

> Bản thực thi cho người làm **một mình + Claude Code**, mục tiêu **chất lượng / SaaS dài hạn**.
> Hệ: quản trị công ty media (~200 nhân sự / 100 kênh / 300 video/tháng).
> Giữ đúng **thứ tự phụ thuộc** — không nhảy cóc. Mã phase (`G2-3`) dùng để tham chiếu commit/PR.

---

## 0. Cách đọc file này (đọc 1 lần)

### Đánh dấu tiến độ
`[ ]` chưa làm · `[~]` đang làm · `[x]` xong. **Không đóng một Giai đoạn** khi chưa đạt hết "✅ Done khi".

### Nhãn mỗi task: `<chế độ><năng lượng> (<cỡ>)`

**Chế độ làm** — quyết định bạn lái Claude Code thế nào:

| Nhãn | Nghĩa | Cách làm với Claude Code | Model | Review |
| --- | --- | --- | --- | --- |
| 🤖 **AI-bulk** | Claude sinh hàng loạt từ ERD/contract | Đưa ERD + contract Zod → yêu cầu sinh module CRUD/list/detail/form. Bạn đọc-duyệt, không gõ tay. | Haiku/Sonnet | LIGHT gate |
| 🛠️ **TDD tay** | Lõi nhạy cảm, bạn lái từng bước | **Deny-path RED trước**, implement GREEN, refactor. Đọc kỹ từng diff. | **Opus** | **FULL gate** |
| 🔧 **Setup** | Hạ tầng/config một lần | Theo checklist, scaffold rồi chỉnh tay. | Haiku/Sonnet | quick |
| 🧪 **Spike/Test** | Thiết kế đã xong ở G0, giờ hiện thực hoá / viết test | Bám file spike đã có. | Sonnet/Opus | theo loại |

**Năng lượng** (để xếp nhịp, tránh kiệt sức):
🔋 = nặng não, dễ mệt (crown-jewel, logic khó) · 🟢 = flow, AI làm phần lớn, nhẹ đầu.

**Cỡ** (1 mình + AI): **S** ≈ ½–1 ngày · **M** ≈ 1–3 ngày · **L** ≈ 3–6 ngày · **XL** ≈ 1–2 tuần.

### 4 nguyên tắc vận hành SONG SONG (QUAN TRỌNG)

> **Đổi mô hình (2026-06-12):** từ "tuần tự solo, 1 task/lúc" → **fan-out song song có rào an toàn**. Lý do an toàn: nền tảng bắt-buộc-tuần-tự (G1·G2·G3·G4 + audit/permission/RLS) **đã land master** → phase sau chỉ phụ thuộc thứ đã land → mở song song được. Chi tiết kỹ thuật: **§5 — Mô hình thực thi song song**.

1. **Song song theo DAG, không tuần tự.** Mở đồng thời MỌI phase mà phụ thuộc đã land master — mỗi phase **1 worktree riêng** + **1 band migration riêng** (§5.2). **CẤM 2 phiên trên cùng working tree** (shared git index → hỏng commit chéo). Phụ thuộc cứng còn lại: trunk **Task Hub G9-1 phải land trước** các lane emit task (G8/G10/G11/G13).
2. **Xen kẽ 🔋 và 🟢 across lanes.** Mỗi lượt fan-out trộn lane nặng (🛠️ permission/payroll) với lane nhẹ (🤖 CRUD) để không dồn toàn việc nặng một lúc.
3. **Đòn bẩy AI đặt đúng chỗ.** 🤖 = sinh hàng loạt (xanh → auto-commit checkpoint). 🛠️ = deny-path RED trước, FULL gate, **người chốt khi đỏ/CRITICAL**. Mỗi lane tự chạy vòng micro-step (test→gate→checkpoint) độc lập (§5.5).
4. **Mốc sống còn trước mốc đầy đủ.** Bám MỐC; trong mỗi mốc fan-out hết lane độc lập, **merge theo thứ tự phụ thuộc** (§5.4).

---

## 1. BẤT BIẾN — không bao giờ phá (ép bằng hook `.claude/hooks/`)

1. **`company_id` ở MỌI query** nghiệp vụ. Tenant isolation ép ở tầng DB bằng **RLS** + FORCE, KHÔNG dựa kỷ luật dev. Mọi repo qua `withTenant(companyId, fn)`.
2. **Không hard-delete** dữ liệu quan trọng (`deleted_at`). Bảng audit/snapshot (`audit_logs`, `payslips`, `kpi_results`, `profit_snapshots`, `revenue_records`, `cost_records`…) **append-only** — app role không UPDATE/DELETE.
3. **Không secret plaintext.** Mật khẩu user → hash. Mật khẩu kênh (`platform_accounts`) → **envelope encryption + KMS/Vault**, mã hoá **app-side**, không log, không vào DTO role không quyền.
4. **Task Hub hợp nhất.** MỌI nguồn việc (sản xuất, duyệt, trả sửa, task sau họp, đề xuất chi, đơn nghỉ, giao việc tay) → **chung bảng `tasks`** phân biệt bằng `task_type`. **Cấm** bảng task riêng cho từng module.

## 2. Luật phụ thuộc (thứ tự bắt buộc)

```text
Audit log + Event bus (outbox)  ──▶  trước mọi module
Permission engine               ──▶  trước mọi module có dữ liệu nhạy cảm
Tenant isolation (RLS)          ──▶  trước khi seed/backfill dữ liệu (policy + FORCE RLS TRƯỚC khi backfill company_id)
```

---

## 3. Lộ trình theo MỐC (cách solo nên ngắm)

> Đừng ngắm "xong 16 phase". Ngắm từng mốc release — mỗi mốc là một thứ **dùng được thật**.

| Mốc | Gồm phase | Cho ra cái gì | Ước lượng (1 mình + AI)¹ | Năng lượng tổng |
| --- | --- | --- | --- | --- |
| **🏁 M1 — Lõi sống** | G1→G4 | 1 video chạy trọn vòng đời, pilot 1 team thật | ~6–9 tuần | 🔋🔋 (qua "thung lũng" G2/G3 rồi tới đỉnh G4) |
| **M2 — Sản xuất thật** | G5 · G6 · G7 · G9 | Quản lý kênh/project/content + Workflow Builder + Task Hub | thêm ~2.5–3.5 tháng | 🔋 (G6-2, G7) |
| **M3 — Chất lượng & giao tiếp** | G8 · G10 | Duyệt 1–3 cấp, trả sửa, KPI, chat, noti, họp | thêm ~1.5–2 tháng | 🟢🔋 hỗn hợp |
| **M4 — HR · Lương · Tài chính** | G11 · G12 · G13 | Chấm công, bảng lương bất biến, doanh thu/chi phí/lợi nhuận | thêm ~2.5–3 tháng | 🔋🔋 (G12 crown jewel) |
| **M5 — Dashboard · Mobile · SaaS** | G14 · G15 · G16 | Dashboard theo role, mobile app, sẵn sàng multi-tenant | thêm ~2.5–3.5 tháng | 🟢 (trừ G16 hardening) |

¹ _Ước lượng "ngày tập trung", chưa trừ lúc kẹt/nghỉ. Solo thực tế kéo dài hơn — bám MỐC, đừng bám tổng._

> **Cảnh báo "thung lũng":** G2 + G3 (nền bảo mật + permission) là phần **nặng nhất, ít thấy thành quả nhất**, nhưng **bắt buộc đi trước**. Đây là chỗ solo hay bỏ cuộc. Hãy biết trước: cắn răng qua nó là tới **G4 — nơi lần đầu thấy hệ thống sống**. Đừng tô vẽ UI ở giai đoạn này.

---

## 4. Bảng tiến độ tổng

| Mã | Giai đoạn | Chế độ chủ đạo | Cỡ | Trạng thái |
| --- | --- | --- | --- | --- |
| G0 | Quyết định & Thiết kế | 🧪 | — | ✅ đóng |
| G1 | Bootstrap repo & hạ tầng | 🔧 Setup | L | ✅ đóng (merged master, CI xanh) |
| G2 | Nền bảo mật & đa-tenant | 🛠️ TDD 🔋 | XL | ✅ đóng (PR #2 merged master — 62 files, 3330 insertions, CI xanh) |
| G3 | Permission Engine | 🛠️ TDD 🔋 | L | ✅ đóng (merged master — 119 tests, typecheck clean, FULL gate passed) |
| G4 | 🏁 MVP-0 Walking Skeleton | 🤖+🛠️ hỗn hợp | XL | ✅ đóng (G4-1→G4-8 đều `[x]`; e2e 17 xanh `259586c`; pilot checklist G4-8 `docs/pilot/`. _Marker fix 2026-06-14: bảng cũ ghi "đang làm" sai — chi tiết §G4 đều xong._) |
| G5 | Tổ chức & Nhân sự đầy đủ | 🤖 AI-bulk 🟢 | L | ✅ |
| G6 | Media (Channel/Project/Content) | 🤖 + 🛠️(G6-2) | L | ✅ đóng (đã land master — migration 0020–0029 + bảng lõi; G6-2 encryption đã merge, verify 2026-06-12) |
| G7 | Workflow Builder | 🛠️ TDD 🔋 | XL | ✅ đóng (merged `6a0d4bd` --no-ff) · spine 1a→4c + FE Track C · gate TỔNG PASS (B1+santa+FE LIGHT) |
| G8 | Approval · Defect · Eval · KPI | 🛠️+🤖 | L | 🟡 G8-1 Approval multi-level (1–3 cấp APR-001/002) **✅ MERGED master** (`7856e88` --no-ff, §5.4): append-only `approval_requests`=nguồn sự thật + step=projection (ADR-0016) + gate fix H1/M1 + E2 audit. Reconcile khi land: journal idx 50–52 (when bump 085000+ vì đụng g13), audit CHECK UNION **44 type** (43 + `approval_rule`). Verify `mediaos_g8` fresh: chain `0000→0082` sạch, **988 pass / 0 fail**. **Cập nhật 2026-06-14:** G8-2 Defect ✅ MERGED (`2813ac2`) · G8-3 Eval ✅ MERGED (`e6ddb5f`). **CÒN NỢ: G8-4 KPI ☐** (cá nhân/team — feed vào G12 lương). |
| G9 | 🧩 Task Hub hợp nhất | 🛠️+🤖 | L | ✅ đóng — G9-1 ✅ (`d58d465`) · G9-2 BE+FE ✅ (`9ba1eda`) · **G9-3 ✅ MERGED (`95e2d55`)** Task Board Kanban/Table/Calendar · **G9-4 ✅ MERGED (`15e8256`)** My/Team/Project. _(Cập nhật 2026-06-14: cả G9-3/4 đã land — bảng cũ ghi ☐ sai.)_ ⚠️ task_attachments (upload file) vẫn descoped (chỉ link). |
| G10 | Chat · Notification · Meeting | 🤖 + 🛠️(realtime) | L | 🟡 G10-1 Chat realtime (Socket.IO + Valkey) **✅ MERGED master** (`7ec6aaa` --no-ff, §5.4): WS handshake fail-closed (middleware) + cross-tenant deny (room `co:{companyId}` 0 row) + masking qua `chatMessageSchema.parse` + append-only. Mig `0050` (idx 44) audit CHECK UNION (DO-block). Verify `mediaos_g10` fresh: **904 pass / 0 fail** (realtime-gateway int 9/9). G10-3 Notification **✅ MERGED** (`8cf0f6c`, mig `0051` idx 61); **G10-2 Group ✅ (`a03dfec`) · G10-4 Meeting ✅ MERGED (`cfab97e`)**. _(Cập nhật 2026-06-14: Meeting đã land — bảng cũ ghi ☐ sai.)_ **CÒN NỢ nhỏ: NOTI-002 thông báo bắt buộc không tắt ☐.** |
| G11 | Attendance · Leave | 🤖 AI-bulk 🟢 | M | 🟡 BE xong (attendance `6181a05` + leave `4b7ea4a`); verify DB cô lập `mediaos_g11` **229 pass** (deny-path 4 + RLS 2-tenant 165 + unit); gate BLOCK→**vá F1–F5** `82fd27f` (TOCTOU FOR UPDATE · check-out perm · mapError leak · scope=all · overnight checkout — [`docs/reviews/g11-gates.md`](docs/reviews/g11-gates.md)); FE xong branch `feat/g11-fe` (167 web test). **✅ MERGED master §5.4** (G11-1/2 `ebce54a`; **F7** `1a05e4f` · **F6/F8** `1e7c5bf`, --no-ff): follow-up **F6 pagination** (limit/offset clamp 1–100 default 50 cho attendance/leave repo) + **F7 period-lock immutability** trước G12 (`0064` trigger BEFORE UPDATE attendance_periods chặn locked→open · RED→GREEN 4/4) + **F8 cleanup DRY** (monthRange→tz.util · between+prevDay→gte/lt) đều land. Merged master xanh: api **895 pass** + web **184 pass**, chain-migrate `0000→0064` sạch, typecheck sạch. |
| G12 | Payroll · Bonus/Penalty | 🛠️ TDD 🔋🔋 | XL | 🟡 **G12-1 Salary profile (CROWN) ✅ MERGED master (`1ec560e` --no-ff)** — BE salary-profile service+repo+controller (RLS+FORCE, mask mặc định, reveal⟹audit-in-tx) + mig band `0090–0092` + 3 int-spec deny-path + contracts `payroll.ts` + FE. _(Cập nhật 2026-06-14: đã land — bảng cũ ghi "CHƯA merge" sai; worktree g12 đã dọn.)_ **CÒN NỢ: G12-2 Payroll period+payslip snapshot ☐ · G12-3 Bonus/Penalty ☐ (cần G8-4 KPI) · G12-4 Duyệt bảng lương + re-auth payslip ☐.** |
| G13 | Finance (Revenue/Cost/Profit) | 🛠️+🤖 | L | 🟡 G13-1 Revenue ledger (CROWN-JEWEL) **✅ MERGED master** (`2d4533f` --no-ff, §5.4): revenue/cost append-only + RLS 2-tenant 0 row + permission fail-closed + audit; entry_kind original/adjustment/void (sửa=ghi mới). Reconcile khi land: journal idx 45–49, audit CHECK UNION **43 type**, rls-registry +5 case finance, contracts +finance (dual-build). Verify `mediaos_g13` fresh: chain `0000→0074` sạch, CHECK=43, **973 pass / 0 fail** (revenue-deny 12/12 · tenant-iso 183). **Cập nhật 2026-06-15 (Wave C):** G13-2 ✅ (`4198f82`). **G13-3 Profit ✅ MERGED (`bdca6b7` --no-ff): `profit_snapshots` append-only + Option X lineage dedup (hết đếm-đôi sau re-allocate, `478b7a2`/`6ba90f2`) + CYCLE guard. G13-4 Expense ✅ MERGED (`dbecefc`): đề xuất chi → duyệt qua Task Hub (`task_type=finance`) → sinh cost_record + expense_approvals log + audit; permission fail-closed.** Verify master fresh `mediaos_mergecheck`: chain `0000→0103` sạch, **1245 pass / 0 fail**, typecheck 0. **G13 ĐÓNG.** |
| G14 | Dashboard & Report | 🤖 AI-bulk 🟢 | M | 🟡 Dashboard module **✅ MERGED master** (`633ba22` --no-ff, §5.4): BE dashboard service (tenant-scoped + permission-masked stats)+spec + controller + mig `0100` permission seed (ON CONFLICT DO NOTHING) + FE stat-card / task-status-chart (recharts `^3.8.1`, React19) / dashboard route+spec server-driven PermissionGate + contracts `dashboard.ts`. Reconcile khi land: journal `0100` idx **53** (when 1717500100000 > master max), audit/app.module/contracts additive union. Gate LIGHT fix: leave count `gt→gte` (day-1 off-by-one) · attendance date `gte/lte` · Cell key by status; mang theo fix nợ master `chat sendMessage messageType`. Verify `mediaos_g14` fresh: chain `0000→latest` sạch, **api 994 pass / web 190 pass**, typecheck 4/4, build 3/3. G14-2 Report **✅ MERGED** (`1aef3ff`, mig `0101` idx 60). _(G14-1 dashboard theo role ✅ xác nhận phủ bởi `633ba22` role-masked route.)_ **G14-3 Materialized views ✅ MERGED (`28198e0` --no-ff, Wave C): `mv_dashboard_task_status`/`mv_dashboard_output` + UNIQUE index → REFRESH CONCURRENTLY (fail-loud, worker pool) + cảnh báo task trễ/lỗi nghiêm trọng (defect-severity)/kênh rủi ro + filter tháng/kênh/project/phòng ban. Fix review: SQLi→parameterize toàn bộ (MV không RLS = ranh giới tenant duy nhất) + GRANT SELECT-only worker (mig `0103`) + int-spec tenant-isolation.** Verify master `0000→0103` sạch, **1245 pass**. **G14 ĐÓNG.** |
| G15 | Mobile App (React Native) | 🤖 AI-bulk | XL | ☐ |
| G16 | Stabilization & SaaS Prep | 🛠️+🔧 | L | ☐ |
| GX | Xuyên suốt (mọi sprint) | — | — | ☐ |

---

## 5. Mô hình thực thi SONG SONG (Parallel Execution Playbook)

> Nguồn sự thật cho cách **fan-out nhiều phase cùng lúc** mà merge vẫn **tất định**. Áp dụng từ 2026-06-12. Ép một phần bằng hook `guard-migration-band` + Workflow `parallel-lanes`.

### 5.1 DAG phụ thuộc — cái gì chạy song song được

Nền tảng bắt-buộc-tuần-tự **ĐÃ land master**: G1 bootstrap · G2 audit+outbox+RLS · G3 permission · G4 skeleton · G5 org/nhân sự · G6 media · G7 workflow. → Mọi phase sau **chỉ phụ thuộc thứ đã land**.

```text
master (G1–G7 ✅, audit/permission/RLS ✅)
  └─ G9-1 Task Hub schema   ◀── TRUNK: land TRƯỚC mọi lane emit task
        ├─ G8  Approval/Defect/Eval/KPI   (cần G7 + tasks)
        ├─ G10 Comms (meeting_action task) (cần tasks)
        ├─ G11 HR   (hr task)              (cần tasks)
        └─ G13 Finance (finance task)      (cần tasks)
  Wave B (sau khi Wave A merge):
        ├─ G12 Payroll    ◀── cần G8 KPI + G11 attendance
        └─ G14 Dashboard  ◀── cần các phase sinh dữ liệu
  Cuối: G15 Mobile · G16 SaaS
```

**Quy tắc:** mở song song MỌI lane mà mũi tên phụ thuộc đã land. Lane Wave B chờ phụ thuộc Wave A merge xong. Không có giới hạn số lane — chỉ giới hạn bởi phụ thuộc.

### 5.2 Cấp phát band migration (KHÔNG bao giờ dùng chéo band)

Master kết thúc ở `0037`. Mỗi lane sở hữu **1 dải 10 số** riêng:

| Lane | Band | Trạng thái |
| --- | --- | --- |
| G9  | `0040–0049` | đang dùng (`0040`) |
| G10 | `0050–0059` | ✅ đã land master (`0050` idx 44, `0051` idx 61) |
| G11 | `0060–0069` | đang dùng (`0060–0064`) |
| G13 | `0070–0079` | đang dùng (`0070–0074`) |
| G8  | `0080–0089` | đang dùng (`0080–0082`) |
| G12 | `0090–0099` | ✅ đã land master (`0090–0092`, idx 54–56, when 17175001100/111/112) |
| G14 | `0100–0109` | ✅ đã land master (`0100` idx 53, `0101` idx 60) |
| G15 | `0110–0119` | reserved |
| G16 | `0120–0129` | reserved |

`_journal.json`: `idx`/`when` phải **đơn điệu tăng** trong band; khi merge nhiều lane, reconcile journal theo thứ tự merge (idx liên tục, when tăng dần). Hook `guard-migration-band` **chặn (exit 2)** file migration có số ngoài band của branch hiện tại.

> **⚠️ DB CÔ LẬP mỗi lane (BẮT BUỘC verify):** band riêng KHÔNG đủ chống drift trên **1 DB dùng chung**. drizzle migrator áp migration **đơn điệu theo `when`** ⇒ khi lane band cao (G8 `0080s`) migrate `mediaos` chung, migration band thấp (G10 `0050`, G11 `0060s`, G13 `0070s`) bị **SKIP** vĩnh viễn → bảng vắng, test xanh-giả/đỏ-giả. **Mỗi lane verify trên DB riêng `mediaos_<lane>`:** `bash scripts/lane-db-setup.sh <lane>` (tạo + chain-migrate `0000→latest`, `--reset` để làm lại) → `export LANE_DB=mediaos_<lane>` → `pnpm --filter @mediaos/api test`. `vitest.config.ts` đọc `LANE_DB` (không set → `mediaos` chung cho CI ephemeral/master). Đã verify 2026-06-13: `mediaos_g13` áp sạch 44 migration đủ bảng G13.

### 5.3 Hot-file append protocol (file mọi lane đụng → CẤM rewrite)

| File / đối tượng | Quy tắc merge |
| --- | --- |
| audit `object_types` CHECK | Migration audit mỗi lane định nghĩa lại CHECK = **UNION(type master + type của lane)**. Merge = tính lại union đủ mọi lane. _(G11 đã làm: `0060` = 24 type G7 + 7 type HR = 31.)_ |
| permission seed | `INSERT … ON CONFLICT DO NOTHING` — idempotent, cộng dồn, không sửa hàng có sẵn. |
| `schema/index.ts` barrel · `app.module.ts` imports | Khối **additive**, sắp alpha; xung đột merge tầm thường (nối 2 phía). |
| `tasks` (Task Hub) | **Chỉ G9 đổi cấu trúc**; lane khác chỉ INSERT theo `task_type`. Cần đổi shape → đi qua trunk G9-1. |

### 5.4 Thứ tự merge = thứ tự phụ thuộc

1. ✅ **G9-1 trunk đã land master** (`d58d465`, merge --no-ff).
2. Rebase mỗi lane Wave A lên master mới → chạy lại **gate** (FULL/LIGHT theo diff) → merge lần lượt, **reconcile audit-CHECK + journal** mỗi lần.
3. ✅ Wave A (G8/G10/G11/G13) merged master. **Wave B ✅ XONG:** G14 Dashboard **✅ MERGED** (`633ba22`, 2026-06-13) · G12 Payroll (crown) **✅ MERGED** (`1ec560e` --no-ff, 2026-06-13): reconcile audit-CHECK union 45-type + journal idx 54–56 (when > master max) + 0090 SQL superset; verify DB cô lập `mediaos_g12` 57 mig/api 1031 pass/web 199 pass; gate FULL (3 reviewer + santa dual-review) 0 CRIT/HIGH + 2 gate fix (`edef897`).
4. Mỗi lần merge: `pnpm db:migrate` chain `0000→latest` apply **sạch** + `pnpm test` **xanh** trước khi land.

### 5.5 Vòng tự động hoá mỗi lane (autonomous micro-step)

Mỗi lane chạy độc lập trong worktree của nó:

```text
RED (deny-path/contract test) → GREEN (implement) → gate (FULL/LIGHT) → checkpoint commit
  ├─ xanh + non-sensitive  → auto-commit "wip(gN): …", sang micro-step kế
  └─ đỏ / CRITICAL / 🛠️    → DỪNG, người chốt
```

Fan-out nhiều lane 1 lượt: **Workflow `parallel-lanes`** (`.claude/workflows/parallel-lanes.mjs`) — mỗi lane 1 agent pinned vào worktree+band, chạy 1 round micro-step rồi báo cáo `committed / needs_human`. **Checkpoint commit trước mỗi rebase.**

### 5.6 Model routing & plan-step (tự động)

> Workflow tự chọn model theo độ khó của lane (CLAUDE.md §6). Quyết định 2026-06-12 (**thận trọng chất lượng**): **KHÔNG Haiku · Sonnet mặc định · Opus chỉ crown-jewel**. Crown-jewel còn được **lập micro-plan (Opus) trước khi code** (pipeline `Plan → Implement`); việc thường code thẳng Sonnet.

| Lane | Tier | Model | Plan-step |
| --- | --- | --- | --- |
| G12 Payroll · G3 Permission · G6-2 Secret/encrypt · G13 Finance ledger (revenue/cost/profit) · G7 Workflow FSM/DAG · G8 KPI/Eval · ADR | **crown** | **Opus** | ✅ |
| G9 Task Hub CRUD · G10 Comms · G11 HR (attendance/leave) · G14 Dashboard · G15 Mobile · build-fix/docs/UI | thường | **Sonnet** | ❌ |

- **Tự phát hiện crown** qua `tier:'crown'` hoặc regex trên `task` (lương/permission/RLS/secret/finance/ledger/KPI/FSM/DAG/append-only/ADR…). Không cần khai báo tay nếu task có từ khoá.
- **Override per-lane:** `model:'opus'|'sonnet'|'haiku'` (ép model), `skipPlan:true` (bỏ plan dù crown), `tier:'crown'` (ép crown).
- **Xem trước không tốn token:** `args.dryRun:true` → in bảng routing (`lane → model [crown,+plan]`) rồi dừng, không spawn agent.
- `gate` (FULL/LIGHT) **tách bạch** với model — gate quyết cường độ review (§5.5 / CLAUDE.md §6), không quyết model.

**Agent/skill routing + Review stage (Hybrid).** Mỗi lane còn tự nhận đúng reviewer/skill/build-resolver theo domain `task`:

| Domain trên `task` | Reviewer / skill |
| --- | --- |
| DB·migration·RLS·schema·repository | `database-reviewer` |
| permission·secret·encrypt·payroll·audit·auth · **gate=FULL** | `security-reviewer` + `silent-failure-hunter` |
| FE·React·`.tsx`·component·form | `react-reviewer` |
| baseline mọi lane code | `typescript-reviewer` |
| crown-jewel | + `santa-method` · mọi lane + `quality-gate` |
| build/typecheck đỏ | FE→`react-build-resolver` · API/TS→`build-error-resolver` |

- Pipeline 3 stage: **Plan → Implement → Review**. Crown-jewel: stage Review **spawn reviewer agent độc lập** (agentType) trên diff worktree → `mergeVerdicts`; verdict `CRITICAL`/`blocking` ép `needs_human`. Việc thường: reviewer/skill **chèn vào prompt** implementer (không spawn riêng).
- **Auto build-fix:** build/typecheck đỏ → sửa root-cause / route build-resolver TRƯỚC khi báo `needs_human`.
- Field args mới: `reviewers:[...]` (ép danh sách) · `noReview:true` (tắt). `dryRun:true` in cả reviewers/skills/build.

---

# G0 — Quyết định & Thiết kế ✅ ĐÓNG

> **Trạng thái (2026-06-05):** G0 đóng chính thức. Mọi quyết định bất khả nghịch đã thành ADR; scope MVP-0 rõ; harness Claude Code đã wire 6 hook.
>
> Phần thiết kế bất khả nghịch. Solo: **đừng mở code khi G0 chưa khoá** — sửa thiết kế lúc đã có code tốn gấp 10.

- [x] **G0-1** 🧪 (S) Chốt phạm vi **MVP-0** (1 video trọn vòng đời) → [`docs/mvp-0-scope.md`](docs/mvp-0-scope.md). _Solo: tự xác nhận ✅_
- [x] **G0-2** 🧪 ADR (15 file `docs/adr/`) — đã xong.
- [x] **G0-3** 🧪 Spike **Workflow State Machine** → [`docs/spikes/workflow-state-machine.md`](docs/spikes/workflow-state-machine.md).
- [x] **G0-4** 🧪 Spike **Permission Matrix** → [`docs/permission-matrix-spec.md`](docs/permission-matrix-spec.md).
- [x] **G0-5** 🧪 Hạ tầng $0 → [`docs/infra-zero-cost-plan.md`](docs/infra-zero-cost-plan.md).
- [x] **G0-6** 🔧 (S) Harness Claude Code: [`CLAUDE.md`](CLAUDE.md) + 6 hook guardrail wired (PreToolUse: 4 guard · PostToolUse: 2 check). _`agent-sort` → skip (agents: plan-reviewer, completion-evaluator, rls-tenant-isolation-tester đã tạo thủ công)._

✅ **Done khi:** scope MVP-0 rõ với chính bạn; mọi quyết định bất khả nghịch đã thành ADR; có bảng transition + ma trận quyền làm nguồn sự thật.

---

# 🏁 MỐC 1 — LÕI SỐNG (G1 → G4)

> Mục tiêu duy nhất của M1: **một video thật đi từ tạo → task → nộp → duyệt → trả sửa → upload**, pilot 1 team. Mọi thứ khác để sau.

---

## G1 — Bootstrap repo & hạ tầng _(Sprint 0 · 🔧 Setup · ~5–7 ngày)_ ✅ ĐÓNG

> **Trạng thái (2026-06-05):** G1 đã merge vào master cùng G2 qua PR #2. CI xanh (lint + typecheck + build + migrate + 49 integration tests).

- [x] **G1-1** 🔧🟢 (S) Monorepo **pnpm + Turborepo**: `apps/api`, `apps/web`, `packages/contracts` (Zod = nguồn sự thật DTO). → ✅ 3 workspace; `contracts` chuyển **dual-build ESM+CJS** để cả Vite (web) và Nest (api) import được.
- [x] **G1-2** 🔧🟢 (S) **Docker Compose**: Postgres 17 + Valkey 8 + MinIO + **PgBouncer transaction-mode** + `.env.example` (chỉ placeholder). → `docker-compose.yml` (chưa chạy ở máy build; verify qua CI services).
- [x] **G1-3** 🔧🔋 (M) **Drizzle** config + db client (pool qua **PgBouncer** + pool **direct**) + migrator + migration baseline (pgcrypto/citext). Để sẵn **seam `withTenant`** cho G2-2. ⚠️ _PgBouncer × RLS assert hoãn tới khi bật RLS (G2)._
- [x] **G1-4** 🤖🟢 (S) **NestJS skeleton**: zod-env validation (fail-fast, DB optional → boot không cần docker), health-check, response-envelope interceptor, global exception filter (không lộ 5xx), `ZodValidationPipe`. → verify runtime.
- [x] **G1-5** 🤖🟢 (S) **Vite + React 19 skeleton**: TanStack Router (guarded) + Query + Zustand; shadcn/ui (Button/Input) + Tailwind v4 `@theme`; **login mock** → Home đọc health qua contract envelope.
- [x] **G1-6** 🔧🟢 (S) **CI** (`.github/workflows/ci.yml`): install → build → lint → typecheck → test → **apply migration trên Postgres ephemeral** (+ Valkey service).
- [x] **G1-7** 🔧🔋 (S) **Hooks guardrail**: 3 guard bất biến (tenant/immutability/secret) + `anti-bandaid-guard` đã wire vào **PreToolUse**; `format-on-write` + `typecheck-changed` (typecheck đúng 1 workspace qua `pnpm --filter`) wire vào **PostToolUse**. `settings.json` hợp lệ + smoke-test 3 hook OK (BLOCK exit 2 / skip exit 0). _Còn: chạy CI lần đầu xác nhận xanh (cần push)._
- [x] **G1-8** 🔧🟢 (S) **Backup**: `scripts/backup-db.sh` — `pg_dump -Fc` → mã hoá (age/gpg) → `rclone` offsite + retention GFS (tách khoá khỏi dữ liệu).

✅ **DONE** — `pnpm dev` chạy; API health-check OK; web mở màn login mock; CI xanh. Merged vào master.

---

## G2 — Nền bảo mật & đa-tenant _(🛠️ TDD 🔋 · ~10–14 ngày · "thung lũng" phần 1)_ ✅ ĐÓNG

> **Trạng thái (2026-06-05):** G2 đóng chính thức. PR #2 merged vào master. CI xanh (lint + typecheck + build + migrate + 49 integration tests). 62 files, 3330 insertions.

- [x] **G2-1** 🔧🔋 (S) **App DB role** non-superuser, không BYPASSRLS, không owner bảng.
- [x] **G2-2** 🛠️🔋 (M) Wrapper **`withTenant(companyId, fn)`** + `set_config('app.current_company_id',$1,true)`; mọi repo đi qua nó.
- [x] **G2-3** 🛠️🔋 (M) Bảng nền (`companies`, `users`) + **RLS policy** USING+WITH CHECK + FORCE + `company_id NOT NULL` + index + partial-unique soft-delete.
- [x] **G2-4** 🛠️🔋 (L) **Audit log bất biến** + **transactional outbox** + **internal event bus** + dead-letter/alert khi drop.
- [x] **G2-5** 🧪🔋 (M) **Test 2-tenant đối kháng**: seed A & B → mọi path trả 0 row của B khi login A (7 bảng RLS, data-driven).
- [x] **G2-6** 🛠️/🤖 (M) **Auth**: login (`companySlug`+email+password) / refresh / `/me` / forgot-password / reset; argon2id; rotation; rate-limit; audit.

> ⚠️ **Follow-up chưa vá (xử lý trước PROD):** (1) 🔴 Reset token plaintext trong `outbox_events.payload` → envelope-encrypt G6-2. (2) Rate-limit in-memory → Valkey + bucket theo tài khoản. (3) `workerDb` fallback `directPool` → assert `current_user = mediaos_worker` ở prod. (4) `password.verify` catch nuốt lỗi hạ tầng — tách lỗi. (5) Agent `rls-tenant-isolation-tester` chưa tạo.

✅ **DONE** — không đọc chéo tenant; mọi thay đổi quan trọng có audit; outbox/event idempotent + cảnh báo khi drop. Merged master.

---

## G3 — Permission Engine _(🛠️ TDD 🔋 · ~8–12 ngày · "thung lũng" phần 2)_

> Bám [`docs/permission-matrix-spec.md`](docs/permission-matrix-spec.md). Logic khó nhất phần đầu → **dùng Opus**, deny-path RED trước.

- [x] **G3-1** 🤖🟢 (S) Bảng `roles / permissions / role_permissions / user_roles / object_permissions`. _(AI sinh từ ERD)._
- [x] **G3-2** 🛠️🔋 (L) **`PermissionService.can(user, action, objType, objId, ctx)`** — 4 tầng, **quyền nhạy cảm KHÔNG kế thừa**. 52/52 tests GREEN; FULL gate passed (security-reviewer + silent-failure-hunter); security fixes applied: logging trong catch, auditRequired=isSensitive on fail-closed, requiresReauth guard cho non-sensitive branch, effectivelySensitive cross-check từ grant catalog, instanceof Date guard cho expiresAt/reauthValidUntil.
- [x] **G3-3** 🛠️🔋 (M) **Test deny-path TRƯỚC** (RED) cho từng rule. _(`ecc:tdd-guide`)_ — 52 cases (27 deny + 15 allow + 10 audit/reauth/idempotent); tất cả RED chờ G3-2. Files: `src/permission/permission.types.ts`, `permission.service.ts` (stub), `permission.service.spec.ts`.
- [x] **G3-4** 🛠️🔋 (M) Guards `auth → company → permission`; cache permission ở Valkey + **invalidate đúng** khi đổi quyền. Guards: JwtAuthGuard → CompanyGuard → PermissionGuard (fail-closed, @Public bypass, PERMISSION_GUARD_ENABLED kill-switch); CachedPermissionRepository (Valkey TTL 300s, fallback to DB); PermissionCacheInvalidator (permission.changed → DEL cap key); 20/20 tests GREEN. ⚠️ **read/decision-path XONG; mutation-path NỢ G5/G7** (re-review 2026-06-09, [`docs/reviews/g3-gates.md`](docs/reviews/g3-gates.md) §4.1): chưa nơi nào _emit_ `permission.changed`, chưa có endpoint grant/revoke role + `PATCH /permissions/object` → "invalidate <100ms" + "audit 100% mutation quyền" chưa hiện thực (infra sẵn, chờ nối). `grant-object-permission:permission` đã seed phòng-bẫy-F2 ở migration 0031.
- [x] **G3-5** 🤖🟢 (S) FE `<PermissionGate>` + `useCan()` (capabilities từ `/me`). _Chỉ UX — server là sự thật._ `/me` trả `capabilities: Record<string,boolean>` (non-sensitive only); Zustand store + `useCan(action,resourceType)` O(1) wildcard lookup; `<PermissionGate>` với fallback; 14/14 FE tests GREEN.

✅ **Done khi:** user chỉ thấy menu/nút theo quyền; API chặn đúng; đổi quyền có audit + cache invalidate.

---

## G4 — 🏁 MVP-0 Walking Skeleton _(🤖+🛠️ hỗn hợp · ~12–18 ngày · ĐỈNH đầu tiên)_

> Dùng **1 workflow hard-coded** (chưa cần Builder). Đây là lúc bạn **lần đầu thấy hệ thống sống** — phần thưởng sau thung lũng. Xen kẽ 🤖 (nhẹ) và 🛠️ (nặng) trong phase này.

- [x] **G4-1** 🤖🟢 (S) Org/Employee tối thiểu — org_units + teams + team_members; RLS+FORCE+CHECK; NestJS OrgModule (7 endpoints); Zod contracts; FE /org/departments + /org/teams + /org/employees; LIGHT gate passed; commit aca6233. **Re-review 2026-06-09 (G5-FIX F2):** `OrgController` mutations thiếu permission guard (ORG-002/003) — đã vá: 4 route org_unit + **6 route team** gắn `@RequirePermission('manage', <resource>)`, seed+grant ở migration 0030, deny suite `org.permission.spec.ts` 40/40 xanh (commit `4b23ccd`; FULL gate F2 còn chờ). Xem [`docs/reviews/g4-gates.md`](docs/reviews/g4-gates.md) §5.
- [x] **G4-2** 🤖🟢 (M) Channel + Project + Content tối thiểu (project ↔ nhiều kênh; tạo 1 video). BE 9 endpoints + FE 3 trang + sidebar nav; commit 0467216.
- [x] **G4-3** 🛠️🔋 (M) **1 workflow cứng**: Script → Edit → QA → Upload; auto-sinh task. _(custom `workflow-state-machine-guide`)_ — _Hard-code nên đơn giản hơn G7, nhưng vẫn TDD._ FULL gate passed; deny-path RED→GREEN (23 tests); workflow FSM + 4-step + auto-task + submit; global JWT+Company guards wired; 125 tests green. **Close-out 2026-06-09:** thêm FE board "Sản xuất" (content-detail) + `POST /workflow/start` từ UI + `POST /workflow/steps/:id/assign` (gán assignee/reviewer, FULL `@RequirePermission update content`) + `GET /workflow/by-content/:id`; trước đó lifecycle chỉ chạy qua API/E2E.
- [x] **G4-4** 🤖🟢 (M) My Tasks + submit work (**chỉ link**, file đính kèm descoped) + comment. _(`ecc:tdd-workflow`)_ — GET /tasks (tasks table, joined step+content), POST /tasks/:id/comments + GET comments; FE /tasks page (2-panel: list + detail), SubmitWorkForm (link+note→submitStep), CommentThread; submission_url/note on workflow_steps; migration 0009; typecheck+125 tests green. ⚠️ **`task_attachments` descoped** (close-out 2026-06-09) — không upload file, chỉ link.
- [x] **G4-5** 🛠️🔋 (M) **Approval 1 cấp** + **return revision**. TDD: 12 deny+happy tests RED→GREEN; validateConsumerTransition added to FSM; ApprovalService (approve T3, requestRevision T4 + defect + revision task); repository: approvalSteps, closeApprovalRequest, advanceInstanceStepOrder, completeWorkflowInstance, createDefect, findMaxStepOrder; 3 endpoints (GET/POST approval-requests); FE: "Chờ duyệt" tab with ApprovalCard (approve / trả về form); 137 API + 17 web tests green, typecheck clean.
- [x] **G4-6** 🤖🟢 (M) Notification cơ bản + 1 group chat project (auto-tạo). _(migration 0010: 4 bảng RLS; BE NotificationsModule + ChatModule; auto-create project chat room khi tạo project; FE NotificationBell (poll 30s) + /chat/projects/:id; LIGHT gate passed, 3 HIGH fixes applied; typecheck + 154 tests xanh)_
- [x] **G4-7** 🧪🟢 (M) **E2E**: 1 video đi trọn vòng đời; chạy lại test isolation G2-5. _(17-test E2E spec: Script→Edit→QA→Upload lifecycle + revision flow + tenant isolation cross-check; G2-5 harness mở rộng thêm 22 bảng G4 với idColumn/skipNoContext; fix 3 production bugs: auth.controller.ts thiếu @Public(), audit_logs CHECK constraint, route ordering approval-requests vs :instanceId; fix 2 migration bugs: task_comments thiếu GRANT + policy thiếu NULLIF; 282 tests xanh, LIGHT gate passed)_
- [x] **G4-8** 🔧 (S) **Triển khai pilot 1 team thật**; thu feedback. _(deploy checklist → [`docs/pilot/deploy-checklist.md`](docs/pilot/deploy-checklist.md); feedback form → [`docs/pilot/feedback-template.md`](docs/pilot/feedback-template.md))._

✅ **Done khi:** một video thật đi tạo → task → nộp → duyệt → trả sửa → upload; **pilot team dùng được**. 🎉 _Ăn mừng — bạn vừa qua phần khó nhất về mặt tâm lý._

> **Process close-out (2026-06-09):** 2 nợ quy trình (CLAUDE.md §6) đã vá:
>
> 1. **Coverage ≥80% module nhạy cảm (G4-3 FSM + G4-5 approval) — ĐÃ ENFORCE.** Cài `@vitest/coverage-v8@3`; threshold **scoped per-file** trong `apps/api/vitest.config.ts` cho `workflow-fsm.service.ts` + `approval.service.ts` (KHÔNG phủ cả `src/workflow/**` để tránh đỏ oan các file chỉ có DB-test). Bổ sung 6 test → `approval.service.ts` branch **69.5% → 86.6%** (không hạ ngưỡng). Lệnh gate: `pnpm --filter @mediaos/api test:cov`. FSM 94/90/100/94 · approval 98/86/86/98 — đều ≥80%.
> 2. **Review-gate artifact — ĐÃ TẠO** → [`docs/reviews/g4-gates.md`](docs/reviews/g4-gates.md) (G4-1..G4-8: gate level, reviewer §7, trạng thái, fix đã áp).
>
> ⚠️ _Quan sát (KHÔNG thuộc 2 việc trên):_ `apps/api/test/workflow-lifecycle.e2e-spec.ts` hiện **đỏ ở bootstrap** vì thay đổi **chưa commit** ở working tree — `OrgController` đã thêm `@UseGuards(PermissionGuard)` nhưng `OrgModule` chưa `import PermissionModule` → Nest không resolve được `PermissionService`. 17 test e2e vốn `skipIf(!DATABASE_URL)` nhưng suite compile ném trước. Fix 1 dòng (thêm `PermissionModule` vào `OrgModule.imports`) — để chủ WIP org-permission xử lý, không sửa trong phiên này.

---

# MỐC 2 — SẢN XUẤT THẬT (G5 · G6 · G7 · G9)

> Sau M1 hãy **nghỉ lấy đà**, rồi vào M2. Mở đầu bằng G5 (🟢 toàn AI-bulk) để hồi sức trước khi đụng G7.

---

## G5 — Tổ chức & Nhân sự đầy đủ _(🤖 AI-bulk 🟢 · ~6–10 ngày · cụm hồi sức)_

> Gần như **toàn bộ sinh từ ERD**. Solo: đây là chỗ AI cày, bạn duyệt. Tận hưởng cụm nhẹ.

- [x] **G5-1** 🤖🟢 (S) Company Settings: logo, múi giờ, tiền tệ, ngôn ngữ, ngày làm việc, cấu hình kỳ lương.
- [x] **G5-2** 🤖🟢 (M) Org tree phòng ban/khối cha–con + **Sơ đồ tổ chức** (cây). _(PRD ORG-002)_
- [x] **G5-3** 🤖🟢 (M) Team/Ekip + `team_members` — **1 nhân sự nhiều team** (ORG-003, EMP-002).
- [x] **G5-4** 🤖🟢 (S) Chức vụ (Position) + gán role mặc định theo chức vụ.
- [x] **G5-5** 🤖🟢 (M) Employee profile đầy đủ (tabs) + **import nhân sự**; lương **mask theo quyền** (server mask, không phải client).

**DB:** `companies` `org_units` `teams` `team_members` `positions` `employee_profiles`
**Màn:** Company Settings · Org Chart · Department/Team/Position List · Employee List/Detail
✅ **Done:** cấu trúc công ty đa cấp; 1 nhân sự nhiều team; import nhân sự; nhân viên chỉ xem dữ liệu cá nhân.

> **G5-FIX ĐÓNG (2026-06-09, branch `feat/g5-fix`):** rà soát phát hiện G5 ban đầu nợ (salary audit không gọi, thiếu guard Org/Team, 0 test, FE thiếu) → vá F1–F13 (plan §14). **FULL gate F1/F2/F4 PASS — 0 CRITICAL** (security/database/silent-failure reviewer; commit `a2e2d09`). Test: full API **510 pass/2 skip**, G2-5 2-tenant regression (tenant-isolation.int-spec) **132 pass**, salary mask 100% (30), api+web typecheck xanh. harness-audit 25/29 (2 fail = evals/ + SECURITY.md, hygiene toàn repo ngoài scope G5). Residual: createEmployee salary lúc tạo **đã vá** (`d1927d0`, gác update-salary + audit, re-gate PASS); còn 1 MEDIUM non-blocking (baseSalary trong LIST_COLUMNS defense-in-depth) → ticket. **Còn lại:** merge `feat/g5-fix`.

---

## G6 — Media: Channel · Account · Project · Content _(🤖 + 🛠️ G6-2 · ~10–14 ngày)_

> Phần lớn 🤖, **trừ G6-2** là crown-jewel 🔋 (mã hoá tài khoản kênh). Đừng để AI tự do ở G6-2.
>
> **Trạng thái (2026-06-06):** Plan chi tiết xong + `plan-reviewer` **PASS** (không còn BLOCKING) → [`docs/plans/G6-media-full.md`](docs/plans/G6-media-full.md). Migration **0020–0028** (latest hiện tại 0019). Micro-step + đặc tả G6-2 envelope encryption nằm trong plan; theo plan, KHÔNG theo dòng tóm tắt dưới đây.
> ⚠️ **2 bước bắt buộc plan-reviewer chèn thêm:** (1) **`2e0`** vá `PermissionGuard` forward `resourceId`+`ctx` + **fail-closed 403** khi action sensitive thiếu resourceId — TRƯỚC khi mở reveal-secret (nếu không → bypass Tầng-3 object_permissions). (2) **`1a-bis`** mở rộng `test/integration/rls-registry.ts` thêm ~10 bảng G6 vào harness 2-tenant TRƯỚC khi tuyên bố G2-5 xanh (tránh xanh-giả).
> **Thứ tự bắt đầu:** `0a` (migration 0020 audit object_types) → `1a-bis` (mở rộng RLS harness) → G6-1 → … → `2e0` (vá guard) → G6-2.

- [x] **G6-1** 🤖🟢 (M) Platform + Channel + `channel_members` + gán Manager/team; lọc theo nền tảng/trạng thái. _(BE 1a–1d `8a9fbe3`/`c5060aa`; FE 1e `f4a07d2`: list+filter+TanStack Table, detail tabs Overview/Members, members CRUD)._
- [x] **G6-2** 🛠️🔋 (L) 🔒 **Platform Account Encryption** (envelope + KMS/Vault, mã hoá app-side; `reveal-secret` + re-auth + **audit mỗi lần xem/sửa**). **FULL gate.** _(custom `secret-encryption-reviewer`; `ecc:security-reviewer` + `ecc:database-reviewer`)._ **✅ ĐÃ LAND MASTER** — toàn bộ G6 (migration 0020–0029, gồm 0022 `platform_accounts` envelope) nằm trong master; `bf4362c` là tổ tiên master (verify 2026-06-12). _(gates pre-merge XONG + e2e G4-7 xanh `259586c`.)_
  - ✅ **Build 2a–2h XONG** (chi tiết + carry-forward → handoff §4.5; per-step FULL gate đều 0 CRIT):
    - **2a** `17f9722` migration 0022 (`platform_accounts` 8-cột envelope + worker policy + column-grant · `encryption_keys` global · `channel_accounts`; journal idx27/when30000; +hardening octet_length IV/tag).
    - **2b+2c** `831b986`/`86c074a` 39 RED deny-path + NodeEnvelopeCipher (AES-256-GCM) + SecretEncryptionService (AAD pinned `companyId‖recordId‖encAlgo‖dekKeyVersion`, app-gen uuid, dek zeroize) + Local/VaultKekProvider + CryptoModule (ngoài app.module).
    - **2e0** `61b9197` PermissionGuard forward resourceId+ctx + F2 object-grant fail-closed (deny-object-required; 80/80 permission).
    - **2e** `448b252`/`95a6130` service (reauth/reveal/list/masked + audit-in-tx **kể cả deny** + `secret_reveal_failed`) + HTTP (Controller + ReauthGuard per-(userId,accountId)) · FULL gate `36fbbd9` (security+database+silent-failure + santa) 0 CRIT.
    - **2d** `13321a6` migration 0027 (`edit-platform-account` sensitive + channel-manager metadata grant; sensitive KHÔNG vào role hệ thống).
    - **2f** `652c91b`/`cb92ae8` migration 0028/0029 reset-token envelope + scrub outbox + trigger; FULL gate (silent-failure+security) 0 blocker. Residual M1 (bỏ email khỏi outbox payload)/M3 (scrub email khỏi log) FIX + M2 (decryptResetToken `@internal`) `d556ce7`.
    - **2g** `d8ef592`/`617d985` rotation worker (DECISION A: `dek_key_version` = seal version **bất biến**; rotation chỉ đổi `kms_key_id`/`encrypted_dek`/`last_rotated_at`) + hardening 5 finding; RED 13 7/7. Doc plan §6d đính chính `851e495`.
    - **2h** `eaf99bf` FE company-wide `/settings/platform-accounts` (reveal+reauth; plaintext CHỈ state local, clear khi ẩn/blur/auto-hide60s/unmount; LIGHT gate 0 CRIT). ⚠️ e2e DEFER→G2-6 (FE chưa auth thật).
  - ⏳ **Trước merge (nợ):** `ecc:harness-audit` + `ecc:security-scan` (**CHƯA chạy** — kiểm soát cost, HỎI user) · M2 guard runtime cứng deferred → đi cùng mail-consumer · `ecc:santa-method` **BỎ** (2 reviewer đã hội tụ).
- [x] **G6-3** 🤖🟢 (S) Project ERD-full: gắn **nhiều kênh · nhiều team · nhiều thành viên** (PRJ-002/003/004, BR-003). _(3a migration 0023 `6a380a1`; 3bc contracts+BE `e335795`; 3d FE `c41039c`; FULL-gate fix `9e583dc`. Migrate→tenant-isolation 118 pass+rls-guards→typecheck/lint/build xanh; app boot routes /projects* OK. ⚠️ chưa render live (auth header chưa wa FE-wide — pre-existing). Bonus: vá lỗ rls-registry G5 `d5021ba`.)_
- [x] **G6-4** 🤖🟢 (M) Content/Video: đăng **đa kênh**, content type, asset + version, gợi ý workflow theo content type. _(Migration 0024 content_types + 0025 content_items ERD-full (breaking content_type text→content_type_id FK; data-migration NOT EXISTS seed + backfill + GUARD NULL) + 0026 content_channels/content_assets (version chain one-current uq). BE: ContentController/Service/Repository tách (CRUD + đa kênh publish snapshot platform_id + asset version chain demote→insert→supersede 1-tx + soft-delete current flip + suggest-workflow + audit + cross-tenant guard in-tx); gỡ content khỏi Media\*. FE: /content list + /content/$id tabs (Tổng quan/Kênh đăng/Asset version) + content-api + CreateContentDialog. FULL gate (database+security+silent-failure) → fix query validation/version-chain guards/owner chéo tenant `7c008ce`. typecheck 4 + content.int 10 + rls-guards 3 + tenant-isolation 126 + web lint/build xanh. ⚠️ chưa render live.)_
- [x] **G6-5** 🤖🟢 (S) Channel Health (score/status, risk note) → feed Dashboard. _(KHÔNG migration — cột health_* có sẵn ở 0021. 5a BE: `PATCH /channels/:id/health` + audit `ChannelHealthUpdated` + filter risk (health_status ∈ risk/declining); 5b FE: tab "Sức khỏe" (form gated update:channel) + filter "Chỉ kênh rủi ro" + widget Dashboard "Kênh rủi ro". LIGHT gate: typecheck 3 pkg + lint 0 error + 17 web test + vite build xanh. ⚠️ chưa render live.)_

**DB:** `platforms` `channels` `platform_accounts` `channel_accounts` `channel_members` `projects` `project_channels` `project_teams` `project_members` `content_types` `content_items` `content_channels` `content_assets`
**Màn:** Channel List/Detail · Channel Account Tab · Project List/Detail · Content List/Detail · Asset Manager
✅ **Done:** quản lý ~100 kênh; tài khoản kênh mã hoá (re-auth + audit); project nhiều kênh/content; 1 content đăng nhiều kênh.

---

## G7 — Workflow Builder đầy đủ _(🛠️ TDD 🔋 · ~14–20 ngày · MOAT lớn nhất)_

> Phần **custom giá trị nhất** — không nền tảng nào thay được. Bám spike [`workflow-state-machine.md`](docs/spikes/workflow-state-machine.md). Cụm 🔋 dài nhất M2 → chia nhỏ, mỗi ngày 1 viên.

- [x] **G7-1** 🤖🟢 (M) `workflow_templates` + `step_templates` + `step_dependencies` (cấu hình người/role/team/reviewer/checklist/file mặc định). _(BR-004: KHÔNG hard-code workflow)._ — 1a (mig 0032 DAG/checklist) + 1c CRUD (mig 0033) + DagValidator (2a).
- [x] **G7-2** 🛠️🔋 (L) **Canvas React Flow**: node/edge, bước **song song & tuần tự**, dependency DAG, nháp/publish/nhân bản. _(custom FSM designer; `ecc:a11y-architect`)_ — 2b publish/clone lifecycle (DAG gate) + FE Track C canvas/templates.
- [x] **G7-3** 🛠️🔋 (L) Workflow Instance + step instance + **auto-sinh task idempotent** khi áp vào content/project. — 3a (mig 0034) + 3b applyTemplate + 3c FSM/DAG approve+revision (FOR UPDATE race-safety).
- [x] **G7-4** 🛠️🔋 (L) **"Khoá phần liên quan"** (lock theo dependency, không khoá toàn workflow) + checklist + evaluation hook. _(WF-003, APR-004, BR-006)._ — 4a LockPropagation (mig 0035) + 4b checklist enforcement + 4c eval-hook (mig 0036) + FE checklist UI.

**DB:** `workflow_templates` `workflow_step_templates` `workflow_step_dependencies` `workflow_instances` `workflow_step_instances` `checklists` `checklist_items`
**Màn:** Workflow Template List · Workflow Builder · Step Config · Instance View
✅ **Done:** builder tạo bước song song/tuần tự + dependency; áp vào content sinh task idempotent; lỗi chỉ khoá phần liên quan.

> **Gate TỔNG + PR (2026-06-12):** spine 1a→4c + FE Track C đã hội tụ trên `feat/g7-workflow`, **merge `master` (G5-fix) + reconcile migration** (drop `0030` redundant, rename g3fix→`0037`, journal đơn điệu; chain `0000→0037` apply sạch). Gate HOLISTIC: **BE B1 FOCUSED** (security+database+silent-failure) → fix **S2** (null-reviewer fail-open→tự duyệt, FAIL-CLOSED) + **D4** (requestRevision race-safety) + SF3/SF5 → **santa dual-review cả 2 PASS**; **FE LIGHT** (checklist mirror fail-closed khi load + canvas a11y). Verify XANH: BE typecheck · unit 427 · int 284+2skip · e2e 17 · FE typecheck/test 133/build. Dấu vết: [`docs/reviews/g7-gates.md`](docs/reviews/g7-gates.md) (+ residual §4: S1 RBAC-layer, TS-HIGH2 editor-gate, FE a11y hardening). **PR `feat/g7-workflow` → `master`** (đã push, branch ahead origin). Commits: `32ac739` merge · `2fbe7d0` S2/D4/SF3/SF5 · `0c0e88d` santa coverage · `e9e93c7` FE · `cff1994` review-log.

---

## G9 — 🧩 Task Hub hợp nhất _(🛠️+🤖 · ~8–12 ngày · bất biến #4)_

> Làm **trước** G8/G10/G11/G13 để các module sau chỉ **emit vào đây**. G9-1 là 🛠️ (contract test), phần còn lại 🤖.
>
> **🌳 TRUNK song song (§5.4):** **G9-1 đã land master** (`d58d465`, merge --no-ff; feat `0c5d4b0` + docs `0d5f490`) — đó là điểm các lane G8/G10/G11/G13 branch/rebase lại. G9-2/3/4 (giao việc tay · Task Board · gộp nguồn) chạy song song như lane thường trong band `0040s`.

- [x] **G9-1** 🛠️🔋 (M) Chuẩn hoá `tasks` nhận đủ **7 `task_type`** (`production·review·revision·meeting_action·office·finance·hr`) + giữ `workflow_step` back-compat (8 loại); `project_id/content_item_id/workflow_instance_id` **nullable**. **Contract-test: task non-video tạo được mà không cần video.** — **mig 0040** (idx 38 / when 1717500050000, ADR-0024 widen-CHECK no-data-migrate); contract 18 test GREEN · typecheck 4/4 · api unit 427/427; **gate FULL PASS** (security+database+silent-failure + adversarial verify, vá SF-1 `listByTeam` lọc soft-deleted member). Tầng repo/service (`createTask`/`list*`/`updateStatus`/`softDelete` + audit + deny-path workflow-task) làm **nền G9-2/3/4 — CHƯA nối controller**. Latent chuyển G9-2: SEC-1 tenant-FK guard · DB-8/SF-2 pagination · SEC-2 status-typing. **Land #1 — merged `d58d465` (PR #4, --no-ff).**
- [x] **G9-2** 🤖🟢 (S) **Giao việc tay** (`task_type=office`): tạo task thủ công ngoài workflow (TASK-001). — **BE+FE ✅ land #2** (`9ba1eda`, rebase lên master): `POST /tasks` gate `create:task` + **SEC-1** tenant-FK guard in-tx · `PATCH /tasks/:id/status` gate `update:task` + **SEC-2** status thu hẹp `OfficeTaskStatusDto` · `DELETE /tasks/:id` soft-delete gate `delete:task` · `POST .../comments` gate `comment:comment` (vá H-1) · audit-in-tx · **DB-8/SF-2** pagination + `page` threaded · FE 2d `CreateTaskDialog` "Giao việc tay" + `<PermissionGate create:task>`. typecheck sạch · **api 456/456 · web 133/133** · **gate PASS** (security-reviewer + silent-failure-hunter + adversarial verify; CRITICAL=0; defer→handoff). Attachments hoãn (bảng + storage chưa land).
- [x] **G9-3** 🤖🟢 (L) **Task Board tổng**: Kanban/Table/Calendar; **filter theo `task_type`**; view Office Tasks; **luồng rút gọn** (Chưa bắt đầu→Đang làm→Hoàn thành) cho task không có vòng duyệt. — **BE+FE ✅** (wip checkpoint, lane G9 band 0040s, KHÔNG migration mới): `GET /tasks/board` gate `read:task` (PermissionGuard) + `ListTasksQueryDto`(clamp limit≤200/offset≥0) → `service.listBoard` (đã có nền G9-1; chỉ wire controller, KHÔNG sửa repo). Contracts: `listTasksQuerySchema` (nguồn sự thật DTO). FE: `/tasks/board` (router+nav additive) — 3 view Kanban/Table(TanStack v8)/Calendar + `TaskTypeFilter` (7+1 loại, sub-view Office Tasks) + `OfficeTaskStatus` luồng rút gọn 3-status bọc `<PermissionGate update:task>` (chỉ render cho task workflowStep==null & taskType∉FSM — mirror BE SEC-2). DRY: extract `task-status-constants.ts` (TASK_STATUS_LABELS/COLORS + TASK_TYPE_LABELS). **RED trước**: board deny-path gate (read:task) + listBoard forward-filter + FE filter/luồng-rút-gọn. Verify DB-cô-lập `mediaos_g9`: api tasks 42/42 (board int-spec 7/7 gồm **2-tenant isolation** A/B) · web 141/141 (+8) · typecheck api+web sạch · lint 0 error · prettier sạch. LIGHT gate PASS. ⚠️ 4 fail int-spec G6-2/G2-6 (reset-token-envelope/secret-rotation/platform-reveal/auth) là **baseline môi trường** (KEK/crypto) — fail như nhau trên master sạch, KHÔNG do G9-3 (diff không chạm auth/secret/crypto). _Deviation: date-fns chưa nằm deps web → Calendar dùng Intl `toLocaleDateString("vi-VN")` như phần còn lại codebase (tránh churn lockfile xuyên lane); vẫn UTC-safe qua day-key ổn định._
- [x] **G9-4** 🤖🟢 (M) My/Team/Project Tasks **gộp tất cả nguồn**; card có badge loại + bối cảnh điều kiện. — **BE+FE ✅ merged `15e8256` (--no-ff)**, lane g9-4 band `0040s`, KHÔNG migration mới: 3 view My/Team/Project trên bảng `tasks` hợp nhất; endpoint `GET /tasks/my|team/:id|project/:id` gate `read:task` + pagination limit/offset (Team/Project); badge `task_type` + ngữ cảnh từ `task-status-constants` (TASK_TYPE_LABELS — không hard-code); `<PermissionGate read:task>` cho Team/Project + loading/error/empty mỗi tab. **RED trước** (BE aggregation + FE gate/tab). Verify DB-cô-lập `mediaos_g94`: api tasks-service 17 + permissions 22 + board int 7 (836 pass) · web 184 (task-hub 9) · typecheck api+web sạch. LIGHT gate PASS.

**DB:** `tasks` `task_comments` `task_attachments`
**Màn:** Task Board (Kanban/Table/Calendar) · Task Detail Drawer · My/Team/Project/Office Tasks
✅ **Done:** giao việc tay được; Task Board đủ 7 loại; lọc theo loại; office task đi luồng rút gọn; **không module nào có bảng task riêng**.

---

# MỐC 3 — CHẤT LƯỢNG & GIAO TIẾP (G8 · G10)

---

## G8 — Approval · Defect · Evaluation · KPI _(🛠️+🤖 · ~12–16 ngày)_

> `approval_requests` = **nguồn sự thật duy nhất** (ADR 0016), step = projection. **Deny-path TRƯỚC.**

- [x] **G8-1** 🛠️🔋 (M) Approval **1–3 cấp** (cấp sau mở khi cấp trước đạt) + **Approval Inbox đa loại**. _(APR-001/002)._ — **✅ MERGED master (`7856e88` --no-ff).**
- [x] **G8-2** 🛠️🔋 (M) Defect/Revision: chọn **bước lỗi + người chịu trách nhiệm + loại lỗi**, khoá liên quan, **sinh revision task**, defect history. _(BR-005, APR-003/005)._ — **✅ MERGED master (`2813ac2`).**
- [x] **G8-3** 🤖🟢 (M) Evaluation: template + tiêu chí + trọng số + chấm điểm gắn workflow step. — **BE ✅ MERGED (`e6ddb5f`)** (lane g8, band 0080s): mig **0083** (4 bảng evaluation_templates/criteria/results/scores · RLS+FORCE+WITH CHECK · results/scores GRANT SELECT,INSERT ONLY append-only · uq(result,criteria) idempotent · FK workflow_steps đọc) → **0084** (audit CHECK UNION + 'evaluation_template'/'evaluation_result', không drop type lane khác) → **0085** (seed manage:evaluation-template + score:evaluation, hyphen, grant admin). `_journal` **idx57-59 when 1717500120000+** (reconcile khi land: nối SAU master max idx56/when 1717500112000 = G12 0092, đơn điệu tăng). ⚠️ 0084 là CHECK re-stamp CUỐI → UNION 47 type (45 từ 0090_g12 incl `salary_profile` + evaluation_template/result). Schema Drizzle + AUDIT_OBJECT_TYPES cùng commit · contracts Zod nguồn sự thật · Repository (withTenant, soft-delete template/criteria, append-only insert results/scores) · Service (validate tổng trọng số=100 + score∈[min,max] + phủ đủ tiêu chí · totalScore có trọng số · audit+outbox CÙNG tx khi chấm · mapError 23505→409) · Controller (PermissionGuard manage/score) + Module + app.module + rls-registry (+4 bảng). **RED trước**: contract 13 + service deny E1–E6 9 + int-spec RLS-2tenant/append-only/permission/audit/WITH-CHECK 9. Verify DB-cô-lập `mediaos_g8` (chain 0000→0085 sạch): api evaluation 18/18 · contracts 13/13 · tenant-isolation 199 · rls-guards 3 · typecheck+prettier+lint sạch. LIGHT gate PASS (DB+security+silent-failure self-review, CRITICAL=0). KHÔNG đụng KPI (G8-4).
- [ ] **G8-4** 🛠️/🤖 (M) KPI cá nhân/team (task xong · đúng deadline · điểm · lỗi loại 1/2 · tỷ lệ duyệt lần đầu). **Ban đầu = tham khảo**, HR/quản lý xác nhận trước khi vào lương (BR-007). _Công thức KPI = test kỹ._

**DB:** `approval_rules` `approval_requests` `approval_steps` `defects` `defect_histories` `evaluation_templates` `evaluation_criteria` `evaluation_results` `evaluation_scores` `kpi_definitions` `kpi_results` `performance_reviews`
**Màn:** Approval Inbox/Detail · Defect Center/Detail · Evaluation Builder/Result · KPI Individual/Team
✅ **Done:** duyệt 1–3 cấp; trả sửa đúng người-đúng bước; chấm điểm; KPI khoá theo kỳ.

---

## G10 — Communication: Chat · Notification · Meeting _(🤖 + 🛠️ realtime · ~10–14 ngày)_

> G10-1 là 🛠️ (WS phải qua cùng masking như REST). Còn lại 🤖.

- [x] **G10-1** 🛠️🔋 (L) Chat realtime 1-1 + group (Socket.IO + Valkey adapter, room `co:{companyId}:…`); text/file/mention/ghim. **WS qua cùng DTO/masking như REST — cấm `io.emit` thẳng row.** _(custom `realtime-test-harness`)._ — **✅ MERGED master (`7ec6aaa`).**
- [x] **G10-2** 🤖🟢 (S) Auto group chat theo project/kênh/phòng ban (CHAT-003). — **BE ✅** (wip checkpoint, lane g10 band 0050s, KHÔNG migration mới — cột channel_id/org_unit_id + partial-unique `chat_rooms_channel_uq`/`chat_rooms_org_unit_uq` đã land ở 0050). `ChatService.ensureChannelRoom`/`ensureOrgUnitRoom` (mirror `ensureProjectRoom`): check-then-insert idempotent + re-select onConflict (TOCTOU-safe) + `addMembers` bulk dedupe; best-effort try/catch→log→null (KHÔNG throw, parity project). Wiring: `media.createChannel` gọi `ensureChannelRoom` SAU commit tx (non-critical, lỗi room không rollback channel) với member-set = creator + `listChannelMembers`; `org.createOrgUnit` gọi `ensureOrgUnitRoom` với head + `listOrgUnitMemberUserIds` (employee_profiles.org_unit_id). MediaModule/OrgModule imports ChatModule. Mọi truy vấn qua `withTenant(companyId)` → RLS+FORCE company_id. **RED trước**: chat-auto-room.int-spec (idempotent channel+org + member-set + **TENANT ISOLATION A/B** deny-path + best-effort no-rollback) + chat.service.spec unit (idempotent/best-effort/TOCTOU). Verify DB-cô-lập `mediaos_g10`: spec mới 7+7 xanh · **full api 1008 pass/2 skip** (0 fail) · typecheck sạch · lint 0 error · prettier sạch. LIGHT gate PASS (typescript + DB/security/silent-failure self-review: append-only chỉ INSERT room/member, không secret, idempotent partial-unique). ⚠️ Scope: auto-create CHỈ lúc tạo entity; backfill member khi entity thêm member SAU = ngoài scope G10-2. _Auto group chat theo PROJECT đã có sẵn từ G4-6 (`ensureProjectRoom`)._
- [x] **G10-3** 🤖🟢 (M) Notification Center + rules (NOTI-001). — **✅ MERGED master** (`8cf0f6c` --no-ff, §5.4): `notification_rules` + `notification_preferences` (RLS+FORCE+tenant policy, REVOKE UPDATE/DELETE = append-only), `NotificationsService` preference-filter + transactional outbox + audit + WS emit qua `notificationSchema.parse` (masking server-side), preference endpoints. Mig `0051` band 0050s, journal idx **61** (when 1717500124000 > master max). **Reconcile land:** seed fix (permissions `(action,resource_type,is_sensitive)` thay vì `(name,description)` + bỏ DO-block audit-CHECK hỏng — types đã có sẵn union master; `cf21f5c`) + RLS tenant-iso int-spec + đăng ký rls-harness (`a1ec2ea`). Verify chain `0000→latest` sạch + **full api 1138 pass**. _Thông báo bắt buộc không tắt (NOTI-002) còn lại ☐._
- [x] **G10-4** 🤖🟢 (M) Meeting + biên bản + **task sau họp** → ghi vào **Task Hub G9** (`task_type=meeting_action`), KHÔNG bảng riêng. — **✅ MERGED master (`cfab97e`): booking + double-booking guard + RLS tenant-iso + masking.**

**DB:** `chat_rooms` `chat_members` `messages` `notifications` `notification_rules` `notification_preferences` `meeting_rooms` `meetings` `meeting_attendees` `meeting_notes` `meeting_tasks` (chỉ liên kết meeting↔tasks)
**Màn:** Chat · Notification Center/Rule · Meeting Calendar/Room/Detail/Notes
✅ **Done:** chat realtime; group tự động; noti bắt buộc; **task sau họp xuất hiện trên Task Board chung**.

---

# MỐC 4 — HR · LƯƠNG · TÀI CHÍNH (G11 · G12 · G13)

> Mốc nặng tâm lý nhất sau M1. Mở bằng G11 (🟢) trước khi vào G12 (🔋🔋 crown jewel).

---

## G11 — HR: Attendance · Leave _(🤖 AI-bulk 🟢 · ~6–10 ngày · cụm hồi sức)_

- [x] **G11-1** 🤖🟢 (M) Attendance: check-in/out web+mobile, ca làm, đi muộn/về sớm, **đơn bổ sung công → duyệt qua Task Hub** (`task_type=hr`), khoá kỳ công. **Timezone-correct (ADR 0008).** _(GX-7)._ — **✅ merged `ebce54a`** (BE `6181a05` + FE `feat/g11-fe`); verify DB-cô-lập `mediaos_g11` 229 pass; gate vá F1–F5 `82fd27f`; **hardening F7 period-lock `1a05e4f`** (trigger chặn locked→open trước G12); **F6 pagination + F8 cleanup `1e7c5bf`**.
- [x] **G11-2** 🤖🟢 (M) Leave: loại nghỉ, số phép, **đơn nghỉ → duyệt qua Task Hub** (`task_type=hr`), trừ phép, lịch nghỉ team. — **✅ merged `ebce54a`** (leave `4b7ea4a` + FE); F6 pagination `findRequests` limit/offset land `1e7c5bf`.

**DB:** `work_schedules` `attendance_records` `attendance_adjustment_requests` `leave_types` `leave_requests` `leave_balances`
**Màn:** Attendance Dashboard/Monthly · Adjustment Requests · Leave Requests/Calendar
✅ **Done:** chấm công mobile; đơn bổ sung/nghỉ duyệt qua Task Hub; trừ phép đúng; dữ liệu công feed payroll.

---

## G12 — Payroll · Bonus/Penalty _(🛠️ TDD 🔋🔋 · ~12–18 ngày · CROWN JEWEL)_

> **FULL gate + `ecc:santa-method`.** Snapshot **bất biến** (ADR 0005); **khoá kỳ KPI trước khi chạy lương**. Đây là phase **rủi ro cao nhất** — sai = mất tiền/mất niềm tin. Đi chậm, test dày.

- [x] **G12-1** 🛠️🔋 (M) Salary profile (lương cơ bản/loại/chu kỳ/hiệu lực/phụ cấp) — chỉ người có quyền xem/sửa, **audit khi sửa**. **✅ MERGED master** (`1ec560e` --no-ff, 2026-06-13; band 0090–0092 idx 54–56; post-merge audit-CHECK = superset 45-type, 2 gate fix `edef897`: schema index drift + HttpException passthrough). **BE ✅** (`7b4d011`): schema 0090–0092 (RLS+FORCE, audit-CHECK superset 32, perms is_sensitive grant TAY admin+hr) · service mask + reveal⟹audit-in-tx + rollback atomic + mapError no-leak · controller `@RequirePermission isSensitive` mỗi route · verify DB cô lập `mediaos_g12` (salary-profile 34 + rls-guards 3 + contracts 14) · FULL gate self-review 0 CRIT. **FE ✅** (wip): trang `/payroll/salary-profiles` mask-by-default (`•••`/"Không có quyền") + `CreateSalaryProfileDialog` bọc `<PermissionGate manage-salary-profile>` + `salary-profile-api` (schema nullable=masked) + router/nav additive; **9 RED→GREEN** (api 6 + table mask 3); web 184 pass · typecheck/lint(0err)/prettier sạch · **santa dual-review B∧C PASS** (client never-unmask · cap không unmask · gate fail-safe). Dấu vết [`docs/reviews/g12-gates.md`](docs/reviews/g12-gates.md). **Còn:** FE detail/edit (PATCH+phụ cấp inline) → G12-4 · merge Wave B (§5.1, chờ G8 KPI + G11 attendance).
- [ ] **G12-2** 🛠️🔋🔋 (L) Payroll period + payslip: công/KPI/thưởng/phạt → **payslip snapshot append-only** (app role không UPDATE/DELETE). _(custom `payroll-snapshot-immutability-guard`)._
- [ ] **G12-3** 🛠️🔋 (M) Bonus/Penalty: thủ công + từ KPI/lỗi, gắn reference task/defect/KPI, duyệt.
- [ ] **G12-4** 🛠️🔋 (M) Duyệt bảng lương (draft→duyệt→phát hành) + nhân viên xác nhận/khiếu nại; **re-auth khi xem payslip**.

**DB:** `salary_profiles` `payroll_periods` `payslips` `payslip_items` `bonus_penalties` _(payslip/snapshot = append-only)_
**Màn:** Salary Profile · Payroll Period · Payslip List/Detail · Bonus/Penalty · Payroll Approval
✅ **Done:** payslip snapshot bất biến; duyệt trước phát hành; mọi sửa có audit; KPI khoá trước khi vào lương.

---

## G13 — Finance: Revenue · Cost · Profit _(🛠️+🤖 · ~8–12 ngày)_

> Append-only (revenue/cost/profit). G13-1/G13-3 là 🛠️, còn lại 🤖.

- [~] **G13-1** 🛠️🔋 (M) Revenue nhập tay, gắn nền tảng/kênh/project/video, file đính kèm, **audit khi sửa/xoá** (append-only `revenue_records`). **Service/repo/module XANH trên DB cô lập `mediaos_g13`** (deny-path 12/12 = RLS 2-tenant + append-only + permission fail-closed + audit-in-tx + 4 boundary; finance 51 · tenant-isolation 160 · e2e 19; typecheck clean). FULL gate (security-review + santa-method **NICE** + db/silent-failure/typescript) **0 CRITICAL/HIGH**; 1 MEDIUM non-blocking (map `revenue_records_replaces_uq` violation→409 ở HTTP layer). Vá DRIFT `vitest.config.ts` (đọc `LANE_DB`/process.env TRƯỚC literal — gốc shared-DB drift). **Nợ:** RevenueController (HTTP layer) chưa build. Artifact: [`docs/reviews/g13-gates.md`](docs/reviews/g13-gates.md). **Chưa land master** (G13 land CUỐI sau G9→G10→G11; reconcile journal idx39-43 + audit-CHECK union lúc merge — MERGE NOTE 0070).
- [x] **G13-2** 🤖🟢 (M) Cost + **Cost Allocation** (chia đều / theo video / theo task / % thủ công / theo giờ) — FIN-003. **Service/repo/module GREEN trên DB cô lập `mediaos_g13`** (cost-deny 13/13 = RLS 2-tenant + append-only no-UPDATE/DELETE + permission fail-closed + create/adjust/void audit-in-tx + 4 DB boundary; cost-allocation-deny 10/10 = RLS + perm deny + re-allocate soft-delete + cents-exact SUM===amount cho 3 method tĩnh + active_uq + cross-tenant target guard; allocation-resolve unit 11/11). Full suite **1027 pass/2 skip/0 fail** (revenue không hồi quy). typecheck api+contracts clean · lint 0 error. KHÔNG migration mới (0071 cost ĐÃ land master `2d4533f`/`8759e7e`). FULL gate (security-review + code-review database/silent-failure/typescript) **0 CRITICAL/HIGH**; 2 MEDIUM non-blocking (N-await ≤200 target cap; double-adjust uq→map 409 ở HTTP layer). Artifact: [`docs/reviews/g13-gates.md`](docs/reviews/g13-gates.md) §G13-2. **Nợ:** Cost/CostAllocation Controller (HTTP layer) chưa build. **✅ MERGED (`4198f82`)** — CROWN: merge master(incl g8) vào lane 0-conflict (chỉ finance/*), FULL gate 0 real CRIT/HIGH (database/silent-failure CRITICAL/HIGH **REFUTED** vs contract refine + Drizzle throw-on-fail), verify isolated `mediaos_g13` deny-path 73 pass. Land lên master `8cf0f6c` (đã có g8+g14+g10) — post-merge typecheck 4/4 + build 3/3 xanh. **Nợ còn:** HTTP Controller + N+1≤200 + revenue Number()>2^53 (non-blocking).
- [x] **G13-3** 🛠️🔋 (M) Profit snapshot **bất biến** theo công ty/kênh/project/video (Doanh thu − CP trực tiếp − CP phân bổ). — **✅ MERGED (`bdca6b7`):** `profit_snapshots` append-only + **Option X** lineage dedup (recursive CTE — winner = run active mới nhất/lineage; loại lineage void; giữ allocation khi adjust-chưa-reallocate) hết bug đếm-đôi sau re-allocate (`478b7a2`) + CYCLE guard (`6ba90f2`). KHÔNG đụng G13-2 đã land.
- [x] **G13-4** 🤖🟢 (S) Expense Request: **đề xuất chi → duyệt qua Task Hub** (`task_type=finance`) → sau duyệt sinh cost record. — **✅ MERGED (`dbecefc`):** `ExpenseRequestService`/repo + `finance-tasks.service` (cầu nối Task Hub) → approve sinh `cost_record` (lineage qua `expense_request_id`) + `expense_approvals` log + audit; permission fail-closed `create/approve:expense-request`; reject KHÔNG sinh cost.

**DB:** `revenue_records` `cost_records` `cost_allocations` `profit_snapshots` `expense_requests` `expense_approvals` _(revenue/cost/profit = append-only)_
**Màn:** Revenue List/Entry · Cost List/Entry · Cost Allocation · Profit Dashboard · Expense Request/Approval
✅ **Done:** doanh thu/chi phí đa chiều; phân bổ; lợi nhuận kênh/project/video; **đề xuất chi qua Task Hub**; tài chính mask theo quyền.

---

# MỐC 5 — DASHBOARD · MOBILE · SAAS (G14 · G15 · G16)

---

## G14 — Dashboard & Report _(🤖 AI-bulk 🟢 · ~6–10 ngày)_

> Toàn 🤖, **trừ** materialized views (cần index/refresh đúng).

- [x] **G14-1** 🤖🟢 (M) Dashboard **theo role** (lãnh đạo/quản lý/nhân viên/HR/Finance) — mask theo quyền (Recharts + Tremor). — **✅ phủ bởi `633ba22`** (role-masked dashboard route, server-driven `PermissionGate`).
- [x] **G14-2** 🤖🟢 (M) Report kênh/project/content/KPI. — **✅ MERGED master** (`1aef3ff` --no-ff, §5.4): `GET /dashboard/report` server-side masking theo 3 quyền (`read:finance_report` / `read:employee_report` / `read:attendance_report`) + export lọc theo `company_id`; FE stat-card + recharts revenue-by-channel chart. Mig `0101` permission seed band 0100s, journal idx **60** (when 1717500123000 > master max). **Reconcile land:** seed fix (`role_permissions (role_id,permission_id,effect)` join roles by name thay vì `(role_name,permission_id)`; `cf21f5c`). Verify chain `0000→latest` sạch + 10 API unit + 10 FE tests + full api 1138 pass.
- [x] **G14-3** 🛠️/🤖 (M) **Materialized views** + cảnh báo (task trễ · lỗi nghiêm trọng · kênh rủi ro) + filter tháng/kênh/project/phòng ban. — **✅ MERGED (`28198e0`):** 2 MV + UNIQUE index → REFRESH CONCURRENTLY (fail-loud) + alerts (overdue/defect-severity/channel-risk) + filter; SQLi-safe parameterize (MV không RLS) + GRANT SELECT-only (`0103`) + int-spec tenant-isolation.

**Màn:** Leadership/Manager/Employee/HR/Finance Dashboard · Channel/Project/KPI Report
✅ **Done:** mỗi role 1 dashboard; chỉ dữ liệu theo quyền; có cảnh báo; click chỉ số xem chi tiết.

---

## G15 — Mobile App (React Native) _(🤖 AI-bulk · ~14–20 ngày · để CUỐI)_

> Bề mặt rộng nhưng tái dùng API + contract đã có → AI sinh nhanh. **Đừng làm song song với web** — chỉ vào khi web module đã ổn.

- [ ] **G15-1** 🤖🟢 (L) Mobile core: Home · My Tasks · Task Detail · Submit Work · Approval · Revision (MOB-002→004).
- [ ] **G15-2** 🤖🟢 (M) Chat · Notification (push **FCM**) · thông báo bắt buộc.
- [ ] **G15-3** 🤖🔋 (M) Attendance check-in/out · Leave · **Payslip (re-auth)** · KPI cá nhân. _(payslip re-auth = cẩn thận)._

_(custom `react-native-reviewer/patterns/build-fix/push`)_
✅ **Done:** nhân sự dùng mobile hằng ngày; dữ liệu nhạy cảm có re-auth; push hoạt động.

---

## G16 — Stabilization & SaaS Preparation _(🛠️+🔧 · ~8–12 ngày)_

- [ ] **G16-1** 🛠️🔋 (M) Hardening: 2FA nâng cao (AUTH-003), log truy cập nhạy cảm, cảnh báo bảo mật, kiểm tra leak theo scope.
- [ ] **G16-2** 🔧🟢 (M) Tối ưu: query/index, dashboard, notification, mobile; **backup/restore drill** (`ecc:canary-watch`).
- [ ] **G16-3** 🛠️/🤖 (M) SaaS prep: workspace/company management, subscription/feature-flag/usage-limit (kiến trúc), template workflow/role/dashboard.
- [ ] **G16-4** 🧪 (S) Integration planning: YouTube/AdSense/TikTok/Facebook/Drive/Email/SSO (**chỉ thiết kế**, chưa build).

✅ **Done:** chạy ổn với dữ liệu thật; không lỗi phân quyền nghiêm trọng; DB sẵn sàng multi-tenant; clone template được cho công ty khác.

---

## 🚦 Mốc release nội bộ _(không chờ xong hết mới dùng)_

| Release | Gồm phase | Người dùng chính |
| --- | --- | --- |
| R1 Admin Internal | G2–G5 | Admin · HR · Lãnh đạo |
| R2 Media Mgmt | G6 | Channel/Project Manager |
| R3 Production | G4·G7·G9 | PM · Team Lead · Nhân viên SX |
| R4 Quality Control | G8 | QA · Team Lead · Trưởng phòng |
| R5 Daily Comms | G10·G15 | Toàn nhân sự |
| R6 HR & Payroll | G11·G12 | HR · Kế toán |
| R7 Finance | G13 | Kế toán · Finance · Lãnh đạo |
| R8 Full Rollout | G14·G16 | Toàn công ty |

---

# GX — Xuyên suốt _(mọi sprint, không bỏ — solo dễ quên nhất)_

- [ ] **GX-1** Review gate phân tầng: diff chạm `permission/RLS/secret/payroll/audit` → **FULL gate** (`ecc:security-reviewer` + `ecc:database-reviewer` + `ecc:silent-failure-hunter`). CRUD thường → **LIGHT gate** (`ecc:typescript-reviewer` + `ecc:quality-gate`).
- [ ] **GX-2** Test: **deny-path trước** · coverage ≥80% (ngưỡng riêng permission/payroll) · contract-test masking.
- [ ] **GX-3** Audit + event cho mọi hành động quan trọng.
- [ ] **GX-4** Migration an toàn: policy + FORCE RLS **trước** khi backfill `company_id` (assert trong CI). _(`ecc:database-migrations`)._
- [ ] **GX-5** Backup offsite + health check (`ecc:canary-watch`); `ecc:harness-audit` cuối G2/G5/G7.
- [ ] **GX-6** Theo dõi chi phí Claude Code (`ecc:cost-tracking`); **định tuyến model**: Haiku → 🤖 CRUD/docs · Sonnet → module thường · Opus → 🛠️ spike khó (workflow FSM, permission, payroll, ADR).
- [ ] **GX-7** i18n (tiếng Việt) + timezone áp dụng ngay khi có dữ liệu thời gian.
- [ ] **GX-8** **Tự động hoá chất lượng & tự sửa lỗi** theo [`docs/AUTOMATION-PLAYBOOK.md`](docs/AUTOMATION-PLAYBOOK.md): vòng lặp micro-step (test→check→root-cause→clean→commit), tự động **phân tầng** (xanh tự sửa/commit · đỏ người chốt), song song khi độc lập (worktree). Kích hoạt dần theo phase (bảng mục 8 của playbook).

> **Mẹo solo cho GX:** đừng coi GX là "việc cuối". Chạy **GX-1 review gate ngay sau mỗi task 🛠️**, và **GX-6 model routing** mỗi lần mở phiên Claude Code. Đây là cách một mình vẫn giữ chất lượng SaaS.

---

## Custom components cần tự tạo (ECC chưa có)

| Tên | Loại | Dùng ở | Chế độ |
| --- | --- | --- | --- |
| `workflow-statemachine-designer` / `-tester` | agent | G4-3, G7 | 🛠️ |
| `event-outbox-audit-guide` | skill | G2-4 | 🛠️ |
| `tenant-isolation-guard` / `rls-tenant-isolation-tester` | hook/agent | G1-7, G2-5 | 🔧/🛠️ |
| `secret-encryption-reviewer` | agent | G6-2 | 🛠️ |
| `payroll-snapshot-immutability-guard` | hook | G12-2 | 🛠️ |
| `realtime-test-harness` | custom | G10-1 | 🛠️ |
| `kms-provisioning-and-rotation` | infra | G6-2 | 🔧 |
| `react-native-*` (reviewer/patterns/build-fix/push) | agent/skill | G15 | 🤖 |

---

## Lỗ hổng phải bù (đừng quên)

- [ ] **Test realtime/WebSocket** (lifecycle, presence cross-tenant, reconnect, ordering) — G10-1.
- [ ] **i18n + Timezone payroll** (ADR + hook, DST-safe) — GX-7.
- [ ] **KMS provisioning/rotation/break-glass** — G6-2.
- [ ] **Alerting runtime** audit/event-dispatch drop (dead-letter + cảnh báo) — G2-4.
- [ ] **PgBouncer × RLS** & **thứ tự backfill company_id** — assert trong CI — GX-4.

---

## Checklist sức bền cho người làm một mình

- [ ] **Mỗi lane chỉ 1 task `[~]`** (song song nhiều lane OK — §5); trong 1 worktree đừng mở 2 task chồng nhau.
- [ ] Sau mỗi cụm 🔋 (G2, G3, G7, G12) → tự thưởng một cụm 🟢 (G5, G11, G14) để hồi sức.
- [ ] Trước khi vào "thung lũng" G2/G3, nhắc mình: **đỉnh G4 ở ngay sau** — đừng bỏ cuộc giữa dốc.
- [ ] Demo cho 1 người dùng thật **sau mỗi mốc M1–M5** → dopamine + feedback sớm, tránh build lệch.
- [ ] Bám **MỐC**, không bám tổng 16 phase. Một mình mà nhìn tổng sẽ nản.

---

_Tham chiếu: PRD, ERD, Permission Matrix, Workflow mẫu, Thiết kế màn hình, Kế hoạch phase, Tài liệu dev (các `.md` cùng thư mục); `CLAUDE-CODE-TOOLKIT.md` (bản đồ agent/skill/hook + custom component); `TECH-DECISION-RECORD.md` (15 ADR)._
