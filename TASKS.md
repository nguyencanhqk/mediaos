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

### 4 nguyên tắc vận hành solo (QUAN TRỌNG)

1. **Tuần tự, không song song.** Một mình thì làm xong-gọn từng task; không mở 3 mặt trận. Mỗi lúc chỉ 1 task `[~]`.
2. **Xen kẽ 🔋 và 🟢.** Sau mỗi cụm nặng (permission/payroll), thưởng cho mình một cụm 🤖 CRUD nhẹ để hồi sức và thấy tiến độ.
3. **Đòn bẩy AI đặt đúng chỗ.** 🤖 = nơi bạn thắng đậm (sinh hàng loạt). 🛠️ = nơi AI dễ sai, bạn PHẢI lái bằng test deny-path trước. Đừng để AI tự do ở phần 🛠️.
4. **Mốc sống còn trước mốc đầy đủ.** Đạt **Mốc 1 (lõi sống)** rồi mới bung. Đừng làm G5 đầy đủ trước khi 1 video chạy trọn vòng (G4).

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
| G4 | 🏁 MVP-0 Walking Skeleton | 🤖+🛠️ hỗn hợp | XL | 🟡 đang làm |
| G5 | Tổ chức & Nhân sự đầy đủ | 🤖 AI-bulk 🟢 | L | ✅ |
| G6 | Media (Channel/Project/Content) | 🤖 + 🛠️(G6-2) | L | 🟡 G6-1/3/4/5 ✅ — chỉ còn **G6-2** (crown-jewel) |
| G7 | Workflow Builder | 🛠️ TDD 🔋 | XL | ☐ |
| G8 | Approval · Defect · Eval · KPI | 🛠️+🤖 | L | ☐ |
| G9 | 🧩 Task Hub hợp nhất | 🛠️+🤖 | L | ☐ |
| G10 | Chat · Notification · Meeting | 🤖 + 🛠️(realtime) | L | ☐ |
| G11 | Attendance · Leave | 🤖 AI-bulk 🟢 | M | ☐ |
| G12 | Payroll · Bonus/Penalty | 🛠️ TDD 🔋🔋 | XL | ☐ |
| G13 | Finance (Revenue/Cost/Profit) | 🛠️+🤖 | L | ☐ |
| G14 | Dashboard & Report | 🤖 AI-bulk 🟢 | M | ☐ |
| G15 | Mobile App (React Native) | 🤖 AI-bulk | XL | ☐ |
| G16 | Stabilization & SaaS Prep | 🛠️+🔧 | L | ☐ |
| GX | Xuyên suốt (mọi sprint) | — | — | ☐ |

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
- [x] **G3-4** 🛠️🔋 (M) Guards `auth → company → permission`; cache permission ở Valkey + **invalidate đúng** khi đổi quyền. Guards: JwtAuthGuard → CompanyGuard → PermissionGuard (fail-closed, @Public bypass, PERMISSION_GUARD_ENABLED kill-switch); CachedPermissionRepository (Valkey TTL 300s, fallback to DB); PermissionCacheInvalidator (permission.changed → DEL cap key); 20/20 tests GREEN.
- [x] **G3-5** 🤖🟢 (S) FE `<PermissionGate>` + `useCan()` (capabilities từ `/me`). _Chỉ UX — server là sự thật._ `/me` trả `capabilities: Record<string,boolean>` (non-sensitive only); Zustand store + `useCan(action,resourceType)` O(1) wildcard lookup; `<PermissionGate>` với fallback; 14/14 FE tests GREEN.

✅ **Done khi:** user chỉ thấy menu/nút theo quyền; API chặn đúng; đổi quyền có audit + cache invalidate.

---

## G4 — 🏁 MVP-0 Walking Skeleton _(🤖+🛠️ hỗn hợp · ~12–18 ngày · ĐỈNH đầu tiên)_

