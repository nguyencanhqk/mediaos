# SPEC-15: CHAT — CHAT NỘI BỘ (1-1 · NHÓM · PHÒNG BAN · DỰ ÁN)

> **📚 Bộ tài liệu SPEC — Hệ thống Quản lý Doanh nghiệp**
> [SPEC-01 Tổng quan](<SPEC-01 Tổng quan.md>) · [SPEC-02 AUTH](<SPEC-02 AUTH.md>) · [SPEC-03 HR](<SPEC-03 HR.md>) · [SPEC-04 ATT](<SPEC-04 ATT.md>) · [SPEC-05 LEAVE](<SPEC-05 LEAVE.md>) · [SPEC-06 TASK](<SPEC-06 TASK.md>) · [SPEC-07 DASH](<SPEC-07 DASH.md>) · [SPEC-08 NOTI](<SPEC-08 NOTI.md>) · [SPEC-09 ME](<SPEC-09 ME.md>) · [SPEC-10 GOAL](<SPEC-10 GOAL.md>) · **SPEC-15 CHAT**
>
> **Liên quan:** [Chỉ mục tài liệu](<../README.md>) · [DB-12 CHAT Database Design](<../DB/DB-12 CHAT Database Design.md>) · [Thiết kế API: API-13 CHAT](<../API Design/API-13_CHAT_API_Design.md>) · [Ma trận phân quyền §9c](<../permission-matrix-spec.md>) · [NOTI nền: SPEC-08](<SPEC-08 NOTI.md>) · [TASK nền: SPEC-06](<SPEC-06 TASK.md>)
>
> **Đánh số:** SPEC-11…14 (PAYROLL · RECRUIT · ASSET · ROOM) là các module Phase 2–3 **chưa viết**; CHAT giữ đúng số SPEC-15 đã khoá tại [SPEC-01 §5](<SPEC-01 Tổng quan.md>) — không dồn số.

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | SPEC-15 |
| Tên tài liệu | CHAT - Chat nội bộ (1-1 · Nhóm · Phòng ban · Dự án) |
| Module code | CHAT |
| Tài liệu cha | SPEC-01: Tổng quan hệ thống (§12.12) |
| Module phụ thuộc trực tiếp | AUTH (RBAC · token WS), HR (employees/departments), TASK (projects), FOUNDATION (files · audit · sequences) |
| Module liên quan | NOTI, ME, DASH, LMS (lối vào /chat hiện tại) |
| Phiên bản | v1.0 |
| Trạng thái | **Approved** — owner chốt 12 quyết định §22 ngày 02/08/2026 (CHAT-DEC-004 chốt **ngược** đề xuất ban đầu — xem §3.3) |
| Giai đoạn | **Phase 4 · wave S7-CHAT** — NGOÀI phạm vi RC v1.0.0 (scope freeze RELEASE-05) |
| Ngày tạo | 01/08/2026 |
| Ngày cập nhật | 01/08/2026 |

> ⚠️ **Vị trí so với go-live:** CHAT nằm **ngoài** cửa sổ RC đang mở (`S6-GOLIVE-1` NO-GO + 10 cổng owner). Wave `S7-CHAT-*` được phép thi công song song nhưng **KHÔNG merge vào `master`** cho tới khi go-live đóng — bảo toàn 4 chặn RC của [RELEASE-05](<../RELEASE/RELEASE-05_Scope_Freeze_And_Release_Governance.md>).

---

## 2. Mục đích tài liệu

Tài liệu này mô tả module **CHAT — Chat nội bộ**: kênh trao đổi tức thời giữa nhân viên, nhóm tự lập, phòng ban và dự án, thay thế việc công ty phải dùng ứng dụng ngoài (Zalo/Messenger) cho công việc — nơi nội dung nằm ngoài tầm kiểm soát, không gắn được với hồ sơ nhân sự, và mất sạch khi nhân viên nghỉ.

CHAT trả lời các câu hỏi:

```text
Tôi nhắn riêng cho một đồng nghiệp ở đâu?
Phòng ban tôi có kênh trao đổi chung không, ai được vào?
Dự án X bàn việc ở đâu, người mới vào dự án có đọc được nội dung cũ không?
Tin nhắn cũ tìm lại được không — tìm bằng tiếng Việt có dấu và không dấu?
Ai đã đọc tin của tôi?
Nhân viên nghỉ việc thì nội dung trao đổi công việc còn lại cho công ty không?
```

CHAT **không sở hữu** dữ liệu của module khác: nhân sự vẫn thuộc HR, dự án vẫn thuộc TASK, tệp vẫn thuộc FOUNDATION Files. CHAT chỉ sở hữu **phòng · thành viên phòng · tin nhắn · trạng thái đã đọc**.

---

## 3. Định nghĩa và nguyên tắc kiến trúc

### 3.1 Bốn loại phòng — hai cơ chế thành viên

| `room_type` | Ai tạo | Thành viên | Xoá/rời |
| --- | --- | --- | --- |
| `direct` | Hệ thống (khi A mở chat với B) | Đúng 2 người, cố định | Không rời, không xoá |
| `group` | Người dùng | **Thủ công** — admin phòng thêm/bớt | Rời được; admin xoá được |
| `department` | Hệ thống (theo `org_units`) | **Dẫn xuất** từ nhân sự của phòng ban | Không rời, không xoá |
| `project` | Hệ thống (theo `projects` của TASK) | **Dẫn xuất** từ `project_members` | Không rời, không xoá |

- **Thủ công** = `chat_room_members` là nguồn sự thật, người quản trị phòng ghi trực tiếp.
- **Dẫn xuất** = `chat_room_members` là **cache đồng bộ** từ module nguồn; đồng bộ tại sự kiện (thêm/bớt nhân sự, đổi phòng ban, thêm/bớt project member) + **job đối soát định kỳ** sửa lệch. Người dùng không tự thêm/bớt được (CHAT-ERR-012).
- Loại `channel` của bản chat cũ (media, G10) **bị loại bỏ** cùng đợt de-media-fy — xem §5.3.

### 3.2 Thành viên phòng LÀ ranh giới quyền — không phải data_scope

Đây là điểm khác căn bản so với HR/TASK/GOAL. CHAT **không** dùng thang `own / department / all`: một nhân viên có thể nhắn riêng với giám đốc (ngoài phòng ban), và trưởng phòng **không** được đọc tin nhắn riêng của nhân viên trong phòng mình dù data_scope là `department`.

```text
Quyền CHAT.* (per-pair)  =  CỔNG MODULE — "có được dùng chat không, được làm hành động gì"
Thành viên phòng          =  RANH GIỚI DỮ LIỆU — "được đọc/ghi ở phòng nào"
```

Cả hai phải cùng đúng. Mọi đường đọc — danh sách phòng, đọc tin, **tìm kiếm**, tải tệp đính kèm, join room WebSocket, đích emit realtime — đi qua **đúng một** hàm khẳng định: `ChatAccessService.assertMember(companyId, roomId, actorUserId)`. Không route nào tự viết lại điều kiện membership (bài học `module-closed-by-second-assert-not-scope` — ATT/LEAVE đã tự-bound theo `actor.id` cùng kiểu này).

### 3.3 Membership là ranh giới — đúng MỘT ngoại lệ, có cặp quyền riêng và audit bắt buộc

**CHAT-DEC-004 (owner chốt 02/08/2026):** Super Admin **đọc được mọi phòng, có audit**.

> ⚠️ Bản Draft của tài liệu này đề xuất ngược lại ("không ai đọc được, kể cả Super Admin"). Owner đã bác đề xuất đó. Mục này là **văn bản có hiệu lực**; mọi mô tả cũ trong lịch sử git không còn giá trị tham chiếu.

Ngoại lệ này được đóng khung chặt để không biến thành lỗ đọc toàn cục:

| Ràng buộc | Nội dung | Vì sao ràng buộc này tồn tại |
| --- | --- | --- |
| **Cặp quyền RIÊNG** | `('view','chat-oversight')` — **không** nới scope của `('view','chat-room')` | Nới cặp cũ buộc **mọi** route thường phải tự phân biệt member/không-member; một chỗ quên là lỗ. Cặp riêng giữ toàn bộ đường đọc thường fail-closed **nguyên vẹn**, chỉ một nhánh mới phải chứng minh (`read-path-gate-pair-must-match-download-pair`) |
| **Chỉ Super Admin — nhưng KHÔNG grant trong migration** | Migration **chỉ INSERT catalog `permissions`**; **0** hàng `role_permissions` cho mọi role canonical. SA nhận cặp qua `SuperAdminBootstrapService` lúc boot | ⚠️ **`super-admin` KHÔNG phải role canonical.** 4 role canonical (`roles.company_id IS NULL`) = `employee` · `manager` · `hr` · `company-admin`; SA là role **company-scoped dựng lúc boot**. Viết `INSERT … WHERE code='super-admin'` trong migration khớp **0 hàng** ⇒ verify "SA có cặp" **luôn đỏ** ⇒ lối thoát dễ nhất của người thi công là grant lạc sang `company-admin`, đúng role mục này cấm. Verify trong migration đúng **một vế**: 0 role canonical giữ cặp. Khẳng định SA có cặp là **int-spec chạy SAU boot** (DB-12 §9 bước D′) |
| **`is_sensitive = true`** | riêng cặp này; 9 cặp kia giữ `false` | Cặp nhạy cảm bị `getCapabilities()` **lọc khỏi `/auth/me`** trừ khi có trong `SENSITIVE_CAPABILITY_ALLOWLIST` (**backend** — `apps/api/src/permission/permission.service.ts`, KHÔNG phải file FE). Thiếu ⇒ màn quản trị **ẩn dù DB có quyền**; và test bằng chính tài khoản SA **không tái hiện được** (SA lọt nhờ tai nạn `*:*`). FE phải gate bằng **`useCanExact`**, không phải `useCan` — `useCan` rơi xuống `*:resource → action:* → *:*` nên sẽ hiện lối vào màn nguy hiểm nhất module cho mọi người giữ wildcard trong khi BE vẫn 403 |
| **Audit — hai mô hình transaction** | **thành công**: `Success` trong **cùng** tx với truy vấn đọc, ghi **trước khi** trả dữ liệu · **từ chối**: `Denied` trong tx **RIÊNG đã commit** rồi mới ném 403 | Audit ghi sau/ngoài transaction là đường im lặng: lỗi ghi audit vẫn trả dữ liệu ⇒ "có audit" mất sạch ý nghĩa. Ngược lại, ném 403 **trong** cùng tx sẽ **rollback mất** dòng audit từ chối — đúng thứ ta dựng nó để ghi lại |
| **KHÔNG mở tìm kiếm** | `/chat/search` giữ nguyên vị từ membership, **kể cả** với Super Admin | Tìm kiếm là đường đọc rộng nhất module. Mở toàn cục biến một ô search thành cửa xuất toàn bộ nội dung công ty, và dấu vết audit sẽ ghi theo *câu truy vấn* thay vì theo *phòng* ⇒ mất khả năng trả lời "ai đã đọc phòng nào" |
| **KHÔNG cấp quyền tải tệp** | `ChatMessageFileResolver` **cấm** đọc cặp `chat-oversight`; DTO oversight trả metadata tệp **không kèm URL ký** | Thêm cặp vào resolver đẻ ra đường tải đi qua route FOUNDATION Files — **không dòng audit CHAT nào**. Và tái dùng nguyên DTO tin nhắn thường (vốn kèm URL ký) làm chính payload oversight phát ra khoá đọc tệp không cần membership |
| **Lối vào tường minh trên UI** | màn quản trị riêng + xác nhận "xem với tư cách quản trị"; **không** trộn vào danh sách phòng thường; FE gate bằng `useCanExact` | Không bao giờ xảy ra do vô ý, và làm cho mỗi dòng audit tương ứng một chủ đích có thật |

