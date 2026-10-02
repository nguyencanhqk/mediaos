# API-19: SOCIAL — THIẾT KẾ API (MẠNG XÃ HỘI NỘI BỘ)

> **📚 Bộ tài liệu API** — [API-01 Tổng quan](<API-01 TỔNG QUAN.md>) · [API-10 Permission Matrix](<API-10 PERMISSION MATRIX.md>) · [API-13 CHAT](<API-13_CHAT_API_Design.md>) · [API-17 RECRUIT](<API-17_RECRUIT_API_Design.md>) · [API-18 PAYROLL](<API-18_PAYROLL_API_Design.md>) · **API-19 SOCIAL**
>
> **Nguồn nghiệp vụ:** [SPEC-16 SOCIAL](<../SPEC/SPEC-16 SOCIAL.md>) · **Schema:** [DB-17](<../DB/DB-17 SOCIAL Database Design.md>) · **Quyền:** [ma trận §9h](<../permission-matrix-spec.md>)

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | API-19 |
| Tên tài liệu | SOCIAL - Thiết kế API |
| Module code | SOCIAL |
| Tài liệu cha | API-01 · SPEC-16 |
| Phiên bản | v1.0 |
| Trạng thái | Approved (thiết kế) — **đang hiện thực theo WO** (BE-1 … BE-3C) — đối chiếu code ở §9 |
| Wave | `S16-SOCIAL` — BE-1 (Track A) · BE-2 (Track B) · BE-3 (Track C) |
| Ngày tạo | 18/09/2026 |

---

## 2. Mục đích tài liệu

Khoá bề mặt HTTP + WS của module SOCIAL: **59 route** `SOCIAL-API-001..059` (53 của SPEC-16 §15 + 2 cửa tệp hạ tầng `054`/`055` + route đọc quản trị huy hiệu `056` — SOC-DEC-012 + 2 route thùng rác bài viết `057`/`058` ở basePath `recycle-bin` — `S16-SOCIAL-BE-3C`, owner ký O1–O4 ngày 28/09/2026 + danh bạ người nhận vinh danh `059` — SOC-DEC-013, `S16-SOCIAL-BE-2D`, owner ký K1–K4 ngày 29/09/2026), cặp quyền từng route, DTO có ràng buộc che dữ liệu, sự kiện realtime và quy ước lỗi. Rule nghiệp vụ **không** nhân bản ở đây — nguồn là SPEC-16.

---

## 3. Căn cứ thiết kế

| Căn cứ | Nội dung |
| --- | --- |
| SOC-DEC-002 | `SOCIAL` = mạng xã hội nội bộ; fbpost là tiện ích con. Resource mới **bắt buộc** tiền tố `feed-` |
| SOC-DEC-004 | 14 cặp quyền; tương tác cá nhân đi theo `view:feed` + `user_id = actor`, **không** cặp riêng |
| SOC-DEC-007 | Sinh nhật chỉ `day`/`month` |
| SOC-DEC-009 | Poll ẩn danh: DTO kết quả không chở `user_id` |
| SOC-DEC-010 | WS payload = DTO đã mask; thống kê không cache |
| BE-3C O1–O4 | Owner ký 28/09/2026 (plan `S16-SOCIAL-BE-3C`): cặp thứ 15 `restore:feed-post` (ngoài 14 cặp SOC-DEC-004, vẫn `is_sensitive=false`) · nhớ status trước khi xoá · route thùng rác ở recycle-bin · tác giả tự xoá ⇒ khôi phục `hidden` — §5.1k |
| API-01 | Envelope, phân trang, mã lỗi, idempotency |

---

## 4. Phạm vi API-19

### 4.1 Bao gồm trong v1

Bảng tin · bài (5 loại) · bình luận 1 cấp · cảm xúc · lưu · lượt xem · tin tức + xác nhận đọc · hashtag · tìm kiếm · trang cá nhân · sinh nhật · báo cáo + kiểm duyệt · nhóm · bình chọn · sáng kiến · vinh danh + huy hiệu · thống kê tương tác.

### 4.2 Không bao gồm (SPEC-16 §5.2/§5.3)

Đăng lại có trích dẫn · khảo sát nhiều câu · story · push mobile · dịch tự động · sự kiện + RSVP · đăng chéo ra Facebook · giới thiệu ứng viên (`PARK-SOCIAL-002` — việc của RECRUIT).

---

## 5. Endpoint tổng hợp SOCIAL

Prefix: `/api/v1`. Tất cả dưới basePath `social` ⇒ OpenAPI + route-census gom đúng module qua `API_MODULE_TAGS` nhóm `SOCIAL` — **trừ `057`/`058`** (thùng rác bài viết, basePath `recycle-bin/feed-posts` theo O3): route-census 2 tầng vẫn đếm chúng vào SOCIAL (allowlist theo tên lớp controller), nhưng tag OpenAPI rơi vào **HR** — xem §5.1k (D15).

### 5.1 Bảng endpoint — 59 route (53 của SPEC-16 §15 + 2 cửa tệp hạ tầng + `056` quản trị huy hiệu + `057`/`058` thùng rác bài viết + `059` danh bạ người nhận)

