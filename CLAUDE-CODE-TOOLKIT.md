# CLAUDE-CODE-TOOLKIT — MediaOS

> **Bản đồ công cụ Claude Code** cho dự án. Trả lời: _"Task này dùng **agent / skill / hook / workflow** nào, **model** nào, **zone/gate** nào?"_
> Đây là **MAP, KHÔNG phải nguồn sự thật** — luật sống ở: `CLAUDE.md` §6 (review gate) · `harness/policy.md` (zone→model/gate/autonomy) · `harness/team.md` (roster) · `harness/AUTOMATION-LOOP.md` (vòng 3 đội). Khi mâu thuẫn, các file đó thắng.
> Đọc kèm `harness/backlog.mjs` (Work Order) và `docs/spec/` + `docs/README.md` §8 (sản phẩm).

---

## 0. Cách đọc file này

- **Agent** = `.claude/agents/*.md` — gọi qua **Agent tool** (`subagent_type`/`agentType`). Đây là **thành phần THẬT trong repo**, KHÔNG còn `ecc:*`.
- **Skill** = gọi qua **Skill tool** — `skill-smith` (project) + skill toàn cục (deep-research, frontend-design, code-review, verify…).
- **Hook** = `.claude/hooks/*.mjs` — **tự chạy** quanh tool (PreToolUse/PostToolUse/Stop), đăng ký trong `.claude/settings.json`.
- **Workflow** = `.claude/workflows/*.mjs` — "bộ não" đa-agent, gọi qua **Workflow tool**.
- **Model:** **Sonnet mặc định · Opus cho crown/red · KHÔNG Haiku** (quyết định "thận trọng chất lượng" 2026-06-12).
- **Reframe 2026-06-20:** dự án đã **de-media-fy** → là **Hệ thống quản lý doanh nghiệp nội bộ** (AUTH·HR·ATT·LEAVE·TASK·DASH·NOTI). Module media/channel/content/finance/payroll-theo-kênh **out-of-scope** (parked). Mọi nhắc tới "media/finance" bên dưới chỉ là di sản hoặc Phase 2.

---

## 1. Harness lõi — vòng một phiên

```text
bash harness/init.sh     # MỞ: đang ở đâu · làm gì · sửa ở đâu (đọc handoff + tái sinh STATUS)
   │  → làm ĐÚNG 1 Work Order in_progress trong backlog.mjs (green/yellow: code thẳng · red/phức tạp: parallel-lanes)
bash harness/check.sh --quick   # VERIFY nhanh: lint + typecheck (KHÔNG DB/test) — '--all' (+build) khi tiền-merge/vùng đỏ
bash harness/finish.sh   # ĐÓNG: full check (+test) → cập nhật backlog → ghi handoff → commit-if-safe
```

| Mảnh | File |
| --- | --- |
| Hợp đồng vận hành (3 bất biến · tech stack · review gate) | `CLAUDE.md` · contract gọn: `AGENTS.md` |
| Work Order (làm gì · `paths` · `done_when` · `zone` · `skills`) | `harness/backlog.mjs` |
| Trạng thái "đang ở đâu" (TỰ SINH — không sửa tay) | `harness/gen-status.mjs` → `docs/STATUS.md` |
| Ghi nhớ phiên→bàn giao→dài hạn | `harness/handoff.md` · `docs/DECISIONS/` |
| Sổ mốc thời gian WO (append-only) | `harness/ledger.mjs` → `harness/activity.jsonl` |
| Báo cáo tiến độ + rủi ro | `harness/report.md` |
| Luật tự động hoá (zone→model/gate/leo thang) | `harness/policy.md` · roster: `harness/team.md` |

---

## 2. Đội agent (`.claude/agents/`) — 14 agent THẬT

> Gọi solo qua Agent tool theo `agentType`, hoặc để workflow tự route theo domain. Phép tính nhân sự + posture: `harness/team.md`.

### Điều phối & triage

| Agent | Vai trò | Model | Khi nào |
| --- | --- | --- | --- |
| `tech-lead` | Phân rã 1 WO/module → lane song song có thứ tự, đánh dấu crown, kế hoạch hot-file/migration nối tiếp (read-only) | Opus | TRƯỚC khi fan-out |
| `red-zone-scanner` | Đọc **diff/file THẬT** → vẽ bản đồ zone theo hunk, bắt ca "tiêu đề xanh nhưng nội dung đỏ" | Opus | trước route/merge khi nghi ngờ |
| `plan-reviewer` | Review đối kháng **plan** trước khi code: thiếu deny-path? migration an toàn? scope creep? | — | khi tạo/đổi `docs/plans/*.md` |

### Builders (thực thi)