Hệ quả vẫn giữ nguyên từ bản Draft:

- Ngoài nhánh `('view','chat-oversight')`, **không** endpoint nào nhận `roomId` mà bỏ qua assert membership — kể cả endpoint quản trị khác.
- Không widget DASH nào đếm/hiện nội dung tin nhắn.
- Trường hợp cần kiểm duyệt nội dung vi phạm → xem §5.2 (cơ chế **báo cáo tin nhắn**), không phải mở thêm quyền đọc.

**Phạm vi đọc-vượt bao gồm cả phòng `direct` (tin nhắn riêng)** — đây là phần nhạy cảm nhất của quyết định. Phải ghi thẳng trong RELEASE-11 Admin Guide để người dùng biết ranh giới riêng tư thật của hệ thống, không chôn trong code.

### 3.4 Tin nhắn là ledger append-only

`chat_messages` đã nằm trong nhóm bảng append-only từ migration 0010: app role chỉ có `INSERT` + `SELECT`, không có `DELETE`, và `UPDATE` chỉ được cấp **theo cột** (`pinned_at`, `pinned_by` — mig 0050). CHAT v1 giữ nguyên bất biến đó:

- **Sửa tin nhắn: KHÔNG có ở v1** (§5.2). Không có đường ghi nào chạm `body`/`sender_id` sau khi insert.
- **Thu hồi tin nhắn** không phải xoá: set `recalled_at`/`recalled_by` qua **column-level GRANT UPDATE** (cùng cơ chế `pinned_at`). Body vẫn nằm trong DB cho audit; **tầng DTO bỏ trắng `body` khi `recalled_at IS NOT NULL`** — che ở SERVER, không ở client (CLAUDE.md §5).

### 3.5 Client không bao giờ ghi qua WebSocket

Gửi tin đi **REST** (`POST /chat/rooms/:id/messages`), server emit lại qua WS. Gateway hiện tại **không có** `@SubscribeMessage` nào và v1 **giữ nguyên** như vậy (CHAT-DEC-005).

Lý do: mỗi khung tin qua WS sẽ phải tự kiểm token còn hạn + permission + membership; một chỗ quên là lỗ ghi trực tiếp. Đi REST thì tái dùng nguyên `JwtAuthGuard` + `PermissionGuard` + audit + validation Zod đã được kiểm chứng. Với 45 người dùng, độ trễ thêm của một HTTP POST là không đáng kể so với rủi ro.

### 3.6 Không sao chép dữ liệu nguồn

CHAT không lưu tên nhân viên, tên phòng ban, tên dự án — join từ module nguồn khi hiển thị. Ảnh đại diện người gửi lấy từ ME/HR. Tệp đính kèm **không** lưu URL trần trên `chat_messages` (cột `file_url`/`file_name` của bản cũ bị **khai tử**, §5.3) mà đi qua `file_links` của FOUNDATION + URL ký hạn ngắn.

---

## 4. Mục tiêu module

### 4.1 Mục tiêu nghiệp vụ

1. Nhân viên trao đổi công việc trong hệ thống công ty, không phải trên ứng dụng cá nhân.
2. Mỗi phòng ban và mỗi dự án có sẵn một kênh chung, không ai phải lập nhóm thủ công và không ai bị bỏ sót.
3. Nội dung trao đổi công việc là **tài sản công ty** — còn lại sau khi nhân viên nghỉ việc.
4. Tìm lại được tin nhắn cũ bằng tiếng Việt, có dấu lẫn không dấu.
5. Trao đổi riêng tư chỉ mở cho thành viên phòng; ngoại lệ quản trị duy nhất đi qua cặp quyền riêng và **để lại dấu vết** (§3.3).

### 4.2 Mục tiêu kỹ thuật

1. Tái dùng **hạ tầng đã có**: bảng chat 0010/0050 (RLS+FORCE, append-only, `seq` identity, `direct_key`), gateway `/ws` + Valkey adapter, FOUNDATION Files, OutboxNotificationBridge. Không dựng lại nền.
2. Một điểm khẳng định membership duy nhất (§3.2), fail-closed.
3. Realtime **best-effort**: WS chết thì REST + polling vẫn cho trải nghiệm đúng, không mất tin (`REALTIME_ENABLED=false` là đường lui hợp lệ).
4. Tìm kiếm tiếng Việt bằng hạ tầng Postgres sẵn có (`unaccent` + `tsvector`), **không** thêm search engine (Typesense đã bị loại vì GPL-3 — CLAUDE.md §4).
5. Một kết nối WS duy nhất cho toàn app shell, dùng chung giữa trang full-screen và panel nổi.

---

## 5. Phạm vi module

### 5.1 Trong wave S7-CHAT (v1)

| Nhóm | Nội dung | Nguồn SPEC-01 §12.12 |
| --- | --- | --- |
| Phòng 1-1 | Mở chat riêng với bất kỳ nhân viên nào trong công ty, idempotent theo `direct_key` | Chat 1-1 |
| Phòng nhóm | Tạo/đổi tên/thêm-bớt thành viên/rời/lưu trữ | Chat nhóm |
| Phòng ban | Phòng tự động theo `org_units`, thành viên dẫn xuất + đối soát định kỳ | Chat theo phòng ban |
| Dự án | Phòng tự động theo `projects`, thành viên dẫn xuất từ `project_members` | Chat theo dự án |
| Gửi tệp | Đính kèm qua FOUNDATION Files + resolver quyền riêng của CHAT | Gửi file |
| Gửi hình ảnh | Cùng đường tệp + xem trước ảnh (thumbnail ký hạn ngắn) | Gửi hình ảnh |
| Đã xem | `last_read_seq` per-thành-viên → badge chưa đọc + danh sách "đã xem bởi" | Đã xem tin nhắn |
| Tìm kiếm | Toàn văn tiếng Việt (có dấu/không dấu) **trong phạm vi phòng mình là thành viên** | Tìm kiếm tin nhắn |
| Realtime | Đẩy `chat:message` / `chat:read` / `chat:room` qua WS, room `co:{companyId}:chatroom:{roomId}` | Realtime message |
| Trả lời & ghim | Trả lời tin (`reply_to_message_id`), ghim tin trong phòng | Bổ sung tối thiểu để dùng thật |
| Thu hồi | Người gửi thu hồi tin của mình trong cửa sổ thời gian; admin phòng thu hồi tin trong phòng nhóm | Bổ sung tối thiểu để dùng thật |
| Thông báo | `CHAT_MENTIONED` (mention) + `CHAT_DIRECT_MESSAGE` (DM khi vắng mặt, gộp theo lô) | NOTI: thông báo tin nhắn mới |
| Tắt thông báo | `muted_until` per-phòng | Bổ sung tối thiểu để dùng thật |

### 5.2 Ngoài v1 (chừa thiết kế, KHÔNG làm đợt này)

| Nhóm | Ghi chú |
| --- | --- |
| Sửa tin nhắn đã gửi | Phá append-only thuần (§3.4); nếu cần → bảng `chat_message_revisions`, không UPDATE tại chỗ |
| Đang gõ / đang online (typing · presence) | Cần kênh WS hai chiều + Valkey presence; đo nhu cầu thật sau v1 |
| Thả cảm xúc (reaction) | Không nằm trong SPEC-01 §12.12 |
| Chat theo **task** (không phải dự án) | SPEC-01 §12.12 nêu "task"; TASK đã có bình luận riêng (SPEC-06) ⇒ tránh hai kênh trùng. Xem CHAT-DEC-009 |
| Kiểm duyệt / báo cáo tin nhắn | Thiết kế đề xuất: `chat_message_reports` → người xử lý chỉ thấy **tin bị báo cáo** + ngữ cảnh 5 tin quanh nó, KHÔNG mở khoá đọc cả phòng. Cần owner chốt chính sách trước khi làm |
| Cuộc gọi thoại/hình | Ngoài phạm vi sản phẩm |
| Chat với người ngoài công ty | Đơn-công-ty, không có khách |
| Ứng dụng di động | Phase 5 (MOBILE) |
| Lưu trữ/xoá theo chính sách lưu giữ | Nối vào `retention` của FOUNDATION ở phase sau; v1 không tự xoá tin |

### 5.3 Tài sản cũ bị khai tử trong wave này