> Dùng **1 workflow hard-coded** (chưa cần Builder). Đây là lúc bạn **lần đầu thấy hệ thống sống** — phần thưởng sau thung lũng. Xen kẽ 🤖 (nhẹ) và 🛠️ (nặng) trong phase này.

- [x] **G4-1** 🤖🟢 (S) Org/Employee tối thiểu — org_units + teams + team_members; RLS+FORCE+CHECK; NestJS OrgModule (7 endpoints); Zod contracts; FE /org/departments + /org/teams + /org/employees; LIGHT gate passed; commit aca6233.
- [x] **G4-2** 🤖🟢 (M) Channel + Project + Content tối thiểu (project ↔ nhiều kênh; tạo 1 video). BE 9 endpoints + FE 3 trang + sidebar nav; commit 0467216.
- [x] **G4-3** 🛠️🔋 (M) **1 workflow cứng**: Script → Edit → QA → Upload; auto-sinh task. _(custom `workflow-state-machine-guide`)_ — _Hard-code nên đơn giản hơn G7, nhưng vẫn TDD._ FULL gate passed; deny-path RED→GREEN (23 tests); workflow FSM + 4-step + auto-task + submit; global JWT+Company guards wired; 125 tests green.
- [x] **G4-4** 🤖🟢 (M) My Tasks + submit work (file/link) + comment. _(`ecc:tdd-workflow`)_ — GET /tasks (tasks table, joined step+content), POST /tasks/:id/comments + GET comments; FE /tasks page (2-panel: list + detail), SubmitWorkForm (link+note→submitStep), CommentThread; submission_url/note on workflow_steps; migration 0009; typecheck+125 tests green.
- [x] **G4-5** 🛠️🔋 (M) **Approval 1 cấp** + **return revision**. TDD: 12 deny+happy tests RED→GREEN; validateConsumerTransition added to FSM; ApprovalService (approve T3, requestRevision T4 + defect + revision task); repository: approvalSteps, closeApprovalRequest, advanceInstanceStepOrder, completeWorkflowInstance, createDefect, findMaxStepOrder; 3 endpoints (GET/POST approval-requests); FE: "Chờ duyệt" tab with ApprovalCard (approve / trả về form); 137 API + 17 web tests green, typecheck clean.
- [x] **G4-6** 🤖🟢 (M) Notification cơ bản + 1 group chat project (auto-tạo). _(migration 0010: 4 bảng RLS; BE NotificationsModule + ChatModule; auto-create project chat room khi tạo project; FE NotificationBell (poll 30s) + /chat/projects/:id; LIGHT gate passed, 3 HIGH fixes applied; typecheck + 154 tests xanh)_
- [x] **G4-7** 🧪🟢 (M) **E2E**: 1 video đi trọn vòng đời; chạy lại test isolation G2-5. _(17-test E2E spec: Script→Edit→QA→Upload lifecycle + revision flow + tenant isolation cross-check; G2-5 harness mở rộng thêm 22 bảng G4 với idColumn/skipNoContext; fix 3 production bugs: auth.controller.ts thiếu @Public(), audit_logs CHECK constraint, route ordering approval-requests vs :instanceId; fix 2 migration bugs: task_comments thiếu GRANT + policy thiếu NULLIF; 282 tests xanh, LIGHT gate passed)_
- [x] **G4-8** 🔧 (S) **Triển khai pilot 1 team thật**; thu feedback. _(deploy checklist → [`docs/pilot/deploy-checklist.md`](docs/pilot/deploy-checklist.md); feedback form → [`docs/pilot/feedback-template.md`](docs/pilot/feedback-template.md))._

✅ **Done khi:** một video thật đi tạo → task → nộp → duyệt → trả sửa → upload; **pilot team dùng được**. 🎉 _Ăn mừng — bạn vừa qua phần khó nhất về mặt tâm lý._

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