| Mã | Method · Path | Cặp quyền | Ghi chú |
| --- | --- | --- | --- |
| **Bảng tin & bài — Track A** ||||
| `SOCIAL-API-001` | `GET /social/feed` | `view:feed` (+ `manage:feed-post` khi `status` khác `published`) | Lọc `type`/`audience`/`groupId`/`tag`/`authorId`/**`status`**, sắp xếp `latest`\|`active`; cursor-based. **`status` là nguồn dữ liệu của `SOC-SCREEN-010`** — `status` khác `published` đòi thêm `manage:feed-post` |
| `SOCIAL-API-002` | `POST /social/posts` | **theo `type` — xem §5.1b** | `@Idempotent()`; parse hashtag + mention cùng tx. 5 loại bài dùng 5 cặp khác nhau |
| `SOCIAL-API-003` | `GET /social/posts/{post_id}` | `view:feed` | `hidden` ⇒ 404 trừ tác giả / `manage:feed-post` |
| `SOCIAL-API-004` | `PATCH /social/posts/{post_id}` | `view:feed` + chủ bài, **hoặc** `manage:feed-post`; **+ `create:feed-post` khi THÊM đính kèm mới — xem §5.1f** | Set `edited_at`; đồng bộ lại hashtag/mention (vắng `mentionedUserIds` = giữ nguyên — §5.1g) |
| `SOCIAL-API-005` | `DELETE /social/posts/{post_id}` | như trên | Xoá **mềm** + recycle-bin |
| `SOCIAL-API-006` | `PATCH /social/posts/{post_id}/moderation` | **theo TỪNG trường — xem §5.1c** | Body `{hidden?, pinned?, commentsLocked?}`; **mỗi trường đổi = 1 dòng audit** |
| `SOCIAL-API-007` | `POST /social/posts/{post_id}/view` | `view:feed` (hàng `user_id = actor`) | `ON CONFLICT DO NOTHING` — reload không tăng |
| `SOCIAL-API-008` | `POST /social/posts/{post_id}/save` | `view:feed` (hàng `user_id = actor`) | |
| `SOCIAL-API-009` | `DELETE /social/posts/{post_id}/save` | như trên | |
| `SOCIAL-API-010` | `GET /social/saved` | `view:feed` | Chỉ bài của chính actor |
| `SOCIAL-API-011` | `PUT /social/posts/{post_id}/reaction` | `view:feed` (hàng `user_id = actor`) | Đặt/đổi emoji — idempotent theo bản chất |
| `SOCIAL-API-012` | `DELETE /social/posts/{post_id}/reaction` | như trên | |
| `SOCIAL-API-013` | `GET /social/posts/{post_id}/reactions` | `view:feed` | Danh sách người thích + emoji |
| **Bình luận — Track A** ||||
| `SOCIAL-API-014` | `GET /social/posts/{post_id}/comments` | `view:feed` | Phân trang; trả lời lồng 1 cấp |
| `SOCIAL-API-015` | `POST /social/posts/{post_id}/comments` | `create:feed-comment` | `@Idempotent()`; bài khoá bình luận ⇒ 409 `ERR-004`; trả lời quá 1 cấp ⇒ 422 `ERR-005` |
| `SOCIAL-API-016` | `PATCH /social/comments/{comment_id}` | chủ bình luận **hoặc** `manage:feed-post`; **+ `create:feed-comment` khi THÊM đính kèm mới — xem §5.1f** | Đồng bộ lại mention (vắng `mentionedUserIds` = giữ nguyên — §5.1g) |
| `SOCIAL-API-017` | `DELETE /social/comments/{comment_id}` | như trên | Xoá mềm |
| `SOCIAL-API-018` | `PUT /social/comments/{comment_id}/reaction` | `view:feed` (hàng `user_id = actor`) | |
| `SOCIAL-API-019` | `DELETE /social/comments/{comment_id}/reaction` | như trên | |
| **Tin tức — Track A** ||||
| `SOCIAL-API-020` | `GET /social/news` | `view:feed` | Tin ghim lên đầu; cờ `ackedByMe`. Tham số **`unackedOnly`** + **`countOnly`** ⇒ **nguồn dữ liệu của `SOCIAL-WIDGET-002`** «Tin tức chưa đọc» (phạm vi Own, không cần route riêng) |
| `SOCIAL-API-021` | `POST /social/posts/{post_id}/ack` | `view:feed` (hàng `user_id = actor`) | Không phải `news`/không bật ack ⇒ 409 `ERR-011`; **không rút lại được** |
| `SOCIAL-API-022` | `GET /social/posts/{post_id}/acks` | `manage:feed-news` | Ai đã đọc / chưa đọc |
| **Tìm kiếm · thẻ · trang cá nhân · sinh nhật — Track A** ||||
| `SOCIAL-API-023` | `GET /social/search` | `view:feed` | `tsvector` phạm vi tenant; chỉ bài actor được thấy |
| `SOCIAL-API-024` | `GET /social/tags` | `view:feed` | Gợi ý hashtag theo `usage_count` |
| `SOCIAL-API-025` | `GET /social/profiles/{employee_id}/posts` | `view:feed` | Bài của một người, lọc theo audience của actor |
| `SOCIAL-API-026` | `GET /social/birthdays` | `view:feed` | **DTO chỉ `{employeeId, fullName, avatar, day, month}`** — không năm, không tuổi; tôn trọng `showBirthday` |
| **Báo cáo & kiểm duyệt — Track A ghi · Track C xử lý** ||||
| `SOCIAL-API-027` | `POST /social/reports` | `view:feed` (hàng `reporter_user_id = actor`) | Báo cáo bài/bình luận |
| `SOCIAL-API-028` | `GET /social/reports` | `view:feed-report` | Sàn scope `Company`; manager `Department`. **`reporter` = `null` khi scope HẸP HƠN `Company`** (D13-a, owner ký 22/09/2026) — chỉ HR/company-admin thấy người tố giác; khoá vẫn có mặt |
| `SOCIAL-API-029` | `PATCH /social/reports/{report_id}` | `manage:feed-report` **SÀN** + cặp theo `action` — xem §5.1h | `resolve`/`dismiss` + hành động kèm `action` (BE-3A); đã xử lý ⇒ 409 `ERR-021`; ghi audit |
| **Nhóm — Track B** ||||
| `SOCIAL-API-030` | `GET /social/groups` | `view:feed` | Nhóm `public` + nhóm actor là thành viên |
| `SOCIAL-API-031` | `POST /social/groups` | `create:feed-group` | Người tạo thành `owner` cùng tx |
| `SOCIAL-API-032` | `GET /social/groups/{group_id}` | `view:feed` (+ membership nếu `private`) | Không thành viên + `private` ⇒ 404 `ERR-012` |
| `SOCIAL-API-033` | `PATCH /social/groups/{group_id}` | `owner`\|`admin` nhóm **hoặc** `manage:feed-group` | |
| `SOCIAL-API-034` | `DELETE /social/groups/{group_id}` | `owner` nhóm **hoặc** `manage:feed-group` | Xoá mềm |
| `SOCIAL-API-035` | `POST /social/groups/{group_id}/join` | `view:feed` | `public` ⇒ `active` ngay; `private` ⇒ `pending`; trùng ⇒ 409 `ERR-013` |
| `SOCIAL-API-036` | `POST /social/groups/{group_id}/leave` | `view:feed` (hàng của actor) | `owner` cuối cùng ⇒ 409 `ERR-015` |
| `SOCIAL-API-037` | `GET /social/groups/{group_id}/members` | `view:feed` + membership | |
| `SOCIAL-API-038` | `PATCH /social/groups/{group_id}/members/{user_id}` | `owner`\|`admin` nhóm **hoặc** `manage:feed-group` | Duyệt / từ chối / đổi vai trò; ghi audit; NOTI cho người xin vào. **Cấp vai `owner`**: chỉ `owner` hiện tại **hoặc** `manage:feed-group` BẤT KỂ vai trong nhóm (admin kiêm manage cấp được — GROUPERR-1); audit `viaManage:true` khi quyền cấp đến từ manage |
| `SOCIAL-API-039` | `DELETE /social/groups/{group_id}/members/{user_id}` | như trên | Mời ra khỏi nhóm |
| **Bình chọn — Track B** ||||
| `SOCIAL-API-040` | `GET /social/polls` | `view:feed` | Bình chọn đang mở / đã đóng |
| `SOCIAL-API-041` | `PUT /social/posts/{post_id}/poll/vote` | `view:feed` (hàng `user_id = actor`) | Poll `closed`/quá hạn ⇒ 409 `ERR-016`; phiếu đôi một-lựa-chọn ⇒ 409 `ERR-017` |
| `SOCIAL-API-042` | `DELETE /social/posts/{post_id}/poll/vote` | như trên | Rút phiếu khi còn `open` |
| `SOCIAL-API-043` | `GET /social/posts/{post_id}/poll/results` | `view:feed` | **Ẩn danh ⇒ không có `user_id` trong response, kể cả `company-admin`** |
| `SOCIAL-API-044` | `POST /social/posts/{post_id}/poll/close` | chủ bài **hoặc** `manage:feed-post` | Đóng **bằng tay**. Job đóng theo hạn **KHÔNG** đi qua route này — xem §5.1d |
| **Sáng kiến — Track B** ||||
| `SOCIAL-API-045` | `GET /social/ideas` | `view:feed` | Lọc theo `status` |
| `SOCIAL-API-046` | `PATCH /social/posts/{post_id}/idea/review` | `approve:feed-idea` | FSM §13.3; sai chuyển tiếp ⇒ 409 `ERR-019`; `rejected` bắt buộc `note`; audit + NOTI tác giả |
| **Vinh danh — Track B** ||||
| `SOCIAL-API-047` | `GET /social/kudos` | `view:feed` | Vinh danh gần đây / theo tháng |
| `SOCIAL-API-048` | `GET /social/kudos-badges` | `view:feed` | Catalog huy hiệu đang bật |
| `SOCIAL-API-059` | `GET /social/kudos/recipients?q=` | **`create:feed-kudos`** | **SOC-DEC-013 (BE-2D).** Danh bạ cho ô chọn người nhận vinh danh: `{data:[{employeeId, fullName, avatarUrl}], truncated}` — **KHÔNG `userId`**/email/mã NV. Chỉ nhân sự `active` + TK `active` (chưa xoá mềm ở cả hai), loại chính người gọi. `q` ≥ 2 chữ/số (NFC, dấu tổ hợp không tính), khớp **ĐẦU TỪ** chỉ trên họ tên (bỏ dấu, không phân biệt hoa thường; `strpos` — `%`/`_` là ký tự thường), trần **20**, không phân trang (`.strict()`: `limit`/`page` ⇒ 400). Xem §5.1l |
| `SOCIAL-API-049` | `POST /social/kudos-badges` | `manage:feed-kudos` | `201` + DTO quản trị; `@Idempotent()`; `code` `^[a-z0-9-]{2,32}$` BẤT BIẾN; trùng (kể cả huy hiệu đã tắt) ⇒ 409 `KUDOS_BADGE_CODE_TAKEN`; audit — xem §5.1i |
| `SOCIAL-API-050` | `PATCH /social/kudos-badges/{badge_id}` | `manage:feed-kudos` | `200` + DTO quản trị; `{name?, description?, icon?, position?, isActive?}` strict, ≥1 trường; gửi `code` ⇒ 400; `isActive:true` bật lại; không đổi gì ⇒ 200 không audit |
| `SOCIAL-API-051` | `DELETE /social/kudos-badges/{badge_id}` | `manage:feed-kudos` | `200` + DTO quản trị. Tắt (`is_active=false`), **không** hard-delete; đã tắt sẵn ⇒ 200 không audit; không tồn tại/tenant khác ⇒ 404 `KUDOS_BADGE_NOT_FOUND` |
| `SOCIAL-API-056` | `GET /social/kudos-badges/manage` | `manage:feed-kudos` | **SOC-DEC-012 (BE-3A).** CẢ huy hiệu đã tắt + `isActive`; OFFSET; `ORDER BY position, id`. Khai TRƯỚC `…/{badge_id}` |
| **Thống kê — Track C** ||||
| `SOCIAL-API-052` | `GET /social/stats/engagement` | `view:feed-report` | Sàn scope `Company`; manager `Department`. Theo tuần & đơn vị; SQL set-based; **KHÔNG cache** — xem §5.1j |
| `SOCIAL-API-053` | `GET /social/stats/engagement/export` | `view:feed-report` | Như `052`; XLSX; ghi audit cùng tx — xem §5.1j |
| **Cửa đăng ký tệp đính kèm — `S16-SOCIAL-BE-1C`** ||||
| `SOCIAL-API-054` | `POST /social/files/upload-url` | **SÀN `view:feed` + cặp theo `target` — xem §5.1e** | `@HttpCode(200)`; đăng ký tệp `Private` owned-by-token + presigned-PUT. **Không** `@Idempotent()` |
| `SOCIAL-API-055` | `POST /social/files/{id}/confirm` | như trên | `Pending → Uploaded`; owner-check TRƯỚC khi chạm storage; 200 idempotent khi đã `Uploaded` |
| **Thùng rác bài viết — `S16-SOCIAL-BE-3C`** ||||
| `SOCIAL-API-057` | `GET /recycle-bin/feed-posts` | **`restore:feed-post`** — sàn scope `Company` | Bài đã xoá mềm của tenant; OFFSET `page`/`limit`, envelope `{data,page,limit,total}`, `ORDER BY deleted_at DESC, id DESC`; tác giả · nhóm · đơn vị · trích đoạn **che theo vị từ audience**; **KHÔNG audit** — xem §5.1k |
| `SOCIAL-API-058` | `POST /recycle-bin/feed-posts/{post_id}/restore` | như trên | `200 {id, status}` — `status` ∈ `published`\|`hidden` theo luật §5.1k; **audit LUÔN**, cùng tx (`social.post.restore`); chưa xoá / không có / tenant khác ⇒ 404 `ERR-001`; nhóm đã xoá ⇒ 409 `RESTORE_GROUP_DELETED`; **không** `@Idempotent()` |

> **59 mã = 59 route HTTP** — không mã nào gói hai route.

#### 5.1l Danh bạ người nhận vinh danh `059` (S16-SOCIAL-BE-2D, SOC-DEC-013)

