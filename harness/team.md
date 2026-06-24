# Đội Agent — MediaOS (charter)

> Roster vai trò + phép tính nhân sự + luật điều phối cho mục tiêu **MVP trong 1 tháng**.
> Lập 2026-06-21. Brain thực thi: `.claude/workflows/parallel-lanes.mjs`. Định nghĩa agent: `.claude/agents/*.md`.
> Posture đã chốt (owner 2026-06-21): **Tăng tốc tối đa** — đỉnh 6–8 lane song song; người duyệt red-zone nhiều lần/ngày.

---

## 1. Phép tính nhân sự (vì sao 8 vai trò / đỉnh 6–8 lane)

**Khối lượng còn lại tới MVP ≈ 28 person-week chuẩn** (7 module spec đối chiếu BE + FE apps/app từ 0 + PERM-UI + QA + dọn + tích hợp).

- Ngây thơ: 28 PW ÷ 4 tuần = **7 người**.
- Hệ số agent (CRUD/FE/test greenfield nén ~2×): builder cần **3–4 lane đồng thời** để dọn ~20 PW build.
- Phần KHÔNG nén (bị chặn bởi người duyệt + serialize): điều phối · DB/migration (1 lane) · gate an ninh · QA · DevOps = **+3–4 vai trò** on-demand.

→ **8 vai trò lõi; đỉnh 6–8 lane đồng thời; DB/migration luôn = 1 lane nối tiếp.**

**Cổ chai THẬT = thông lượng duyệt red-zone của con người**, không phải tốc độ code. Trần song song = số PR vùng đỏ người duyệt được/ngày.

## 2. Roster (ánh xạ vai trò xây dựng/thiết kế HT → agent thật)

| # | Vai trò (xây dựng HT) | Agent (`.claude/agents/`) | Model | Đồng thời | Tồn tại |
|---|---|---|---|---|---|
| 1 | Tổng công trình sư / điều phối | `tech-lead` | Opus | luôn (brain) | mới |
| 1b | Khoanh vùng đỏ (crown-jewel triage) | `red-zone-scanner` | Opus | trước route | mới |
| 2 | Kỹ sư Backend | `backend-builder` ×2 | Sonnet (Opus khi crown) | ✅ ×2 | mới |
| 3 | Kỹ sư Frontend | `frontend-builder` ×2 | Sonnet | ✅ ×2 | mới |
| 4 | Kỹ sư DB/Migration | `db-migration` | Opus | ⚠️ **serialize 1** | mới |
| 5 | Kỹ sư An ninh/Phân quyền | `security-reviewer` | Opus | on-demand | mới |
| 6 | Kỹ sư QA/Test | `qa-test-engineer` | Sonnet | on-demand | mới |
| 7 | DevOps/CI | `devops-ci` | Sonnet | on-demand | mới |
| 8 | Cổng RLS chuyên dụng | `rls-tenant-isolation-tester` | — | on-demand | sẵn |
| + | Chấm hoàn thành (DoD) | `completion-evaluator` | Opus | đóng phase | sẵn |
| + | Review plan đối kháng | `plan-reviewer` | — | trước code | sẵn |
| + | Theo dõi mốc thời gian | `progress-tracker` | Sonnet | mỗi WO | mới |
| + | Báo cáo + rủi ro | `project-analyst` | Sonnet | on-demand | mới |
| + | Cổng deploy/merge | `deploy-gate` | Sonnet | sau eval | mới |

## 2b. Phân công: TASK → AGENT (giao đúng chuyên môn)

> "Giao đúng việc cho đúng người" KHÔNG dựa vào trí nhớ — nó **deterministic theo tín hiệu** trên `task`/`paths`, ép trong code `parallel-lanes.mjs`/`auto-loop.mjs`. Ba lớp:

**Lớp 1 — `tech-lead` PHÂN CÔNG** (đọc spec, cắt lane không chồng paths, gán `builder` theo bảng dưới).
**Lớp 2 — regex DETERMINISTIC** (`pickBuilder`/`pickReviewers` — sàn rẻ, nhất quán, không cần agent):

