# Cost Report — Claude Code (GX-6)

> Đóng GX-6 (`TASKS.md §GX`): **theo dõi chi phí Claude Code** (`ecc:cost-tracking`) + **định tuyến
> model**. Doc-only — KHÔNG production code. Hai nửa của GX-6:
>
> 1. **Định tuyến model** — ĐÃ TỰ ĐỘNG (xem §1). Không cần làm gì thêm.
> 2. **Theo dõi chi phí** — quy trình bật + báo cáo mẫu (xem §2–§4).

Liên quan: [`../../CLAUDE.md`](../../CLAUDE.md) §6 (routing) · [`../AUTOMATION-PLAYBOOK.md`](../AUTOMATION-PLAYBOOK.md) §14 (model theo việc) · skill `ecc:cost-tracking` · command `/ecc:cost-report`.

---

## 1. Định tuyến model — ĐÃ THỎA (tự động)

Nửa "định tuyến model" của GX-6 đã được codify và **chạy tự động** trong workflow `parallel-lanes`
(`CLAUDE.md §6`, quyết định 2026-06-12). Không chọn tay nữa:

| Loại việc                                                                                            | Model                     | Plan-step                        |
| ---------------------------------------------------------------------------------------------------- | ------------------------- | -------------------------------- |
| **Crown-jewel** (payroll · permission/RLS · secret/KMS · finance · KPI · workflow FSM · audit · ADR) | **Opus**                  | ✅ planner Opus micro-plan trước |
| **Việc thường** (kể cả 🤖 CRUD/UI/docs)                                                              | **Sonnet**                | ❌ code thẳng                    |
| **Override tay**                                                                                     | `lane.model` / `skipPlan` | theo tier                        |

- Quyết định 2026-06-12: **KHÔNG dùng Haiku** (thận trọng chất lượng) — khác bảng gợi ý cũ trong
  playbook §14 (Haiku cho 🟢). Bảng `CLAUDE.md §6` là nguồn sự thật hiện hành.
- Xem trước routing **0 token**: bung `parallel-lanes` với `args.dryRun:true` → in bảng rồi dừng.
- Việc solo 1 phiên (không qua workflow): skill `/ecc:model-route` gợi ý tier.

---

## 2. Theo dõi chi phí — cách BẬT (`ecc:cost-tracking`)

Skill `ecc:cost-tracking` đọc DB SQLite local `~/.claude-cost-tracker/usage.db` (1 dòng / lần gọi
tool hoặc tương tác model). Báo cáo qua `/ecc:cost-report` hoặc skill. Điều kiện:

```bash
# 1) sqlite3 trên PATH
command -v sqlite3 >/dev/null && echo "sqlite3 OK" || echo "sqlite3 THIẾU → cài (winget/apt/brew)"

# 2) DB tồn tại (do hook/plugin cost-tracker ghi)
test -f ~/.claude-cost-tracker/usage.db && echo "DB OK" || echo "DB CHƯA CÓ → bật hook cost-tracker"
```

**Trạng thái máy hiện tại (2026-06-16):** `sqlite3` THIẾU + `~/.claude-cost-tracker/usage.db` CHƯA
CÓ ⇒ chưa có dữ liệu thật. Bật thật cần (việc người vận hành, **ngoài repo app này**):

1. Cài `sqlite3`.
2. Bật một cost-tracker hook đáng tin (ghi `usage` rows vào `~/.claude-cost-tracker/usage.db`).
   Đây là sửa `~/.claude/settings.json` **toàn cục** — KHÔNG tự động sửa trong lane này (giới hạn
   trung thực: không cài hook chạy mã tuỳ ý thay người dùng).
3. Sau khi có dữ liệu: `/ecc:cost-report` (hoặc skill `ecc:cost-tracking`) sinh báo cáo thật.

> Schema `usage` kỳ vọng: `timestamp · project · tool_name · input_tokens · output_tokens ·
cost_usd · session_id · model`. **Ưu tiên `cost_usd`** (giá model/cache đổi theo thời gian — tracker
> là nguồn sự thật), KHÔNG hard-code giá hiện hành.