- **Cặp `create:feed-kudos`** (owner K3 — thay `view:feed` của S3(a)): danh bạ chỉ phục vụ composer vinh danh; thu hồi quyền tạo vinh danh là đóng danh bạ. ⚠️ Bất đối xứng có ghi: vai tuỳ biến chỉ có `create:feed-kudos` (thiếu `create:feed-post`) tra được danh bạ nhưng không tạo được kudos.
- **KHÔNG chống liệt kê** (owner K2): API không có throttler — dò ~26² tiền tố 2 ký tự lấy được toàn danh bạ active + `employeeId`. Min-2 / trần 20 / không phân trang là giới hạn UX-hiệu năng. Rào thật: chỉ tên + avatar + `employeeId` của người ĐANG làm, cặp `create:feed-kudos`, khớp CHỈ họ tên (khớp email/mã NV là oracle trên cột không trả về).
- Oracle dư chấp nhận: vắng khỏi danh bạ ⇒ suy ra TK bị khoá/treo (thẻ kudos vẫn hiện tên người TK khoá — S6), cùng lớp `026`.
- `avatarUrl` = URL ĐÃ KÝ (TTL ngắn) hoặc `null` (chữ cái đầu) — cùng luật avatar của toàn module (§6.1, `S16-SOCIAL-AVATARPRESIGN-1`, owner ký K4 + D1–D10 02/10/2026). Chỉ ký ≤ trần 20 dòng trả về, MỘT câu cổng.
- `q` quá ngắn / chỉ ký tự đặc biệt / ký tự điều khiển ⇒ **400** `VALIDATION-ERR-001` (lỗi hình dạng, không mã SOCIAL).
>
> ⚠️ **`057`/`058` NẰM NGOÀI 56 route của SPEC-16 §15 VÀ NGOÀI basePath `social`** — thêm ở `S16-SOCIAL-BE-3C`
> (owner ký O3 ngày 28/09/2026): SPEC-16 §13.1/§16 nói bài xoá «vào recycle-bin», nên route sống ở
> recycle-bin (registry theo loại đối tượng, SOCIAL đăng ký handler), không dựng thùng rác thứ hai trong
> `social/`. SPEC-16 nằm NGOÀI `paths` của BE-3C ⇒ §15 vẫn ghi «56 route» (nợ `054`/`055`/`056` đã đóng ở
> BE-3A). **Nợ doc MỚI:** §15 thêm dòng cụm «Thùng rác bài viết · `SOCIAL-API-057..058` · 2» và sửa tổng
> 56 → 58; §11 thêm cặp `restore:feed-post` (14 → 15 cặp).
>
> ⚠️ **`056` cũng NẰM NGOÀI 53 route của SPEC-16 §15** — thêm ở `S16-SOCIAL-BE-3A` theo SOC-DEC-012
> (owner 28/09/2026): `048` CỐ Ý chỉ trả huy hiệu đang bật dưới cặp `view:feed`, nên màn quản trị cần
> một route đọc riêng gác `manage:feed-kudos` để thấy và bật lại huy hiệu đã tắt.
>
> ⚠️ **`054`/`055` NẰM NGOÀI 53 route của SPEC-16 §15, CÓ CHỦ Ý.** Chúng là hạ tầng own-scope quanh
> `FileService` (khuôn `POST /chat/files/*`), không phải một chức năng nghiệp vụ mới của SPEC-16: mọi
> ràng buộc sản phẩm về đính kèm (≤10 ảnh · ≤1 video · ≤20MB — SOC-DEC-008) vẫn ép ở bước GẮN với mã
> `SOCIAL-ERR-007`. `docs/spec/**` nằm NGOÀI `paths` của `S16-SOCIAL-BE-1C` nên SPEC-16 §15 vẫn ghi
> «53 route»; **nợ doc đã ghi nhận** (plan `S16-SOCIAL-BE-1C.md` §4): WO doc kế tiếp thêm dòng cụm
> «Đính kèm · `SOCIAL-API-054..055` · 2» và sửa tổng 53 → 55.
>
> ⚠️ **Route-census của module SOCIAL KHÔNG bằng 53.** App vệ tinh fbpost (`apps/api/src/integrations/social/`) đã khai tag module `SOCIAL` từ wave S9. Khi BE-1..BE-3 land, census kỳ vọng = **53 + số route fbpost đang đếm** (đo lúc chạy, đừng gõ cứng). Hai lựa chọn cho WO BE-1, ghi lại lựa chọn vào §9: (a) giữ chung tag `SOCIAL` và cập nhật số sàn census; (b) tách tag OpenAPI riêng cho tiện ích fbpost. Không đo trước ⇒ cổng census đỏ ngay PR đầu.

### 5.1b `SOCIAL-API-002` — cặp quyền và body **phân nhánh theo `type`**

`POST /social/posts` là route DUY NHẤT tạo cả 5 loại bài. Không có route riêng cho poll/idea/kudos, nên **cặp quyền yêu cầu phụ thuộc `type`** — nếu không ghi bảng này thì ba cặp `create:feed-poll`/`-idea`/`-kudos` trở thành **grant chết** và QA-1 không dựng được ca DENY.

| `type` | Cặp quyền BẮT BUỘC | Trường body riêng | Mã lỗi phát sinh |
| --- | --- | --- | --- |
| `share` | `create:feed-post` | — | `ERR-007` (đính kèm) · `ERR-008` (audience) |
| `news` | `create:feed-post` **＋** `manage:feed-news` | `pinned?` · `requiresAck?` | `ERR-010` (thiếu `manage:feed-news`) |
| `poll` | `create:feed-post` **＋** `create:feed-poll` | `question` · `options[]` (2–10) · `multipleChoice?` · `isAnonymous?` · `closesAt?` | **`ERR-018`** (ngoài 2–10 lựa chọn) · 403 **không số** (thiếu `create:feed-poll`) · 422 **không số** (`closesAt` ở quá khứ) |
| `idea` | `create:feed-idea` | — (trạng thái khởi tạo luôn `submitted`) | 403 **không số** (thiếu `create:feed-idea`) |
| `kudos` | `create:feed-kudos` (**＋ `manage:feed-kudos`** nếu `isOfficial=true`) | `recipientEmployeeIds[]` · `badgeId?` · `message` · `isOfficial?` | **`ERR-022`** (huy hiệu không có / đã tắt) · 422 **không số** (ngoài 1–10 người nhận · tự vinh danh · người nhận không hợp lệ) · 403 **không số** (thiếu `create:feed-kudos`; thiếu `manage:feed-kudos` khi `isOfficial`) |

- 🔴 **Cột "Cặp quyền BẮT BUỘC" là cặp SÀN ＋ cặp theo loại.** `create:feed-post` do decorator của route gác (tầng 1) nên nó áp cho **mọi** `type`; cặp riêng theo loại do `SocialAccessService.assertCreatablePostType` gác (tầng 2, đọc bảng `SOCIAL_POST_TYPE_PAIRS`). Đọc bảng này thành "poll chỉ cần `create:feed-poll`" là sai — đã sửa 23/09/2026 (BE-2B-1, finding **M55**). Hai dòng `idea`/`kudos` chưa thi công cũng theo đúng luật hai tầng đó.
- Mọi `type` đều thêm `audience` + khoá tương ứng (`groupId` **hoặc** `orgUnitId`) ⇒ `ERR-008`; ghi vào nhóm/đơn vị actor không thuộc ⇒ **403 `ERR-002`**.
- `body` bắt buộc với `share`/`news`/`idea`; với `poll`/`kudos` có thể vắng (DB-17 §6.1).
- 🔴 **Khoá của `kudos` là `recipientEmployeeIds[]`, KHÔNG phải `recipients[]`** (sửa 24/09/2026 khi thi công BE-2B-2): `feed_kudos_recipients.employee_id` neo theo **`employee_profiles.id`**, còn NOTI gửi theo `users.id`. Tên viết tắt `recipients[]` của bản trước để ngỏ đúng chỗ nhầm đắt nhất của cụm này — hợp đồng gọi đúng tên khoá.
- Mention ngoài audience **bị bỏ im lặng**, trả về trong `data.droppedMentions[]` — **không** phải lỗi (SPEC-16 §12 `ERR-009`).

### 5.1e `SOCIAL-API-054/055` — cặp quyền phân nhánh theo `target`

`SocialFileResolver.canLinkFile` (vế 6a) hỏi **hai cặp khác nhau** tuỳ đích tệp sẽ được gắn vào, còn
`@RequirePermission` chỉ khai được **một** cặp tĩnh. Nên hai route này theo đúng khuôn `002`/`006`:
decorator mang SÀN, cặp thật hỏi ở tầng 2 (`SocialAccessService.assertFileTarget`, bảng hằng
`SOCIAL_FILE_TARGET_PAIRS`).

| `target` | Cặp tầng-2 | Thiếu ⇒ |
| --- | --- | --- |
| `post` | `create:feed-post` @Company | 403 `SOCIAL-ERR: cần quyền đăng bài…` |
| `comment` | `create:feed-comment` @Company | 403 `SOCIAL-ERR: cần quyền bình luận…` |

- **SÀN `view:feed` là sàn THẬT, không phải chỗ để trống**: `canLinkFile` cũng đòi đúng cặp đó ở vế
  `readScope`. Thiếu nó ⇒ 403 ở **tầng 1** (`PermissionGuard`), trước khi service chạy một dòng.
- 🔴 **`target` là đầu vào của CỔNG, không phải một khẳng định được tin.** Khai `comment` rồi đem tệp
  gắn vào bài vẫn bị `canLinkFile` hỏi lại cặp đúng của đích THẬT. Nói dối chỉ tự thu hẹp cửa.
- **Không cặp quyền mới, không migration**: cả hai cặp đã có trong catalog từ seed `0578:42-43`.
- Tệp vừa đăng ký **inert** (0 `file_links`) ⇒ không đường tải nào ký URL cho nó cho tới khi được gắn.

### 5.1f `SOCIAL-API-004` / `016` — cặp `create` khi lượt SỬA **THÊM đính kèm mới**

> S16-SOCIAL-ATTGATE-1 (owner ký 24/09/2026). Đóng khoảng hở: trước bản này, hai route SỬA gác
> `view:feed` + (chủ nội dung ∨ `manage:feed-post`) rồi ghi thẳng `file_links`, nên một vai giữ
> `manage:feed-post` mà KHÔNG có `create:feed-post` vẫn gắn được tệp vào bài của người khác —
> trong khi chính vai đó bị chặn ở `002`.

| Lượt PATCH | Cặp ĐÒI THÊM | Mã lỗi |
| --- | --- | --- |
| Không gửi `attachmentIds` (chỉ sửa chữ) | — | — |
| `attachmentIds` = danh sách hiện có (0 tệp MỚI) | — | — |
| `attachmentIds: []` (GỠ HẾT đính kèm) | — | — |
| `attachmentIds` có ≥1 tệp **CHƯA** gắn vào nội dung này | `004` → `create:feed-post` · `016` → `create:feed-comment` | 403 `SOCIAL-ERR` «không có quyền … đính kèm» |

**Điều kiện là «có tệp MỚI», KHÔNG phải «danh sách không rỗng».** Chủ ý: người kiểm duyệt phải gỡ
được một ảnh vi phạm khỏi bài người khác — FE gửi lại danh sách còn lại, và một luật theo
«không rỗng» sẽ biến thao tác gỡ đó thành 403.

**Thứ tự cổng trong lượt PATCH:** `resolveActor` → 404 (không thấy nội dung) → 403 `SOCIAL-ERR-003`
(không phải chủ, không `manage:feed-post`) → **403 cặp `create` (mục này)** → 422 `SOCIAL-ERR-007`
(tệp không thuộc người gọi / sai trạng thái / quá trần). Cổng quyền đứng TRƯỚC vế sở hữu tệp: vai
thiếu cặp nhận 403 nói đúng lý do, không phải 422 nói về quyền sở hữu tệp.

**Cờ `tier1IsFloor` của hai route này = `true`** kể từ đây: cặp ở decorator chỉ là SÀN.

### 5.1c `SOCIAL-API-006` — trường nào cần cặp nào

`PATCH /social/posts/{post_id}/moderation` nhận ba trường độc lập; **cặp quyền theo TỪNG trường**, không phải một cặp cho cả route:

| Trường | Cặp quyền | Ghi chú |
| --- | --- | --- |
| `hidden` | `manage:feed-post` | `published ⇄ hidden` |
| `commentsLocked` | `manage:feed-post` | |
| `pinned` | **`manage:feed-news`** | CHECK `chk_feed_posts_pinned_news` chỉ cho ghim bài `news` ⇒ nhánh `manage:feed-post` cho `pinned` là **nhánh chết**, đừng khai |