| Agent | Vai trò | Model | Đồng thời |
| --- | --- | --- | --- |
| `backend-builder` | Module NestJS (service·controller·repo·DTO), ép `company_id`/`withTenant`, permission guard, audit, deny-path RED | Sonnet (Opus khi crown) | ✅ ×2 |
| `frontend-builder` | React 19 SPA (Vite·TanStack·Zustand·shadcn) apps/app·console·auth; PermissionGate/useCan; masking do server; i18n vi | Sonnet | ✅ ×2 |
| `db-migration` | **LANE NỐI TIẾP DUY NHẤT** chạm schema/migration: Drizzle + migration đánh số tiếp head, **RLS+FORCE TRƯỚC backfill**, grant append-only | Opus | ⚠️ **serialize 1** |
| `devops-ci` | Giữ build/typecheck/lint xanh toàn workspace (pnpm+Turbo), CI path-filter, docker compose, sửa build đỏ tận gốc | Sonnet | on-demand |

### Gate (kiểm tra & review — read-only)

| Agent | Vai trò | Model | Khi nào |
| --- | --- | --- | --- |
| `security-reviewer` | Cổng **FULL gate**: OWASP + 3 bất biến trên diff permission·RLS·secret·audit·auth·migration → severity + PASS/BLOCK | Opus | mọi lane gate=FULL/crown |
| `rls-tenant-isolation-tester` | Seed 2 tenant A/B → assert mọi path trả 0 row của B khi login A (cổng RLS chuyên dụng) | — | on-demand RLS |
| `qa-test-engineer` | Deny-path RED-trước, integration DB cô lập theo lane, E2E luồng tới hạn, coverage ≥80% | Sonnet | on-demand |
| `completion-evaluator` | Chấm DoD + rubric chất lượng có trọng số → điểm + PASS/BLOCK (chạy test/lint xác minh) | Opus | đóng phase/merge lớn |

### Ship & theo dõi

| Agent | Vai trò | Model | Khi nào |
| --- | --- | --- | --- |
| `deploy-gate` | green/yellow + check xanh → branch + commit + push + `gh pr create` + nhãn `auto-merge`. **red → DỪNG cho người.** KHÔNG push thẳng master | Sonnet | sau eval |
| `progress-tracker` | Đóng dấu start/milestone/finish (giờ thật) vào `harness/activity.jsonl` qua `ledger.mjs` | Sonnet | mỗi WO |
| `project-analyst` | Cập nhật STATUS + viết `harness/report.md` + chấm rủi ro (WIP ì, kẹt deps, scope drift, CI đỏ) | Sonnet | on-demand |

> Override per-lane trong workflow: `lane.builder` ép builder · `lane.reviewers:[…]` ép reviewer · `lane.model` ép model.

---

## 3. Hooks (`.claude/hooks/`) — sàn cứng tự động (đăng ký ở `settings.json`)

| Hook | Sự kiện | Ép điều gì |
| --- | --- | --- |
| `guard-tenant.mjs` | PreToolUse (Write/Edit) | **Bất biến 1** — query nghiệp vụ phải có `company_id` / đi qua `withTenant(` |
| `guard-immutability.mjs` | PreToolUse | **Bất biến 2** — chặn UPDATE/DELETE/hard-delete bảng audit/snapshot; ép `deleted_at` soft-delete |
| `guard-secrets.mjs` | PreToolUse | **Bất biến 3** — chặn secret plaintext / pgcrypto-in-SQL / log secret |
| `anti-bandaid-guard.mjs` | PreToolUse | Chặn vá triệu chứng: `catch{}` rỗng · `@ts-ignore` · `eslint-disable` · `.skip`/`.only` · TODO-fix vùng đỏ |
| `guard-migration-band.mjs` | PreToolUse | Migration phải nằm trong band của lane; `_journal` idx/when đơn điệu tăng |
| `guard-scope.mjs` | PreToolUse | **Warn-only** — cảnh báo khi sửa ra ngoài `paths` của Work Order |
| `guard-claim.mjs` | PreToolUse + Stop | **Warn-only** — claim-on-touch theo `session_id`; cảnh báo khi 2 phiên cùng giữ 1 WO (`node harness/claim.mjs list`) |
| `format-on-write.mjs` | PostToolUse | Auto prettier file vừa ghi |
| `typecheck-changed.mjs` | PostToolUse | Typecheck workspace vừa đổi |
| `stop-gate.mjs` | Stop | Kết phiên → lint+typecheck workspace vừa đổi; hiện `advisory` (cảnh báo, vẫn cho dừng) tới khi baseline xanh → đổi `block` |

> 3 hook đầu = ép 3 bất biến §2 CLAUDE.md. Hook chặn nhầm → **sửa pattern hook, KHÔNG bypass**. CI mirror: `.github/workflows/ci.yml` (RLS gate).

---