> **G5-FIX ĐÓNG (2026-06-09, branch `feat/g5-fix`):** rà soát phát hiện G5 ban đầu nợ (salary audit không gọi, thiếu guard Org/Team, 0 test, FE thiếu) → vá F1–F13 (plan §14). **FULL gate F1/F2/F4 PASS — 0 CRITICAL** (security/database/silent-failure reviewer; commit `a2e2d09`). Test: full API **510 pass/2 skip**, G2-5 2-tenant regression (tenant-isolation.int-spec) **132 pass**, salary mask 100% (30), api+web typecheck xanh. harness-audit 25/29 (2 fail = evals/ + SECURITY.md, hygiene toàn repo ngoài scope G5). Residual: 2 MEDIUM non-blocking (createEmployee chưa audit salary lúc tạo; baseSalary trong LIST_COLUMNS defense-in-depth) → ticket follow-up. **Còn lại:** merge `feat/g5-fix`.

---

## G6 — Media: Channel · Account · Project · Content _(🤖 + 🛠️ G6-2 · ~10–14 ngày)_

> Phần lớn 🤖, **trừ G6-2** là crown-jewel 🔋 (mã hoá tài khoản kênh). Đừng để AI tự do ở G6-2.
>
> **Trạng thái (2026-06-06):** Plan chi tiết xong + `plan-reviewer` **PASS** (không còn BLOCKING) → [`docs/plans/G6-media-full.md`](docs/plans/G6-media-full.md). Migration **0020–0028** (latest hiện tại 0019). Micro-step + đặc tả G6-2 envelope encryption nằm trong plan; theo plan, KHÔNG theo dòng tóm tắt dưới đây.
> ⚠️ **2 bước bắt buộc plan-reviewer chèn thêm:** (1) **`2e0`** vá `PermissionGuard` forward `resourceId`+`ctx` + **fail-closed 403** khi action sensitive thiếu resourceId — TRƯỚC khi mở reveal-secret (nếu không → bypass Tầng-3 object_permissions). (2) **`1a-bis`** mở rộng `test/integration/rls-registry.ts` thêm ~10 bảng G6 vào harness 2-tenant TRƯỚC khi tuyên bố G2-5 xanh (tránh xanh-giả).
> **Thứ tự bắt đầu:** `0a` (migration 0020 audit object_types) → `1a-bis` (mở rộng RLS harness) → G6-1 → … → `2e0` (vá guard) → G6-2.

- [x] **G6-1** 🤖🟢 (M) Platform + Channel + `channel_members` + gán Manager/team; lọc theo nền tảng/trạng thái. _(BE 1a–1d `8a9fbe3`/`c5060aa`; FE 1e `f4a07d2`: list+filter+TanStack Table, detail tabs Overview/Members, members CRUD)._
- [x] **G6-2** 🛠️🔋 (L) 🔒 **Platform Account Encryption** (envelope + KMS/Vault, mã hoá app-side; `reveal-secret` + re-auth + **audit mỗi lần xem/sửa**). **FULL gate.** _(custom `secret-encryption-reviewer`; `ecc:security-reviewer` + `ecc:database-reviewer`)._ **✅ gates pre-merge XONG + e2e G4-7 xanh (`259586c`) → merge `--no-ff` local 2026-06-09 (chưa push).**
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

- [ ] **G7-1** 🤖🟢 (M) `workflow_templates` + `step_templates` + `step_dependencies` (cấu hình người/role/team/reviewer/checklist/file mặc định). _(BR-004: KHÔNG hard-code workflow)._
- [ ] **G7-2** 🛠️🔋 (L) **Canvas React Flow**: node/edge, bước **song song & tuần tự**, dependency DAG, nháp/publish/nhân bản. _(custom FSM designer; `ecc:a11y-architect`)_ — _UI nặng + logic; tách "vẽ canvas" (🤖) khỏi "validate DAG" (🛠️)._
- [ ] **G7-3** 🛠️🔋 (L) Workflow Instance + step instance + **auto-sinh task idempotent** khi áp vào content/project.
- [ ] **G7-4** 🛠️🔋 (L) **"Khoá phần liên quan"** (lock theo dependency, không khoá toàn workflow) + checklist + evaluation hook. _(WF-003, APR-004, BR-006)._