| Thứ | Trạng thái | Xử lý |
| --- | --- | --- |
| `chat_rooms.channel_id` → `channels` (media) | Bảng `channels` out-of-scope sau de-media-fy | Ngừng dùng ở v1; DROP cột ở migration **riêng** sau khi xác minh 0 hàng (expand-contract) |
| `chat_rooms.room_type = 'channel'` | Không còn nghĩa | Loại khỏi enum contracts + CHECK |
| `chat_messages.file_url` / `file_name` | URL trần — rò tệp không qua kiểm quyền | Ngừng ghi ngay từ v1, đọc trả `null`; DROP ở migration riêng |
| `apps/api/src/chat/*` (G4-6/G10, đã `git rm` ở `2591db13`) | Chỉ kiểm membership, **không** permission guard, **không** audit, **không** data-scope | Dùng làm **tham chiếu**, KHÔNG khôi phục nguyên trạng |
| `packages/contracts/src/chat.ts` | Còn trong repo, thiếu nhiều trường v1 | Mở rộng tại chỗ (thêm trường + bỏ `channel`) |

---

## 6. Nhóm người dùng

| Nhóm | Nhu cầu chính |
| --- | --- |
| Nhân viên | Nhắn riêng đồng nghiệp; theo dõi kênh phòng ban/dự án của mình; tìm lại tin cũ; tắt thông báo phòng ồn |
| Trưởng đơn vị | Thông báo cho cả phòng qua kênh phòng ban; lập nhóm công việc liên phòng |
| Quản lý dự án | Trao đổi trong kênh dự án; người mới vào dự án đọc được ngữ cảnh trước đó |
| BOD / Admin | Dùng chat như nhân viên. **Không** có quyền đọc phòng mình không thuộc — cặp `('view','chat-oversight')` chỉ cấp cho Super Admin (§3.3) |
| Quản trị hệ thống | Bật/tắt module CHAT; đối soát phòng tự động; theo dõi sức khoẻ WS |

---

## 7. Mối liên kết với các module khác

| Module | CHAT dùng gì | Chiều |
| --- | --- | --- |
| AUTH | permission `CHAT.*`; token access dùng lại cho handshake WS; khoá/vô hiệu user → cắt phiên WS | CHAT ← AUTH |
| HR | `employees` (danh bạ chọn người nhắn), `org_units` (phòng tự động), sự kiện đổi phòng ban → đồng bộ thành viên | CHAT ← HR |
| TASK | `projects` + `project_members` (phòng dự án tự động); dự án đóng/xoá → lưu trữ phòng | CHAT ← TASK |
| FOUNDATION | Files (đính kèm + resolver quyền), `audit_logs`, `sequence_counters` (mã phòng), system-jobs (đối soát định kỳ) | CHAT ← FOUNDATION |
| NOTI | phát `CHAT_MENTIONED` · `CHAT_DIRECT_MESSAGE` qua OutboxNotificationBridge | CHAT → NOTI |
| ME | badge tổng số tin chưa đọc trên header; `muted_until` hiển thị trong tuỳ chọn cá nhân | CHAT → ME |
| LMS | thay lối vào `/chat` tạm hiện tại của LMS bằng CHAT nội bộ (ghi chú S5-LMS-UI-4) | CHAT → LMS |
| DASH | **không** có widget nội dung chat (§3.3); chỉ có thể đếm số phòng chưa đọc của chính người xem | CHAT → DASH (tối thiểu) |

---

## 8. Cấu trúc thông tin

Chi tiết cột/kiểu/constraint: [DB-12](<../DB/DB-12 CHAT Database Design.md>).

**Phòng (`chat_rooms`)**

| Nhóm | Trường | Ghi chú |
| --- | --- | --- |
| Định danh | `room_code`, `name`, `description` | code sinh qua `sequence_counters`; `name` của `direct` là dẫn xuất (tên người đối thoại), không lưu |
| Loại & neo | `room_type` + neo tương ứng: `org_unit_id` / `ref_id` (project) / `direct_key` | CHECK ràng buộc loại ↔ neo |
| Đồng bộ | `sync_source` (`manual` / `department` / `project`), `synced_at` | phòng dẫn xuất mới có |
| Hoạt động | `last_message_at`, `last_message_seq` | sắp xếp danh sách phòng, tránh N+1 |
| Vòng đời | `is_archived`, `archived_at`, `deleted_at` | soft delete |

**Thành viên (`chat_room_members`)**

| Nhóm | Trường | Ghi chú |
| --- | --- | --- |
| Neo | `room_id`, `user_id` | unique theo phòng |
| Vai trò | `role` (`member` / `admin`) | phòng nhóm mới có admin do người chỉ định |
| Đã đọc | `last_read_seq`, `last_read_at` | **`seq` là nguồn sự thật**, `at` chỉ để hiển thị (§13.2) |
| Tuỳ chọn | `muted_until` | tắt thông báo tới thời điểm |
| Vòng đời | `joined_at`, `left_at`, `visible_from_seq` | `visible_from_seq` chừa sẵn, v1 **luôn NULL** (§13.4 · CHAT-DEC-008) |

**Tin nhắn (`chat_messages`)**

| Nhóm | Trường | Ghi chú |
| --- | --- | --- |
| Neo | `room_id`, `sender_id`, `seq` | `seq` = bigint identity, thứ tự tổng trong phòng |
| Nội dung | `body`, `message_type` (`text` / `file` / `system`), `mentions` | `system` = tin do hệ thống sinh ("A đã thêm B vào nhóm") |
| Trả lời | `reply_to_message_id` | cùng phòng, không lồng nhiều tầng |
| Chống trùng | `client_message_id` | unique theo (phòng, người gửi) — chống double-submit (§12, CHAT-ERR-014) |
| Ghim | `pinned_at`, `pinned_by` | column-level UPDATE |
| Thu hồi | `recalled_at`, `recalled_by` | column-level UPDATE; body bị che ở DTO |
| Tìm kiếm | `search_vector` | cột **GENERATED STORED**, DB tự tính — không đường ghi nào chạm |

---

## 9. Danh sách màn hình

| Mã | Màn hình | Ghi chú |
| --- | --- | --- |
| CHAT-SCREEN-001 | Trang Chat full-screen (`/chat`) | 3 cột: danh sách phòng · khung hội thoại · thông tin phòng |
| CHAT-SCREEN-002 | Panel chat nổi (mọi màn hình) | thu nhỏ/mở rộng, tối đa 3 hội thoại mở, **dùng chung store + chung 1 kết nối WS** với CHAT-SCREEN-001 |
| CHAT-SCREEN-003 | Hộp thoại tạo nhóm / chọn người nhắn riêng | danh bạ nhân viên có tìm kiếm, tôn trọng quyền xem danh bạ của HR |
| CHAT-SCREEN-004 | Bảng thông tin phòng | thành viên · tệp đã gửi · tin đã ghim · nút rời/lưu trữ (theo quyền + loại phòng) |
| CHAT-SCREEN-005 | Tìm kiếm tin nhắn | phạm vi: tất cả phòng của tôi, hoặc trong 1 phòng; nhảy tới tin trong ngữ cảnh |
| CHAT-SCREEN-006 | Badge chưa đọc trên header | tổng theo user, đồng bộ realtime qua `chat:read` |
| CHAT-SCREEN-007 🔒 | **Quản trị: đọc-vượt membership** (§3.3) | Chỉ hiện với cặp `('view','chat-oversight')`. Tra phòng theo mã/tên → **hộp thoại xác nhận "xem với tư cách quản trị"** → mở phòng ở chế độ **chỉ đọc** (không gửi/ghim/thu hồi được). **Không** trộn vào danh sách phòng của CHAT-SCREEN-001 |
| CHAT-SCREEN-008 🔒 | **Quản trị: nhật ký đọc-vượt** | Danh sách lần dùng CHAT-SCREEN-007 (ai · phòng nào · lúc nào · thành công/bị từ chối), đọc từ `audit_logs`. Audit không xem được trên UI thì không phải là kiểm soát (§18) |

---

## 10. Chi tiết chức năng

| Mã | Chức năng | Mô tả ngắn |
| --- | --- | --- |
| CHAT-FUNC-001 | Mở phòng 1-1 | idempotent theo `direct_key` = 2 userId sắp xếp tăng dần, nối `:` |
| CHAT-FUNC-002 | Tạo & quản trị phòng nhóm | tạo · đổi tên/mô tả · thêm/bớt thành viên · phong admin · rời · lưu trữ |
| CHAT-FUNC-003 | Phòng ban tự động | tạo/đóng theo `org_units`; thành viên dẫn xuất từ nhân sự đang làm việc |
| CHAT-FUNC-004 | Dự án tự động | tạo/đóng theo `projects`; thành viên dẫn xuất từ `project_members` |
| CHAT-FUNC-005 | Đồng bộ thành viên + đối soát định kỳ | tại sự kiện + job idempotent so khớp lại toàn bộ phòng dẫn xuất (§13.3) |
| CHAT-FUNC-006 | Gửi tin nhắn | text/file, mention, trả lời, chống trùng theo `client_message_id` |
| CHAT-FUNC-007 | Đính kèm tệp & ảnh | presign upload → link vào tin nhắn qua `file_links` (§13.5) |
| CHAT-FUNC-008 | Đọc lịch sử | phân trang theo con trỏ `seq` (trước/sau), không dùng offset |
| CHAT-FUNC-009 | Đánh dấu đã đọc | `last_read_seq` chỉ tiến, không lùi (§13.2) |
| CHAT-FUNC-010 | Ghim / bỏ ghim | tối đa 20 tin ghim/phòng |
| CHAT-FUNC-011 | Thu hồi tin | người gửi trong cửa sổ N phút; admin phòng nhóm bất kỳ lúc nào (§13.6) |
| CHAT-FUNC-012 | Tìm kiếm toàn văn | tiếng Việt có dấu/không dấu, chỉ trong phòng mình là thành viên (§13.7) |
| CHAT-FUNC-013 | Realtime | đẩy tin/đã đọc/đổi phòng; đồng bộ join-leave WS room khi membership đổi |
| CHAT-FUNC-014 | Thông báo | mention tức thì; DM gộp lô khi người nhận vắng mặt (§17) |
| CHAT-FUNC-015 | Tắt thông báo phòng | `muted_until`; phòng đã tắt không sinh notification nhưng vẫn tăng badge |

