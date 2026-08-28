# Kế hoạch wave S11-OFFICE — Phase 3 «Quản trị văn phòng»: ASSET (tài sản) + ROOM (phòng họp)

> Seed 2026-08-28. Trạng thái: **CHỜ OWNER DUYỆT** — 2 WO gốc (`S11-ASSET-DOC-1`, `S11-ROOM-DOC-1`)
> để `blocked` cho tới khi owner duyệt tài liệu định hướng (bản HTML kèm wireframe UI đã publish
> làm Artifact) và ký các quyết định §3. Nguồn phạm vi: SPEC-01 §12.10–12.11 · §7 (Phase 3) ·
> §10.8 (Asset Manager) · §10.9 (Office Admin) · IMPLEMENTATION-10 §22 (PARK-ASSET/ROOM) ·
> RELEASE-14 §5.

---

## 1. Điểm xuất phát — ĐO THẬT ngày 28/08/2026

- **ASSET/ROOM hiện chỉ "đặt chỗ, chưa xây":** 0 SPEC, 0 DB doc, 0 API doc, 0 story, 0 WO,
  0 mục permission-matrix. SPEC-01 đã khoá số **SPEC-13 (ASSET)** / **SPEC-14 (ROOM)** (§7 bảng
  dòng 166–167, §8 dòng 196–197).
- **Đụng độ đánh số DB:** `docs/DB/` đang ở đầu **DB-12 (CHAT)**, nhưng IMPLEMENTATION-10 §…
  (dòng 697–698) đã **đặt trước DB-13 = PAYROLL, DB-14 = RECRUIT**. `docs/API Design/` đang ở đầu
  **API-13 (CHAT)**. → cần OFFICE-DEC-001.
- **Di sản `meeting_*` (mig 0052 + composite-FK 0535):** 5 bảng `meeting_rooms · meetings ·
  meeting_attendees · meeting_notes · meeting_tasks` **tồn tại thật trong DB**, RLS+FORCE,
  soft-delete, và `meetings` có sẵn **EXCLUDE GIST chống trùng lịch** — đúng lõi SPEC-14. Nhưng
  **chết-code**: 0 service/controller/spec dùng (`apps/api/src/db/schema/meeting.ts` là nơi duy nhất
  tham chiếu), erd-current xếp cùng nhóm di sản với kpi/evaluation/workflow. → cần ROOM-DEC-001,
  cùng lớp tình huống "NỀN ĐÃ CÓ SẴN" của wave S7-CHAT.
- **Đường tên cho ASSET sạch:** toàn bộ migrations không có bảng `assets` trần (chỉ `content_assets`
  thuộc cụm media đã park) — không đụng độ.
- **Điểm nối đã có khuôn từ các wave trước:** seed `modules` (mẫu 0506 GOAL) · nới CHECK
  `module_code` trên **CẢ HAI bảng** `notification_events` + `notifications` (mẫu 0538 CHAT §642/§684)
  + union type `notification-event-catalog.const.ts` · UNION-ADD `audit_logs.object_types` ·
  `sequence_counters` cho mã tài sản · permission seed `ON CONFLICT DO NOTHING`.
- **Harness:** enum module hợp lệ ở `harness/backlog.mjs` header (đã thêm ASSET·ROOM cùng commit
  seed này); `harness/lib/stories.mjs` (`EPIC_MODULE`) và `harness/dashboard/server.mjs`
  (`MODULE_SPEC`) chưa biết ASSET/ROOM — giao cho 2 WO DOC.

## 2. Phạm vi wave

Hai track độc lập, chung một cửa duyệt:

| Track | Phạm vi v1 (theo SPEC-01 §12.10/§12.11) | NGOÀI phạm vi v1 |
| --- | --- | --- |
| **ASSET** | Danh mục loại tài sản · hồ sơ tài sản (mã + QR) · cấp phát · thu hồi · bảo trì · kiểm kê · thanh lý (= trạng thái) · «tài sản của tôi» · sự kiện NOTI · widget DASH | Khấu hao/giá trị kế toán · mua sắm/đề xuất cấp phát tự phục vụ · barcode scanner app |
| **ROOM** | Danh mục phòng họp (sức chứa · thiết bị · vị trí) · đặt lịch · **chống trùng lịch ở tầng DB** · hủy lịch · lịch sử sử dụng · nhắc lịch NOTI · widget DASH «lịch họp hôm nay» | Duyệt đặt phòng (để cờ `requires_approval` cho sau) · recurring booking · đồng bộ Google Calendar (PARK-ROOM-002) |

