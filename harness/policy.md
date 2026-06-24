# harness/policy.md — Luật tự động hoá phân tầng (zone → model · gate · autonomy · thang leo)

> Nguồn sự thật cho "việc này được tự động tới đâu". Bộ THỰC THI là `.claude/workflows/parallel-lanes.mjs`
> (`pickModel/pickReviewers/pickSkills`) + 6 hook `.claude/hooks/`. File này = ý định, để đọc nhanh.

## Zone của một Work Order (gắn trong `backlog.mjs`)

| zone | Diff chạm | Model | Gate | Auto-fix | Auto-commit | Người chốt |
| --- | --- | --- | --- | --- | --- | --- |
| 🟢 **green** | CRUD · list/detail · form · dashboard UI · docs · style · dời route | Sonnet | LIGHT (`typescript-reviewer` + `quality-gate`) | ✅ | ✅ khi check xanh | ❌ |
| 🟡 **yellow** | workflow phê duyệt (nghỉ phép/điều chỉnh công) · task · noti · FE dữ liệu nhạy cảm HR (mask) | Sonnet/Opus | LIGHT + test logic | ✅ báo diff | ✅ khi xanh | ⚠️ xem trước merge lớn |
| 🔴 **red** | permission · RLS · secret/encrypt · audit · auth (login/token) · migration | **Opus** | **FULL** (`security` + `database` + `silent-failure` [+ `santa-method`]) | ❌ không sửa mù | ❌ | ✅ **luôn người** |

Phát hiện crown-jewel tự động (regex trong parallel-lanes): permission/RLS/policy · secret/envelope/encrypt/KMS ·
auth/token · workflow phê duyệt (FSM/DAG) · audit append-only · ADR · (Phase 2: payroll/lương/payslip).
De-media-fy 2026-06-20: bỏ finance/revenue/cost/profit/ledger/KPI (subsystem parked).

> **Khoanh vùng đỏ chính xác = agent `red-zone-scanner`** (`.claude/agents/`). Regex `CROWN_JEWEL` soi tiêu đề + `RED_PATHS`
> soi đường dẫn là **sàn rẻ trong brain** (thiên Opus, fail-closed); scanner đọc **diff/file thật** vẽ bản đồ zone theo
> từng hunk — bắt ca "tiêu đề/đường dẫn xanh nhưng nội dung chạm đỏ". Gọi TRƯỚC khi route/merge khi nghi ngờ.

## Đường nhanh việc nhỏ (fast lane — chống over-process)

> Mặc định v2: cỗ máy đa-agent (`parallel-lanes`/`auto-loop` · plan → review độc lập · Opus) CHỈ dành cho việc
> ĐỎ/phức tạp. Việc nhỏ KHÔNG đi qua máy — main-loop sửa thẳng, rẻ và nhanh. (Trước đây routing over-match
> đẩy cả edit tí hon vào đường nặng ⇒ "rất lâu mới đổi vài chữ".)

**Trivial edit** = main-loop tự `Edit` + `bash harness/check.sh --quick`. KHÔNG plan · KHÔNG reviewer độc lập ·
KHÔNG Opus · KHÔNG gọi Workflow. Điều kiện ĐỦ (phải thoả MỌI gạch đầu dòng):

- ≤ ~30 dòng diff **hoặc** ≤ 2 file;
- KHÔNG chạm vùng đỏ (permission/RLS · secret/encrypt · audit · auth/token · migration/schema · FSM phê duyệt · ADR) — đụng 1 cái là hết trivial, theo zone 🔴;
- loại việc: text/i18n/copy · comment/docs · đổi tên cục bộ · style · dời route · tinh chỉnh UI thuần.

Nghi ngờ nhạy cảm → KHÔNG trivial (fail-closed). Lane lỡ route vào `parallel-lanes` nhưng thực ra nhỏ + sạch đỏ:
hạ cấp tay bằng `skipPlan:true` + `noReview:true` (hoặc `model:'sonnet'`) — đây là dạng "cổng kích thước" thủ công.

