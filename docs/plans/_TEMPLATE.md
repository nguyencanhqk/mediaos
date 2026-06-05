# PLAN — <Mã task/phase> <Tên ngắn>

> Bắt buộc tạo TRƯỚC khi viết code (AUTOMATION-PLAYBOOK §11). Rà soát bằng agent `plan-reviewer` tới khi PASS rồi mới code.
> Copy file này → `docs/plans/<mã>-<tên>.md` (vd `G4-5-approval.md`).

## Meta

- **Mã:** G_-_ · **Phase:** G_ · **Mốc:** M_
- **Vùng rủi ro chủ đạo:** 🟢 xanh / 🟡 vàng / 🔴 đỏ _(xem PLAYBOOK §2)_
- **Model chính:** Haiku / Sonnet / Opus
- **Ước lượng:** S / M / L / XL

## 1. Mục tiêu

_Một câu: phase này làm xong thì hệ thống làm được gì mà trước đó không._

## 2. Scope

**Trong:** …
**Ngoài (không làm lần này):** …
**Acceptance (từ PRD/TASKS):** liệt kê mã requirement (vd APR-001, BR-005) + tiêu chí Done của phase.

## 3. Phụ thuộc (luật thứ tự — PLAYBOOK §0/CLAUDE §3)

- Cần có TRƯỚC: _(vd: PermissionService G3, withTenant G2-2, outbox G2-4)_
- Đụng schema/lõi chung nào? _(nếu có → tuần tự, không song song)_

## 4. Phân rã micro-step

| # | Bước nhỏ | Vùng | Model | Agent/Skill | Song song? | Test (deny-path trước nếu 🔴/🟡) | DoD bước |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | … | 🟢 | Haiku | typescript-reviewer | — | … | … |
| 2 | … | 🔴 | Opus | tdd-guide + security-reviewer | ❌ | RED: … | … |

> Bước độc lập (khác domain, không đụng schema chung) → đánh dấu "song song ✅" + chạy nhánh riêng/worktree (PLAYBOOK §7).

## 5. Rủi ro & giảm thiểu (PHÒNG RỦI RO — phần quan trọng nhất)

| Rủi ro | Khả năng | Tác động | Giảm thiểu |
| --- | --- | --- | --- |
| Rò chéo tenant (thiếu `company_id`/RLS) | … | 🔴 cao | policy+FORCE RLS trước backfill; test 2-tenant G2-5 |
| Vá triệu chứng thay vì root-cause | … | … | giao thức §5; anti-bandaid-guard |
| Fix lan sang module khác | … | … | regression suite sau mỗi bước; nhánh cô lập |
| _(3 bất biến nào bị động tới?)_ | … | … | … |

## 6. Test plan

- Deny-path RED (vùng 🔴/🟡): liệt kê ca phải đỏ trước khi implement.
- Coverage mục tiêu: ≥80% (permission/payroll cao hơn).
- Regression phải chạy lại: _(vd test isolation 2-tenant, suite phase trước)._

## 7. Commit & merge (PLAYBOOK §6)

- Nhánh: `feat/<mã>-<tên>`
- Micro-commit mỗi bước mục 4. Conventional: `feat(<mã>): …`
- Điều kiện merge: cụm xanh + gate (LIGHT/🟢 · FULL/🔴) đạt + completion-evaluator PASS.

## 8. Rollback

_Nếu hỏng thì lùi thế nào: revert commit nào / migration có reversible không / feature-flag tắt được không._

---

## ✅ Kết quả rà soát plan (`plan-reviewer`)

_(dán verdict: PASS / REVISE + các rủi ro bắt buộc vá. Không code khi còn REVISE.)_

## 🏁 Kết quả đánh giá hoàn thành (`completion-evaluator`)

_(điền khi đóng phase: điểm rubric + PASS/BLOCK + việc còn nợ.)_