**DB:** `workflow_templates` `workflow_step_templates` `workflow_step_dependencies` `workflow_instances` `workflow_step_instances` `checklists` `checklist_items`
**Màn:** Workflow Template List · Workflow Builder · Step Config · Instance View
✅ **Done:** builder tạo bước song song/tuần tự + dependency; áp vào content sinh task idempotent; lỗi chỉ khoá phần liên quan.

---

## G9 — 🧩 Task Hub hợp nhất _(🛠️+🤖 · ~8–12 ngày · bất biến #4)_

> Làm **trước** G8/G10/G11/G13 để các module sau chỉ **emit vào đây**. G9-1 là 🛠️ (contract test), phần còn lại 🤖.

- [ ] **G9-1** 🛠️🔋 (M) Chuẩn hoá `tasks` nhận đủ **7 `task_type`** (`production·review·revision·meeting_action·office·finance·hr`); `project_id/content_item_id/workflow_instance_id` **nullable**. **Contract-test: task non-video tạo được mà không cần video.**
- [ ] **G9-2** 🤖🟢 (S) **Giao việc tay** (`task_type=office`): tạo task thủ công ngoài workflow (TASK-001).
- [ ] **G9-3** 🤖🟢 (L) **Task Board tổng**: Kanban/Table/Calendar; **filter theo `task_type`**; view Office Tasks; **luồng rút gọn** (Chưa bắt đầu→Đang làm→Hoàn thành) cho task không có vòng duyệt.
- [ ] **G9-4** 🤖🟢 (M) My/Team/Project Tasks **gộp tất cả nguồn**; card có badge loại + bối cảnh điều kiện.

**DB:** `tasks` `task_comments` `task_attachments`
**Màn:** Task Board (Kanban/Table/Calendar) · Task Detail Drawer · My/Team/Project/Office Tasks
✅ **Done:** giao việc tay được; Task Board đủ 7 loại; lọc theo loại; office task đi luồng rút gọn; **không module nào có bảng task riêng**.

---

# MỐC 3 — CHẤT LƯỢNG & GIAO TIẾP (G8 · G10)

---

## G8 — Approval · Defect · Evaluation · KPI _(🛠️+🤖 · ~12–16 ngày)_

> `approval_requests` = **nguồn sự thật duy nhất** (ADR 0016), step = projection. **Deny-path TRƯỚC.**

- [ ] **G8-1** 🛠️🔋 (M) Approval **1–3 cấp** (cấp sau mở khi cấp trước đạt) + **Approval Inbox đa loại**. _(APR-001/002)._
- [ ] **G8-2** 🛠️🔋 (M) Defect/Revision: chọn **bước lỗi + người chịu trách nhiệm + loại lỗi**, khoá liên quan, **sinh revision task**, defect history. _(BR-005, APR-003/005)._
- [ ] **G8-3** 🤖🟢 (M) Evaluation: template + tiêu chí + trọng số + chấm điểm gắn workflow step.
- [ ] **G8-4** 🛠️/🤖 (M) KPI cá nhân/team (task xong · đúng deadline · điểm · lỗi loại 1/2 · tỷ lệ duyệt lần đầu). **Ban đầu = tham khảo**, HR/quản lý xác nhận trước khi vào lương (BR-007). _Công thức KPI = test kỹ._

**DB:** `approval_rules` `approval_requests` `approval_steps` `defects` `defect_histories` `evaluation_templates` `evaluation_criteria` `evaluation_results` `evaluation_scores` `kpi_definitions` `kpi_results` `performance_reviews`
**Màn:** Approval Inbox/Detail · Defect Center/Detail · Evaluation Builder/Result · KPI Individual/Team
✅ **Done:** duyệt 1–3 cấp; trả sửa đúng người-đúng bước; chấm điểm; KPI khoá theo kỳ.

---

