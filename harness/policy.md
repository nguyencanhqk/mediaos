# harness/policy.md — Luật tự động hoá phân tầng (zone → model · gate · autonomy · thang leo)

> Nguồn sự thật cho "việc này được tự động tới đâu". Bộ THỰC THI là `.claude/workflows/parallel-lanes.mjs`
> (`pickModel/pickReviewers/pickSkills`) + 6 hook `.claude/hooks/`. File này = ý định, để đọc nhanh.

## Zone của một Work Order (gắn trong `backlog.mjs`)

| zone | Diff chạm | Model | Gate | Auto-fix | Auto-commit | Người chốt |
| --- | --- | --- | --- | --- | --- | --- |
| 🟢 **green** | CRUD · list/detail · form · dashboard UI · docs · style · dời route | Sonnet | LIGHT (`typescript-reviewer` + `quality-gate`) | ✅ | ✅ khi check xanh | ❌ |
| 🟡 **yellow** | workflow logic · task hub · noti · KPI calc · chat realtime · FE payroll(mask) | Sonnet/Opus | LIGHT + test logic | ✅ báo diff | ✅ khi xanh | ⚠️ xem trước merge lớn |
| 🔴 **red** | permission · RLS · secret/encrypt · payroll · finance snapshot · audit · migration | **Opus** | **FULL** (`security` + `database` + `silent-failure` [+ `santa-method`]) | ❌ không sửa mù | ❌ | ✅ **luôn người** |

Phát hiện crown-jewel tự động (regex trong parallel-lanes): payroll/lương/payslip · permission/RLS/policy ·
secret/envelope/encrypt/KMS · finance/revenue/cost/profit/ledger · KPI · FSM/DAG · audit append-only · ADR.

## Sàn cứng (không bypass — `.claude/hooks/`, PreToolUse)

`guard-tenant` · `guard-secrets` · `guard-immutability` (3 bất biến) · `anti-bandaid-guard`
(chặn `catch{}` rỗng / `@ts-ignore` / `eslint-disable` / `.skip`/`.only` / TODO-fix vùng đỏ) ·
`guard-migration-band` · **`guard-scope` (cảnh báo khi sửa ngoài `paths` của Work Order — warn-only)** ·
**`guard-claim` (claim-on-touch theo `session_id`; cảnh báo khi HAI PHIÊN cùng giữ một Work Order — warn-only, sổ chung mọi worktree ở `.git/mediaos-claims/`; xem `node harness/claim.mjs list`)**.

## Routing — mỗi sub-task chọn 3 thứ (⑤)

- **pickModel**: red→Opus · else Sonnet (KHÔNG Haiku — thận trọng chất lượng, 2026-06-12).
- **pickReviewers** (auto theo domain): db→`database-reviewer` · sec/payroll/audit hoặc gate=FULL→`security-reviewer`+`silent-failure-hunter` · FE→`react-reviewer` · baseline `typescript-reviewer`.
- **pickSkills**: tĩnh = field `skills` của Work Order (`backlog.mjs`); crown → `santa-method`; mọi lane → `quality-gate`.

## Thang leo khi kẹt (③ — chống "chạy đi chạy lại mãi")

Kích hoạt: gate đỏ > 2 vòng chưa ra gốc · agent tự báo bí · test còn đỏ sau retry.

```
L0  Sonnet (mặc định green/yellow)
L1  cùng model + tăng reasoning effort + NẠP LẠI Work Order & memory   (nâng context — rẻ)
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