Mỗi trường đổi = **một dòng audit riêng** (`{postId, field, from, to}`).

### 5.1d Job đóng bình chọn theo hạn — **không đi qua HTTP**

`SOCIAL-API-044` cần actor + cặp quyền; job hẹn giờ **không có user** nên không dùng được route đó.

**Mô hình chốt (khuyến nghị đã chọn):** job khuôn `system-jobs` chạy **in-process trong API**, gọi thẳng `FeedPollsService.closeExpiredTx()` qua `withTenant(companyId, …)` cho từng tenant có poll quá hạn.

- **Actor audit** = actor hệ thống của `system-jobs` (cùng khuôn job hiện có); dòng audit ghi rõ nguồn là job, không phải người.
- **Không** cấp thêm quyền ghi cho `mediaos_worker`: DB-17 §4 (nguyên tắc 3) giữ worker ở mức `SELECT`. Lý do chọn đường này thay vì cấp `UPDATE (status, closed_at)` cho worker — ít quyền hơn, và tái dùng nguyên tầng service đã có gate/audit/outbox thay vì mở một đường ghi thứ hai vào DB.
- NOTI `NOTI-EVENT-035` phát qua **outbox trong cùng transaction** với việc đóng poll.

### 5.1g `SOCIAL-API-004` / `016` — `mentionedUserIds` **vắng ≠ rỗng**

> S16-SOCIAL-MENTIONSYNC-1 (28/09/2026). Trước bản này BE đọc `mentionedUserIds ?? []`, nên lượt sửa
> chỉ đổi chữ âm thầm XOÁ mọi mention cũ. FE không vá được: DTO bài/bình luận không phơi `userId`
> người được nhắc (§6.1), nên FE không có dữ liệu để gửi lại danh sách.

| Lượt PATCH | `feed_mentions` | `NOTI-EVENT-028` | `droppedMentions` |
| --- | --- | --- | --- |
| Không gửi `mentionedUserIds` (chỉ sửa chữ) | **giữ nguyên** | không bắn | `[]` |
| `mentionedUserIds: []` tường minh | xoá hết | không bắn | `[]` |
| `mentionedUserIds` có giá trị | đồng bộ về đúng tập hợp lệ (ngoài audience bị bỏ im lặng — §6) | chỉ cho người **mới** được nhắc | người bị bỏ |

Cùng khuôn `attachmentIds` ở §5.1f: khoá vắng = không đụng, mảng rỗng = gỡ hết.

### 5.1h `SOCIAL-API-029` — hành động kèm khi xử lý báo cáo (`S16-SOCIAL-BE-3A`)

Body: `{status, resolutionNote?, action?}`; `action ∈ none · hide_post · lock_comments · delete_target`,
**vắng ⇒ `none`** (client cũ giữ nguyên hành vi). `status='dismissed'` + `action ≠ none` ⇒ **400**.

| Loại đích | `none` | `hide_post` | `lock_comments` | `delete_target` |
| --- | --- | --- | --- | --- |
| `post` | ✓ | ẩn bài | khoá bình luận bài | xoá mềm bài |
| `comment` | ✓ | ✗ 422 `REPORT_ACTION_INVALID_FOR_TARGET` | khoá bình luận **BÀI CHA** | xoá mềm bình luận |

- **Cặp quyền theo `action`** (bảng `SOCIAL_REPORT_ACTION_PAIRS`, `tier1IsFloor=true`): mọi `action ≠ none` đòi
  THÊM `manage:feed-post` @Company; thiếu ⇒ **403 `REPORT_ACTION_DENIED`**. Khác route gốc CÓ CHỦ Ý: qua `005`
  tác giả tự xoá bài mình không cần `manage:feed-post`; qua `029` thì cần.
- **Một transaction**: đổi trạng thái báo cáo + hành động + audit. Hành động chạy qua CÙNG hàm lõi của `006`/`005`/`017`
  (cùng audit theo trường, cùng dọn mention/reaction, cùng luật «xoá nội dung của CHÍNH MÌNH không audit»).
- Đích đọc qua **cổng thường** (không qua snapshot của hàng đợi). Không còn thao tác được (đã xoá · actor không thấy ·
  vừa bị xoá bởi lượt đua) ⇒ **422 `REPORT_ACTION_TARGET_UNAVAILABLE`**, báo cáo vẫn `open` — kết thúc bằng `action: none`.
  ⚠️ Nợ D14: bài/bình luận nhóm **riêng tư** mà người xử lý không phải thành viên rơi vào ca này (WO `S16-SOCIAL-GROUPMOD-1`).
- **Báo cáo anh em (D9)**: `delete_target` thành công ⇒ mọi báo cáo `open` KHÁC cùng `(target_type, target_id)` tự
  chuyển `resolved` (`resolved_by` = actor, `resolution_note` NULL), mỗi hàng một audit mang `via`. **Chỉ cùng đích**:
  xoá bài KHÔNG đóng báo cáo về bình luận của bài đó (FE-3 hiển thị các báo cáo đó như thường). `hide`/`lock` không đóng anh em.
- **Khoá**: mọi báo cáo `open` cùng đích bị khoá `FOR UPDATE ORDER BY id` trước câu ghi; `lock_timeout` 5s ⇒ hết hạn
  **409 `REPORT_BUSY`** (tạm, thử lại được) — khác `409 ERR-021` (đã có người xử lý xong).
- Hành động kèm **chỉ ghi trong audit** (không cột mới): `social.report.{resolved|dismissed}` metadata thêm `action` + `effect` (`none` · `applied` · `noop` = đích đã ở trạng thái đó, không có dòng audit trường đi kèm).

### 5.1i `SOCIAL-API-049..051` + `056` — catalog huy hiệu (`S16-SOCIAL-BE-3A`)

- DTO quản trị `{id, code, name, description, icon, position, isActive, createdAt, updatedAt}` cho `049`/`050`/`051`/`056`
  (`048` giữ DTO công khai, không `isActive`).
- Mọi huy hiệu — kể cả 5 huy hiệu hệ thống seed — tắt/bật lại được như nhau (SOC-DEC-011 không đặc cách).
  Seeder `ON CONFLICT DO NOTHING` không bật lại huy hiệu tenant đã tắt.
- Huy hiệu tắt KHÔNG ảnh hưởng vinh danh cũ (`047` vẫn hiển thị); chỉ chặn chọn mới (`ERR-022`).
- Audit cùng tx: `social.kudos_badge.create|update|deactivate`, payload id + trường đổi.

### 5.1j `SOCIAL-API-052` / `053` — thống kê tương tác (`S16-SOCIAL-BE-3B`)

**Tham số** (`.strict()`, lỗi ⇒ 400): `from` + `to` (`YYYY-MM-DD`, phải đi cùng nhau, `from ≤ to`), `orgUnitId` (uuid).
Khoảng được **nắn về tuần ISO trọn vẹn** (thứ Hai → Chủ nhật): `from` lùi về thứ Hai, `to` tiến tới Chủ nhật; sau nắn
≤ **26 tuần**. Vắng cả hai ⇒ **8 tuần tới hết tuần hiện tại**. Mọi mốc tính theo **múi giờ công ty** (`companies.timezone`),
khoảng nửa mở `[from 00:00, to+1 00:00)` giờ địa phương.

**Response `052`:** `{ range:{from,to,weeks}, units:[{orgUnitId,name,isDeleted}], rows:[{weekStart,orgUnitId,posts,comments,reactions,activeMembers}], weekTotals:[{weekStart,posts,comments,reactions,activeMembers}] }`.
`rows` chỉ gồm ô tuần × đơn vị CÓ hoạt động; `weekTotals` đủ mọi tuần của khoảng (tuần 0 hoạt động = số 0). `activeMembers`
của `weekTotals` là số người DISTINCT trong tuần, không phải tổng các đơn vị.

**Định nghĩa đếm:**

- **Quy thuộc đơn vị = đơn vị HIỆN TẠI của người thực hiện** (tác giả bài/bình luận, người thả cảm xúc) — không theo
  `audience` của bài. Người đổi đơn vị thì lịch sử đi theo người. Người chưa gán đơn vị ⇒ `orgUnitId: null`.
- «Bài còn sống» = chưa xoá mềm, `status ≠ deleted`, nhóm (nếu có) chưa xoá mềm. Bài `hidden` VẪN tính. Bài trong nhóm
  riêng tư tính vào đơn vị của tác giả — chỉ là số đếm, không lộ nội dung.
- `comments` = bình luận chưa xoá trên bài còn sống. `reactions` = cảm xúc (mọi emoji) có đích còn sống — nghĩa là
  «cảm xúc HIỆN còn», không phải «số lần thả» (bỏ cảm xúc xoá cứng hàng). Cảm xúc trên một trả lời còn sống vẫn tính dù
  bình luận cha đã xoá mềm (trả lời không bị xoá theo).
- Mốc thời gian của mỗi loại là `created_at` của CHÍNH nó: bình luận tuần này trên bài tháng trước vẫn tính tuần này.
- `activeMembers` = số người khác nhau có ít nhất một trong ba hoạt động.

**Phạm vi:** `Company`/`System` ⇒ mọi đơn vị + nhóm `null`; `Department` ⇒ đơn vị của mình ∪ đơn vị mình đứng đầu
(không cây con), KHÔNG có nhóm `null`, `weekTotals` chỉ tính trên phạm vi đó; `Own`/`Team` (vai tuỳ biến) ⇒ 200 rỗng.
`units` là **tập `orgUnitId` hợp lệ duy nhất** (gồm cả đơn vị đã xoá mềm, `isDeleted:true`). `orgUnitId` ngoài tập đó
⇒ **403 `SOCIAL-ERR: đơn vị nằm ngoài phạm vi thống kê của bạn.`** — một thông điệp cho mọi lý do (không oracle).

**`053`:** CÙNG hàm thu thập với `052`; sheet «Theo đơn vị» + «Theo tuần»; tên đơn vị chống formula-injection; tệp
`social-tuong-tac-{from}_{to}.xlsx`. Ghi ĐÚNG 1 audit cùng tx: `objectType feed_report` (giá trị CHECK sẵn có),
`action social.stats.exported`, `entityType feed_engagement_stats`, metadata `{from,to,orgUnitId,rowCount,format}` — không
số liệu. ⚠️ Nợ: thêm object type riêng ở lượt migrate CHECK `audit_logs.object_type` kế tiếp.

**Widget `SOCIAL-WIDGET-001`:** `SocialStatsService.weeklyEngagementForWidget(user)` — cùng cổng/sàn với `052`, trả tổng
tuần hiện tại. Handler/catalog DASH thuộc `S16-SOCIAL-DASH-1`.

### 5.1k `SOCIAL-API-057` / `058` — thùng rác bài viết (`S16-SOCIAL-BE-3C`)

