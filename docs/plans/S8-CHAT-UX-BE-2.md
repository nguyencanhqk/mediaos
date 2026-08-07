# Kế hoạch thi công `S8-CHAT-UX-BE-2` — avatar phòng chat (CHAT-DEC-016)

> Vùng **ĐỎ**. Gate = **FULL** (`security-reviewer` + `silent-failure-hunter`).
> Nguồn: `SPEC-15 §11` · `API-13 §5` · `CHAT-DEC-016` · `docs/plans/S8-CHAT-UX-WAVE.md §3`.
> Nền DB: `chat_rooms.avatar_file_id` từ mig `0543` (đã land). Ngày lập: 07/08/2026.

---

## 1. Điểm xuất phát (ĐO THẬT 07/08/2026 — không theo trí nhớ)

| Thứ | Trạng thái đo được | Bằng chứng |
| --- | --- | --- |
| Cột `chat_rooms.avatar_file_id` | CÓ — composite tenant FK `(company_id, avatar_file_id) → files`, `ON DELETE SET NULL (avatar_file_id)` | `0543:79-93` |
| CHECK chặn `direct` có avatar | CÓ — `room_type <> 'direct' OR avatar_file_id IS NULL` | `0543:101` |
| `GRANT UPDATE (avatar_file_id)` cho app role | CÓ | `0543:105` |
| Cặp `('update','chat-room')` | CÓ trong catalog + grant **cả 4 role canonical @Company** | `0538:410,776-782` |
| Cặp cho phòng ban | **`('update','org_unit')`** — gạch DƯỚI, không phải `org-unit` | `0030:19`; grant: company-admin (…001) + hr-manager (…009) |
| Vai trò per-project | `ProjectAccessService.getMembershipTx` → `Owner\|Manager\|Member\|Viewer` | `tasks/project-access.service.ts:56` |
| Khuôn đã qua FULL gate 2 lần | `HrEmployeeAvatarService` (entity của NGƯỜI KHÁC) + `ChatFilesService` (presign wrapper own-scope) | — |
| Khuôn ký URL hàng loạt | `CoverPresignService` + `FileRepository.findVerifiedTaskCoversTx` (self-defending + vị từ ĐỘC QUYỀN) | `foundation/files/*` |
| Job đối soát derived-room | chỉ chạm `left_at` / archive-restore — **không** ghi cột phòng khác | `0540:72-73,286` |

---

## 2. Ba quyết định thi công

### 2.1 ⚠️ `ChatModule` **KHÔNG import được** `TasksModule` — đây là vòng, không phải lựa chọn

`tasks.module.ts:63` đã `import { ChatModule }` (cần `ChatDerivedRoomsSyncService`). Thêm chiều
ngược lại là vòng `Chat → Tasks → Chat`, Nest sập lúc bootstrap ⇒ **100+ int-spec đỏ dây chuyền**
(lớp `systemjobhandler-optional-dbw-di`). `forwardRef` chữa được về mặt kỹ thuật nhưng nó **giấu**
vòng đi thay vì phá nó, và cạnh này chạy trên đường quyền.

**Chốt:** tách `ProjectAccessService.getMembershipTx` ra một **module LÁ** `ProjectMembershipModule`
(khuôn `RealtimeEmitterModule` — chính nó được tách ra để phá vòng `Realtime → Chat → Realtime`), rồi
`ProjectAccessService` **uỷ quyền** xuống nó. Một bản sao DUY NHẤT của vị từ identity
(`employee_id = … OR user_id = …`) — hai bản sao là hai cửa quyền khác nhau cho cùng một người
(`module-closed-by-second-assert-not-scope`).

> **CẤM tuyệt đối** hiện thực thay thế: viết lại câu `project_members` trong một repo của CHAT. Vị từ
> identity ở `getMembershipTx` MIRROR `buildReadScopeExists` — bản sao thứ ba sẽ trôi khỏi cả hai.

### 2.2 Chủ thể đặt avatar — 4 luật, ép ở SERVICE, `roomType` quyết định