---

## 11. Permission đề xuất

Theo chuẩn per-pair `(action, resource)` + data_scope per-(permission, role). Module `CHAT` đứng riêng.

⚠️ **Đọc kèm §3.2:** data_scope ở đây **không** phân biệt phạm vi dữ liệu (mọi role đều bị chặn bởi membership). Scope chỉ dùng để phân biệt **được làm hành động ở mức nào**; đề xuất đồng nhất `all` cho các cặp đọc/ghi cơ bản vì ranh giới thật nằm ở membership.

| Cặp quyền | Ý nghĩa | Nhân viên | Trưởng đơn vị | BOD/Admin |
| --- | --- | --- | --- | --- |
| `('access','chat')` | cổng nav + panel nổi | có | có | có |
| `('view','chat-room')` | xem phòng · đọc tin · **tìm kiếm** · tải tệp đính kèm | có (all) | có (all) | có (all) |
| `('create','chat-room')` | tạo phòng nhóm + mở DM | có | có | có |
| `('update','chat-room')` | sửa tên/mô tả phòng nhóm | có (admin phòng) | có | có |
| `('archive','chat-room')` | lưu trữ phòng nhóm | có (admin phòng) | có | có |
| `('manage','chat-member')` | thêm/bớt/phong admin trong phòng nhóm | có (admin phòng) | có | có |
| `('send','chat-message')` | gửi tin + đính kèm | có | có | có |
| `('recall','chat-message')` | thu hồi tin | có (tin của mình) | có | có |
| `('pin','chat-message')` | ghim/bỏ ghim | có (admin phòng) | có | có |
| `('view','chat-oversight')` 🔒 | **đọc-vượt membership** — mở đích danh một phòng với tư cách quản trị, có audit (§3.3) | — | — | **chỉ Super Admin** |

Ghi chú bắt buộc:

- **Cặp gate của tìm kiếm và tải tệp PHẢI trùng cặp của đường đọc** (`view:chat-room`). Dùng cặp khác (ví dụ tách `('search','chat-message')`) sẽ tạo role "tìm được mà đọc không được" hoặc ngược lại — đúng lỗ đã gặp ở `S5-TASK-COVER-1` (bài học `read-path-gate-pair-must-match-download-pair`).
- Cột "có (admin phòng)" nghĩa là: **quyền là điều kiện cần, `chat_room_members.role='admin'` là điều kiện đủ** — kiểm ở service, không phải ở seed.
- `is_sensitive` **CHỐT**: `false` cho 9 cặp thường, **`true`** cho riêng `('view','chat-oversight')`. Giá trị này là cuối cùng, không để mở sau seed (bẫy `canonical-seed-pin-regression`: flip `is_sensitive` sau seed làm ĐỎ pin `auth-seed-canonical-roles` và phải sửa đồng thời allowlist sensitive FE). Cặp `chat-oversight` **phải** có mặt trong `SENSITIVE_CAPABILITY_ALLOWLIST` — nằm ở **backend** `apps/api/src/permission/permission.service.ts` (pin bởi `apps/api/src/auth/auth-me-capabilities.int.spec.ts`), **không** phải file phía FE — **cùng commit** với seed; thiếu là màn quản trị ẩn dù DB có quyền (KI-058).
- **Đúng một cặp cho phép đọc phòng mình không thuộc:** `('view','chat-oversight')`, chỉ Super Admin, luôn kèm audit, **không** áp cho tìm kiếm (§3.3). Mọi cặp khác — kể cả `('view','chat-room')` — vẫn bị membership chặn tuyệt đối.
- Nếu về sau owner duyệt cơ chế kiểm duyệt nội dung, cặp mới phải là `('manage','chat-report')` gắn với **tin bị báo cáo**, không phải mở rộng scope của `('view','chat-room')` hay của `('view','chat-oversight')`.

---

## 12. Quy tắc nghiệp vụ và mã lỗi

| Mã lỗi | Quy tắc |
| --- | --- |
| CHAT-ERR-001 | Không phải thành viên phòng → **404** cho đường đọc phòng lạ (không phải 403 — 403 xác nhận phòng có tồn tại, thành oracle dò); **403** khi đã là thành viên nhưng thiếu quyền hành động |
| CHAT-ERR-002 | Loại phòng ↔ neo không khớp: `direct` chỉ có `direct_key`; `department` chỉ có `org_unit_id`; `project` chỉ có `ref_id`; `group` không neo |
| CHAT-ERR-003 | Mở DM với chính mình, hoặc với user không cùng company, hoặc user đã bị khoá/nghỉ việc |
| CHAT-ERR-004 | Tin nhắn rỗng hoặc vượt 4000 ký tự; tin `file` không kèm tệp hợp lệ |
| CHAT-ERR-005 | Gửi tin vào phòng đã lưu trữ / đã xoá mềm |
| CHAT-ERR-006 | Thu hồi tin của người khác (không phải admin phòng), hoặc quá cửa sổ thu hồi (§13.6) |
| CHAT-ERR-007 | Sửa tin nhắn — **không hỗ trợ ở v1**, mọi đường ghi vào `body` bị từ chối |
| CHAT-ERR-008 | Ghim quá 20 tin/phòng |
| CHAT-ERR-009 | Trả lời tin không cùng phòng, hoặc tin đã bị thu hồi |
| CHAT-ERR-010 | Mention user không phải thành viên phòng → bỏ khỏi danh sách mention (không chặn gửi), không sinh notification |
| CHAT-ERR-011 | Thêm thành viên đã có / bớt thành viên cuối cùng là admin của phòng nhóm |
| CHAT-ERR-012 | Thao tác thành viên thủ công trên phòng **dẫn xuất** (`department`/`project`) → chặn; đổi thành viên phải làm ở HR/TASK |
| CHAT-ERR-013 | Rời phòng `direct` / `department` / `project` → chặn (§3.1) |
| CHAT-ERR-014 | `client_message_id` trùng trong cùng (phòng, người gửi) → **trả lại tin đã tạo lần đầu, 200 idempotent** — không tạo bản sao, không báo lỗi |
| CHAT-ERR-015 | Tệp đính kèm không thuộc quyền của người gửi, chưa quét virus xong, hoặc đã bị đánh dấu nhiễm |
| CHAT-ERR-016 | Con trỏ phân trang không hợp lệ (`beforeSeq`/`afterSeq` sai kiểu, hoặc dùng cả hai cùng lúc) |
| CHAT-ERR-017 | Truy vấn tìm kiếm ngắn hơn 2 ký tự → **400/422** (lỗi validate thuần). Chỉ định `roomId` mà người tìm không thuộc → **404, GIỐNG HỆT** trường hợp `roomId` không tồn tại — trả mã khác nhau là biến ô tìm kiếm thành oracle dò sự tồn tại của phòng, đúng thứ CHAT-ERR-001 dựng 404 để chặn |
| CHAT-ERR-018 | `last_read_seq` gửi lên nhỏ hơn giá trị hiện có → bỏ qua im lặng (chỉ tiến, không lùi), không lỗi |
| CHAT-ERR-019 | Gọi đường đọc-vượt (§3.3) mà **thiếu cặp** `('view','chat-oversight')` → **403** (không phải 404: người gọi biết mình đang cố dùng chức năng quản trị, không có gì để dò). Ghi audit cả lần **bị từ chối** |
| CHAT-ERR-020 | Đường đọc-vượt được gọi nhưng **ghi `audit_logs` thất bại** → **rollback, không trả dữ liệu**. Đọc-vượt không có dấu vết thì không được phép xảy ra (§3.3) |

Quy tắc bổ sung (không cần mã lỗi riêng):

- Nhân viên nghỉ việc: **giữ nguyên** mọi tin đã gửi (tài sản công ty, §4.1); user bị vô hiệu hoá → rời khỏi phòng dẫn xuất, cắt phiên WS, không đọc/gửi được nữa.
- Xoá phòng nhóm là **lưu trữ + soft delete**, không bao giờ xoá cứng tin nhắn.
- Tin `system` (thêm/bớt thành viên, đổi tên phòng) do server sinh, `sender_id` = người gây ra hành động, không thu hồi/ghim được.
- Mọi hành động quản trị phòng (tạo/đổi tên/thêm-bớt thành viên/lưu trữ/thu hồi) ghi `audit_logs`. **Nội dung tin nhắn KHÔNG vào audit log** — chỉ id và loại hành động (audit log có nhiều người đọc hơn phòng chat).

---

## 13. Lõi nghiệp vụ

### 13.1 Thứ tự tin nhắn và phân trang

**`room_seq`** (bigint, liên tục từ 1 **trong từng phòng** — mig `0539`) là thứ tự dùng cho **mọi** việc sắp xếp, phân trang và đếm chưa đọc; `created_at` chỉ để hiển thị. Lý do dùng số thứ tự thay đồng hồ: hai tin cùng mili-giây có thứ tự nhập nhằng, và đồng hồ có thể lùi.

> ⚠️ **ĐÍNH CHÍNH 02/08/2026 — bản trước của mục này SAI.** Nó viết "`seq` … là thứ tự tổng **trong phòng**", chép theo comment `0050:79`. DDL thật (`0050:77`) là `GENERATED ALWAYS AS IDENTITY` **cấp BẢNG**: tăng xuyên mọi phòng và mọi tenant. Hai hệ quả đã đo được:
> 1. Công thức đếm chưa đọc ở §13.2 cho **số của phòng khác**: phòng A 2 tin, phòng B 50 tin ⇒ badge phòng A hiện **51** thay vì **1**.
> 2. `seq` là con trỏ **lộ ra client**, nên thành viên một phòng suy ra được lưu lượng tin **toàn công ty** giữa hai lần mình nhắn — gồm cả DM họ không thuộc.
>
> `seq` toàn cục **vẫn còn** trong bảng (identity không drop sạch được) nhưng **KHÔNG được lộ ra client** và **KHÔNG được đem trừ**. Mọi thứ hướng-client dùng `room_seq`.

