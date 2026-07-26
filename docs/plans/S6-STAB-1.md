# S6-STAB-1 — Stabilization & Bug Triage (WS2)

> Work Order **S6-STAB-1** — Sprint 6 Workstream **WS2** (🟡 yellow · layer BE).
> Nguồn: `IMPLEMENTATION-09` §11 (WS2 — severity matrix · triage cadence · bug lifecycle ·
> module stabilization checklist §11.5) · `IMP09-IN-004`.
> Luật áp dụng: **`RELEASE-05`** (S6-GOV-1) — freeze 3 tầng §2, thang severity `S0…S4` §5, change
> control §4. Phụ thuộc: `S5-UAT-1` (đã ship).

---

## 1. Cách WO này chấm checklist (chống xanh-giả)

`IMPLEMENTATION-09` §11.5 là 60 ô tick trải 8 nhóm module. Tick bằng cảm nhận là vô giá trị, nên
mỗi ô chỉ được ✅ khi trỏ được về **một trong ba** loại bằng chứng:

| Loại | Nghĩa |
| --- | --- |
| **T** — test | Tên spec file + tên `it()` **đã chạy xanh** trong lần chạy ở §2 |
| **C** — code | Đường dẫn + dòng, cho ràng buộc tĩnh (cấu trúc, ai ghi cờ nào) |
| **L** — live | Cần môi trường chạy (UI/deploy) ⇒ **không tick được ở WO này**, chuyển UAT Cycle 1 / `S6-QA-FINAL-1` |

Ô không có bằng chứng ⇒ ghi **GAP**, phân mức theo `RELEASE-05` §5, vào sổ `RELEASE-02`.

## 2. Bằng chứng chạy

Chạy trên DB cô lập `LANE_DB=mediaos_s6stab1` (Postgres thật) để deny-path/IDOR/cross-tenant
**thực sự thực thi** thay vì `describe.skipIf` bỏ qua.

`bash harness/check.sh --lane-db=s6stab1` một-tiến-trình **ĐỎ** vì `ERR_IPC_CHANNEL_CLOSED`
(**KI-014**, không phải lỗi sản phẩm) ⇒ chạy **chia chunk**. Kết quả + 4 phát hiện: `RELEASE-06` §2/§4.

## 3. Đầu ra

| File | Nội dung |
| --- | --- |
| `docs/plans/S6-STAB-1.md` | File này |
| `docs/RELEASE/RELEASE-06_Stabilization_Checklist_And_Bug_Triage.md` | Checklist 8 nhóm có bằng chứng từng ô + biên bản triage |
| `apps/api/test/integration/goal-be2-link.int-spec.ts` | Fix **STAB-F02** — `outboxOf` lọc `company_id` |
| `apps/api/test/helpers/seed.ts` | Fix **STAB-F03** — đóng cửa sổ đua `audit_logs → companies` khi teardown |
| `docs/RELEASE/RELEASE-02_Known_Issues_MVP.md` | Thêm **KI-021** (3 sự kiện NOTI của ATT không có producer) |

## 4. Vì sao WO này sửa file trong `apps/api/test/**`

`paths` khai ban đầu chỉ có `apps/api/src/**` + `apps/app/src/**` + `docs/RELEASE/**`. Hai lỗi tìm được
lại nằm ở **tầng test**, và cả hai đều sinh **ĐỎ-GIẢ ngẫu nhiên**. Để nguyên thì mọi kết luận "xanh"
của các WO Sprint 6 sau (`S6-QA-FINAL-1`, `S6-SEC-1`, `S6-PERF-DB-1`) đều không đáng tin — đúng định
nghĩa **Operational fix** được nhận sau freeze (`RELEASE-05` §4.1).

⇒ `paths` của WO được **mở rộng thêm `apps/api/test/**`** trong `harness/backlog.mjs` thay vì sửa lén
ngoài phạm vi (bài học: `paths` là cái lái review gate + scheduler).

## 5. Cái WO này KHÔNG làm

- **Không sửa gốc KI-014** (crash IPC khi chạy 1 tiến trình) — đó là `S6-QA-CHUNK-1`, chạm
  `harness/`+CI, ngoài phạm vi WO này. Ở đây chỉ **né** bằng cách chạy chunk và ghi lại.
- **Không mở scope mới**: `KI-021` (ATT thiếu producer NOTI) được phân mức **S2** và **defer** theo
  `RELEASE-05` §4.2 — build job mới là tính năng, không phải bug fix chặn release.
- **Không tick các ô cần môi trường sống** (UI, deploy) — đánh dấu `L`, chuyển UAT Cycle 1.

## 6. Verify

```bash
# 1) tái tạo ĐÚNG điều kiện tranh chấp đã làm đỏ (chunk f–l) → phải 44/44 file · 1.022/1.022 test
cd apps/api && LANE_DB=mediaos_s6stab1 npx vitest run $(ls test/integration/*.int-spec.ts | awk -F/ '$3 ~ /^[f-l]/')

# 2) lint + typecheck + build
bash harness/check.sh --all       # ⚠️ bước `test` ĐỎ vì KI-014, KHÔNG phải vì lỗi test — xem RELEASE-06 §4.4
```

> **`check.sh --all` không thể xanh trên máy Windows này** (KI-014 chạm cả `@mediaos/api` lẫn
> `@mediaos/app`). Bằng chứng thay thế đã ghi ở `RELEASE-06` §2: **777 file spec toàn workspace xanh**
> khi chạy chia chunk, cộng CI `ubuntu-latest` chạy đủ một lần và success.