| `roomType` | Chủ thể | Từ chối |
| --- | --- | --- |
| `group` | `ChatAccessService.isRoomAdmin(access)` | **403** `CHAT-ERR-023` |
| `department` | cặp `('update','org_unit')` **+ đúng đơn vị neo** (`chat_rooms.org_unit_id`) khi scope là `Department` | **403** `CHAT-ERR-023` |
| `project` | `ProjectRole ∈ {Owner, Manager}` trên `chat_rooms.ref_id` | **403** `CHAT-ERR-023` |
| `direct` | **KHÔNG AI** — avatar dẫn xuất từ người đối thoại | **422** `CHAT-ERR-022` |

> ⚠️ **Hai vá SAU khi đo lại (07/08/2026):**
>
> 1. **Mã lỗi là `022`/`023`, KHÔNG đẻ mã mới.** Bản đầu của plan này viết `CHAT-ERR-026`; SPEC-15 §12 đã cấp sẵn 022/023 cho đúng WO này và `chat-error-code-census.spec.ts` liệt chúng trong `PENDING_CODES` kèm tên WO ⇒ mã ngoài sổ làm census ĐỎ (đã xảy ra thật, đo được).
> 2. **Phòng ban neo ở `org_unit_id`, KHÔNG phải `ref_id`** (`chk_chat_rooms_type_anchor`). Chỉ dự án dùng `ref_id`. Bản đầu ghi `refId` cho cả hai.
>
> Nhánh `group` gọi vị từ THUẦN `isRoomAdmin` chứ không `requireRoomAdmin`: hàm sau ném `CHAT-ERR-001`, còn §11b đòi `023`. Vị từ vẫn đúng MỘT bản — `requireRoomAdmin` giờ gọi `isRoomAdmin`.

Cả 4 nhánh chạy **SAU** `assertMember` ⇒ người ngoài phòng nhận **404**, không phải 403 (CHAT-ERR-001
giữ nguyên tính chất không-dò-được). Route gate `@RequirePermission('update','chat-room')` — cổng
module; luật trên là ranh giới dữ liệu. Hai lớp, cả hai phải cùng đúng.

> `direct` → 422 chứ không 403: người gọi ĐÃ là thành viên nên đã biết phòng tồn tại; 422 nói đúng
> bản chất "loại phòng này không có avatar để đặt", và CHECK ở `0543:101` là đai thứ hai.

### 2.3 Đường ĐỌC: `ChatRoomAvatarPresignService` ký hàng loạt, self-defending

Danh sách phòng ký **một lô** (mirror `CoverPresignService`), KHÔNG một lần ký mỗi phòng —
`CHAT-DEC-019` đã chốt nguyên tắc này cho avatar người gửi, cùng lý do áp cho phòng.

- Nguồn sự thật là **`file_links` sống `(CHAT, chat_room_avatar)`**, KHÔNG phải cột `avatar_file_id`
  một mình: cột là ĐA-NGƯỜI-GHI (`POST /foundation/files/:id/links` nhận `isPrimary` verbatim).
- Vị từ **ĐỘC QUYỀN** (`NOT EXISTS` link khác) như `findVerifiedTaskCoversTx` — chống leo thang đọc:
  ảnh CCCD link cả vào HR lẫn phòng chat không được ký. ⚠️ KHÔNG thêm `company_id` vào `NOT EXISTS`
  (làm ẩn link ⇒ **fail-OPEN**).
- `image/%` + `Uploaded` + non-`Infected` + `owner_user_id = link.created_by`.
- **FAIL-SOFT có LOG**: ký lỗi → phòng vắng mặt trong map ⇒ `avatarUrl: null`, KHÔNG 500 cả danh sách.
- `ChatRoomAvatarFileResolver` (`CHAT` / `chat_room_avatar`) **BẮT BUỘC**: thiếu nó
  `decideForLinkedFile` trả `deny-no-resolver` ⇒ đặt được avatar mà không ai tải được (lỗi đã ship
  thật ở `S5-BRAND-BE-1`). `canUnlink`/`canDelete` khai TƯỜNG MINH `false` — bỏ trống là tụt về
  fallback `FOUNDATION.FILE.*` mà company-admin đang giữ.