> Owner ký 28/09/2026 bốn quyết định O1–O4 (plan `docs/plans/S16-SOCIAL-BE-3C.md` §1) — mục này là hợp đồng
> HTTP của chúng. Trước bản này `restorePostTx` có sẵn nhưng KHÔNG route nào gọi (chỉ test), và nó ghi CỨNG
> `status='published'` ⇒ lỗ «moderator ẩn → tác giả xoá → khôi phục → bài hiện lại cho cả công ty».

**Cặp quyền — O1 · D1.**

- **Cặp MỚI `restore:feed-post`**, seed ở mig `0590` (`ON CONFLICT DO NOTHING`), cấp ĐÚNG tập vai đang giữ
  `manage:feed-post`: `hr` + `company-admin`, scope `Company`. **KHÔNG tái dùng `manage:feed-post`**: vai tuỳ
  biến CHỈ có `manage:feed-post@Company` ⇒ 403 ở cả hai route. Migration verify fail-loud: tập vai canonical giữ
  `restore:feed-post` = tập giữ `manage:feed-post` · 0 grant cho `payroll-officer`/`recruiter`/`asset-manager`/
  `office-admin` · 0 hàng `object_permissions` trỏ cặp.
- **Hai tầng** (bảng hằng `SOCIAL_ROUTE_PAIRS` += `recycleFeedPostList` · `recycleFeedPostRestore`,
  `tier1IsFloor:false`, `companyFloor:true`): tầng 1 decorator đọc CÙNG hằng; tầng 2
  `SocialRecycleBinService.list/restore` gọi `resolveActor` NGOÀI `withTenant` — grant hẹp hơn `Company`
  (`Department`/`Own`) ⇒ **403 `AUTH-ERR-SCOPE-DENIED`**, kể cả khi vai có thêm `manage:feed-post@Company`.
- **`is_sensitive = false`** — nhất quán với 14 cặp `feed-*` (SOC-DEC-004 «không cặp `is_sensitive`»). Khác
  `restore:employee`/`restore:user` (`true`) vì hai cặp đó hồi sinh PII/credential; khôi phục bài là kiểm duyệt
  NỘI DUNG, đảo ngược được, và luật trạng thái dưới đây đẩy mọi ca mơ hồ về `hidden`.
- ⚠️ **HỆ QUẢ WILDCARD (có chủ ý, PIN bằng int-spec W1):** vai mang `*:*` (engine Priority 4) và `super-admin`
  (bootstrap cấp toàn catalog @System) **TỰ nhận** `restore:feed-post` — y hệt `manage:feed-post` hôm nay. Đây là
  hành vi engine với cặp không-sensitive, không phải lỗ của SOCIAL. Muốn chặn đường wildcard thì phải đổi cặp
  sang `true` — tức **ĐỔI SPEC** (phá SOC-DEC-004), ngoài phạm vi BE-3C. FE gate bằng `useCan`.

**`057` — tham số & DTO (D10).** Query `.strict()`: `page` (≤ `FEED_PAGE_MAX`) · `limit`
(≤ `FEED_ADMIN_PAGE_LIMIT_MAX`), lỗi ⇒ 400. Phần tử — tập khoá ĐÓNG:

```text
{ id, type, audience, groupId, groupDeleted, orgUnitId, author:{employeeId, fullName} | null,
  bodyExcerpt, statusBeforeDelete, restoreAs, deletedAt, deletedByAuthor, createdAt }
```

- `restoreAs` = status mà `058` SẼ ghi — tính bằng **cùng một hàm SQL** với `058` (`restoreStatusSql()`), nên
  bản xem trước không lệch hành vi thật. `deletedByAuthor` = `deleted_by IS NOT NULL AND deleted_by = author_user_id`.
  `groupDeleted` = nhóm của bài đã xoá mềm (khôi phục sẽ 409).
- **Che theo vị từ audience** (`seen = audienceCondition(actor, feed_posts)` — CÙNG vị từ `visiblePostCondition`
  dùng cho feed, bỏ vế `deleted_at`/`status`): ngoài `seen` ⇒ `author: null` (qua `identityColumns`, basis
  `identity-gated`), `groupId: null`, `orgUnitId: null`, `bodyExcerpt: null`. `author` **và** `bodyExcerpt`
  (≤ 200 ký tự, cắt ở SQL) còn đòi thêm vế status trên status ĐÃ NHỚ — `status_before_delete = 'published'` ∨
  actor giữ `manage:feed-post` ∨ actor là tác giả (mirror vế `statusOk` của `visiblePostCondition`) — vai CHỈ có
  `restore:feed-post` không đọc được tác giả lẫn nội dung của một bài vốn đã bị ẩn (chiếu tên = lộ «bài của X
  từng bị kiểm duyệt ẩn»), hoặc không rõ status cũ (legacy `status_before_delete IS NULL` ⇒ che, fail-closed).
  `groupId`/`orgUnitId` chỉ theo `seen`. Lý do: `manage:feed-post` chỉ đọc
  tác giả/nội dung của bài QUA `visiblePostCondition` (bài nhóm riêng tư khi không là thành viên · bài `org_unit`
  đơn vị khác đều không thấy) — thùng rác **không được mở đường vòng qua SOC-DEC-006**.
- **Hàng VẪN liệt kê** dù bị che: mọi khoá ngoài 4 trường che (`id` · `type` · `audience` · `groupDeleted` ·
  `statusBeforeDelete` · `restoreAs` · `deletedByAuthor` · `deletedAt` · `createdAt`) LUÔN có mặt, để HR
  khôi phục theo yêu cầu. Nhóm đã xoá ⇒ không còn ai «thấy» qua nhóm ⇒ che cả với thành viên cũ (chấp nhận: bài
  đó cũng không khôi phục được). **Không** `userId` người xoá nào trong response; không avatar.
- Mọi JOIN (`users` · `employee_profiles` · `feed_groups`) ghim `company_id` tường minh; thứ tự khớp chỉ mục
  partial `idx_feed_posts_company_deleted` (DB-17 §6.1).

**Luật trạng thái khi khôi phục — O2 · O4 · D4.** `softDeletePostTx` (đường xoá DUY NHẤT, cả `005` lẫn
`029 delete_target`) ghi `status_before_delete = status` trong CÙNG câu UPDATE xoá (biểu thức SQL, không
đọc-rồi-ghi). Lượt khôi phục ghi `status` theo MỘT biểu thức, tính trên hàng CŨ trong cùng câu:

```sql
CASE WHEN deleted_by IS NOT NULL AND deleted_by <> author_user_id
     THEN coalesce(status_before_delete, 'hidden')
     ELSE 'hidden' END
```

Minh hoạ — trong code đây là `restoreStatusSql(t = feedPosts)` (`social-counters.ts`), cột nội suy qua đối tượng
Drizzle ⇒ luôn là `"feed_posts"."deleted_by"`; đừng chép chữ trần vào câu có JOIN `feed_groups` (bảng đó cũng có
`deleted_by` ⇒ 42702 hoặc bám nhầm bảng).

| Ca | `deleted_by` | `status_before_delete` | Khôi phục thành |
| --- | --- | --- | --- |
| Người KHÁC tác giả xoá (moderator · `029 delete_target`) | ≠ `author_user_id` | `published` \| `hidden` | **status đã nhớ** — ẩn trước khi xoá thì vẫn ẩn (O2) |
| **Tác giả TỰ xoá** (O4) | = `author_user_id` | bất kỳ | **`hidden`** — tác giả đã rút nội dung; HR cứu dữ liệu nhưng phải CHỦ Ý bỏ ẩn |
| Người xoá đã mất (FK `ON DELETE SET NULL`) · hàng xoá bằng SQL tay | `NULL` | bất kỳ | **`hidden`** — không chứng minh được đó là moderator ⇒ fail-closed |
| **Legacy** — xoá TRƯỚC mig `0589` | ≠ `author_user_id` | `NULL` | **`hidden`** |

Cùng câu: `status_before_delete`, `deleted_at`, `deleted_by` về NULL · `updated_at = now()` · `updated_by = actor`.
**KHÔNG** bump `last_activity_at`/`published_at` ⇒ bài trở lại đúng vị trí cũ trong feed. Bộ đếm
`like_count`/`comment_count`/`view_count` đếm lại TỪ NGUỒN; `feed_tags.usage_count` cộng lại bằng **delta +1**
(đối xứng với −1 của `softDeletePostTx`; đếm lại từ nguồn đua READ COMMITTED với `bumpTagUsage` ⇒ lệch −1 vĩnh
viễn). ⚠️ Giới hạn nói thẳng: hàng bị xoá mềm bằng SQL tay (không qua `softDeletePostTx`, không −1) mà có thẻ thì
khôi phục đẩy `usage_count` lệch **+1** — chỉ xảy ra ở fixture; luật fixture: xoá tay KHÔNG gắn thẻ.

> ⚠️ **OPS NOTE — PROD.** `0589` KHÔNG backfill. Hệ quả: **MỌI bài đã xoá TRƯỚC `0589` khôi phục thành `hidden`**
> (legacy `NULL`), cũng như MỌI bài tác giả tự xoá. HR muốn bài hiện lại phải **bỏ ẩn tay qua `006`**
> (`{hidden:false}` — có audit theo trường, §5.1c). Không phải lỗi: `restoreAs` ở `057` báo trước đúng giá trị
> này cho từng hàng.

**Lỗi `058` — D12.** Thứ tự trong tx: khoá hàng `feed_posts … deleted_at IS NOT NULL FOR UPDATE` (kèm
`feed_groups.deleted_at`, ghim `company_id`) → không hàng ⇒ 404 → nhóm chết ⇒ 409 → khôi phục → audit.

| Ca | HTTP | Mã |
| --- | --- | --- |
| Thiếu `restore:feed-post` | 403 | tầng 1 (`PermissionGuard`) |
| Grant hẹp hơn `Company` | 403 | `AUTH-ERR-SCOPE-DENIED` (tầng 2) |
| `{post_id}` không phải uuid | 400 | `ParseUUIDPipe` |
| Không tồn tại · tenant khác · **bài CHƯA xoá** | 404 | `SOCIAL-ERR-001` (`POST_NOT_FOUND`) — **MỘT chuỗi cho mọi lý do**, không oracle |
| Bài thuộc **nhóm đã xoá mềm** | 409 | `RESTORE_GROUP_DELETED` — «SOCIAL-ERR: nhóm của bài viết đã bị xoá — không thể khôi phục bài.» |

- 409 nhóm chết: khôi phục sẽ tạo một bài sống-vô-hình mà bộ đếm/thẻ đã cộng lại. ⚠️ **NỢ: chưa có route khôi phục
  NHÓM** ⇒ bài trong nhóm đã xoá kẹt trong thùng rác tới khi có route đó.