```text
GET /chat/rooms/:id/messages?beforeSeq=<n>&limit=50   → n-1, n-2, … (cuộn lên đọc tin cũ)
GET /chat/rooms/:id/messages?afterSeq=<n>&limit=50    → n+1, n+2, … (bù tin lỡ sau khi WS đứt)

# `beforeSeq`/`afterSeq` mang giá trị `room_seq` (per-room), KHÔNG phải `seq` toàn cục. Tên tham số
# giữ nguyên để khỏi churn FE; ngữ nghĩa đã đổi ở mig 0539.
```

Cấm phân trang bằng `offset` (kết quả trôi khi có tin mới chèn vào giữa lúc cuộn).

### 13.2 Đã xem — `last_read_seq` chỉ tiến

- Client báo đã đọc tới `room_seq` nào → server `UPDATE … SET last_read_seq = GREATEST(last_read_seq, $1)`. Không bao giờ lùi (CHAT-ERR-018): nhiều thiết bị cùng mở, thiết bị chậm không được kéo lùi trạng thái của thiết bị nhanh.
- Số chưa đọc của một phòng = `room.last_message_seq - member.last_read_seq`, **cả hai trong hệ `room_seq`** (đếm bằng phép trừ, **không** `COUNT(*)` trên `chat_messages`). Phép trừ chỉ đúng vì `room_seq` liên tục trong phòng — đem trừ trên `seq` toàn cục là lỗi đã đo (xem cảnh báo §13.1).
- "Đã xem bởi ai" = danh sách thành viên có `last_read_seq >= seq` của tin đang xét — dẫn xuất, không lưu bảng riêng.
- Tin do chính mình gửi luôn tự nâng `last_read_seq` trong cùng transaction.

### 13.3 Đồng bộ thành viên phòng dẫn xuất

```text
Nguồn                          Sự kiện                         Hệ quả ở CHAT
org_units                      tạo phòng ban                   tạo phòng department
employees.org_unit_id đổi      chuyển phòng ban                rời phòng cũ + vào phòng mới
employees trạng thái nghỉ      nghỉ việc / vô hiệu hoá         rời mọi phòng dẫn xuất
projects                       tạo dự án                       tạo phòng project
project_members                thêm/bớt thành viên dự án       vào/rời phòng project
projects đóng/xoá mềm          kết thúc dự án                  lưu trữ phòng (không xoá tin)
```

- Đồng bộ chạy **trong cùng transaction** với thao tác nguồn khi rẻ; nếu module nguồn không tiện gọi trực tiếp thì đi qua outbox.
- **Job đối soát định kỳ** (`@SystemJobHandler`, idempotent — mẫu `retention-cleanup.job-handler.ts`) so khớp lại toàn bộ phòng dẫn xuất với nguồn và sửa lệch; lệch > 0 → log cảnh báo kèm số phòng/số thành viên. Đây là lưới an toàn cho mọi đường ghi bị bỏ sót.

> **Làm rõ 02/08/2026 — owner chốt, đọc trước khi thi công `S7-CHAT-BE-5`:**
>
> 1. **"Đêm" là chữ sai, đã sửa thành "định kỳ".** Hệ **không có cron**: mọi `@SystemJobHandler` chạy chung một `setInterval` (`apps/api/src/scheduler/worker-scheduler.config.ts`), và PROD đặt `SYSTEM_JOBS_POLL_MS=900000` — **15 phút** (`.env.prod:9`; chỉ `.env.example` để 60000). Ai đọc "đêm" rồi đi tìm cron sẽ không thấy gì.
> 2. **Đường THU HỒI quyền chạy trong CÙNG transaction nguồn** — rời phòng khi đổi phòng ban · nghỉ việc · unlink · bớt `project_members`. Cửa sổ lệch phải bằng **0**, không được dựa vào job (15 phút là quá rộng cho một thao tác thu hồi quyền đọc). Hỏng ở nhánh này phải **LOUD** (log ERROR + audit `resultStatus='Failure'`), cấm nuốt bằng `logger.warn`.
> 3. **Đường TẠO PHÒNG được phép ngoài transaction nguồn** — cấp `room_code` đi qua `SequenceService.nextCode()` vốn tự mở `withTenant` nên **không lồng được** vào tx nghiệp vụ (xem jsdoc `chat-room-code.service.ts`); phải cấp mã TRƯỚC khi mở tx, chấp nhận phí số khi rollback (hành vi đã có ở `task`). Thiếu một phòng ≠ rò quyền đọc, nên đánh đổi này an toàn còn ở mục 2 thì không.
> 4. Riêng `OrgService.createOrgUnit`: `OrgRepository.createOrgUnit` **không nhận `tx`** (`org.repository.ts:89`, tự mở `withTenant`) — muốn đồng bộ cùng tx thì phải nới chữ ký repo trước; nếu không thì ghi rõ writer này nằm ngoài tx.
> 5. Vị từ "tập thành viên mong muốn" phải **DUY NHẤT**, dùng chung cho cả hook lẫn job. Với phòng `project` bắt buộc kèm `employee_profiles.status='active' AND deleted_at IS NULL` — thiếu vế này thì nhịp job kế tiếp **join lại người vừa nghỉ việc** (vì `changeStatus` không chạm `project_members`).

- Rời phòng dẫn xuất = set `left_at`, **giữ lại hàng** để còn biết "từng ở đây" (và để `visible_from_seq` phase sau có nghĩa). Mọi truy vấn membership phải lọc `left_at IS NULL` — thiếu điều kiện này là lỗ đọc sau khi rời phòng.

### 13.4 Lịch sử trước khi tham gia

v1: thành viên đọc **toàn bộ** lịch sử phòng mình đang thuộc (`visible_from_seq` luôn NULL). Người mới vào dự án đọc được ngữ cảnh trước đó — đúng nhu cầu §2.

Cột `visible_from_seq` được tạo sẵn để phase sau bật chế độ "chỉ đọc từ lúc vào" cho phòng nhóm nhạy cảm mà **không phải migration đổi hình dạng bảng**. Mọi truy vấn đọc tin phải viết sẵn điều kiện `(m.visible_from_seq IS NULL OR msg.room_seq >= m.visible_from_seq)` ngay từ v1 — thêm sau sẽ sót đường đọc.

**Làm rõ 03/08/2026 (`S7-CHAT-BE-GATE-2`) — ba điểm, đều đã đo trên code:**

1. **Hệ quy chiếu là `room_seq`, KHÔNG phải `seq`.** Bản viết trước ghi `msg.seq` vì có TRƯỚC `S7-CHAT-DB-2` (mig `0539`). `chat_messages.seq` là identity **cấp bảng** — tăng xuyên mọi phòng và mọi tenant; so một mốc per-room với nó là cắt lịch sử ở một điểm ngẫu nhiên, lệch dần theo lưu lượng các phòng khác. `visible_from_seq` sống cùng hệ với `last_read_seq` · `last_message_seq` · `beforeSeq`/`afterSeq`. (Comment trong mig `0538` còn giữ chữ `msg.seq` — migration đã áp, không sửa được; điểm này là bản đính chính.)
2. **KHÔNG writer nào của v1 được set cột này** — kể cả `S7-CHAT-BE-5` (đồng bộ phòng ban/dự án): người được thêm vào phòng dẫn xuất đọc **toàn bộ** lịch sử, đó chính là tiêu chí nghiệm thu §20 mục 3. Cột chỉ đổi giá trị khi có một Work Order riêng bật tính năng, và khi đó nó là **một câu UPDATE**, không phải một đợt sửa code.
3. **Vị từ nằm ở đúng MỘT chỗ**: `apps/api/src/chat/chat-visibility.ts` (`visibleFromSeqScalar` · `visibleFromSeqColumn` · `unreadSeqExpr`). Mọi đường đọc gọi helper, không viết lại tay. Hai đường **cố ý** đứng ngoài, có lý do ghi trong file đó: `countPinned` (trần 20 là bất biến của PHÒNG, không của người đang nhìn) và `findByClientMessageId` (đã bound theo `senderId`). Danh sách miễn trừ được đóng đinh trong `chat-visibility.spec.ts`; thêm tên vào đó là một quyết định phải giải trình.

Trong phép **đếm chưa đọc**, vị từ xuất hiện dưới dạng sàn của phép trừ: `unread = GREATEST(0, last_message_seq − GREATEST(last_read_seq, visible_from_seq − 1))`. Thiếu sàn thì badge của người mới vào phòng đếm cả phần lịch sử họ không mở ra được ⇒ badge **không bao giờ tắt được** (không thao tác nào của họ đẩy con trỏ qua đoạn đó). Khi cột NULL, sàn = `−1` ⇒ công thức rút về đúng bản cũ, không đổi một con số nào ở v1.

### 13.5 Tệp đính kèm

```text
1. Client xin presign upload (FOUNDATION Files) → tải lên R2/MinIO
2. Client gửi tin nhắn kèm danh sách fileId
3. Server: kiểm file thuộc người gửi + đã quét virus sạch (CHAT-ERR-015)
           → tạo file_links (moduleCode='CHAT', entityType='chat_message', entityId=<messageId>, linkType='Attachment')
           trong CÙNG transaction với INSERT tin nhắn
4. Đường đọc: URL ký hạn ngắn, cấp sau khi assertMember (§3.2)
```

⚠️ **Bắt buộc có `ChatMessageFileResolver`.** `FilePolicyService.decideForLinkedFile` **fail-closed**: link nào có cặp `(moduleCode, entityType)` chưa đăng ký resolver thì trả thẳng `deny-no-resolver` và **không** rơi xuống fallback `FOUNDATION.FILE.*`. Thiếu resolver ⇒ gửi được tệp nhưng **không ai tải được** — tính năng chết trong im lặng (đúng lỗi đã gặp ở `S5-BRAND-BE-1`). Resolver phải:

