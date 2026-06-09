# MVP-0 SCOPE — Walking Skeleton (Task G0-1)

> **Mục tiêu task G0-1** ([`TASKS.md:42`](../TASKS.md)): Chốt phạm vi MVP-0 — **một video đi trọn vòng đời** — để 20 sprint sau không đập đi làm lại.
>
> **MVP-0 = Walking Skeleton:** mỏng nhất có thể về tính năng, nhưng **xuyên suốt mọi tầng** (DB → RLS → permission → workflow → task → approval → FE → notification). Mục đích là **chứng minh lõi kiến trúc đứng vững**, KHÔNG phải làm đủ tính năng.
>
> **Trạng thái:** Bản nháp chờ duyệt. Khi duyệt → đánh `[x]` G0-1 trong TASKS.md.

---

## 1. Quyết định cốt lõi: chọn 1 workflow duy nhất

MVP-0 dùng **đúng 1 workflow cứng (hard-coded)**, **chưa cần Workflow Builder** (Builder → G5a).

**Workflow MVP-0** (rút gọn từ ["Video YouTube dài tiêu chuẩn"](../THIẾT%20KẾ%20WORKFLOW%20MẪU%20—%20MVP%20v1.md), 13 bước → 4 bước):

```text
Script  →  Edit  →  QA  →  Upload
```

| Bước | Người thực hiện (mặc định) | Người duyệt | Auto-sinh task |
| --- | --- | --- | --- |
| 1. Script | Script Writer | Project Manager | "Viết kịch bản" |
| 2. Edit | Editor | QA Reviewer | "Dựng video" |
| 3. QA | QA Reviewer | Project Manager | "Kiểm tra chất lượng" |
| 4. Upload | Uploader | Channel Manager | "Đăng video" |

- **Tuần tự** (chưa làm song song/DAG ở MVP-0 — để G5a). Bước sau mở khi bước trước `Approved`.
- **Approval 1 cấp** mỗi bước (3 cấp → G5b).
- **Return-revision:** người duyệt chọn **bước lỗi + người chịu trách nhiệm**, hệ thống tạo revision task và đẩy trạng thái bước về `Revision Required`.

---

## 2. Định nghĩa "trọn vòng đời" của 1 video

Một `content_item` phải đi được hết chuỗi này **trong hệ thống** (không dùng chat/sheet ngoài):

```text
Tạo video → sinh workflow instance → sinh 4 step → sinh task
   → nhân sự nhận task (My Tasks) → nộp work (file/link) + comment
   → người duyệt duyệt / trả sửa
   → (nếu trả sửa) revision task về đúng người → nộp lại → duyệt
   → bước cuối Upload được duyệt → content = Published
```

### State machine MVP-0 (mức bước — chi tiết đầy đủ ở G0-3)

```text
not_started → in_progress → waiting_review → approved        (→ mở bước kế)
                               waiting_review → revision        (→ revision task)
                               revision → in_progress           (làm lại)
```

> Lock-propagation phức tạp ("khóa phần liên quan") **chưa làm ở MVP-0** vì workflow tuần tự — chỉ cần khóa "bước sau bước lỗi". Lock đa nhánh → G0-3 + G5a.

---

## 3. IN-SCOPE — phải có trong MVP-0

Khớp các task **G4-1 → G4-8** của TASKS.md:

| Mã | Hạng mục | Giới hạn MVP-0 |
| --- | --- | --- |
| G4-1 | Org/Employee tối thiểu | 1 công ty, vài phòng ban, 1–2 team, gán role cơ bản |
| G4-2 | Channel + Project + Content | 1 project ↔ ≥1 kênh; tạo được 1 video |
| G4-3 | 1 workflow cứng 4 bước + auto-task | Script→Edit→QA→Upload, sinh task tự động |
| G4-4 | My Tasks + nộp work + comment | Upload file/link, comment trong task |
| G4-5 | Approval 1 cấp + return-revision | Chọn bước lỗi + người chịu trách nhiệm |
| G4-6 | Notification cơ bản + 1 group chat project | Auto-tạo group khi tạo project |
| G4-7 | E2E + chạy lại test isolation | 1 video trọn vòng đời; test 2-tenant |
| G4-8 | Pilot 1 team thật | Thu feedback |

