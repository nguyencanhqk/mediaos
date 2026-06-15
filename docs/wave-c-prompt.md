# Wave C — Prompt chạy song song (soạn 2026-06-14)

> Dán nguyên 1 batch vào **PHIÊN MỚI** (mở phiên mới sau mỗi run nặng — bài học runtime kẹt). Bám `TASKS.md §5` + `CLAUDE.md §6/§9`. Mỗi lane 1 worktree riêng + 1 band migration riêng. DB cô lập `mediaos_<lane>` khi verify (`bash scripts/lane-db-setup.sh <lane> --reset`).

## Trạng thái nền (master @ `1a4094a`, verify 2026-06-14)
- Master **XANH**: api **1167 pass / 2 skip / 0 fail** (DB cô lập `mediaos_master`, chain 0000→latest = 65 migration sạch, 72 bảng forced-RLS).
- ⚠️ Harness: `pnpm test` qua **turbo KHÔNG truyền `LANE_DB`** → test int rơi về DB chung `mediaos` (drift, 54 bảng) → 22 fail giả. **Verify đúng:** `cd apps/api && LANE_DB=mediaos_<lane> pnpm exec vitest run` (bỏ turbo). Cần vá: thêm `LANE_DB` vào `turbo.json` passthrough env.
- Đã land hết: G4–G11, G12-1, G13-1/2, G14/G14-2. Worktree cũ g8/g9/g10/g12/g14 đã dọn; **g13-finance giữ lại** (có G13-3 WIP).

## Còn nợ (toàn dự án)
| Lane | Việc | Tier/Model | Band mig | Phụ thuộc | Worktree |
|---|---|---|---|---|---|
| **A** | G8-4 KPI (task xong·deadline·điểm·lỗi loại1/2·tỷ lệ duyệt lần đầu; ban đầu=tham khảo, HR xác nhận trước khi vào lương) | 🔋 crown Opus +plan | 0086+ | eval+defect+task ✅ | mới `feat/g8-kpi` |
| **B** | G13-3 Profit snapshot (DT−CPtrực tiếp−CPphân bổ, bất biến) **+** G13-4 Expense Request (đề xuất chi→Task Hub `finance`→sinh cost) | 🔋 crown Opus | 0075+ | revenue+cost ✅; **G13-3 có WIP `6b441a5`** | dùng `mediaos-g13-finance` |
| **C** | G14-3 Materialized views + cảnh báo (task trễ/lỗi nghiêm trọng/kênh rủi ro) + filter tháng/kênh/project/phòng ban · tick xác nhận G14-1 | 🟢 Sonnet | 0102+ | data ✅ | mới `feat/g14-matviews` |
| **D** | G12-2 Payroll period + payslip **snapshot append-only** (công/KPI/thưởng/phạt→payslip; app role không UPDATE/DELETE) | 🔋🔋 crown Opus +plan | 0093+ | G11 ✅ (KPI/bonus = input sau) | mới `feat/g12-period` |

Sau Wave C: **G12-3 Bonus/Penalty** + **G12-4 Duyệt bảng lương + re-auth payslip** (cần KPI lane A) → **G15 Mobile** → **G16 SaaS/Hardening** → dọn nợ **GX** (GX-4 PgBouncer×RLS CI assert, GX-5 backup+harness-audit, GX-8 automation playbook) + **task_attachments** (upload file, descoped G4-4/G9-2).

---

## ▶️ BATCH 1 — Lane A (KPI) + Lane D (Payroll period) — 2 crown