- Hai lượt `058` đua trên cùng bài (nối tiếp hoặc song song) ⇒ ĐÚNG một 200 + một audit; lượt thua đánh giá lại
  ⇒ 404, 0 audit. Vì thế route **không** cần `@Idempotent()`.
- **Tác giả đã nghỉ việc** (user/hồ sơ xoá mềm) · **`org_unit` đã xoá** ⇒ **KHÔNG chặn**, vẫn 200.

**Không tác dụng phụ ngoài danh sách đóng của SPEC-16 §16 — D14.**

- **KHÔNG phát WS** (xoá cũng không phát; phát lại `feed:post.created` sẽ đẩy một bài có thể `hidden` ra audience).
- **KHÔNG gửi lại NOTI** mention · kudos · news.
- **KHÔNG đụng** `file_links` · `feed_mentions` · `feed_saved_posts` · `feed_post_acks` · `feed_reactions` — xoá mềm
  chỉ LỌC, không xoá quan hệ, nên khôi phục trả lại đủ (SPEC-16 §16, T18). Poll giữ nguyên lựa chọn + `vote_count`;
  bài `news` giữ `pinned`/`requires_ack`.
- ⚠️ **Poll quá hạn:** job `closeExpiredTx` lọc `deleted_at IS NULL` ⇒ poll của bài trong thùng rác giữ `open` quá
  hạn. Sau khôi phục, **nhịp job kế tiếp ĐÓNG poll và gửi `NOTI-EVENT-035` — kể cả khi bài về `hidden`**. Hành vi
  CHẤP NHẬN: `NOTI-EVENT-035` tới đúng MỘT người — tác giả bài (người tạo bình chọn, SPEC-16 §17.1); payload
  không chở gì về cử tri (SOC-DEC-009).

**Hạ tầng recycle-bin — O3 · D6 · D15.**

- Recycle-bin có **registry tối thiểu theo loại đối tượng** (`RecycleBinRegistry` + module lá dùng chung);
  SOCIAL đăng ký handler `feed_post` ở `onModuleInit`. Handler thiếu ⇒ 500 + log (fail-closed), trùng khoá ⇒ lỗi
  lúc boot. Controller riêng `RecycleBinFeedPostsController` (`@Controller("recycle-bin/feed-posts")`).
- **Route employee (`/recycle-bin/employees…`) KHÔNG đổi** — không vào registry. Nợ tuỳ chọn: đưa employee vào
  registry.
- ⚠️ **Tag OpenAPI = HR** (nợ): tag suy từ SEGMENT ĐẦU của path, và `recycle-bin` thuộc nhóm HR trong
  `config/openapi-modules.ts`. Đổi mapping nằm ngoài `paths` của BE-3C. Route-census 2 tầng vẫn tính `057`/`058`
  vào SOCIAL (58 route) qua allowlist theo tên lớp controller.

### 5.2 Thứ tự khai báo route — bẫy đã biết

Các route **tĩnh** phải khai **TRƯỚC** route có tham số cùng cấp, nếu không NestJS sẽ bắt nhầm (bài học `goals/tree`):

- `GET /social/saved` · `GET /social/search` · `GET /social/tags` · `GET /social/news` · `GET /social/groups` · `GET /social/polls` · `GET /social/ideas` · `GET /social/kudos` · `GET /social/kudos/recipients` · `GET /social/kudos-badges` · `GET /social/kudos-badges/manage` (trước `…/{badge_id}`) · `GET /social/reports` · `GET /social/birthdays` · `GET /social/stats/*` — **trước** `GET /social/posts/{post_id}` và các route `{id}` khác.
- `POST /social/posts` ở basePath `social/posts`, không đụng `social/{...}`.

Mọi `{id}` qua pipe UUID **cấp method** (không `@UsePipes` cấp class) — ratchet `param-uuid` không được tăng.

---

## 6. Chuẩn response, lỗi, phân trang, idempotency

### 6.1 Envelope thành công — thẻ bài (caller chỉ có `view:feed`)

```json
{
  "success": true,
  "data": {
    "id": "8f1c…",
    "type": "share",
    "audience": "company",
    "author": { "employeeId": "a12…", "fullName": "Nguyễn Văn A", "avatarUrl": "https://…/avatar.png?X-Amz-Signature=…" },
    "body": "Chào cả nhà #tuyendung",
    "tags": ["tuyendung"],
    "attachments": [{ "fileId": "f01…", "kind": "image", "url": "https://…" }],
    "pinned": false,
    "commentsLocked": false,
    "likeCount": 3,
    "commentCount": 1,
    "viewCount": 31,
    "myReaction": "👍",
    "savedByMe": false,
    "mentions": [
      { "withheld": false, "employeeId": "b34…", "label": "Trần Thị B" },
      { "withheld": true }
    ],
    "editedAt": null,
    "createdAt": "2026-09-18T03:12:00.000Z"
  },
  "error": null
}
```

- **Không** có `status`, `deletedAt`, `authorUserId` trong DTO của người đọc thường — chỉ tác giả và `manage:feed-post` nhận thêm `status`.
- **Avatar — luật CHUNG của 10 trường danh tính SOCIAL** (`author.avatarUrl` bài/bình luận · người thả cảm xúc `013` · đã/chưa đọc `022` · `avatar` sinh nhật `026` · thành viên nhóm `037` · người nhận vinh danh trên thẻ + `047` · danh bạ `059` · reporter/resolver/tác giả đích `028`/`029`) — `S16-SOCIAL-AVATARPRESIGN-1`, owner ký 02/10/2026:
  - Giá trị = **URL ĐÃ KÝ (TTL ngắn, mặc định 300 s)** hoặc **`null`** (FE vẽ chữ cái đầu). **Không bao giờ** là cột thô `employee_profiles.avatar_url` (fileId — cột đa-người-ghi, đầu độc được).
  - Chỉ ký khi CẶP `(employeeId, fileId)` khớp một avatar **ĐÃ XÁC MINH** (link `ME/avatar` sống · `image/*` · `Uploaded` · không `Infected` · người tạo link sở hữu tệp) — fileId của người khác / tenant khác / tệp không link ⇒ `null`. **D2-b:** URL `http(s)` do quản trị đặt và mọi scheme khác (`javascript:`, `data:`…) ⇒ `null` trên SOCIAL (HR/CHAT/TASK vẫn passthrough URL — lệch có chủ ý).
  - **Che ảnh ⊆ che tên** ở mọi điểm: người bị che tên (K1 kudos · D9 `026`/`022`-chưa-đọc: TK khoá/xoá mềm · D13-a reporter với scope < Company) thì ảnh cũng `null`, và fileId của họ không vào câu ký. **`026` chặt hơn** (owner sửa D9 02/10/2026): `avatar` chỉ khi tài khoản SỐNG — hồ sơ KHÔNG có tài khoản cũng ⇒ `null` (không có đường tự ẩn `showBirthday`); mọi bề mặt khác giữ «vắng ≠ che».
  - **FE** (`avatarSrc`) chỉ vẽ `src` cho URL có hình dạng presign (`X-Amz-Signature=` 64 hex) — fileId / URL http(s) ngoài của API cũ (FE tự deploy trước API) ⇒ chữ cái đầu. Giá trị cố ý giả hình dạng presign chỉ bị chặn khi API ≥ `S16-SOCIAL-AVATARPRESIGN-1` chạy ⇒ **deploy API trước hoặc cùng FE**.
  - Ký trong tx sẵn có của route: **+1 câu/request** bất kể số dòng, 0 transaction thêm; 0 câu khi trang không có avatar fileId. `029` ký trong SAVEPOINT — lỗi ký ⇒ ảnh `null`, quyết định kiểm duyệt vẫn lưu (D10).
  - Kiểu giữ `string | null` (D5) — hình dạng ép ở BE, không `.url()` ở hợp đồng.
- `myReaction` · `savedByMe` là **projection theo actor**, tính trong cùng câu truy vấn, không gọi thêm vòng.
- **`mentions[]`** (bài **và** bình luận — `S16-SOCIAL-BE-1D`, owner chốt 28/09/2026) — người được nhắc, thứ tự ổn định `(created_at, id)` giữa các lần tải — KHÔNG theo thứ tự trong body, FE khớp theo `label`:
  - **Luật tầm nhìn (O-1):** phần tử có link ⇔ người được nhắc **VẪN trong audience của bài đích tại lúc ĐỌC** (bình luận: audience của **bài cha**), dùng **cùng vị từ** với lúc ghi (`classifyInAudience`): `company` ⇒ mọi tài khoản `active`; `org_unit` ⇒ hồ sơ thuộc đơn vị hoặc là trưởng đơn vị; `group` ⇒ thành viên `active` + nhân sự `active` + nhóm chưa xoá. Kết quả **không phụ thuộc người xem** (không có luật tự-nhắc ở đường đọc).
  - **Hình dạng (O-2):** `{withheld:false, employeeId, label}` | `{withheld:true}`. **KHÔNG `userId`** ở nhánh nào. Nhánh rút **không** mang `label` hay `employeeId` — FE giữ nguyên chữ `@…` trong `body` làm span.
  - **Rút (`withheld`) khi:** người đó rời audience (đổi đơn vị · rời nhóm), tài khoản không `active`/đã xoá, **không còn hồ sơ nhân sự sống**, **hồ sơ nhân sự không `active`** (nghỉ việc `resigned`/`terminated`/`inactive` — kể cả khi TK vẫn `active`, ở MỌI audience; owner chốt plan BE-1D §7 Q1 ngày 28/09/2026), hoặc tên rỗng. Cùng vị từ đó ở đường GHI: nhắc người đã nghỉ việc ⇒ bị bỏ vào `droppedMentions[]`. Phần tử **giữ vị trí** — mảng không bị rút gọn.
  - **Optional:** vắng khoá ≠ mảng rỗng. Response kiểm duyệt (`006`) không mang `mentions` ⇒ FE giữ mảng cũ trong cache khi merge.
  - Nạp theo **lô** cho cả trang (≤ 3 câu, cùng tx với projection) — không N+1.
