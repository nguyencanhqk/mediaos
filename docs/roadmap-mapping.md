# ROADMAP MAPPING — Nguồn sự thật lộ trình MediaOS

> **Mục đích:** Trong bộ tài liệu hiện có tồn tại **3 cách đánh số giai đoạn khác nhau**, gây mâu thuẫn khi giao việc. File này **hợp nhất tất cả về một chuẩn duy nhất = G-phases trong [`TASKS.md`](../TASKS.md)**.
>
> **Quy tắc:** Khi nói "Phase mấy", LUÔN dùng mã **G** (vd `G2`, `G4-3`). Các tên Phase 1–9 / Release 1–8 chỉ là tham chiếu lịch sử, **không dùng để giao việc**.

---

## 1. Vì sao cần hợp nhất

| Tài liệu | Hệ đánh số | Vấn đề |
| --- | --- | --- |
| [`TASKS.md`](../TASKS.md) | **G0 → G5 + GX** | ✅ Chuẩn thực thi (có MVP-0 walking skeleton ở G4) |
| [PRD §10](../MVP%20REQUIREMENT%20-PRODUCT%20REQUIREMENT%20DOCUMENT.md) | Phase 1 → 6 | Không có khái niệm walking skeleton; coi Builder là P0 |
| [Kế hoạch chia phase](../KẾ%20HOẠCH%20CHIA%20PHASE%20PHÁT%20TRIỂN.md) | Phase 0 → 9 + Release 1 → 8 | Chi tiết nhưng số phase lệch hẳn TASKS.md |

→ "Phase 2" có thể là **Media Core** (PRD) hoặc **Tổ chức/phân quyền** (TASKS). Phải xoá nhập nhằng này.

---

## 2. Bảng ánh xạ chính (CHUẨN)

| G-phase (CHUẨN) | Tên | PRD Phase | Phase-Plan Phase | Release |
| --- | --- | --- | --- | --- |
| **G0** | Quyết định & Thiết kế | — (§10 mở đầu) | Phase 0 | — |
| **G1** | Bootstrap repo & hạ tầng | (hạ tầng, ẩn trong PRD) | (một phần Phase 0) | — |
| **G2** | Nền bảo mật & đa-tenant (RLS, audit, outbox, auth) | Phase 1 (phần Auth + Audit) | Phase 1 (phần security) | Release 1 |
| **G3** | Permission Engine (4 tầng) | Phase 1 (Role & Permission) | Phase 1 (Permission) | Release 1 |
| **G4** | 🎯 **MVP-0 Walking Skeleton** (1 video, 1 workflow cứng) | _Không có_ — đây là phần TỐI ƯU thêm | _Không có_ | (lát cắt dọc qua Release 2–3) |
| **G5a** | Workflow Builder (canvas React Flow) | Phase 3 (WF-001) | Phase 3 | Release 3 |
| **G5b** | Approval 3 cấp + Defect + Evaluation + KPI | Phase 4 | Phase 4 | Release 4 |
| **G5c** | Chat realtime + Notification + Meeting | Phase 6 (Chat/Noti/Meeting) | Phase 5 | Release 5 |
| **G5d** | Attendance + Leave | Phase 5 (HR phần công/phép) | Phase 6 (phần công/phép) | Release 6 |
| **G5e** | Platform Account Encryption (envelope + KMS) | Phase 2 (Platform Account, phần secret) | Phase 2 (phần secret) | Release 2 |
| **G5f** | Payroll + Bonus/Penalty | Phase 5 (Payroll) | Phase 6 (Payroll) | Release 6 |
| **G5g** | Finance (revenue/cost/profit) | Phase 5 (Finance) | Phase 7 | Release 7 |
| **G5h** | Dashboard theo role + materialized views | (rải rác DASH-001→005) | Phase 8 | Release 8 |
| **G5i** | Mobile RN | Phase 6 (Mobile) | Phase 5/8 (Mobile) | — |
| **GX** | Xuyên suốt (review gate, test, audit, migration, backup, cost) | NFR + §11 | Phase 9 (một phần) | — |

> ⚠️ **Lưu ý quan trọng về G4:** "MVP-0 Walking Skeleton" **không tồn tại trong PRD/Phase-Plan**. Nó là tối ưu được thêm vào để chứng minh lõi vận hành end-to-end trước khi mở rộng. Chi tiết xem [`mvp-0-scope.md`](./mvp-0-scope.md).

---

## 3. Ánh xạ "Media Core" (Channel/Project/Content)

Module Media Core (PRD Phase 2 / Phase-Plan Phase 2 / Release 2) **không phải một G-phase riêng**. Nó được **chia nhỏ và phân phối**:

- Phần **tối thiểu** (1 kênh, 1 project, 1 content) → nằm trong **G4-2** (MVP-0).
- Phần **mã hóa secret tài khoản nền tảng** → tách ra **G5e** (vì là crown-jewel bảo mật, làm sau permission).
- Phần **đầy đủ** (channel health, multi-account, đa nền tảng) → **G5** mở rộng.

---

## 4. Khác biệt cố ý so với PRD (đã được quyết định)

| Điểm | PRD nói | Quyết định CHUẨN | Lý do |
| --- | --- | --- | --- |
| Workflow Builder | P0 (bắt buộc MVP v1) | **Hoãn sang G5a**; MVP-0 dùng 1 workflow hard-code | PRD §11 Rủi ro 3 tự thừa nhận Builder khó |
| "MVP v1" = 20 module | Tất cả là MVP | **MVP-0 = lát cắt dọc nhỏ** (G4); 20 module trải dài G5 | Tránh trôi scope; ra giá trị sớm |
| Object permission | P1 | Bật tối thiểu ngay ở **G2/G3** cho secret/payroll | Bất biến bảo mật không thể hoãn |
| Audit + Event/Outbox | Rải rác trong NFR | **Bắt buộc TRƯỚC mọi module — G2-4** | Luật phụ thuộc trong CLAUDE.md |

---

## 5. Quy tắc dùng file này

1. Mọi commit/PR/issue tham chiếu **mã G** (vd `feat(G2-3): ...`).
2. Khi tài liệu khác nói "Phase X" → tra bảng §2 để quy về mã G.
3. Nếu PRD/Phase-Plan mâu thuẫn TASKS.md → **TASKS.md thắng**; cập nhật lại tài liệu kia hoặc ghi chú "superseded by roadmap-mapping.md".

---

_Tài liệu liên quan: [`TASKS.md`](../TASKS.md) · [`mvp-0-scope.md`](./mvp-0-scope.md) · [`erd-v2.md`](./erd-v2.md) · [`CLAUDE.md`](../CLAUDE.md)_