**Nền bắt buộc đi kèm** (không thể bỏ — bất biến): RLS multi-tenant (G2), audit log + outbox (G2-4), PermissionService cơ bản (G3).

---

## 4. OUT-OF-SCOPE — CỐ TÌNH chưa làm (đẩy sang G5)

> Quan trọng ngang IN-SCOPE: liệt kê rõ để chống "vẽ rắn thêm chân".

| Hạng mục | Hoãn tới |
| --- | --- |
| Workflow Builder canvas (React Flow), bước song song, DAG, lock đa nhánh | **G5a** |
| Approval 3 cấp, Defect đầy đủ, Evaluation form, KPI thật | **G5b** |
| Chat realtime đầy đủ, reaction, search, Meeting | **G5c** |
| Attendance, Leave | **G5d** |
| Mã hóa Platform Account (envelope/KMS), reveal-secret | **G5e** |
| Payroll, Bonus/Penalty | **G5f** |
| Finance (revenue/cost/profit/allocation) | **G5g** |
| Dashboard theo role, materialized views | **G5h** |
| Mobile React Native | **G5i** |
| Multi content-type, đa nền tảng, channel health | G5 |

---

## 5. Tiêu chí nghiệm thu MVP-0 (Acceptance Criteria)

MVP-0 đạt khi **tất cả** đúng:

1. ✅ Tạo được 1 công ty + nhân sự + role; user chỉ thấy menu/nút theo quyền.
2. ✅ Tạo được 1 project gắn ≥1 kênh, tạo được 1 video trong project.
3. ✅ Áp workflow cứng → hệ thống tự sinh 4 step + task.
4. ✅ Nhân viên thấy task ở My Tasks, nộp file/link, comment.
5. ✅ Người duyệt duyệt được; trả sửa được **đúng bước + đúng người**; revision task được tạo.
6. ✅ Một video đi trọn: tạo → task → nộp → duyệt → **trả sửa** → nộp lại → upload → Published.
7. ✅ Có notification cho: task mới, chờ duyệt, bị trả sửa, được duyệt.
8. ✅ Auto-tạo 1 group chat project.
9. ✅ **Test 2-tenant đối kháng pass**: đăng nhập công ty A không đọc được 1 row nào của công ty B.
10. ✅ Mọi hành động quan trọng (duyệt/trả sửa/tạo-xóa) có **audit log**.
11. ✅ Pilot 1 team thật dùng được cho 1 video thật.

---

## 6. Ràng buộc bất biến (áp dụng kể cả ở bản mỏng nhất)

Dù chỉ 1 video, MVP-0 **không được phá 3 bất biến** ([`CLAUDE.md` mục 2](../CLAUDE.md)):

1. **`company_id` ở mọi query** — ép bằng RLS ở tầng DB, qua `withTenant()`.
2. **Không hard-delete** audit/snapshot — append-only.
3. **Không secret plaintext** — MVP-0 chưa làm platform_accounts secret (G5e), nhưng password user vẫn phải hash.

→ Đây là lý do thứ tự bắt buộc: **G2 (RLS) → G3 (Permission) → G4 (MVP-0)**.

---

## 7. Definition of Done cho riêng G0-1

- [x] Chốt 1 workflow (Script→Edit→QA→Upload).
- [x] Định nghĩa "trọn vòng đời" + state machine mức MVP-0.
- [x] Liệt kê đầy đủ IN-SCOPE và OUT-OF-SCOPE.
- [x] Có tiêu chí nghiệm thu đo được (11 mục).
- [x] **Đội đọc và xác nhận hiểu giống nhau** về "MVP-0 là gì / không là gì". ← solo: tự xác nhận ✅

---

_Tài liệu liên quan: [`TASKS.md` G4](../TASKS.md) · [`roadmap-mapping.md`](./roadmap-mapping.md) · [`erd-v2.md`](./erd-v2.md) · [Workflow mẫu](../THIẾT%20KẾ%20WORKFLOW%20MẪU%20—%20MVP%20v1.md)_