- **Khối theo loại bài `kudos?` · `poll?` · `idea?`** (`S16-SOCIAL-BE-2D`, owner ký K1–K4 29/09/2026) — OPTIONAL, **vắng là trạng thái duy nhất của «không có»** (không bao giờ `null`): vắng khi bài khác loại, trên response `006`, trên payload WS (§7), hoặc hàng con mồ côi (BE ghi `logger.error`, không 500 cả trang).
  - `kudos` = `{kudosId, message, isOfficial, badge:{id,code,name,icon}|null, recipients:[{employeeId, fullName, avatarUrl, isFormerEmployee}]}` — CÙNG hình dạng + CÙNG luật người nhận với `047` (`047` = khối + `postId` + `createdAt`). **Luật K1:** hồ sơ HOẶC tài khoản đã **xoá mềm** ⇒ `fullName`/`avatarUrl` `null` + `isFormerEmployee:true`; nghỉ việc ⇒ giữ tên + cờ (S6); TK khoá ⇒ giữ tên; không TK ⇒ `fullName:null`. KHÔNG bỏ người nào khỏi mảng. Người nhận xếp theo `employeeId`. Huy hiệu đã tắt vẫn hiện. `avatarUrl` = URL ĐÃ KÝ hoặc `null` (luật avatar ở trên) — ký theo CẶP của chính người nhận: cùng một người vừa là tác giả thẻ (được ký) vừa là người nhận đã che K1 trên CÙNG trang vẫn ra `null` ở ô người nhận.
  - `poll` = **ĐÚNG hình dạng `043`** (`myVote` của NGƯỜI XEM, `totalVoters`, `options[{id,label,voteCount}]`, `status` y DB — vẫn `open` quá `closesAt` tới khi job đóng) ⇒ FE seed cache `043` từ thẻ. Không danh tính cử tri nào (SOC-DEC-009). Cùng MỘT câu SQL với `041..044` (bất biến H-8).
  - `idea` = `{status}` DUY NHẤT (pill trạng thái). KHÔNG `reviewNote`, KHÔNG người duyệt.
  - Nạp theo **lô**: kudos 2 câu · poll 1 · idea 1 — chỉ bảng của loại có mặt ⇒ ≤ 4 câu/trang bất kể số bài, 0 khi trang không có ba loại đó.

### 6.2 Envelope sinh nhật — PII đã cắt

```json
{
  "success": true,
  "data": [{ "employeeId": "a12…", "fullName": "Nguyễn Văn A", "avatar": "https://…/avatar.png?X-Amz-Signature=…", "day": 18, "month": 9 }],
  "error": null
}
```

> ⚠️ Response **không được** chứa `date_of_birth`, `year`, `age` hay ngày đầy đủ dưới bất kỳ tên nào. QA có ca grep response theo mẫu năm 4 chữ số.

### 6.3 Envelope kết quả bình chọn ẩn danh

```json
{
  "success": true,
  "data": {
    "pollId": "p01…",
    "question": "Chọn địa điểm team building",
    "isAnonymous": true,
    "status": "open",
    "totalVoters": 24,
    "myVote": ["opt-2"],
    "options": [{ "id": "opt-1", "label": "Đà Lạt", "voteCount": 9 }, { "id": "opt-2", "label": "Nha Trang", "voteCount": 15 }]
  },
  "error": null
}
```

> `myVote` là của **chính actor** nên được phép. Không có `voters[]`, không có `user_id` ở bất kỳ nhánh nào — kể cả `company-admin`. Repository dùng **tập cột tường minh**, cấm `select()` trần (DB-17 §11 R6).

### 6.4 Phân trang

- **Feed và bình luận:** cursor-based (`cursor` + `limit`, `limit` ≤ 50) — dòng cuộn dài, offset sẽ trượt khi có bài mới.
- **Danh sách quản trị** (báo cáo · nhóm · huy hiệu · thống kê · **bình chọn `040`** · **sáng kiến `045`** · **vinh danh `047`** · **catalog huy hiệu `048`/`056`** · **thùng rác bài viết `057`**): offset (`page` + `limit`) theo API-01.

🔴 **Mọi danh sách offset PHẢI trả envelope `{data, page, limit, total}`** — không trả mảng trần. Thiếu `total` thì FE không phân biệt được «trang cuối» với «trang rỗng» và không dựng được pager; `030` đã theo đúng khuôn này. `040` được sửa cho khớp ngày 23/09/2026 (BE-2B-1, owner chốt **S5**) — trước đó nó trả mảng trần.

⚠️ **Thứ tự phải có khoá phá-hoà DUY NHẤT.** OFFSET không có chốt cuối ổn định thì hàng **lặp hoặc MẤT** giữa hai trang mà không lỗi gì — `created_at` mặc định `now()` là mốc BẮT ĐẦU transaction nên mọi hàng tạo trong cùng một tx (seed/import) giống hệt nhau. `030` chốt bằng `id`; `040` chốt bằng `CASE WHEN status='open' … END, created_at DESC, id`; `045`/`047` chốt bằng `created_at DESC, id`; `048`/`056` bằng `position, id` (`position` là `smallint` tenant sửa được qua `050` nên nó **có thể trùng** — vẫn cần chốt cuối); `057` bằng `deleted_at DESC, id DESC` (khớp chỉ mục partial `idx_feed_posts_company_deleted`).

### 6.5 Envelope lỗi + mã

Theo API-01 §12/§13 `MODULE-ERR-CODE`. **Mã nằm ở `error.code`** của envelope (S16-SOCIAL-GROUPERR-1, 29/09/2026 — trước đó service ném chuỗi trần nên `error.code` là mã CHUNG theo status và mã SOCIAL chỉ ở tiền tố `message`). Nguồn sự thật MÃ dùng chung api ↔ web: `packages/contracts/src/social-errors.ts` (`SOCIAL_ERROR_CODES`, khoá = khoá `SOCIAL_ERR` của `social.errors.ts`). Namespace SOCIAL gồm **hai nhóm**:

- **Đánh số** `SOCIAL-ERR-001`..`SOCIAL-ERR-022` — quy tắc nghiệp vụ, định nghĩa ở SPEC-16 §12. Nhiều hằng có thể CHUNG một số (vd `001` = bài · bình luận · báo cáo lạ; `013` = đã là thành viên · lệch trạng thái hàng) — FE phân xử bằng ngữ cảnh thao tác.
- **Đặt tên** (sentinel, KHÔNG chiếm số — owner ký O1 29/09/2026: không đánh số mới, không sửa SPEC-16 §12) — dạng `SOCIAL-ERR-<KHOÁ>`, mỗi hằng một mã:

| Mã sentinel | HTTP | Ý nghĩa |
| --- | ---: | --- |
| `SOCIAL-ERR-REPORT-DUPLICATE-OPEN` | 409 | Báo cáo trùng khi cái cũ còn `open` |
| `SOCIAL-ERR-FILE-TARGET-POST-DENIED` · `-FILE-TARGET-COMMENT-DENIED` | 403 | `054` thiếu `create:feed-post` / `create:feed-comment` @Company (cả cổng gắn tệp của `004`/`016`) |
| `SOCIAL-ERR-FILE-NOT-OWNED` | 403 | `055` xác nhận tệp không phải của mình |
| `SOCIAL-ERR-GROUP-NAME-TAKEN` | 409 | `031`/`033` tên nhóm trùng (nhóm còn sống) |
| `SOCIAL-ERR-GROUP-MEMBER-NOT-FOUND` | 404 | `036`/`038`/`039` người đó không có hàng thành viên — TÁCH khỏi `012` |
| `SOCIAL-ERR-POLL-OPTION-NOT-FOUND` | 404 | Lựa chọn không thuộc bình chọn này |
| `SOCIAL-ERR-POLL-CLOSES-AT-PAST` | 422 | Hạn đóng bình chọn ở quá khứ |
| `SOCIAL-ERR-POLL-CREATE-REQUIRED` · `-IDEA-CREATE-REQUIRED` · `-KUDOS-CREATE-REQUIRED` | 403 | Thiếu cặp theo loại bài @Company |
| `SOCIAL-ERR-POLL-WRITE-BUSY` · `SOCIAL-ERR-REPORT-BUSY` | 409 | Hết `lock_timeout` — tạm thời, thử lại được |
| `SOCIAL-ERR-IDEA-REJECT-NOTE-REQUIRED` | 422 | Từ chối sáng kiến không ghi lý do |
| `SOCIAL-ERR-KUDOS-SELF-RECIPIENT` · `-KUDOS-RECIPIENT-LIMIT` · `-KUDOS-RECIPIENT-INVALID` | 422 | Người nhận vinh danh không hợp lệ |
| `SOCIAL-ERR-KUDOS-OFFICIAL-DENIED` | 403 | `isOfficial:true` thiếu `manage:feed-kudos` |
| `SOCIAL-ERR-REPORT-ACTION-DENIED` | 403 | `029` hành động kèm thiếu cặp |
| `SOCIAL-ERR-REPORT-ACTION-INVALID-FOR-TARGET` · `-REPORT-ACTION-TARGET-UNAVAILABLE` | 422 | `029` hành động không áp được / đích không còn thao tác được |
| `SOCIAL-ERR-KUDOS-BADGE-CODE-TAKEN` | 409 | `049` mã huy hiệu trùng |
| `SOCIAL-ERR-KUDOS-BADGE-NOT-FOUND` | 404 | `050`/`051` huy hiệu lạ |
| `SOCIAL-ERR-STATS-UNIT-OUT-OF-SCOPE` | 403 | `052`/`053` đơn vị ngoài phạm vi thống kê |
| `SOCIAL-ERR-RESTORE-GROUP-DELETED` | 409 | `058` bài thuộc nhóm đã xoá (§5.1k) |
| `SOCIAL-ERR-CURSOR-INVALID` · `-CURSOR-FILTER-MISMATCH` | **400** | Con trỏ phân trang hỏng / thuộc bộ lọc khác. _(Trước GROUPERR-1 mang tiền tố `SOCIAL-ERR-001` — mã **404** — trên một 400.)_ |
| `SOCIAL-ERR-PIN-NEWS-ONLY` | 422 | `006` ghim bài không phải `news`. _(Trước mang tiền tố `SOCIAL-ERR-010` — 403 thiếu quyền — trên một 422.)_ |
| `SOCIAL-ERR-POST-TYPE-PAIR-DESYNC` | 403 | Chân fail-closed khi hai bảng cặp theo loại bài lệch nhau — không tới được khi cấu hình đúng |

**Thông điệp** giữ nguyên tiền tố cũ: hằng có số ⇒ tiền tố `message` = đúng `error.code`; sentinel ⇒ tiền tố `SOCIAL-ERR: `. Client **bắt theo `error.code`**, không so câu chữ `message`.

**KHÔNG mang mã SOCIAL** (giữ mã chung): 403 tầng-1 `PermissionGuard` (`AUTH-ERR-FORBIDDEN`, `Permission denied: …` — kể cả route `046`; `SOCIAL-ERR-020` chỉ ra ở nhánh có grant nhưng dưới sàn Company) · 403 tầng-2 `resolveActor` của route không có mã riêng (`AUTH-ERR-FORBIDDEN` / message `AUTH-ERR-SCOPE-DENIED` — nợ `S16-SOCIAL-SCOPEDENIEDCODE-1`) · 400 Zod/ParseUUID (`VALIDATION-ERR-001`) · 409 idempotency (`REQUEST-ERR-IDEMPOTENCY-*`) · lỗi của FileService.