## G10 — Communication: Chat · Notification · Meeting _(🤖 + 🛠️ realtime · ~10–14 ngày)_

> G10-1 là 🛠️ (WS phải qua cùng masking như REST). Còn lại 🤖.

- [ ] **G10-1** 🛠️🔋 (L) Chat realtime 1-1 + group (Socket.IO + Valkey adapter, room `co:{companyId}:…`); text/file/mention/ghim. **WS qua cùng DTO/masking như REST — cấm `io.emit` thẳng row.** _(custom `realtime-test-harness`)._
- [ ] **G10-2** 🤖🟢 (S) Auto group chat theo project/kênh/phòng ban (CHAT-003).
- [ ] **G10-3** 🤖🟢 (M) Notification Center + rules + **thông báo bắt buộc không tắt được** (NOTI-001/002).
- [ ] **G10-4** 🤖🟢 (M) Meeting + biên bản + **task sau họp** → ghi vào **Task Hub G9** (`task_type=meeting_action`), KHÔNG bảng riêng.

**DB:** `chat_rooms` `chat_members` `messages` `notifications` `notification_rules` `notification_preferences` `meeting_rooms` `meetings` `meeting_attendees` `meeting_notes` `meeting_tasks` (chỉ liên kết meeting↔tasks)
**Màn:** Chat · Notification Center/Rule · Meeting Calendar/Room/Detail/Notes
✅ **Done:** chat realtime; group tự động; noti bắt buộc; **task sau họp xuất hiện trên Task Board chung**.

---

# MỐC 4 — HR · LƯƠNG · TÀI CHÍNH (G11 · G12 · G13)

> Mốc nặng tâm lý nhất sau M1. Mở bằng G11 (🟢) trước khi vào G12 (🔋🔋 crown jewel).

---

## G11 — HR: Attendance · Leave _(🤖 AI-bulk 🟢 · ~6–10 ngày · cụm hồi sức)_

- [ ] **G11-1** 🤖🟢 (M) Attendance: check-in/out web+mobile, ca làm, đi muộn/về sớm, **đơn bổ sung công → duyệt qua Task Hub** (`task_type=hr`), khoá kỳ công. **Timezone-correct (ADR 0008).** _(GX-7)._
- [ ] **G11-2** 🤖🟢 (M) Leave: loại nghỉ, số phép, **đơn nghỉ → duyệt qua Task Hub** (`task_type=hr`), trừ phép, lịch nghỉ team.

**DB:** `work_schedules` `attendance_records` `attendance_adjustment_requests` `leave_types` `leave_requests` `leave_balances`
**Màn:** Attendance Dashboard/Monthly · Adjustment Requests · Leave Requests/Calendar
✅ **Done:** chấm công mobile; đơn bổ sung/nghỉ duyệt qua Task Hub; trừ phép đúng; dữ liệu công feed payroll.

---

## G12 — Payroll · Bonus/Penalty _(🛠️ TDD 🔋🔋 · ~12–18 ngày · CROWN JEWEL)_

> **FULL gate + `ecc:santa-method`.** Snapshot **bất biến** (ADR 0005); **khoá kỳ KPI trước khi chạy lương**. Đây là phase **rủi ro cao nhất** — sai = mất tiền/mất niềm tin. Đi chậm, test dày.

- [ ] **G12-1** 🛠️🔋 (M) Salary profile (lương cơ bản/loại/chu kỳ/hiệu lực/phụ cấp) — chỉ người có quyền xem/sửa, **audit khi sửa**.
- [ ] **G12-2** 🛠️🔋🔋 (L) Payroll period + payslip: công/KPI/thưởng/phạt → **payslip snapshot append-only** (app role không UPDATE/DELETE). _(custom `payroll-snapshot-immutability-guard`)._
- [ ] **G12-3** 🛠️🔋 (M) Bonus/Penalty: thủ công + từ KPI/lỗi, gắn reference task/defect/KPI, duyệt.
- [ ] **G12-4** 🛠️🔋 (M) Duyệt bảng lương (draft→duyệt→phát hành) + nhân viên xác nhận/khiếu nại; **re-auth khi xem payslip**.