## 4. Workflows (`.claude/workflows/`) — bộ não đa-agent (Workflow tool)

| Workflow | Dùng khi | Tự làm gì | Xem trước |
| --- | --- | --- | --- |
| `parallel-lanes` | Fan-out NHIỀU lane song song (mỗi lane 1 worktree + 1 band migration) cho việc đỏ/phức tạp | `pickModel` (crown→Opus) · `pickBuilder`/`pickReviewers` theo domain · pipeline plan→implement→review · crown spawn reviewer độc lập + santa-method · `mergeVerdicts`→`needs_human` | `args:{dryRun:true}` (in routing, 0 token) |
| `auto-loop` | Vòng tự động end-to-end **3 đội** (Phân tích→Thực thi→Review, FAIL trả về phân tích) tới khi hết READY/cạn budget | Đội1 `tech-lead`/`project-analyst` → Đội2 builder (db nối tiếp) → Đội3 `completion-evaluator`+`qa`+(`security`) → PASS: `deploy-gate` auto-merge; FAIL: re-analyze | `args:{}` (dryRun mặc định) |
| `gap-analysis-mvp` | Soi KHOẢNG CÁCH spec/docs ↔ code thật từng module → đề xuất Work Orders (id·zone·paths·done_when·effort) | 1 agent read-only/module → trả WO codeable còn thiếu để tổng hợp vào `backlog.mjs` | READ-ONLY mặc định |

**Routing tự động trong `parallel-lanes` / `auto-loop`** (deterministic theo regex trên `task`/`paths`):

| Tín hiệu | Builder | Reviewer kèm |
| --- | --- | --- |
| `migration`·`drizzle`·`schema`·`rls`·`_journal`·`/db/` | `db-migration` (Opus, nối tiếp) | `rls-tenant-isolation-tester` |
| `permission`·`auth`·`secret`·`audit`·`encrypt`·`token` HOẶC gate=FULL | builder theo domain | `security-reviewer` (+silent-failure) |
| `react`·`.tsx`·`component`·`form`·`web`·`ui`·`màn hình` | `frontend-builder` | `completion-evaluator` (chất lượng FE) |
| còn lại (service/controller/repo API) | `backend-builder` | `completion-evaluator` (baseline DoD) |
| crown-jewel (mọi vùng đỏ) | + Opus + plan | + `santa-method` + `quality-gate` |

> Lưu ý runtime: reviewer mô tả `database-reviewer`/`silent-failure-hunter`/`react-reviewer`/`typescript-reviewer` được **ánh xạ về agent THẬT** (`rls-tenant-isolation-tester` · `security-reviewer` · `completion-evaluator`) trong `parallel-lanes.mjs` — `ecc:*` KHÔNG tồn tại ở runtime này.

---

## 5. Zone → model · gate · autonomy (rút gọn `harness/policy.md`)

| zone | Diff chạm | Model | Gate | Auto-commit | Người chốt |
| --- | --- | --- | --- | --- | --- |
| 🟢 **green** | CRUD · list/detail · form · dashboard UI · docs · style · dời route | Sonnet | LIGHT (`typescript-reviewer` + `quality-gate`) | ✅ khi check xanh | ❌ |
| 🟡 **yellow** | workflow phê duyệt (nghỉ phép/điều chỉnh công) · task · noti · FE dữ liệu nhạy cảm HR (mask) | Sonnet/Opus | LIGHT + test logic | ✅ khi xanh | ⚠️ xem trước merge lớn |
| 🔴 **red** | permission · RLS · secret/encrypt · audit · auth (login/token) · migration | **Opus** | **FULL** (`security` + RLS-tester + silent-failure [+`santa-method`]) | ❌ | ✅ **luôn người** |

**Đường nhanh việc nhỏ (fast lane):** ≤30 dòng/≤2 file + sạch đỏ + loại text/i18n/docs/đổi-tên/style/dời-route → main-loop sửa thẳng + `check.sh --quick`. KHÔNG plan · KHÔNG reviewer độc lập · KHÔNG Opus · KHÔNG Workflow. Nghi ngờ nhạy cảm → KHÔNG trivial (fail-closed).

**Thang leo khi kẹt:** L0 Sonnet → L1 +effort+nạp lại context → L2 ↑Opus → L3 Opus+santa-method → **L4 ⛔ người chốt (trần cứng)**. Stop-rule: 2 vòng chưa ra gốc → dừng-có-trạng-thái, ghi memory, KHÔNG chồng fix mù.

---

## 6. Skills (Skill tool)