Quy ước then chốt:

> **404 trước 403.** Mọi trường hợp «không được thấy» trả **404** (`ERR-001` bài / `ERR-012` nhóm). 403 chỉ dùng khi caller **đã** ở trong audience và chỉ thiếu quyền hành động. Trả 403 cho một bài mà caller không được thấy là **rò sự tồn tại**.
>
> Hệ quả cụ thể cho hai mã dễ dùng sai:
> - **`ERR-002` (403) chỉ dành cho nhánh GHI** — đăng bài/bình luận vào `org_unit`/`group` mà actor tự chọn nhưng không thuộc. Nhánh ĐỌC **không bao giờ** trả `ERR-002`.
> - **`ERR-009` KHÔNG phải lỗi HTTP** — mention ngoài audience bị bỏ im lặng, request vẫn `201`, danh sách bị bỏ trả ở `data.droppedMentions[]`.

Race ở chốt cuối DB (`23505` thích đôi · phiếu đôi · ack đôi · lưu đôi) phải **bóc mã PG từ `error.cause`** (drizzle bọc lỗi) và quy về mã nghiệp vụ tương ứng — **không** để rơi ra 500.

### 6.6 Idempotency

`@Idempotent()` trên POST tạo: `SOCIAL-API-002` (bài) · `015` (bình luận) · `027` (báo cáo) · `031` (nhóm) · **`044` (đóng bình chọn tay)** · `049` (huy hiệu).

Key **do client sinh khi mở composer/form**, TTL 15′, replay trả `Idempotency-Replayed: true`. Key phải **suy từ nội dung** — không dùng timestamp hay số ngẫu nhiên sinh lại mỗi lần bấm.

🔴 **Decorator chỉ khoá khi client GỬI header.** `IdempotencyInterceptor` đăng ký toàn cục (`APP_INTERCEPTOR`) và khoá thật qua Valkey (in-flight ⇒ 409 · replay nguyên trạng · key dùng lại với payload khác ⇒ 409), **nhưng** thiếu header `Idempotency-Key` thì nó chạy thẳng handler — back-compat có chủ ý. Vì vậy mỗi route `@Idempotent()` vẫn phải có lưới KHÔNG-ĐIỀU-KIỆN của riêng nó ở tầng dữ liệu; với `044` đó là `UPDATE … WHERE status='open' … RETURNING` (lượt hai khớp 0 hàng ⇒ 409, không sinh audit/NOTI thứ hai). Ghi rõ ở đây vì FULL gate 23/09/2026 đã đọc decorator thành **cả hai thái cực sai**: "đã có khoá server-side đầy đủ" và "chỉ là `SetMetadata`, không khoá gì".

`PUT …/reaction` và `PUT …/poll/vote` idempotent **theo bản chất** (đặt trạng thái, không cộng dồn) nên không cần decorator.

Replay `002` trả **thẻ LÚC TẠO** (khối `poll` đếm 0, tên người nhận tại thời điểm đó) — hành vi sẵn có của interceptor cho mọi trường thẻ; replay chỉ trả cho chính người tạo (khoá theo user) nên `poll.myVote` không rò (S16-SOCIAL-BE-2D D13).

`058` (khôi phục bài) **không** `@Idempotent()`: lưới tầng dữ liệu là khoá `… deleted_at IS NOT NULL FOR UPDATE` — lượt hai không còn khớp hàng đã xoá ⇒ 404, không sinh audit thứ hai (§5.1k).

---

## 7. Sự kiện realtime

| Event | Room | Payload | Gate lúc join |
| --- | --- | --- | --- |
| `feed:post.created` | `co:{companyId}:feed` | DTO bài §6.1 đã mask | `view:feed` |
| `feed:post.created` | `co:{companyId}:feedgroup:{groupId}` | như trên | `view:feed` **+ membership** |
| `feed:comment.created` | cả hai room trên | DTO bình luận đã mask | như trên |
| `feed:reaction.changed` | cả hai room trên | `{ targetType, targetId, likeCount }` | như trên |

- **Payload = DTO của REST**, không bao giờ là hàng thô (`io.emit` thẳng row bị cấm — CLAUDE.md §5).
- **KHÔNG mang `mentions`** (`S16-SOCIAL-BE-1D` D6) — bóc tại nguồn và `.omit` ở schema WS. FE nhận thẻ qua WS render `@…` thành span tới lần refetch REST.
- **KHÔNG mang `kudos` · `poll` · `idea`** (`S16-SOCIAL-BE-2D` D7) — `poll.myVote` là của TÁC GIẢ (thẻ phát ra được decorate bằng tác giả), phát cho cả room là rò; `.omit` không chạm khoá lồng nên bóc nguyên khối, ở CẢ nguồn (`emitPostCreated`) lẫn schema WS. FE chỉ đếm sự kiện nên không mất gì.
- **`author.avatarUrl` LUÔN `null`** trên `feed:post.created` + `feed:comment.created` (`S16-SOCIAL-AVATARPRESIGN-1` D3-b) — REST trả URL ĐÃ KÝ, là capability có TTL (ai cầm cũng tải được); không lên room. GIỮ khoá (bundle FE cũ đòi khoá — bỏ khoá làm bundle cũ từ chối mọi sự kiện), ép giá trị `null` ở CẢ nguồn (`wsAuthorOf`) lẫn schema lồng `wsFeedAuthorSchema` (`.transform`). Ảnh lấy ở lần refetch REST.
- Room nhóm cần gate **riêng** — có `view:feed` không đủ để vào room của nhóm riêng tư.
- **Xoá (`005`) và khôi phục (`058`) bài KHÔNG phát sự kiện nào** — phát lại `feed:post.created` lúc khôi phục sẽ đẩy một bài có thể đang `hidden` ra audience (§5.1k, D14).
- FE chỉ hiện badge «N bài mới» + cập nhật số đếm; **không** tự chèn bài vào dòng cuộn đang đọc.

---

## 8. Hai tầng guard + audit

- Cặp quyền khai ở **decorator route** *và* kiểm lại ở **service**; census QA so từng route theo MÃ ở cả hai tầng.
- Ghi `audit_logs` **cùng transaction** cho: `006` moderation · `029` xử lý báo cáo (+ audit của hành động kèm + một dòng/báo cáo anh em tự resolve) · `038`/`039` thành viên nhóm · `046` xét duyệt sáng kiến · `049`/`050`/`051` huy hiệu · `053` export · **`002` CHỈ ở nhánh `type='kudos'` + `isOfficial=true`** (`social.kudos.official`) · **`058` khôi phục bài — LUÔN** (`social.post.restore`).
- **Audit `058`** (`S16-SOCIAL-BE-3C`, D13): `action:"social.post.restore"`, `object_type` **`feed_post`** (giá trị CHECK sẵn có — không migrate `audit_logs`), `moduleCode:"SOCIAL"`, `entityType:"feed_post"`, `objectId`/`entityId` = `postId`, `resultStatus:"Success"`, metadata **`{postId, authorUserId, restoredStatus, statusBeforeDelete, deletedByAuthor}`** — không nội dung bài. Ghi cùng tx với lượt khôi phục; 404/409 ⇒ 0 audit. **`057` (liệt kê thùng rác) KHÔNG audit** — đọc danh sách đã che theo audience, không phải thao tác ghi.
- 🔴 **Vì sao `002` audit một nhánh chứ không cả route** (bổ sung 24/09/2026, `S16-SOCIAL-BE-2B-2`, owner ký **S8**): bài thường đã có tác giả + thời điểm trong chính hàng `feed_posts`, audit thêm chỉ làm sổ ngập thao tác thường. `isOfficial=true` thì khác — nó dùng năng lực `manage:feed-kudos` để xuất bản nội dung mang **DẤU CÔNG TY**, tức một người nói thay tổ chức, đúng hình dạng mà module đã audit ở mọi chỗ khác (`social.post.update` chỉ ghi khi qua nhánh `asManager` · `social.poll.close` kèm `viaManage`). Metadata `{postId, kudosId, recipientCount}` — **KHÔNG** `message` (chữ tự do) và **KHÔNG** `employee_id` người nhận: sổ audit có bề mặt đọc RIÊNG, rộng hơn `047`.
- `object_type` audit mới: `feed_post` · `feed_comment` · `feed_group` · `feed_report` (UNION-ADD — DB-17 §3.2).
- Payload audit **không** chứa nội dung bài đầy đủ, chỉ `{postId, field, from, to}`.

---

## 9. Trạng thái hiện thực (đối chiếu code)

| Thành phần | Trạng thái (ngày ghi ở từng dòng) |
| --- | --- |
| `apps/api/src/social/` | *(cũ — 18/09)* **Chưa có** — module mới của `S16-SOCIAL-BE-1` · **đã land** ở BE-1..BE-3B |
| `apps/api/src/integrations/social/` (fbpost) | **Đang chạy** — KHÔNG đụng (SOC-DEC-002) |
| `packages/contracts/src/social/feed*.ts` | *(cũ — 18/09)* Chưa có — `S16-SOCIAL-DB-1` · **đã land** ở DB-1..BE-3B (thực tế là file phẳng `packages/contracts/src/social.ts` + `social-api*.ts`, không có thư mục `social/`) |
| Route-census | *(cũ — 18/09)* Chưa có mục SOCIAL nội bộ; thêm 53 lúc BE-1..BE-3 land · **đã land** ở BE-1..BE-3B (56 route `/api/v1/social/*`) |
| Thùng rác bài viết `057`/`058` | **`S16-SOCIAL-BE-3C` (28/09/2026)** — `recycle-bin/recycle-bin-feed-posts.controller.ts` + registry `recycle-bin/recycle-bin.registry.ts` (handler `feed_post` do `social/social-recycle-bin.service.ts` đăng ký); mig `0589` (cột `feed_posts.status_before_delete` + 2 CHECK + chỉ mục thùng rác) · `0590` (cặp `restore:feed-post`, 2 grant); census 2 tầng SOCIAL 56 → **58**. Nợ: khôi phục NHÓM · tag OpenAPI HR · employee vào registry |

---

## 10. Liên quan

[SPEC-16 SOCIAL](<../SPEC/SPEC-16 SOCIAL.md>) · [DB-17](<../DB/DB-17 SOCIAL Database Design.md>) · [Ma trận phân quyền §9h](<../permission-matrix-spec.md>) · [API-01 Tổng quan](<API-01 TỔNG QUAN.md>) · [DECISIONS-08 fbpost](<../DECISIONS/DECISIONS-08_Social_Satellite_App.md>) · [Kế hoạch wave](<../plans/S16-SOCIAL-WAVE.md>)