- `canView` / `canDownload` ⇐ `view:chat-room` **và** `assertMember` của phòng chứa tin nhắn;
- `canLink` ⇐ `send:chat-message` **và** người gọi là **người đã tải lên chính tệp đó** (chặn tại nguồn việc mượn kênh chat để phát tán tệp CCCD/hợp đồng của người khác — đúng cửa hậu đã bịt ở branding).

Ảnh hiển thị trước bằng biến thể thumbnail; tệp không phải ảnh chỉ hiện tên + kích thước.

### 13.6 Thu hồi tin nhắn

| Ai | Điều kiện | Hệ quả |
| --- | --- | --- |
| Người gửi | trong **15 phút** kể từ `created_at` (hằng số cấu hình, không hard-code rải rác) | `recalled_at`/`recalled_by` |
| Admin phòng **nhóm** | bất kỳ lúc nào, chỉ trong phòng nhóm mình quản trị | như trên + audit |
| Bất kỳ ai khác | — | CHAT-ERR-006 |

Sau thu hồi: DTO trả `body: null` + `recalledAt` để UI hiện "Tin nhắn đã được thu hồi". Tệp đính kèm bị **gỡ link** (link mất → FilePolicy từ chối tải). Bản ghi và body gốc **vẫn nằm trong DB** — append-only không cho xoá, và đó là chủ đích: có dấu vết cho tranh chấp nội bộ.

### 13.7 Tìm kiếm tiếng Việt

```text
search_vector = to_tsvector('simple', f_unaccent(body))       -- cột GENERATED STORED + GIN index
truy vấn      = websearch_to_tsquery('simple', f_unaccent($q))
```

- `simple` (không phải `english`) vì tiếng Việt không có bộ từ điển stemming trong Postgres — cắt gốc từ kiểu Anh sẽ làm hỏng kết quả.
- `f_unaccent` là **wrapper IMMUTABLE** bọc `unaccent()`; bản gốc chỉ `STABLE` nên **không** dùng trực tiếp trong cột generated/index được. Đây là điểm dễ làm migration đỏ giữa chừng.
- `unaccent` cho phép gõ "bao cao" ra "báo cáo" — đúng thói quen gõ tiếng Việt.
- Cột generated ⇒ DB tự tính khi INSERT, **không** cần cấp thêm quyền UPDATE nào lên bảng append-only.
- **Ranh giới bảo mật của tìm kiếm:** truy vấn luôn `JOIN chat_room_members` theo `actorUserId` với `left_at IS NULL`. Không có đường tìm kiếm "toàn công ty". Tìm kiếm là đường đọc rộng nhất của module — sai ở đây là rò toàn bộ nội dung, nên nó thuộc nhóm phải có test deny-path viết TRƯỚC.
- Tin đã thu hồi bị loại khỏi kết quả.

### 13.8 Realtime

| Sự kiện WS | Khi nào | Đích |
| --- | --- | --- |
| `chat:message` | tin mới (sau commit) | room `co:{companyId}:chatroom:{roomId}` |
| `chat:message-recalled` | thu hồi | như trên |
| `chat:read` | thành viên nâng `last_read_seq` | như trên |
| `chat:room` | tạo/đổi tên/thêm-bớt thành viên/lưu trữ | như trên + room riêng của user bị ảnh hưởng |

- Socket **join tất cả phòng của user ngay tại kết nối** (server-side, đọc membership từ DB — không nhận danh sách phòng từ client). Với quy mô hiện tại (45 người) đây là lựa chọn rẻ và loại bỏ hoàn toàn cửa "client tự xin vào room".
- Membership đổi → server buộc các socket liên quan `join`/`leave` ngay, không đợi kết nối lại.
- Mọi payload emit đi qua **cùng DTO + cùng lớp che** như REST (`RealtimeEmitterService` `.parse()`), cấm `io.emit` row DB thẳng (CLAUDE.md §5).
- Emit **sau khi transaction commit**. Emit trong transaction sẽ đẩy tin mà người nhận `GET` lại không thấy (đọc trước commit) — và tệ hơn, đẩy cả tin của transaction bị rollback.
- WS chết → FE chuyển sang bù bằng `afterSeq` mỗi 10 giây; không mất tin, chỉ chậm.

---

## 14. Trạng thái UI bắt buộc

Mọi màn hình CHAT phải xử lý: **loading** (skeleton danh sách phòng + khung tin) · **error** (thông điệp + thử lại, không mất nội dung đang soạn) · **empty** ("chưa có tin nhắn nào" + gợi ý bắt đầu) · **đang gửi / gửi lỗi** (tin lạc quan có trạng thái riêng + nút gửi lại — dùng lại `client_message_id` cũ) · **mất kết nối** (dải báo "đang kết nối lại", vẫn đọc được tin đã tải) · **tin đã thu hồi** (chữ xám, không phải khoảng trắng) · **phòng đã lưu trữ** (chỉ đọc, khoá ô soạn) · **không có quyền** (ẩn bằng `<PermissionGate>`, không hard-code).

---

## 15. Yêu cầu API cấp SPEC

Envelope/error/pagination theo API-01. Chi tiết request/response: [API-13](<../API Design/API-13_CHAT_API_Design.md>).

| Mã | Endpoint | Ghi chú |
| --- | --- | --- |
| CHAT-API-001 | `GET /chat/rooms` | phòng của tôi, kèm số chưa đọc + tin cuối; sắp theo `last_message_at` |
| CHAT-API-002 | `POST /chat/rooms` | tạo phòng nhóm |
| CHAT-API-003 | `POST /chat/rooms/direct` | mở DM idempotent theo `peerUserId` |
| CHAT-API-004 | `GET /chat/rooms/:id` | chi tiết phòng + thành viên (assert membership) |
| CHAT-API-005 | `PATCH /chat/rooms/:id` | đổi tên/mô tả (phòng nhóm) |
| CHAT-API-006 | `POST /chat/rooms/:id/archive` | lưu trữ |
| CHAT-API-007 | `GET /chat/rooms/:id/members` · `POST` · `DELETE /:userId` · `PATCH /:userId` (vai trò) | chặn trên phòng dẫn xuất (CHAT-ERR-012) |
| CHAT-API-008 | `POST /chat/rooms/:id/leave` | chỉ phòng nhóm |
| CHAT-API-009 | `GET /chat/rooms/:id/messages` | con trỏ `beforeSeq`/`afterSeq` (§13.1) |
| CHAT-API-010 | `POST /chat/rooms/:id/messages` | body + `clientMessageId` + `replyToMessageId?` + `fileIds[]?` + `mentions[]?`; idempotent |
| CHAT-API-011 | `POST /chat/messages/:id/recall` | §13.6 |
| CHAT-API-012 | `POST /chat/messages/:id/pin` · `DELETE` | tối đa 20/phòng |
| CHAT-API-013 | `GET /chat/rooms/:id/pinned` | danh sách tin đã ghim |
| CHAT-API-014 | `POST /chat/rooms/:id/read` | body `{ seq }`, chỉ tiến |
| CHAT-API-015 | `GET /chat/search` | `q` + `roomId?` + con trỏ; luôn giới hạn theo membership (§13.7) |
| CHAT-API-016 | `GET /chat/unread-count` | tổng chưa đọc cho badge header |
| CHAT-API-017 | `GET /chat/rooms/:id/files` | tệp đã gửi trong phòng, URL ký hạn ngắn |
| CHAT-API-018 🔒 | `GET /chat/oversight/rooms` · `GET /chat/oversight/rooms/:id` · `GET /chat/oversight/rooms/:id/messages` | **Đọc-vượt membership** (§3.3). Cặp `('view','chat-oversight')` — **không** dùng chung path với CHAT-API-001/004/009 để đường đọc thường không bao giờ phải phân nhánh. Chỉ đọc: **không** có biến thể ghi. Mỗi lần gọi ghi `audit_logs`, **hai mô hình khác nhau**: thành công → `Success` trong **cùng** transaction với truy vấn đọc (CHAT-ERR-020); từ chối → `Denied` trong transaction **RIÊNG đã commit** rồi mới ném 403 (CHAT-ERR-019). Ném 403 trong cùng tx sẽ **rollback mất** chính dòng audit từ chối |
| CHAT-API-019 🔒 | `GET /chat/oversight/audit` | Nhật ký đọc-vượt cho CHAT-SCREEN-008 |

> ⚠️ **Không có `GET /chat/oversight/search`.** Tìm kiếm giữ nguyên vị từ membership cho mọi role, kể cả Super Admin (§3.3) — đây là ràng buộc thiết kế, không phải thiếu sót.

---

## 16. Dữ liệu và lưu trữ

Nguồn chuẩn: [DB-12](<../DB/DB-12 CHAT Database Design.md>). Tóm tắt:

- **Bảng đã tồn tại thật trong DB** (mig `0010` + `0050`, đã có RLS+FORCE + GRANT append-only + composite tenant FK ở `0535`): `chat_rooms` · `chat_room_members` · `chat_messages`. Wave này **ALTER mở rộng**, không tạo lại.
- Cột thêm mới, cột khai tử, extension `unaccent` + hàm `f_unaccent`, cột generated `search_vector`: DB-12 §6.
- Seed đi kèm **bắt buộc** (thiếu là 500 ngay bản ghi đầu — bài học 0498/0474/0507):
  1. module `CHAT` vào `modules`;
  2. 10 cặp permission — 9 cặp thường grant per-pair data_scope cho 4 role canonical (verify fail-loud); cặp thứ 10 `('view','chat-oversight')` **chỉ vào catalog, KHÔNG grant role canonical nào** (SA nhận qua bootstrap lúc boot — DB-12 §9 bước D′);
  3. `sequence_counters` cho `room_code`;
  4. `audit_logs.object_type`: `'chat_room'` + `'chat_message'` **đã được UNION-ADD từ migration 0050** — wave này chỉ **verify fail-loud**, không thêm lại;
  5. catalog + template 2 event NOTI — và **nới CHECK trên CẢ HAI bảng** `notification_events` **lẫn** `notifications` (`module_code += 'CHAT'`, `notification_type += 'Chat'`). Quên vế `notifications` là lỗi đã ship thật ở 0507 và phải vá ở 0529 (memory `noti-catalog-check-lives-on-two-tables`).