| Tín hiệu trên `task`/`paths` (regex) | Builder phụ trách | Reviewer kèm |
|---|---|---|
| `migration`·`drizzle`·`schema`·`rls`·`_journal`·`/db/` | **`db-migration`** (Opus, nối tiếp) | `rls-tenant-isolation-tester` |
| `permission`·`auth`·`secret`·`audit`·`encrypt`·`token` HOẶC gate=FULL | builder theo domain | **`security-reviewer`** (+ silent-failure) |
| `react`·`.tsx`·`component`·`form`·`web`·`ui`·`màn hình` | **`frontend-builder`** | `react-reviewer`(→completion-eval) |
| còn lại (service/controller/repo API) | **`backend-builder`** | `typescript-reviewer` (baseline mọi lane) |
| crown-jewel (mọi vùng đỏ) | + Opus + plan | + `santa-method` + `quality-gate` |

**Lớp 3 — `red-zone-scanner` GÁC** (đọc nội dung file thật → nâng zone/gate; bắt ca "tiêu đề xanh nhưng nội dung đỏ").

→ Override per-lane: `lane.builder` ép builder · `lane.reviewers:[...]` ép reviewer · `lane.model` ép model. Xem trước không tốn token: `parallel-lanes` với `args.dryRun:true` (in cả builder/reviewer mỗi lane).

## 3. Luật điều phối (đọc cùng `policy.md`)

1. **DB/migration = 1 lane nối tiếp.** Không bao giờ 2 lane chạm `apps/api/src/db/**` + `drizzle/**` song song. RLS+FORCE trước backfill.
2. **Hot-file APPEND, không rewrite** (CLAUDE.md §9.3): `schema/index.ts`, `app.module.ts`, audit `object_types` CHECK (UNION), permission seed (`ON CONFLICT DO NOTHING`). tech-lead chỉ định thứ tự merge khi nhiều lane đụng cùng hot-file.
3. **`paths` lane không chồng lấn** — guard-scope cảnh báo khi ra ngoài. tech-lane cắt lane theo ranh giới file.
4. **Crown-jewel** (permission/RLS/secret/audit/auth/FSM phê duyệt/ADR) → Opus + plan + `security-reviewer` độc lập + **người chốt** trước merge. Brain tự route (`isCrown`/`pickModel`/`pickReviewers`).
5. **Deny-path test RED trước** mọi việc nhạy cảm; verify trên DB cô lập theo lane.
6. **Spec thắng** khi code cũ (hướng media) mâu thuẫn `docs/SPEC/`.

## 4. Sprint 4 tuần (gợi ý — bám backlog.mjs)

| Tuần | Trọng tâm | Lane song song điển hình |
|---|---|---|
| **W1** | Nền FE + phân quyền: PERM-UI-1, dựng vỏ apps/app (APP-MERGE-1 shell), TRIM-1 dọn hướng cũ | tech-lead phân rã · 2 FE (perm UI + shell) · 1 BE (đối chiếu HR) · db-migration (nếu PERM cần Tier-2 scope) |
| **W2** | HR + ATT lên spec (BE đối chiếu + FE) | 2 BE (HR, ATT) · 2 FE (HR, ATT) · db-migration (ca/điều chỉnh công) · QA deny-path |
| **W3** | LEAVE + TASK (FSM phê duyệt = crown) | 2 BE (LEAVE FSM, TASK) · 2 FE · security-reviewer (FSM) · QA E2E phê duyệt |
| **W4** | DASH + NOTI + realtime + hardening | BE (DASH aggregation, NOTI delivery) · FE (charts, noti center) · devops-ci (CI path-filter, build xanh) · completion-evaluator đóng phase |

> Mỗi tuần: tech-lead phân rã đầu tuần → fan-out builders → security/QA gate → người chốt red-zone → completion-evaluator chấm DoD cuối tuần.

## 5. Cách gọi đội

- **Đa-lane (việc đỏ/phức tạp):** `.claude/workflows/parallel-lanes.mjs` — tự route model/reviewer/builder theo domain. Xem trước không tốn token: `args.dryRun:true`.
- **Solo 1 việc:** gọi thẳng agent qua Agent tool theo `agentType` (vd `backend-builder`, `frontend-builder`).
- **Tuần tự kiểm soát (mặc định harness):** vẫn 1 Work Order/phiên cho việc thường; bật đa-agent khi đỏ.
