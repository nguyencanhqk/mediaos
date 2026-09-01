# RELEASE-14 — POST-GO-LIVE BACKLOG (HANDOFF-010)

> Work Order **`S6-GOLIVE-1`** · `IMP09-HANDOFF-010` · nguồn: [IMPLEMENTATION-09](../IMPLEMENTATION/IMPLEMENTATION-09_Sprint_6_Stabilization_Release_Candidate_Go-live_Execution_Plan.md) §19.5 · tiếp nối: `IMPLEMENTATION-10`
> Người nhận: **Product · PM** · Soạn: 2026-07-31 · `origin/master` `a17ff684`
>
> Danh sách việc **sau khi go-live**. Nguồn: sổ vấn đề đã biết ([`RELEASE-02`](RELEASE-02_Known_Issues_MVP.md)) ·
> các ô CHƯA ĐẠT của [`RELEASE-10`](RELEASE-10_Final_Signoff_Go_NoGo_Decision.md) §2 · Work Order đã hoãn ·
> lộ trình Phase 2+ (`SPEC-01` §7, §25).
>
> **Không phải nơi chứa ước mơ.** Mỗi mục có căn cứ, mức độ và lý do vì sao nó KHÔNG chặn go-live.

---

## 1. Cách xếp ưu tiên

| Nhóm | Nghĩa | Khi nào làm |
| --- | --- | --- |
| **P-NOW** | Phải làm trong hypercare (T+0 → T+7) | Ngay sau go-live |
| **P-NEXT** | Sprint kế tiếp sau khi thoát hypercare | 2–4 tuần |
| **P-LATER** | Có giá trị, chưa cấp bách | Theo lộ trình |
| **P-PHASE2** | Module mới ngoài MVP | `IMPLEMENTATION-10` |

---

## 2. P-NOW — trong hypercare

| Mã | Việc | Vì sao gấp | Căn cứ |
| --- | --- | --- | --- |
| **PGL-001** | Hoàn tất phần còn lại của `KI-050`: đăng ký **lịch backup tự động** + bật **mã hoá** (`BACKUP_GPG_RECIPIENT`) + đẩy **offsite** (`BACKUP_B2_REMOTE`) | Hiện chỉ có backup **thủ công, local, chưa mã hoá**. Máy hỏng ⇒ mất cả bản gốc lẫn bản lưu | `RELEASE-10` §2 ô #9 · `RELEASE-11` §6.2 |
| **PGL-002** | **PITR / WAL archiving** — đưa RPO từ ~24 giờ về ≤ 15 phút | Đang lệch target `COMPLIANCE-01` **96 lần**. Là rủi ro `AR-2` phải ký để go-live | `RELEASE-10` §2 ô #10 |
| **PGL-003** | Bật 2FA cho **toàn bộ** tài khoản `SA` rồi bật cờ bắt buộc trên vai `SA` (`KI-056`) | 4/6 tài khoản toàn quyền đang chỉ có mật khẩu. Nếu go-live theo đường CONDITIONAL mà chưa xong G1 thì đây là việc số một | `RELEASE-10` §4 |
| **PGL-004** | Chạy **regression P0 + migration trên staging** (`RC-003`/`RC-004`) nếu go-live theo đường CONDITIONAL | Nợ kỹ thuật của việc bỏ qua diễn tập; phải trả trước lần deploy kế | `RELEASE-10` §6 G5–G6 |
| **PGL-005** | Cấu hình `OPS_ALERT_WEBHOOK` đẩy cảnh báo ra kênh chat | Cảnh báo chỉ ghi file log ⇒ không ai thấy nếu không mở file | `RELEASE-09` §4 |

---

## 3. P-NEXT — sprint kế tiếp

### 3.1 Bảo mật & phân quyền (nhóm còn nợ của Sprint 6)