- Migration nối tiếp head **THẬT** tại thời điểm chạy (đọc `migrations/meta/_journal.json`, không tin số dự kiến).

---

## 17. Sự kiện và thông báo

| Event code | Khi nào | Người nhận | Gộp lô |
| --- | --- | --- | --- |
| `CHAT_MENTIONED` | tin nhắn có mention thành viên phòng | người được mention | không — gửi ngay |
| `CHAT_DIRECT_MESSAGE` | tin mới trong phòng `direct`, **trừ khi người nhận đã tắt thông báo phòng đó** (`muted_until`) — xem **CHAT-DEC-013** | người nhận | có — gộp theo phòng, tối đa 1 thông báo / 15 phút |

> ⚠️ **Sửa 02/08/2026 (CHAT-DEC-013):** dòng trên trước đây ghi điều kiện *"người nhận không đang mở phòng đó"*. Điều kiện ấy cần **presence**, mà §7 đã đẩy presence **ra ngoài v1** — spec tự mâu thuẫn, và WO thi công (`S7-CHAT-BE-6`) không có cách nào đáp ứng. Owner chốt bỏ điều kiện presence ở v1: chống spam dựa vào **gộp lô 15 phút** (đã seed `dedupe_strategy='DedupeKey'` ở migration `0538`) cộng `muted_until`.

Nguyên tắc chống spam (quan trọng — chat sinh sự kiện nhiều gấp hàng chục lần mọi module khác):

- Phòng `group`/`department`/`project` **không** sinh notification cho từng tin; chỉ badge chưa đọc. Chỉ mention mới xuyên qua.
- `muted_until` chặn notification (badge vẫn tăng).
- `dedupeKey` phải **suy từ nội dung/ngữ cảnh**, ví dụ `chat:{roomId}:{recipientUserId}:{bucket15m}` — tuyệt đối không sinh khoá ngẫu nhiên trong thân hàm (memory `idempotency-key-must-be-content-derived`: khoá ngẫu nhiên = không chống trùng gì cả).
- Payload notification **chỉ** chứa tên phòng/người gửi + liên kết; **không** chứa nội dung tin nhắn (notification đi ra ngoài phạm vi phòng: email, đẩy thiết bị, và ai có quyền đọc thông báo của người khác sẽ đọc luôn nội dung chat).

Phát qua **OutboxNotificationBridge** (đã ship): enqueue trong transaction, map `eventCode` verbatim, dedupe + delivery log.

> ⚠️ **Bẫy boot:** `registerSource()` **fail-loud ngay lúc boot** nếu `eventCode` chưa có trong catalog với `isEnabled=true`. Hai event trên phải được seed **trước** khi WO backend đăng ký registrar, nếu không API sập lúc khởi động.

---

## 18. Audit và bảo mật

- **RLS + FORCE** theo `company_id` trên cả 3 bảng (đã có từ 0010) — giữ nguyên, mọi repository đi qua `withTenant`.
- **Append-only** `chat_messages`: app role chỉ `SELECT`/`INSERT`; `UPDATE` chỉ theo cột (`pinned_at`, `pinned_by`, `recalled_at`, `recalled_by`). Không cấp `DELETE`.
- **Một điểm khẳng định membership** (§3.2) — mọi đường đọc, kể cả WS và tệp.
- **Che ở server**: tin thu hồi bỏ `body` trước khi rời server; tệp chỉ ra bằng URL ký hạn ngắn.
  ⚠️ Khi server bỏ khoá `body` khỏi payload, schema Zod phía FE phải khai `.optional()`/`.nullable()` — thiếu là `ZodError` làm trắng trang **đúng cho người dùng vừa được bảo vệ** (memory `server-masking-needs-optional-fe-schema`).
- **Audit** hành động quản trị phòng, **không** audit nội dung tin (§12).
- **404 chứ không 403** cho phòng người dùng không thuộc (CHAT-ERR-001) — chống dò sự tồn tại của phòng.
- **Đọc-vượt membership (§3.3)** là bề mặt rủi ro lớn nhất của module: đúng một cặp `('view','chat-oversight')`, chỉ Super Admin, `is_sensitive=true`, audit ghi **trong cùng transaction trước khi trả dữ liệu** (CHAT-ERR-020), **không** áp cho `/chat/search`, lối vào UI tường minh. Cả lần **bị từ chối** cũng ghi audit (CHAT-ERR-019) — chuỗi thử-và-trượt là tín hiệu điều tra.
- Nhật ký đọc-vượt phải **xem được trên UI** (màn quản trị §9), không chỉ nằm trong bảng `audit_logs`: audit không ai đọc được thì không phải là kiểm soát.
- Token WS dùng access token có hạn; user bị khoá/đổi mật khẩu → cắt phiên WS đang mở.
- Nội dung tin nhắn là văn bản thuần: **không** render HTML/Markdown thô từ người dùng (chống XSS), chỉ tự động nhận diện liên kết ở tầng hiển thị đã escape.

---

## 19. Non-functional requirements

- Tải 50 tin gần nhất của một phòng < 300ms (index `(company_id, room_id, seq DESC)`).
- Tìm kiếm toàn văn trong phạm vi phòng của một người < 800ms ở quy mô ~1 triệu tin.
- Độ trễ tin từ lúc commit tới lúc hiện ở máy người nhận < 1 giây khi WS bật.
- Danh sách phòng + số chưa đọc **một truy vấn**, không N+1 (đó là lý do có `last_message_seq` trên `chat_rooms`).
- Job đối soát định kỳ là **system-jobs handler** (`@SystemJobHandler` + DiscoveryService — không dùng BullMQ trực tiếp), idempotent. Nhớ: `SchedulerModule` phải import tường minh module chứa handler, và tham số không phải Nest DI trong handler cần `@Optional()` (memory `systemjobhandler-optional-dbw-di` — thiếu là sập `AppModule`, kéo đỏ hàng trăm int-spec).
- i18n: toàn bộ nhãn tiếng Việt qua react-i18next namespace `chat`.
- Panel nổi: **một** kết nối WS cho cả app; mở/đóng panel không tạo kết nối mới.

---

## 20. Tiêu chí nghiệm thu tổng quát

1. Hai nhân viên nhắn riêng, tin hiện ở máy còn lại < 1 giây, không cần tải lại trang.
2. Tạo phòng ban mới trong HR → phòng chat phòng ban xuất hiện với đúng danh sách nhân sự; chuyển một nhân viên sang phòng khác → người đó rời phòng cũ, vào phòng mới, **không đọc được tin mới của phòng cũ**.
3. Thêm người vào dự án → người đó vào phòng dự án và đọc được lịch sử trước đó (§13.4).
4. Gửi ảnh + tệp PDF; người cùng phòng tải được, người ngoài phòng nhận 404/403 ở **cả** đường tin nhắn **lẫn** đường tệp.
5. Tìm "bao cao" ra tin chứa "báo cáo"; kết quả **không** bao giờ chứa tin từ phòng người tìm không thuộc (int-spec bắt buộc).
6. Thu hồi tin → mọi máy đang mở thấy "đã thu hồi" ngay; tệp đính kèm hết tải được.
7. Tắt `REALTIME_ENABLED` → ứng dụng vẫn gửi/nhận đúng qua bù `afterSeq`, không mất tin.
8. Cross-tenant: mọi endpoint deny dữ liệu company khác (int-spec bắt buộc, chạy với `LANE_DB`).
9. Role **không** có `('view','chat-oversight')` (kể cả Company Admin, HR, Manager) không đọc được phòng mình không thuộc qua **bất kỳ** đường nào — deny-path test viết TRƯỚC.
10. **Chủ thể = role dựng trong test được grant đúng cặp `('view','chat-oversight')` — KHÔNG dùng tài khoản Super Admin.** Role đó mở một phòng mình không thuộc qua lối vào quản trị → đọc được **và** sinh đúng một hàng `audit_logs`; ép lỗi ghi audit → **không** trả dữ liệu (CHAT-ERR-020). Ca đối chứng: **cùng role, bỏ cặp** → 403 **và** vẫn +1 hàng audit `Denied`.
    > ⚠️ Dùng SA làm chủ thể ca này là **tautology**: SA có `*:*` **và** được `SuperAdminBootstrapService` grant mọi cặp catalog ⇒ test vẫn XANH kể cả khi guard khai sai resource (`chat-oversite`), sai action, hoặc **quên guard hoàn toàn**. Thêm nữa, lane DB không set `PLATFORM_SUPERADMIN_EMAIL` thì role SA có thể **không tồn tại** và ca test không chạy được.
11. Người dùng có `('view','chat-oversight')` gọi `/chat/search` → kết quả **chỉ** từ phòng mình là thành viên, giống hệt nhân viên thường (§3.3 không mở tìm kiếm).
12. Tài khoản chỉ giữ wildcard `*:*` (không có grant tường minh cặp `chat-oversight`) → **không** thấy lối vào CHAT-SCREEN-007 trên UI (FE phải dùng `useCanExact`, không phải `useCan`).

---

## 21. Test scenario cấp cao