| Skill | Dùng khi |
| --- | --- |
| `skill-smith` (project, `.claude/skills/`) | Đóng băng ma sát lặp ≥2 lần (ghi ở `handoff.md`) / thủ tục tay ≥3 lần → thành skill. Từ chối one-off |
| `frontend-design` | Khi dựng/đổi UI mới — hướng thẩm mỹ, typography, tránh "templated default" |
| `code-review` / `simplify` | Review diff hiện tại (bug + reuse/simplify) · `simplify` = chỉ dọn chất lượng. `code-review ultra` = review đám mây đa-agent |
| `verify` / `run` | Chạy app thật để xác minh một thay đổi/PR hoạt động (không chỉ test) |
| `deep-research` | Báo cáo nghiên cứu đa nguồn, fact-check có trích dẫn |
| `loop` / `schedule` | Lặp một prompt/slash-command theo chu kỳ · tạo cloud agent theo cron |
| `claude-api` | Tra cứu Claude API/SDK (model id, pricing, tool use, caching) trước khi code phần LLM |
| `update-config` / `fewer-permission-prompts` / `keybindings-help` | Sửa `settings.json` (hooks/permissions/env) · giảm prompt quyền · keybinding |

> Skill `skills` tĩnh của một WO khai trong `backlog.mjs` (vd `skills: ['frontend-design', 'code-review']`); workflow chèn vào prompt builder.

---

## 7. Map nhanh: task → công cụ

| Tôi đang làm… | Dùng |
| --- | --- |
| Mở phiên / biết làm gì tiếp | `bash harness/init.sh` → `docs/STATUS.md` → 1 WO `in_progress` |
| Schema/migration/RLS | agent `db-migration` (nối tiếp) → cổng `rls-tenant-isolation-tester` + `security-reviewer` |
| Module BE (service/repo/DTO + audit) | agent `backend-builder` → gate FULL nếu chạm permission/audit/auth |
| Màn hình/form FE | agent `frontend-builder` (+ skill `frontend-design`) → `completion-evaluator` |
| Permission/auth/secret/audit (crown) | **red zone** → Opus + plan + `security-reviewer` + **người chốt**; quét trước bằng `red-zone-scanner` |
| Phân rã 1 module lớn thành lane | agent `tech-lead` (read-only) → fan-out `parallel-lanes` |
| Tìm việc còn thiếu so với spec | workflow `gap-analysis-mvp` → tổng hợp WO vào `backlog.mjs` |
| Chạy tự động end-to-end nhiều WO | workflow `auto-loop` (`args:{dryRun:false}`) |
| Review trước commit | skill `code-review` · vùng đỏ → agent `security-reviewer` |
| Đóng phase / chấm DoD | agent `completion-evaluator` |
| Build/typecheck đỏ | agent `devops-ci` (root-cause; CẤM `@ts-ignore`/`eslint-disable`) |
| Đóng việc + commit an toàn | `bash harness/finish.sh` → green/yellow xanh → `deploy-gate` mở PR + auto-merge |

---

## 8. Lệnh tham chiếu nhanh

```bash
# Harness
bash harness/init.sh              # mở phiên
bash harness/check.sh --quick     # lint+typecheck nhanh (--all: +build, tiền-merge)
bash harness/finish.sh            # đóng phiên: full check + backlog + handoff
node harness/claim.mjs list       # ai đang giữ WO nào

# Dự án (Node ≥20, pnpm 11)
pnpm dev | build | lint | typecheck | test | format
pnpm db:up | db:down | db:migrate
pnpm --filter @mediaos/api db:generate     # sinh migration từ schema
bash scripts/lane-db-setup.sh <lane>       # DB cô lập theo lane (chống shared-DB drift)
pnpm dashboard                              # trực quan tiến độ

# Workflow (Workflow tool)
Workflow{ name:'parallel-lanes', args:{ dryRun:true, lanes:[…] } }   # xem trước routing
Workflow{ name:'auto-loop',      args:{ dryRun:false } }             # vòng 3 đội thật
Workflow{ name:'gap-analysis-mvp' }                                 # soi gap spec↔code
```

**Cấu trúc code:** `apps/api` (NestJS modular monolith — duy nhất) · `apps/auth` (đăng nhập) · `apps/console` (quản trị) · `apps/app` (vỏ nghiệp vụ hợp nhất — đang dựng). Packages: `contracts` (Zod = nguồn sự thật DTO) · `ui` (shadcn) · `web-core` (auth store·api-client·use-can·i18n). CI: `ci.yml` · `api.yml` · `apps-frontend.yml` · `auto-merge.yml`.

---

_Liên kết: `CLAUDE.md` (hợp đồng) · `AGENTS.md` (contract gọn) · `harness/policy.md` (zone→routing) · `harness/team.md` (roster) · `harness/AUTOMATION-LOOP.md` (vòng 3 đội) · `harness/backlog.mjs` (Work Order) · `docs/spec/` + `docs/README.md` §8 (sản phẩm) · `docs/DECISIONS/` (quyết định)._