| Mã | Việc | Mức | Căn cứ |
| --- | --- | --- | --- |
| **PGL-010** | `S6-SEC-IDENTITY-PROJ-1` — **buộc tầng chiếu `users.email`/`fullName` phải nhận vị từ scope, thiếu thì VỠ TYPECHECK** | `S3` | WO đã **hoãn có chủ đích** ra ngoài cửa sổ RC (chốt owner 2026-07-31) |
| **PGL-011** | `KI-053` — `listRoleMembersTx` chiếu `email`+`fullName` thành viên vai, `where` không có vị từ scope | `S3` | `RELEASE-02` |
| **PGL-012** | `KI-054` — `login-log` / `security-event` chiếu danh tính không bound; docstring ghi "Company-scope" nhưng không resolve `data_scope` | `S3` | `RELEASE-02` |
| **PGL-013** | `KI-055` — 11 cặp FK còn trỏ được tới hàng catalog của tenant khác (lỗ tồn dư lớp G) | `S3` | `S6-SEC-XTENANTFK-1` |
| **PGL-014** | `KI-047` · `KI-048` — mù brute-force mã 2FA; nhiễu hàng `blocked` | `S3` | `RELEASE-02` |
| **PGL-015** | `KI-012` / D3 — rà lại widget headcount count-only xuyên phòng ban | `S3` | rủi ro đã ký `AR-4` |

> `PGL-010` … `PGL-013` cùng một họ: **tầng chiếu danh tính chưa bị ép theo phạm vi**. Làm gộp một đợt
> rẻ hơn nhiều so với vá lẻ từng chỗ — đó chính là lý do `S6-SEC-IDENTITY-PROJ-1` tồn tại.

### 3.2 Chất lượng & kiểm thử

| Mã | Việc | Mức | Căn cứ |
| --- | --- | --- | --- |
| **PGL-020** | `KI-025` — **98/346 đường API (28%) không có test HTTP nào chạm** | `S2` | `RELEASE-02` |
| **PGL-021** | `KI-021` — 3 sự kiện NOTI của ATT có trong danh mục nhưng **không có producer** | `S2` | `RELEASE-02` |
| **PGL-022** | `KI-007` — CI `Dependency scan` đỏ do lỗi công cụ; nới override `brace-expansion` | `S3` | `RELEASE-02` |
| **PGL-023** | `KI-009` — log dạng JSON có cấu trúc | `S3` | `RELEASE-09` §5 |
| **PGL-024** | `KI-010` — `GET /employees` phân trang thật (đang chặn bằng cap 2000) | `S3` | `RELEASE-02` |

### 3.3 Dữ liệu & vận hành

| Mã | Việc | Mức | Căn cứ |
| --- | --- | --- | --- |
| **PGL-030** | `KI-004` — **nhập ngày lễ** cho năm hiện hành | `S3` | ảnh hưởng tính công/phép |
| **PGL-031** | `KI-019` — mới có 1 ca làm việc + 1 quy tắc + 0 phân ca | `S3` | cấu hình vận hành thật |
| **PGL-032** | `KI-003` — 3 bản trùng loại nghỉ phép khác nhau hoa/thường | `S3` | dọn dữ liệu |
| **PGL-033** | `KI-017` — refresh materialized view dashboard qua `workerDb` hỏng ("must be owner") | `S3` | dashboard có thể đứng số |
| **PGL-034** | `KI-006` — LMS→NOTI còn thiếu `LMS_NOTI_TOKEN` + deploy hai phía | `S3` | `RELEASE-02` |
| **PGL-035** | `KI-005` — widget "Thông báo" trễ tối đa ~10s | `S3` | trải nghiệm |
| **PGL-036** | `RetentionCleanupJob` ghi 3 dòng `LOG`/`DEBUG` mỗi nhịp trên PROD — hạ mức log hoặc chỉ ghi khi thật sự có việc | `S4` | Chính là thứ bơm `api.out.log` lên **688 MB** (mẫu 8MB giữa file: **99 %** là dòng của job này). `S6-OPS-LOGWINDOW-1` đã bật xoay log nên **hậu quả** bị chặn, nhưng **nguồn** thì chưa — đụng `apps/api/**`, ngoài phạm vi WO đó |

---

## 4. P-LATER