## Đường nhanh việc nhỏ (fast lane — chống over-process)

> Mặc định v2: cỗ máy đa-agent (`parallel-lanes`/`auto-loop` · plan → review độc lập · Opus) CHỈ dành cho việc
> ĐỎ/phức tạp. Việc nhỏ KHÔNG đi qua máy — main-loop sửa thẳng, rẻ và nhanh. (Trước đây routing over-match
> đẩy cả edit tí hon vào đường nặng ⇒ "rất lâu mới đổi vài chữ".)

**Trivial edit** = main-loop tự `Edit` + `bash harness/check.sh --quick`. KHÔNG plan · KHÔNG reviewer độc lập ·
KHÔNG Opus · KHÔNG gọi Workflow. Điều kiện ĐỦ (phải thoả MỌI gạch đầu dòng):

- ≤ ~30 dòng diff **hoặc** ≤ 2 file;
- KHÔNG chạm vùng đỏ (permission/RLS · secret/encrypt · audit · auth/token · migration/schema · FSM phê duyệt · ADR) — đụng 1 cái là hết trivial, theo zone 🔴;
- loại việc: text/i18n/copy · comment/docs · đổi tên cục bộ · style · dời route · tinh chỉnh UI thuần.

Nghi ngờ nhạy cảm → KHÔNG trivial (fail-closed). Lane lỡ route vào `parallel-lanes` nhưng thực ra nhỏ + sạch đỏ:
hạ cấp tay bằng `skipPlan:true` + `noReview:true` (hoặc `model:'sonnet'`) — đây là dạng "cổng kích thước" thủ công.

## Sàn cứng (không bypass — `.claude/hooks/`, PreToolUse)

`guard-tenant` · `guard-secrets` · `guard-immutability` (3 bất biến) · `anti-bandaid-guard`
(chặn `catch{}` rỗng / `@ts-ignore` / `eslint-disable` / `.skip`/`.only` / TODO-fix vùng đỏ) ·
`guard-migration-band` · **`guard-scope` (cảnh báo khi sửa ngoài `paths` của Work Order — warn-only)** ·
**`guard-claim` (claim-on-touch theo `session_id`; cảnh báo khi HAI PHIÊN cùng giữ một Work Order — warn-only, sổ chung mọi worktree ở `.git/mediaos-claims/`; xem `node harness/claim.mjs list`)** ·
**branch-level: cảnh báo khi ≥2 phiên cùng làm trên MỘT branch (xem `node harness/claim.mjs branch`)**.

## Đa-phiên cùng branch (⑦ — chống giẫm chân)

> Bài học 2026-06-23: hai phiên/người cùng commit trên `feat/foundation-wave1` → đè/clobber nhau (commit lạc, revert edit uncommitted của nhau, PR rác). Đây là sự cố THẬT trong một phiên.

**LUẬT: 1 phiên CẦM 1 branch tại 1 thời điểm.** Ép mềm TỰ ĐỘNG (warn-only, fail-open — không bẫy người):

- `guard-claim` (PreToolUse mọi Edit) thấy phiên khác cùng branch → **CẢNH BÁO ngay**: "branch X có N phiên khác — thống nhất AI CẦM".
- Phân biệt phiên = `session_id`; claim refresh mỗi Edit, hết hạn 8h hoặc nhả khi Stop; sổ chung mọi worktree ở `.git/mediaos-claims/`.

**Khi thấy cảnh báo:** dừng → `node harness/claim.mjs branch` xem ai cầm gì. Một phiên giữ branch; phiên kia **tách nhánh riêng** (`git switch -c feat/<việc>`) hoặc **worktree riêng** rồi PR về. Phiên đã chết để lại claim quá hạn → `node harness/claim.mjs prune`.

**Auto-loop live:** chạy `node harness/claim.mjs branch` TRƯỚC; có phiên khác sống trên branch đích → KHÔNG chạy (thống nhất trước). Caveat: `TaskStop` không giết lane con (xem `AUTOMATION-LOOP.md`).