Vai trò: **Asset Manager** (SPEC-01 §10.8) và **Office Admin** (§10.9) — seed role + gán cặp quyền
theo ma trận per-(perm,role) data_scope.

## 3. Quyết định cần owner ký (trước khi mở WO DB)

| Mã | Câu hỏi | Đề xuất (khuyến nghị) |
| --- | --- | --- |
| OFFICE-DEC-001 | Đánh số tài liệu khi DB-13/14 đã bị PAYROLL/RECRUIT đặt trước | **DB-15 ASSET · DB-16 ROOM** · API-14 ASSET · API-15 ROOM · permission-matrix **§9d/§9e** · IMPLEMENTATION-02 **EPIC-17 (§8.18) / EPIC-18 (§8.19)**; giữ nguyên chỗ đặt của IMP-10 |
| ASSET-DEC-001 | Phạm vi v1: thanh lý & QR làm tới đâu | Thanh lý = chuyển trạng thái `Disposed` + lý do (không workflow phê duyệt riêng); QR = render từ `asset_code` ở FE, không service sinh ảnh riêng |
| ASSET-DEC-002 | Cấp phát 1 bước hay 2 bước (NV xác nhận đã nhận) | **1 bước** do Asset Manager ghi nhận (in biên bản từ FE); 2 bước để Phase sau |
| ASSET-DEC-003 | Bộ trạng thái tài sản (phải hợp thức vào SPEC-01 §17) | `In Stock · Assigned · Under Maintenance · Disposed · Lost` (assignment: `Active · Returned`) |
| ASSET-DEC-004 | Sinh mã tài sản | `sequence_counters` per-company theo prefix loại, dạng `TS-<LOẠI>-<seq>` |
| ROOM-DEC-001 | Số phận 5 bảng `meeting_*` di sản | **Tái dụng `meeting_rooms`** (khớp ~1:1 SPEC-14) làm bảng phòng họp chuẩn của DB-16; `meetings`/`meeting_attendees`: WO DOC đo cột thật rồi chốt tái-dụng hay thay bằng `room_bookings` qua expand-contract; `meeting_notes` + `meeting_tasks` → DROP theo khuôn S10-CLEAN (đếm hàng PROD trước). **CẤM** dựng bảng mới song song mà không xử lý bảng cũ (lớp lỗi KI-079) |
| ROOM-DEC-002 | Có luồng duyệt đặt phòng không | **v1 không duyệt** — đặt là giữ chỗ ngay nếu không trùng; cột `requires_approval` trên phòng để mở sau (tránh thêm 1 FSM phê duyệt crown ở v1) |
| ROOM-DEC-003 | Recurring booking / múi giờ | v1 KHÔNG recurring; UTC-at-rest + hiển thị Asia/Ho_Chi_Minh (chuẩn hệ thống) |
| ROOM-DEC-004 | Nhắc lịch họp | Có — NOTI nhắc trước 15 phút qua outbox + system job quét |

Bộ trạng thái booking đề xuất: `Confirmed · Cancelled` (+ `Completed` là **giá trị dẫn xuất** từ
giờ kết thúc, không lưu cứng — cùng nguyên tắc `Overdue` của TASK §17.7).

## 4. Story cấp wave (bản nghiệp vụ đầy đủ viết ở EPIC-17/18 trong WO DOC)

**ASSET** — AS-01 quản lý danh mục loại · AS-02 CRUD hồ sơ tài sản + mã/QR · AS-03 cấp phát cho
nhân viên (liên kết HR, audit) · AS-04 thu hồi (ghi tình trạng khi thu) · AS-05 bảo trì (mở/đóng
lượt bảo trì, tài sản sang `Under Maintenance`) · AS-06 kiểm kê (mở đợt, đánh dấu thấy/mất) ·
AS-07 thanh lý/`Lost` · AS-08 nhân viên xem «tài sản của tôi» · AS-09 sự kiện NOTI cấp phát/thu
hồi/bảo trì đến hạn · AS-10 widget DASH thống kê theo trạng thái/loại.

**ROOM** — RM-01 quản trị phòng họp (Office Admin) · RM-02 nhân viên đặt phòng, chọn khung giờ,
bị chặn nếu trùng (lỗi 409 kèm khung giờ bận) · RM-03 hủy lịch của mình / Office Admin hủy mọi
lịch (có audit + NOTI cho người tham dự) · RM-04 xem lịch phòng dạng tuần/ngày theo từng phòng ·
RM-05 «đặt phòng của tôi» · RM-06 nhắc lịch trước 15′ · RM-07 lịch sử sử dụng phòng · RM-08
widget DASH «lịch họp hôm nay».