- Cặp gate của resolver = **`('view','chat-room')`** — TRÙNG NGUYÊN VĂN cặp đường đọc phòng
  (`read-path-gate-pair-must-match-download-pair`).

---

## 3. Hình dạng API

| Method | Path | Mã trả | Gate |
| --- | --- | --- | --- |
| `POST` | `/chat/rooms/:id/avatar/upload-url` | 201 `{fileId, uploadUrl, expiresAt}` | `('update','chat-room')` |
| `POST` | `/chat/rooms/:id/avatar` | 200 `{fileId}` | `('update','chat-room')` |
| `DELETE` | `/chat/rooms/:id/avatar` | 204 (idempotent) | `('update','chat-room')` |

`declaredMimeType` phải `image/*` — chặn SỚM ở `upload-url` (khác `ChatFilesService` vốn cố ý không ép,
vì chat đính kèm cả tài liệu). Ownership + `Uploaded` + non-`Infected` + `image/*` kiểm LẠI ở bước gắn
(chống IDOR: chỉ gắn file DO CHÍNH MÌNH upload). `downloadUrl` ký TƯƠI mỗi lần trả — **KHÔNG persist**.

DTO: `chatRoomSchema.avatarUrl` **`.nullable().optional()`** — thiếu `.optional()` là ZodError trắng
trang ở mọi consumer cũ (`server-masking-needs-optional-fe-schema`).

---

## 4. Thứ tự RED → GREEN

1. **RED deny-path × 4 loại phòng** — thành viên thường đặt avatar `group` ⇒ 403; người ngoài phòng ⇒
   **404**; `department` không có `('update','org_unit')` ⇒ 403; `project` role `Member` ⇒ 403.
2. **RED `direct`** ⇒ 422 `CHAT-ERR-022`, và DB CHECK vẫn là đai thứ hai.
3. **RED IDOR file** — gắn file do NGƯỜI KHÁC upload ⇒ 403; file `Pending`/`Infected`/non-image ⇒ từ chối.
4. **RED cross-tenant** — `avatar_file_id` trỏ file tenant khác ⇒ chặn (composite FK, KI-046).
5. **RED resolver** — gỡ `registerResolver` ⇒ tải avatar 403 cho MỌI người (chứng minh nó BẮT BUỘC).
6. **RED job đối soát** — chạy THẬT `ChatDerivedRoomsReconcileJobHandler` sau khi đặt avatar ⇒
   `avatar_file_id` **không đổi** (`done_when` #5).
7. **RED N+1** — danh sách 20 phòng: đếm câu SQL, avatar chỉ thêm **1**.
8. GREEN → `pnpm build` (contracts + web-core dist) → regen route census (`ROUTE_CENSUS_WRITE=1`) →
   FULL gate → `bash harness/check.sh --lane-db`.

---

## 5. Rủi ro đã biết

| # | Rủi ro | Chặn bằng |
| --- | --- | --- |
| 1 | Import `TasksModule` ⇒ vòng DI, AppModule sập, 100+ spec đỏ | §2.1 — module LÁ |
| 2 | Dùng `'org-unit'` (gạch NGANG) theo văn bản wave ⇒ pair không tồn tại ⇒ **fail-closed 403 vĩnh viễn** cho mọi phòng ban | §1 — pair thật là `org_unit` |
| 3 | Quên `registerResolver` ⇒ tính năng chết trong im lặng | bước 5 |
| 4 | Quên regen route census ⇒ `route-guard-coverage` ĐỎ | bước 8 |
| 5 | `avatarUrl` required trong `chatRoomSchema` ⇒ consumer cũ ăn ZodError | §3 `.optional()` |
| 6 | Thêm writer thứ 5 cho `chat_rooms` mà không thêm ca vào mục **H** của `s7-chat-db1-invariants.int-spec.ts` ⇒ cột mới không ai chứng minh ghi được | thêm ca mục H |
| 7 | Đặt avatar cho phòng đã **lưu trữ** | chặn: phòng lưu trữ CHỈ ĐỌC (`CHAT-ERR-005`), cùng luật `updateRoom` |
| 8 | `NOT EXISTS` thêm `company_id` ⇒ fail-OPEN | §2.3 |