```
Chạy Wave C BATCH 1 cho MediaOS: 2 lane crown SONG SONG, mỗi lane worktree + band migration riêng, DB cô lập khi verify.

LANE A — G8-4 KPI (crown Opus, plan trước):
- Worktree mới: git worktree add -b feat/g8-kpi ../mediaos-g8-kpi master
- Band migration 0086+ (0083-0085 đã dùng cho eval). Bảng kpi_definitions/kpi_results (append-only, RLS+FORCE, audit). Công thức KPI = TDD deny-path RED trước, test kỹ. "Ban đầu = tham khảo" (BR-007): KPI không tự vào lương, cần HR/quản lý xác nhận.
- Verify: bash scripts/lane-db-setup.sh g8kpi --reset → cd apps/api && LANE_DB=mediaos_g8kpi pnpm exec vitest run. FULL gate (crown): security+database+silent-failure + santa-method.

LANE D — G12-2 Payroll period + payslip snapshot (crown Opus, plan trước):
- Worktree mới: git worktree add -b feat/g12-period ../mediaos-g12-period master
- Band migration 0093+ (0090-0092 đã dùng cho salary profile). payroll_periods + payslips (payslip = SNAPSHOT append-only, app role REVOKE UPDATE/DELETE). Aggregate công (G11 attendance ✅); KPI/thưởng/phạt để slot input nối sau khi lane A land. Period lock đã có trigger G11 F7 (0064).
- Verify: bash scripts/lane-db-setup.sh g12period --reset → cd apps/api && LANE_DB=mediaos_g12period pnpm exec vitest run. FULL gate (crown payroll): security+database+silent-failure + santa-method. re-auth khi xem payslip để G12-4.

Bám CLAUDE.md §6 (model/gate/reviewer auto), §9 (1 worktree/lane, band riêng, hot-file = append, DB cô lập). Hot-file append-only: audit object_types CHECK = UNION (KHÔNG drop type lane khác), permission seed ON CONFLICT DO NOTHING, schema/index.ts + app.module.ts khối additive, journal when > master max. Mỗi lane RED→GREEN→gate→checkpoint; xanh non-sensitive auto-commit wip(gN), đỏ/CRITICAL người chốt. Merge theo thứ tự phụ thuộc, chain 0000→latest apply sạch + test xanh trước khi land.
```

## ▶️ BATCH 2 — Lane B (Finance) + Lane C (Dashboard) — 1 crown + 1 sonnet (sau khi Batch 1 land hoặc phiên khác)

```
Chạy Wave C BATCH 2 cho MediaOS: 2 lane SONG SONG.

LANE B — G13-3 Profit + G13-4 Expense (crown Opus):
- Worktree CÓ SẴN: ../mediaos-g13-finance (đã có G13-3 WIP `6b441a5`: profit.service/repo + finance-profit-deny.int-spec, 987 dòng). TRƯỚC TIÊN: cd mediaos-g13-finance && git merge master (đồng bộ master mới) → giải reconcile.
- G13-3: thêm migration profit_snapshots (band 0075+, append-only RLS+FORCE) — WIP chưa có migration. Profit = DT − CP trực tiếp − CP phân bổ, snapshot bất biến theo công ty/kênh/project/video.
- G13-4 Expense Request: đề xuất chi → duyệt qua Task Hub (task_type=finance) → sau duyệt sinh cost record. Tái dùng tasks G9 (KHÔNG bảng task riêng).
- Verify: bash scripts/lane-db-setup.sh g13 --reset → cd apps/api && LANE_DB=mediaos_g13 pnpm exec vitest run. FULL gate (crown finance) + santa.

LANE C — G14-3 Materialized views + cảnh báo (Sonnet):
- Worktree mới: git worktree add -b feat/g14-matviews ../mediaos-g14-mat master
- Band migration 0102+ (0100-0101 đã dùng). Materialized view tổng hợp + refresh strategy; cảnh báo task trễ / lỗi nghiêm trọng / kênh rủi ro; filter tháng/kênh/project/phòng ban. Tick xác nhận G14-1 (dashboard theo role đã phủ bởi 633ba22).
- Verify: bash scripts/lane-db-setup.sh g14 --reset → cd apps/api && LANE_DB=mediaos_g14 pnpm exec vitest run. LIGHT gate.

Bám CLAUDE.md §6/§9 như Batch 1.
```

---
**Lưu ý vận hành (memory):** ≤2 lane crown Opus/lượt (4 crown ≈21 agent Opus → rate-limit giết agent). Sau run nặng Workflow runtime có thể KẸT cả phiên → mở PHIÊN MỚI cho batch sau. Đối chiếu git log + timestamp mỗi run. Mỗi worktree mới: `cp ../MediaOS/.secrets/local-kek.bin .secrets/` (gitignore không theo `worktree add` → thiếu KEK = int-spec đỏ giả).