## Routing — mỗi sub-task chọn 4 thứ (⑤)

- **pickModel** (bộ não nào): red→Opus · else Sonnet (KHÔNG Haiku — thận trọng chất lượng, 2026-06-12).
- **pickEffort** (nghĩ sâu tới đâu — TÁCH BẠCH với model): theo zone (fast→`low` · green/yellow→`medium` · crown→`high`) × stage (PLAN crown→`xhigh` là nơi reasoning trả giá nhất · REVIEW đối kháng→`high`). Override BASE bằng `lane.effort`. Escalation L1: mỗi vòng kẹt (`lane.retry`) +1 nấc TRƯỚC khi ↑ Opus (rẻ hơn nhảy model). Thang: `low<medium<high<xhigh<max`.
- **pickReviewers** (auto theo domain): db→`database-reviewer` · sec/payroll/audit hoặc gate=FULL→`security-reviewer`+`silent-failure-hunter` · FE→`react-reviewer` · baseline `typescript-reviewer`.
- **pickSkills**: tĩnh = field `skills` của Work Order (`backlog.mjs`); crown → `santa-method`; mọi lane → `quality-gate`.

## Thang leo khi kẹt (③ — chống "chạy đi chạy lại mãi")

Kích hoạt: gate đỏ > 2 vòng chưa ra gốc · agent tự báo bí · test còn đỏ sau retry.

```
L0  Sonnet (mặc định green/yellow)
L1  cùng model + tăng reasoning effort + NẠP LẠI Work Order & memory   (đã CODE: pickEffort +1 nấc/lane.retry — rẻ)
L2  ↑ Opus                                                              (nâng model — red vào từ đây)
L3  Opus + santa-method (2 agent đối kháng hội tụ) / chuyên gia góc khác
L4  ⛔ NGƯỜI CHỐT — trần cứng
```

Chốt kiểm soát: ① trần số vòng · ② trần token/feature · ③ stop-rule (2 vòng chưa ra gốc → dừng, ghi
memory, KHÔNG chồng fix mù) · ④ mọi lần leo ghi run-journal. → tệ nhất là **dừng-có-trạng-thái cho người**,
không bao giờ là vòng lặp chết.

## Cổng kết phiên + thang kiểm chứng + auto-merge (thêm 2026-06-19)

- **Thang kiểm chứng (`harness/check.sh`)**: `--quick` (lint+typecheck, không DB) ◀ Stop-gate · mặc định (+test) · `--all` (+build) ◀ tiền-merge.
- **Stop-gate (`.claude/hooks/stop-gate.mjs`, Stop hook)**: kết phiên ⇒ lint+typecheck CHỈ workspace vừa đổi (git porcelain). `MODE='advisory'` (in cảnh báo, vẫn cho dừng) cho tới khi baseline xanh; đổi `'block'` ⇒ đỏ thì chặn (exit 2). Khác repo mẫu (quét cả repo) vì MediaOS là repo sống có baseline đỏ sẵn.
- **skill-smith (`.claude/skills/skill-smith`)**: ma sát lặp ≥2 lần (ghi ở `harness/handoff.md`) hoặc thủ tục tay ≥3 lần ⇒ đóng băng thành skill. Từ chối one-off (chống phình).
- **Auto-merge có kiểm soát**: PR vùng 🟢/🟡 gắn nhãn `auto-merge` ⇒ GitHub squash-merge khi CI `verify` xanh + 1 review NGƯỜI (`.github/workflows/auto-merge.yml`). Bật bằng `bash scripts/setup-github.sh` (một-lần, người chạy). Agent KHÔNG push thẳng `master`.

## KHÔNG tự động (giới hạn trung thực)

Sửa mù vùng đỏ · migration phá dữ liệu · đổi test để qua bug · **auto-merge vùng 🔴 đỏ** (red → KHÔNG gắn nhãn, người merge tay) · đổi ADR.
