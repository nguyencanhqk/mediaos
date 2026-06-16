# Harness Audit — 2026-06-16 (GX-5)

> Lượt `ecc:harness-audit` cuối nhánh G16/GX, chạy tất định trên cây làm việc `feat/gx-ops`
> (off master `10acafb`). Engine = `scripts/harness-audit.js` (ECC, rubric `2026-03-30`), nguồn sự
> thật chấm điểm — KHÔNG chấm tay. Tái lập: cùng commit ⇒ cùng điểm.

```bash
node "<ECC>/scripts/harness-audit.js" repo --format text --root .
```

## Scorecard — **25 / 29** (chế độ `consumer`)

| Category            | Score    | Earned / Max | Ghi chú                                                              |
| ------------------- | -------- | ------------ | -------------------------------------------------------------------- |
| Tool Coverage       | 10/10    | 7/7          | ECC cài + override `.claude/` của dự án                              |
| Context Efficiency  | 10/10    | 5/5          | có CLAUDE.md/AGENTS.md + config dự án                                |
| Quality Gates       | 10/10    | 7/7          | test entrypoint + CI workflow checked-in                             |
| Memory Persistence  | 10/10    | 2/2          | ghi chú/memory bền                                                   |
| Eval Coverage       | **0/10** | **0/2**      | ❌ thiếu `evals/` (xem gap G1)                                       |
| Security Guardrails | **7/10** | **4/6**      | ❌ thiếu `SECURITY.md` (gap G2); ✅ secret-hygiene + hook guardrails |
| Cost Efficiency     | —        | 0/0          | không tính trong chế độ consumer                                     |

**Checks: 11 total, 2 failing.**

## Gap (failing checks) — backlog, KHÔNG chặn GX-5

| #   | Category            | Action                                                                            | Path          | Điểm |
| --- | ------------------- | --------------------------------------------------------------------------------- | ------------- | ---- |
| 1   | Eval Coverage       | Thêm eval fixtures hoặc vài test tự động cho luồng tới hạn                        | `evals/`      | 2    |
| 2   | Security Guardrails | Thêm `SECURITY.md` hoặc cấu hình quét dependency/code để công bố security posture | `SECURITY.md` | 2    |

### Diễn giải (đánh giá trung thực)

- **Gap #1 (eval) là điểm rubric về thư mục `evals/`, KHÔNG phải "thiếu test".** Dự án có **>1900
  test** (vitest, api) + CI — quality-gate đã 7/7. Đây là khoảng trống _cấu trúc eval-fixtures_ riêng,
  chấp nhận để mở; nếu muốn lấy 2 điểm: thêm `evals/` với vài fixture luồng tới hạn (permission deny,
  payroll snapshot, RLS isolation) — gắn vào sau, không thuộc phạm vi ops GX-5.
- **Gap #2 (`SECURITY.md`):** dự án đã có 3 hook guard bất biến + FULL gate cho vùng nhạy cảm, nhưng
  chưa có file `SECURITY.md` công bố quy trình báo lỗi/posture. Việc nhẹ, đưa vào backlog GX/G-security.
- Hai gap đều là **doc/cấu trúc**, không phải lỗ hổng runtime — vì vậy không chặn đóng GX-5.

## Hành động

- Ghi 2 gap vào backlog (không tự thêm `evals/` hay `SECURITY.md` trong lane ops này — ngoài phạm vi).
- Lượt audit kế: cuối phase G tiếp theo, ghi `docs/ops/harness-audit-<ngày>.md` mới, so delta điểm.
- Cadence & cách chạy: [`ops-runbook.md`](ops-runbook.md) §4.