| Mã | Việc | Vì sao |
| --- | --- | --- |
| **PGL-040** | **Dọn 6 vai di sản hướng media** (`channel-manager` · `editor` · `finance-manager` · `qa-reviewer` · `script-writer` · `uploader`) — 0 người dùng, 9–25 quyền/vai | Đã de-media-fy; vai thừa là bề mặt tấn công + gây nhầm khi phân quyền |
| **PGL-041** | Dọn vai `test` (0 quyền, 0 người, `is_system=false`) | Rác cấu hình trên PROD |
| **PGL-042** | Gán vai `hr` · `hr-manager` · `manager` · `project-manager` cho người thật | Đã seed sẵn nhưng 0 người dùng ⇒ mọi việc quản trị đang dồn vào 6 tài khoản `SA` |
| **PGL-043** | Dọn bảng/module di sản (media · finance · payroll · operator-plane) trong `apps/api` | `docs/erd-current.md` Phụ lục A |
| **PGL-044** | Đưa `docs/TESTABLE-FEATURES.md` khớp bản phát hành | Tài liệu nghiệm thu |
| **PGL-045** | Ứng dụng di động | `SPEC-01` §7 — Phase 5 |
| **PGL-046** | `S7-GOAL-PROJTAB-1` — tab **Mục tiêu** trong trang dự án: mục tiêu của dự án + phủ mục tiêu của việc thực tế (gồm việc **chưa gắn**) + gắn việc tại chỗ | Chiều tra cứu ngược đang thiếu: hiện chỉ đi được từ mục tiêu → việc, người quản lý dự án không có đường thấy việc nào đang trôi ngoài mọi mục tiêu. Owner duyệt hướng 2026-08-01, **cố ý hoãn ra ngoài cửa sổ RC** (`RELEASE-05` scope freeze). Plan: `docs/plans/S7-GOAL-PROJTAB-1.md` |

> `PGL-042` đáng làm sớm hơn thứ hạng của nó: mỗi việc quản trị phải mượn tài khoản `SA` là mỗi lần
> dùng quyền lớn hơn nhu cầu — và đó cũng là thứ khiến `KI-056` nguy hiểm.

---

## 5. P-PHASE2 — module mới (`IMPLEMENTATION-10`)

Theo `SPEC-01` §7 · §25 — thiết kế đã tính chỗ, chưa xây.

| Giai đoạn | Module | Ghi chú |
| --- | --- | --- |
| **Phase 2** | **PAYROLL** — tiền lương | Wave **`S13-PAYROLL`** (owner duyệt 31/08/2026, [kế hoạch](<../plans/S13-PAYROLL-WAVE.md>)). **✅ đã có bộ tài liệu**: [SPEC-11](<../SPEC/SPEC-11 PAYROLL.md>) · [DB-13](<../DB/DB-13 PAYROLL Database Design.md>) · [API-18](<../API Design/API-18_PAYROLL_API_Design.md>) · [phân quyền §9g](<../permission-matrix-spec.md>) — **RECONCILE 6 bảng di sản G12** (không phải nền trắng) + 1 bảng mới `payroll_period_lines`, thi công `S13-PAYROLL-DOC-1 → DB-1 → BE-1 → BE-2 → FE-1 → QA-1 → DASH-1`. **PARK-PAYROLL-001**: engine BHXH/BHYT/BHTN/TNCN luỹ tiến (P2-PAY-05-002/003) · PDF phiếu lương (P2-PAY-07-003) · export payslip batch/signed-URL (P2-PAY-08-002) · variance report (P2-PAY-08-004) · report theo phòng ban (P2-PAY-08-003) · **khiếu nại phiếu lương (dispute/resolve)** · multi-currency · chu kỳ trả ngoài tháng — v1 chỉ khấu trừ nghỉ-không-lương/trễ/phạt/dòng tay, XLSX, xác nhận phiếu |
| **Phase 2** | **RECRUIT** — tuyển dụng | Wave **`S12-RECRUIT`** (owner duyệt 31/08/2026, [kế hoạch](<../plans/S12-RECRUIT-WAVE.md>)). **✅ đã có bộ tài liệu**: [SPEC-12](<../SPEC/SPEC-12 RECRUIT.md>) · [DB-14](<../DB/DB-14 RECRUIT Database Design.md>) · [API-17](<../API Design/API-17_RECRUIT_API_Design.md>) · [phân quyền §9f](<../permission-matrix-spec.md>) — 8 bảng mới, thi công `S12-RECRUIT-DB-1 → BE-1 → FE-1 → QA-1 → DASH-1`. **PARK-RECRUIT-001**: policy retention/auto-purge ứng viên `Rejected` (P2-REC-09-004, REC-DEC-007) — v1 chỉ soft-delete, mở lại ở Phase sau cùng đường xoá hồ sơ |
| Phase 3 | **ASSET** · **ROOM** | Tài sản · phòng họp — wave **`S11-OFFICE`** (owner duyệt 28/08/2026, [kế hoạch](<../plans/S11-OFFICE-WAVE.md>)). **ASSET ✅ đã có bộ tài liệu**: [SPEC-13](<../SPEC/SPEC-13 ASSET.md>) · [DB-15](<../DB/DB-15 ASSET Database Design.md>) · [API-14](<../API Design/API-14_ASSET_API_Design.md>) · [phân quyền §9d](<../permission-matrix-spec.md>) — 6 bảng mới, thi công `S11-ASSET-DB-1 → BE-1 → FE-1 → QA-1`. **ROOM ✅ đã có bộ tài liệu** (29/08/2026): [SPEC-14](<../SPEC/SPEC-14 ROOM.md>) · [DB-16](<../DB/DB-16 ROOM Database Design.md>) · [API-15](<../API Design/API-15_ROOM_API_Design.md>) · [phân quyền §9e](<../permission-matrix-spec.md>) — tái dụng `meeting_rooms` + 2 bảng mới, DROP 4 bảng `meeting_*` (ROOM-DEC-001, 0 hàng đo được), thi công `S11-ROOM-DB-1` (sau ASSET-DB-1) `→ BE-1 → FE-1 → QA-1` |
| Phase 4 | **CHAT** — chat nội bộ | ✅ **Đã có bộ tài liệu** (01/08/2026): [SPEC-15](<../SPEC/SPEC-15 CHAT.md>) · [DB-12](<../DB/DB-12 CHAT Database Design.md>) · [API-13](<../API Design/API-13_CHAT_API_Design.md>) · [phân quyền §9c](<../permission-matrix-spec.md>). Wave `S7-CHAT` trong `harness/backlog.mjs`, thi công **sau** khi cửa sổ go-live đóng. Nền dữ liệu đã có sẵn trong DB (mig `0010`/`0050`) |
| Phase 4 | **SOCIAL** — mạng xã hội nội bộ | Chưa có spec |
| Phase 5 | **MOBILE** · **AI** · **INTEGRATION** | |