---

## 3. Truy vấn báo cáo (chạy khi đã có DB)

```bash
# Tóm tắt nhanh: hôm nay / tổng / số call / số session
sqlite3 ~/.claude-cost-tracker/usage.db "
  SELECT 'Today: $' || ROUND(COALESCE(SUM(CASE WHEN date(timestamp)=date('now') THEN cost_usd END),0),4) ||
         ' | Total: $' || ROUND(COALESCE(SUM(cost_usd),0),4) ||
         ' | Calls: ' || COUNT(*) || ' | Sessions: ' || COUNT(DISTINCT session_id)
  FROM usage;"

# Chi phí theo project
sqlite3 -header -column ~/.claude-cost-tracker/usage.db "
  SELECT project, ROUND(SUM(cost_usd),4) AS cost, COUNT(*) AS calls
  FROM usage GROUP BY project ORDER BY cost DESC;"

# Chi phí theo model (kiểm định tuyến §1: crown→Opus, thường→Sonnet)
sqlite3 -header -column ~/.claude-cost-tracker/usage.db "
  SELECT model, ROUND(SUM(cost_usd),4) AS cost, COUNT(*) AS calls
  FROM usage GROUP BY model ORDER BY cost DESC;"

# 7 ngày gần nhất
sqlite3 -header -column ~/.claude-cost-tracker/usage.db "
  SELECT date(timestamp) AS date, ROUND(SUM(cost_usd),4) AS cost, COUNT(*) AS calls
  FROM usage GROUP BY date(timestamp) ORDER BY date DESC LIMIT 7;"
```

---

## 4. Báo cáo MẪU (minh hoạ định dạng — **KHÔNG phải số thật**)

> ⚠️ Số dưới đây là **ví dụ định dạng** để biết báo cáo trông ra sao khi tracking đã bật. KHÔNG bịa
> chi phí thật — DB chưa cấu hình (xem §2). Khi có dữ liệu, thay bằng output `/ecc:cost-report`.

```text
Cost Report (mẫu) — 2026-06-16
Today: $0.0000 | Total: $0.0000 | Calls: 0 | Sessions: 0   ← (chưa có DB → toàn 0)
```

Khi đã có dữ liệu, báo cáo nên gồm (theo "Reporting Guidance" của skill):

| Mục                            | Ví dụ minh hoạ                                                              |
| ------------------------------ | --------------------------------------------------------------------------- |
| Hôm nay vs hôm qua             | `$X.XX` (hôm nay) · `$Y.YY` (hôm qua)                                       |
| Tổng tích luỹ                  | `$Z.ZZ`                                                                     |
| Top project theo chi phí       | `mediaos` · `news-ai-mvp` …                                                 |
| Top tool theo chi phí          | `Agent` · `Workflow` · `Bash` …                                             |
| Theo model (kiểm routing)      | `Opus` (crown) · `Sonnet` (thường) — kỳ vọng phần lớn token thường ở Sonnet |
| Session: số phiên + chi phí TB | `N` phiên · `$avg`/phiên                                                    |

> Mẹo đối soát GX-6: nếu báo cáo theo-model cho thấy **Opus chiếm phần lớn token việc-thường** ⇒
> routing lệch (đáng lẽ Sonnet). Dùng để tinh chỉnh `pickModel()` / override `lane.model`.

---

## 5. Giới hạn trung thực

- KHÔNG bịa số chi phí khi `cost_usd`/DB vắng (anti-pattern của skill).
- KHÔNG hard-code giá model hiện hành vào doc/đáp (giá đổi theo thời gian).
- KHÔNG tự cài hook cost-tracker toàn cục thay người dùng (mã chạy tuỳ ý — việc người vận hành chốt).
- File này là **doc + quy trình**, không thêm production code (đúng phạm vi GX-6 🟢).