## 5. Phân rã Work Order (11 WO — seed trong harness/backlog.mjs)

```text
        ┌ S11-ASSET-DOC-1 (blocked, chờ duyệt) → S11-ASSET-DB-1 🔴 → S11-ASSET-BE-1 → S11-ASSET-FE-1 → S11-ASSET-QA-1 ┐
duyệt ──┤                                                                                                            ├→ S11-OFFICE-DASH-1
        └ S11-ROOM-DOC-1  (blocked, chờ duyệt) → S11-ROOM-DB-1 🔴 → S11-ROOM-BE-1 → S11-ROOM-FE-1 → S11-ROOM-QA-1    ┘
```

- 2 track chạy song song ĐƯỢC, **trừ** 2 WO DB (🔴 migration): lane migration là lane NỐI TIẾP duy
  nhất — `S11-ROOM-DB-1` chỉ chạy sau khi `S11-ASSET-DB-1` merge (hoặc ngược lại), đánh số migration
  nối tiếp head lúc đó.
- DOC → DB có chốt: plan-reviewer đối kháng PASS trên SPEC + DB doc trước khi mở WO DB (khuôn
  S7-CHAT-DOC-1).

## 6. UI dự kiến (chi tiết wireframe ở tài liệu HTML duyệt)

- `apps/app/src/routes/assets/` — ASSET-SCREEN-001 danh sách tài sản (table + filter loại/trạng
  thái/người giữ) · 002 chi tiết (tab thông tin ‖ lịch sử cấp phát ‖ bảo trì) · 003 form tạo/sửa ·
  004 form cấp phát/thu hồi · 005 màn kiểm kê theo đợt · 006 «tài sản của tôi» (gắn khu vực ME).
- `apps/app/src/routes/rooms/` — ROOM-SCREEN-001 lịch phòng tuần (cột = phòng, kéo chọn khung giờ)
  · 002 form đặt phòng (báo trùng ngay) · 003 «đặt phòng của tôi» · 004 quản trị phòng họp.
- Mọi màn: `<PermissionGate>` + `useCan()`, loading/error/empty, i18n vi, trạng thái dùng constants
  chuẩn §17.

## 7. Rủi ro & bẫy đã biết (từ memory/KI)

1. `meeting_*` di sản: dựng tên mới mà không DROP = hai «phòng họp» cùng sống (KI-079). ROOM-DEC-001 chặn.
2. CHECK `module_code` NOTI phải nới **cả hai bảng** (`notification_events` + `notifications`) — quên 1 bảng là 500 lúc chạy.
3. Hợp đồng Zod phải mirror CHECK DB **hai chiều, đúng bằng** (bài học `contract-must-mirror-db-check-both-directions`).
4. Cột FK mới bắt buộc composite tenant FK (khuôn 0535).
5. Route mới ⇒ route-census ĐỎ — regen `ROUTE_CENSUS_WRITE=1`; module mới khai `API_MODULE_TAGS` (openapi-modules).
6. `:id` = UUID ở biên ngay từ đầu (ratchet param-uuid đang siết về 1 — không thêm nợ).
7. Đặt phòng: POST tạo booking cần Idempotency-Key **suy từ payload**; race double-booking phải có int-spec 2 request song song (EXCLUDE GIST là chốt cuối).
8. SPEC-01 §17.7: trạng thái mới của ASSET/ROOM **phải hợp thức vào SPEC-01 §17** trong WO DOC, không được tự thêm.
9. Test int chạy trên LANE_DB; deny-path/cross-tenant RED-trước cho mọi API nhạy cảm; fixture giả-secret phải ghép chuỗi.

## 8. Definition of Done cấp wave

- Bộ tài liệu đủ 4 mảnh × 2 module: SPEC-13/14 (Approved) · DB-15/16 · API-14/15 · permission-matrix §9d/§9e; SPEC-01/README/DB-01·09·10/erd-current/RELEASE-14/IMPLEMENTATION-02 đồng bộ, trỏ chéo đúng.
- Schema + migration có RLS+FORCE, composite tenant FK, seed modules/permissions/NOTI catalog; di sản `meeting_*` được xử lý dứt điểm theo ROOM-DEC-001.
- BE: guard permission + audit + outbox NOTI; FE: đủ màn hình §6; QA: deny-path + IDOR + cross-tenant + race double-booking xanh trên LANE_DB, coverage ≥80%.
- DASH: 2 widget (thống kê tài sản · lịch họp hôm nay) hiển thị theo quyền.
- `docs/TESTABLE-FEATURES.md` cập nhật; backlog/ledger đóng dấu đủ 11 WO.