> Khi mở PAYROLL: nó là **crown-jewel** ngay từ dòng code đầu (lương = dữ liệu nhạy cảm nhất). Áp
> `CLAUDE.md` §6 FULL gate + test deny-path TRƯỚC, không làm như module CRUD thường.
>
> ⚠️ **Đã đo 31/08/2026 (S13-PAYROLL-DOC-1):** PAYROLL **không phải nền trắng** — 6 bảng + **19 cặp quyền lương**
> đã tồn tại từ đợt G12 hướng cũ, trong đó `approve-payroll-period` và `publish-payroll-period` để
> `is_sensitive=false` ⇒ **duyệt và phát hành lương đang kế thừa được qua wildcard `*:*`**, và 4 cặp `payslip`
> của `0005` (gồm `('update','payslip')`, mâu thuẫn bất biến #2) đã bị blanket-grant. Thu hồi 16 cặp là phần
> **an ninh** của wave, không chỉ là dọn dẹp — chi tiết: [permission-matrix §9g.1](<../permission-matrix-spec.md>).

---

## 6. Đầu vào cho `IMPLEMENTATION-10`

Khi mở sprint kế tiếp, ba việc trước tiên:

1. **Chốt kết quả hypercare** — mọi vấn đề phát sinh T+0…T+7 phải vào `RELEASE-02` kèm mức + chủ.
2. **Đóng P-NOW** (`PGL-001` … `PGL-005`) trước khi nhận scope mới. Nợ vận hành sinh lãi nhanh hơn nợ
   tính năng.
3. **Gộp nhóm danh tính** (`PGL-010` … `PGL-013`) thành một đợt — cùng một lỗ, vá lẻ là trả giá ba lần.

---

## 7. Việc **KHÔNG** làm

Ghi ra để không ai mở lại:

| Không làm | Vì sao |
| --- | --- |
| Module media · kênh · video · content | Đã de-media-fy 2026-06-20 — ngoài phạm vi sản phẩm |
| Tài chính theo kênh (doanh thu/chi phí/lợi nhuận/KPI nội dung) | như trên |
| Đa-công-ty / SaaS | Hạ tầng đã sẵn (`company_id` + RLS chạy ở N=1) nhưng **không phải mục tiêu** |
| Gỡ `company_id` / RLS vì "chỉ có một công ty" | **BẤT BIẾN #1** — giữ nguyên, không tháo |
| Chuyển ORM sang Prisma | `DECISIONS` — phá outbox + rò tenant trên pool |