| Nhóm | Scenario |
| --- | --- |
| Deny-path (RED trước) | không phải thành viên: đọc tin · tìm kiếm · tải tệp · join WS room · nhận emit · đọc tệp qua id trực tiếp · người đã `left_at` không đọc tin mới · cross-tenant mọi endpoint. **Không** dùng Super Admin làm chủ thể của nhóm này (SA có `*:*`, sẽ lọt) — dùng role thường **và** một role có `('view','chat-room')` nhưng **không** có `('view','chat-oversight')` |
| Đọc-vượt membership (§3.3) | **Chủ thể = role dựng trong test, KHÔNG phải SA** (cả vế deny lẫn vế allow — xem §20 ca 10). Role thiếu cặp → **403** + vẫn **+1** hàng audit `Denied` sau khi request kết thúc (CHAT-ERR-019) · role có cặp → đọc được + **đúng 1** hàng `Success` · ép ghi audit lỗi → **rollback, 0 byte dữ liệu** (CHAT-ERR-020) · gọi `/chat/search` → **không** thấy phòng ngoài membership · tải tệp trong phòng không thuộc → **403**, và payload `018c` chứa **0 URL ký** · `019` không trả dòng audit của module khác · cặp có trong `SENSITIVE_CAPABILITY_ALLOWLIST` (backend) · tài khoản chỉ có `*:*` → **không** thấy lối vào trên UI |
| Ranh giới tìm kiếm | truy vấn khớp tin ở phòng ngoài phạm vi → 0 kết quả; chỉ định `roomId` không thuộc → CHAT-ERR-017 |
| Validate | **20** mã lỗi §12, mỗi mã ≥ 1 ca |
| Idempotent | gửi lại cùng `clientMessageId` → đúng 1 hàng, trả về cùng id; mở DM 2 lần → 1 phòng |
| Thứ tự & phân trang | `beforeSeq`/`afterSeq` không trùng lặp/không sót khi có tin chèn giữa; cấm offset |
| Đã đọc | `last_read_seq` không lùi (2 thiết bị); số chưa đọc = phép trừ; "đã xem bởi" đúng tập |
| Đồng bộ phòng dẫn xuất | đổi phòng ban · nghỉ việc · thêm/bớt project member · dự án đóng; job đối soát sửa lệch cố ý gieo |
| Append-only | app role không `DELETE`/`UPDATE body` được trên `chat_messages` (kiểm ở tầng DB, không chỉ tầng service) |
| Tệp | resolver fail-closed khi chưa đăng ký · gắn tệp người khác bị chặn ở nguồn · thu hồi → gỡ link → 403 tải |
| Realtime | emit sau commit (rollback không emit) · membership đổi → join/leave ngay · WS tắt vẫn đúng nghiệp vụ |
| Hiệu năng | danh sách phòng không N+1; 1 triệu tin vẫn đạt ngưỡng §19 |

---

## 22. Quyết định nghiệp vụ — **ĐÃ CHỐT 02/08/2026**

| Mã | Quyết định | Kết quả owner chốt | Trạng thái |
| --- | --- | --- | --- |
| CHAT-DEC-001 | Bốn loại phòng `direct`/`group`/`department`/`project`; bỏ `channel` (media) | theo đề xuất §3.1 | ✅ chốt |
| CHAT-DEC-002 | Thành viên phòng là ranh giới quyền, data_scope chỉ là cổng module | theo đề xuất §3.2 | ✅ chốt |
| CHAT-DEC-003 | Phòng `department`/`project` có thành viên **dẫn xuất**, người dùng không tự thêm/bớt | theo đề xuất §3.1, §13.3 | ✅ chốt |
| CHAT-DEC-004 | Ai đọc được phòng mình không thuộc? | ⚠️ **NGƯỢC đề xuất Draft** — **Super Admin đọc được mọi phòng, có audit**. Đóng khung bằng cặp quyền riêng `('view','chat-oversight')` (`is_sensitive=true`, chỉ SA), audit trong cùng transaction, **không** áp cho tìm kiếm, lối vào UI tường minh — xem **§3.3** | ✅ **chốt** |
| CHAT-DEC-005 | Client ghi qua REST, WS chỉ một chiều server→client | theo đề xuất §3.5 | ✅ chốt |
| CHAT-DEC-006 | Không sửa tin nhắn ở v1; thu hồi bằng `recalled_at`, body giữ trong DB | theo đề xuất §3.4, §13.6 | ✅ chốt |
| CHAT-DEC-007 | Cửa sổ thu hồi của người gửi | **15 phút** | ✅ chốt |
| CHAT-DEC-008 | Thành viên mới đọc lịch sử phòng tới đâu? | **Toàn bộ** lịch sử; `visible_from_seq` vẫn chừa sẵn nhưng **luôn NULL** ở v1 (không phải `0` — vị từ đọc đã viết `IS NULL OR …`) — theo đề xuất §13.4 | ✅ chốt |
| CHAT-DEC-009 | Chat theo từng task? | **KHÔNG làm** — TASK đã có bình luận riêng (SPEC-06), tránh hai kênh trùng | ✅ chốt |
| CHAT-DEC-010 | Notification chỉ cho mention + DM (gộp lô); phòng nhóm/phòng ban/dự án chỉ có badge | theo đề xuất §17 | ✅ chốt |
| CHAT-DEC-011 | Payload notification **không** chứa nội dung tin nhắn | không chứa | ✅ chốt |
| CHAT-DEC-012 | Tìm kiếm bằng `unaccent` + `tsvector('simple')` trong Postgres, không thêm search engine | theo đề xuất §13.7 | ✅ chốt |
| CHAT-DEC-013 | Điều kiện gửi `CHAT_DIRECT_MESSAGE` khi §17 đòi presence mà §7 loại presence khỏi v1 | **Gửi mọi DM, trừ khi `muted_until` còn hiệu lực** — bỏ điều kiện "không đang mở phòng" ở v1. Chống spam = gộp lô 15 phút (`dedupe_strategy='DedupeKey'`, seed `0538`). Xem §17 | ✅ **chốt 02/08/2026** |

> **Ghi chú lịch sử — đọc kỹ trước khi tra git:** bản Draft 01/08/2026 đề xuất CHAT-DEC-004 = "không ai đọc được, kể cả Super Admin", và §3.3 · §11 · §18 · §20 · §21 khi đó được viết quanh mệnh đề ấy. Owner **bác** đề xuất ngày 02/08/2026. Các mục đó đã được viết lại trong `S7-CHAT-DOC-2`; mô tả cũ còn trong lịch sử git **không** còn giá trị tham chiếu.
>
> **CHAT-DEC-013 thêm SAU cổng mở wave** (tối 02/08/2026): nó không phải quyết định thứ 13 của đợt chốt ban đầu mà là **phán quyết gỡ một mâu thuẫn nội bộ** giữa §17 và §7, phát hiện lúc lập micro-plan `S7-CHAT-BE-6`. Không thay đổi điều kiện cổng dưới đây.
>
> ⚠️ **Hệ quả chưa có lời giải:** sau DEC-013, `muted_until` là **cơ chế duy nhất** để người dùng chặn thông báo DM — nhưng đo ngày 02/08 cho thấy cột `chat_room_members.muted_until` (`communication.ts:300`) **không có đường ghi nào**: 0 endpoint, 0 DTO trong `packages/contracts/src/chat.ts`. Không có WO nào trong wave đang nhận việc này. Phải cấp đường ghi trước khi CHAT lên PROD, nếu không v1 ship một nút tắt mà không ai bấm được.
>
> Điều kiện mở WO code của wave (đã đủ): 12 quyết định chốt · §1 = `Approved` · `plan-reviewer` PASS trên SPEC-15 + DB-12. Điều kiện merge vào `master` (**chưa** đủ): go-live đóng — xem §1 và `docs/plans/S7-CHAT-WAVE.md` §4.

---

## 23. Tác động đến bộ tài liệu hiện tại (WO S7-CHAT-DOC-1)

1. **SPEC-01**: §12.12 trỏ sang SPEC-15 (đã có sẵn dòng "Tài liệu chi tiết: SPEC-15"); bổ sung CHAT vào sơ đồ phụ thuộc; thanh điều hướng của 10 file SPEC cũ thêm liên kết SPEC-15.
2. **docs/README.md** §2/§3/§4/§9: thêm dòng SPEC-15 · DB-12 · API-13 và một hàng module CHAT trong bản đồ ghép cặp.
3. **docs/permission-matrix-spec.md**: thêm **§9c CHAT** với 10 cặp quyền (§11) + ghi chú "membership là ranh giới, không phải scope" + ngoại lệ đọc-vượt duy nhất.
4. **DB-01**: ghi nhận nhóm bảng CHAT (đã tồn tại từ 0010/0050) + ERD cấp cao; **DB-09**: index CHAT; **DB-10**: seed module CHAT.
5. Tạo **DB-12** và **API-13** (stub endpoint đã khoá theo §15).
6. **docs/erd-current.md** Phụ lục A: chuyển cụm `communication.ts` chat từ nhóm "park/out-of-scope" sang "đang dùng — module CHAT (SPEC-15)".
7. **RELEASE-14 Post Go-Live Backlog**: ghi CHAT là hạng mục Phase 4 đã có spec, thi công sau go-live.
8. **harness/backlog.mjs**: seed wave `S7-CHAT-*`, trace về đúng mã `CHAT-FUNC/API/ERR` của tài liệu này.

---

## 24. Definition of Done cho SPEC-15

- [x] Owner chốt 12 quyết định §22 (02/08/2026, CHAT-DEC-004 chốt ngược đề xuất) → §1 = **Approved**
- [ ] DB-12 + API-13 + permission-matrix §9c đồng bộ, không mâu thuẫn SPEC-15
- [ ] Wave `S7-CHAT-*` trong `harness/backlog.mjs` trace về đúng mã CHAT-FUNC/API/ERR của tài liệu này
- [ ] Mọi WO code lấy SPEC-15 + DB-12 làm nguồn sự thật; lệch → sửa code, không sửa ngầm spec
- [ ] Không WO nào của wave merge vào `master` trước khi cửa sổ go-live đóng (§1)

---

## 25. Kết luận

CHAT đóng khoảng trống cuối cùng khiến nhân viên vẫn phải rời hệ thống để làm việc: trao đổi tức thời. Thiết kế dựa trên ba lựa chọn cứng — **thành viên phòng là ranh giới quyền**, **đúng một ngoại lệ đọc-vượt có cặp quyền riêng và audit bắt buộc** (§3.3), và **tin nhắn là ledger append-only** — cộng với việc tái dùng gần như toàn bộ hạ tầng đã có (bảng chat từ mig 0010/0050 với RLS và append-only sẵn sàng, gateway WS, Files, outbox NOTI). Phần thực sự mới chỉ là tầng nghiệp vụ, tìm kiếm tiếng Việt và giao diện.