**DB:** `salary_profiles` `payroll_periods` `payslips` `payslip_items` `bonus_penalties` _(payslip/snapshot = append-only)_
**Màn:** Salary Profile · Payroll Period · Payslip List/Detail · Bonus/Penalty · Payroll Approval
✅ **Done:** payslip snapshot bất biến; duyệt trước phát hành; mọi sửa có audit; KPI khoá trước khi vào lương.

---

## G13 — Finance: Revenue · Cost · Profit _(🛠️+🤖 · ~8–12 ngày)_

> Append-only (revenue/cost/profit). G13-1/G13-3 là 🛠️, còn lại 🤖.

- [ ] **G13-1** 🛠️🔋 (M) Revenue nhập tay, gắn nền tảng/kênh/project/video, file đính kèm, **audit khi sửa/xoá** (append-only `revenue_records`).
- [ ] **G13-2** 🤖🟢 (M) Cost + **Cost Allocation** (chia đều / theo video / theo task / % thủ công / theo giờ) — FIN-003.
- [ ] **G13-3** 🛠️🔋 (M) Profit snapshot **bất biến** theo công ty/kênh/project/video (Doanh thu − CP trực tiếp − CP phân bổ).
- [ ] **G13-4** 🤖🟢 (S) Expense Request: **đề xuất chi → duyệt qua Task Hub** (`task_type=finance`) → sau duyệt sinh cost record.

**DB:** `revenue_records` `cost_records` `cost_allocations` `profit_snapshots` `expense_requests` `expense_approvals` _(revenue/cost/profit = append-only)_
**Màn:** Revenue List/Entry · Cost List/Entry · Cost Allocation · Profit Dashboard · Expense Request/Approval
✅ **Done:** doanh thu/chi phí đa chiều; phân bổ; lợi nhuận kênh/project/video; **đề xuất chi qua Task Hub**; tài chính mask theo quyền.

---

# MỐC 5 — DASHBOARD · MOBILE · SAAS (G14 · G15 · G16)

---

## G14 — Dashboard & Report _(🤖 AI-bulk 🟢 · ~6–10 ngày)_

> Toàn 🤖, **trừ** materialized views (cần index/refresh đúng).

- [ ] **G14-1** 🤖🟢 (M) Dashboard **theo role** (lãnh đạo/quản lý/nhân viên/HR/Finance) — mask theo quyền (Recharts + Tremor).
- [ ] **G14-2** 🤖🟢 (M) Report kênh/project/content/KPI.
- [ ] **G14-3** 🛠️/🤖 (M) **Materialized views** + cảnh báo (task trễ · lỗi nghiêm trọng · kênh rủi ro) + filter tháng/kênh/project/phòng ban.

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

- [ ] Mỗi lúc **chỉ 1 task `[~]`**. Đóng gọn rồi mới mở task mới.
- [ ] Sau mỗi cụm 🔋 (G2, G3, G7, G12) → tự thưởng một cụm 🟢 (G5, G11, G14) để hồi sức.
- [ ] Trước khi vào "thung lũng" G2/G3, nhắc mình: **đỉnh G4 ở ngay sau** — đừng bỏ cuộc giữa dốc.
- [ ] Demo cho 1 người dùng thật **sau mỗi mốc M1–M5** → dopamine + feedback sớm, tránh build lệch.
- [ ] Bám **MỐC**, không bám tổng 16 phase. Một mình mà nhìn tổng sẽ nản.

---

_Tham chiếu: PRD, ERD, Permission Matrix, Workflow mẫu, Thiết kế màn hình, Kế hoạch phase, Tài liệu dev (các `.md` cùng thư mục); `CLAUDE-CODE-TOOLKIT.md` (bản đồ agent/skill/hook + custom component); `TECH-DECISION-RECORD.md` (15 ADR)._
