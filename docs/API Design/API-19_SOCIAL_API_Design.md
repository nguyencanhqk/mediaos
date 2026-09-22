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
| Trạng thái | Approved (thiết kế) — **CHƯA hiện thực** |
| Wave | `S16-SOCIAL` — BE-1 (Track A) · BE-2 (Track B) · BE-3 (Track C) |
| Ngày tạo | 18/09/2026 |

---

## 2. Mục đích tài liệu

Khoá bề mặt HTTP + WS của module SOCIAL: **53 route** `SOCIAL-API-001..053`, cặp quyền từng route, DTO có ràng buộc che dữ liệu, sự kiện realtime và quy ước lỗi. Rule nghiệp vụ **không** nhân bản ở đây — nguồn là SPEC-16.

---

## 3. Căn cứ thiết kế

| Căn cứ | Nội dung |
| --- | --- |
| SOC-DEC-002 | `SOCIAL` = mạng xã hội nội bộ; fbpost là tiện ích con. Resource mới **bắt buộc** tiền tố `feed-` |
| SOC-DEC-004 | 14 cặp quyền; tương tác cá nhân đi theo `view:feed` + `user_id = actor`, **không** cặp riêng |
| SOC-DEC-007 | Sinh nhật chỉ `day`/`month` |
| SOC-DEC-009 | Poll ẩn danh: DTO kết quả không chở `user_id` |
| SOC-DEC-010 | WS payload = DTO đã mask; thống kê không cache |
| API-01 | Envelope, phân trang, mã lỗi, idempotency |

---

## 4. Phạm vi API-19

### 4.1 Bao gồm trong v1

Bảng tin · bài (5 loại) · bình luận 1 cấp · cảm xúc · lưu · lượt xem · tin tức + xác nhận đọc · hashtag · tìm kiếm · trang cá nhân · sinh nhật · báo cáo + kiểm duyệt · nhóm · bình chọn · sáng kiến · vinh danh + huy hiệu · thống kê tương tác.

### 4.2 Không bao gồm (SPEC-16 §5.2/§5.3)

Đăng lại có trích dẫn · khảo sát nhiều câu · story · push mobile · dịch tự động · sự kiện + RSVP · đăng chéo ra Facebook · giới thiệu ứng viên (`PARK-SOCIAL-002` — việc của RECRUIT).

---

## 5. Endpoint tổng hợp SOCIAL

Prefix: `/api/v1`. Tất cả dưới basePath `social` ⇒ OpenAPI + route-census gom đúng module qua `API_MODULE_TAGS` nhóm `SOCIAL`.

### 5.1 Bảng endpoint — 53 route

| Mã | Method · Path | Cặp quyền | Ghi chú |
| --- | --- | --- | --- |
| **Bảng tin & bài — Track A** ||||
| `SOCIAL-API-001` | `GET /social/feed` | `view:feed` (+ `manage:feed-post` khi `status` khác `published`) | Lọc `type`/`audience`/`groupId`/`tag`/`authorId`/**`status`**, sắp xếp `latest`\|`active`; cursor-based. **`status` là nguồn dữ liệu của `SOC-SCREEN-010`** — `status` khác `published` đòi thêm `manage:feed-post` |
| `SOCIAL-API-002` | `POST /social/posts` | **theo `type` — xem §5.1b** | `@Idempotent()`; parse hashtag + mention cùng tx. 5 loại bài dùng 5 cặp khác nhau |
| `SOCIAL-API-003` | `GET /social/posts/{post_id}` | `view:feed` | `hidden` ⇒ 404 trừ tác giả / `manage:feed-post` |
| `SOCIAL-API-004` | `PATCH /social/posts/{post_id}` | `view:feed` + chủ bài, **hoặc** `manage:feed-post` | Set `edited_at`; đồng bộ lại hashtag/mention |
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
| `SOCIAL-API-016` | `PATCH /social/comments/{comment_id}` | chủ bình luận **hoặc** `manage:feed-post` | |
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
| `SOCIAL-API-029` | `PATCH /social/reports/{report_id}` | `manage:feed-report` | `resolve`/`dismiss` (+ hành động kèm); đã xử lý ⇒ 409 `ERR-021`; ghi audit |
| **Nhóm — Track B** ||||
| `SOCIAL-API-030` | `GET /social/groups` | `view:feed` | Nhóm `public` + nhóm actor là thành viên |
| `SOCIAL-API-031` | `POST /social/groups` | `create:feed-group` | Người tạo thành `owner` cùng tx |
| `SOCIAL-API-032` | `GET /social/groups/{group_id}` | `view:feed` (+ membership nếu `private`) | Không thành viên + `private` ⇒ 404 `ERR-012` |
| `SOCIAL-API-033` | `PATCH /social/groups/{group_id}` | `owner`\|`admin` nhóm **hoặc** `manage:feed-group` | |
| `SOCIAL-API-034` | `DELETE /social/groups/{group_id}` | `owner` nhóm **hoặc** `manage:feed-group` | Xoá mềm |
| `SOCIAL-API-035` | `POST /social/groups/{group_id}/join` | `view:feed` | `public` ⇒ `active` ngay; `private` ⇒ `pending`; trùng ⇒ 409 `ERR-013` |
| `SOCIAL-API-036` | `POST /social/groups/{group_id}/leave` | `view:feed` (hàng của actor) | `owner` cuối cùng ⇒ 409 `ERR-015` |
| `SOCIAL-API-037` | `GET /social/groups/{group_id}/members` | `view:feed` + membership | |
| `SOCIAL-API-038` | `PATCH /social/groups/{group_id}/members/{user_id}` | `owner`\|`admin` nhóm **hoặc** `manage:feed-group` | Duyệt / từ chối / đổi vai trò; ghi audit; NOTI cho người xin vào |
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
| `SOCIAL-API-049` | `POST /social/kudos-badges` | `manage:feed-kudos` | audit |
| `SOCIAL-API-050` | `PATCH /social/kudos-badges/{badge_id}` | `manage:feed-kudos` | audit |
| `SOCIAL-API-051` | `DELETE /social/kudos-badges/{badge_id}` | `manage:feed-kudos` | Tắt (`is_active=false`), **không** hard-delete |
| **Thống kê — Track C** ||||
| `SOCIAL-API-052` | `GET /social/stats/engagement` | `view:feed-report` | Theo tuần & đơn vị; SQL set-based; **KHÔNG cache** |
| `SOCIAL-API-053` | `GET /social/stats/engagement/export` | `view:feed-report` | XLSX; ghi audit |

> **53 mã = 53 route HTTP** — không mã nào gói hai route.
>
> ⚠️ **Route-census của module SOCIAL KHÔNG bằng 53.** App vệ tinh fbpost (`apps/api/src/integrations/social/`) đã khai tag module `SOCIAL` từ wave S9. Khi BE-1..BE-3 land, census kỳ vọng = **53 + số route fbpost đang đếm** (đo lúc chạy, đừng gõ cứng). Hai lựa chọn cho WO BE-1, ghi lại lựa chọn vào §9: (a) giữ chung tag `SOCIAL` và cập nhật số sàn census; (b) tách tag OpenAPI riêng cho tiện ích fbpost. Không đo trước ⇒ cổng census đỏ ngay PR đầu.

### 5.1b `SOCIAL-API-002` — cặp quyền và body **phân nhánh theo `type`**

`POST /social/posts` là route DUY NHẤT tạo cả 5 loại bài. Không có route riêng cho poll/idea/kudos, nên **cặp quyền yêu cầu phụ thuộc `type`** — nếu không ghi bảng này thì ba cặp `create:feed-poll`/`-idea`/`-kudos` trở thành **grant chết** và QA-1 không dựng được ca DENY.

| `type` | Cặp quyền BẮT BUỘC | Trường body riêng | Mã lỗi phát sinh |
| --- | --- | --- | --- |
| `share` | `create:feed-post` | — | `ERR-007` (đính kèm) · `ERR-008` (audience) |
| `news` | `create:feed-post` **＋** `manage:feed-news` | `pinned?` · `requiresAck?` | `ERR-010` (thiếu `manage:feed-news`) |
| `poll` | `create:feed-poll` | `question` · `options[]` (2–10) · `multipleChoice?` · `isAnonymous?` · `closesAt?` | **`ERR-018`** (ngoài 2–10 lựa chọn) |
| `idea` | `create:feed-idea` | — (trạng thái khởi tạo luôn `submitted`) | — |
| `kudos` | `create:feed-kudos` (**＋ `manage:feed-kudos`** nếu `isOfficial=true`) | `recipients[]` · `badgeId?` · `message` · `isOfficial?` | **`ERR-022`** (huy hiệu không có / đã tắt) |

- Mọi `type` đều thêm `audience` + khoá tương ứng (`groupId` **hoặc** `orgUnitId`) ⇒ `ERR-008`; ghi vào nhóm/đơn vị actor không thuộc ⇒ **403 `ERR-002`**.
- `body` bắt buộc với `share`/`news`/`idea`; với `poll`/`kudos` có thể vắng (DB-17 §6.1).
- Mention ngoài audience **bị bỏ im lặng**, trả về trong `data.droppedMentions[]` — **không** phải lỗi (SPEC-16 §12 `ERR-009`).

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

### 5.2 Thứ tự khai báo route — bẫy đã biết

Các route **tĩnh** phải khai **TRƯỚC** route có tham số cùng cấp, nếu không NestJS sẽ bắt nhầm (bài học `goals/tree`):

- `GET /social/saved` · `GET /social/search` · `GET /social/tags` · `GET /social/news` · `GET /social/groups` · `GET /social/polls` · `GET /social/ideas` · `GET /social/kudos` · `GET /social/kudos-badges` · `GET /social/reports` · `GET /social/birthdays` · `GET /social/stats/*` — **trước** `GET /social/posts/{post_id}` và các route `{id}` khác.
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
    "author": { "employeeId": "a12…", "fullName": "Nguyễn Văn A", "avatarUrl": "https://…" },
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
    "editedAt": null,
    "createdAt": "2026-09-18T03:12:00.000Z"
  },
  "error": null
}
```

- **Không** có `status`, `deletedAt`, `authorUserId` trong DTO của người đọc thường — chỉ tác giả và `manage:feed-post` nhận thêm `status`.
- `myReaction` · `savedByMe` là **projection theo actor**, tính trong cùng câu truy vấn, không gọi thêm vòng.

### 6.2 Envelope sinh nhật — PII đã cắt

```json
{
  "success": true,
  "data": [{ "employeeId": "a12…", "fullName": "Nguyễn Văn A", "avatarUrl": "https://…", "day": 18, "month": 9 }],
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
- **Danh sách quản trị** (báo cáo · nhóm · huy hiệu · thống kê): offset (`page` + `pageSize`) theo API-01.

### 6.5 Envelope lỗi + mã

Theo API-01. Mã nghiệp vụ `SOCIAL-ERR-001..022` (SPEC-16 §12). Quy ước then chốt:

> **404 trước 403.** Mọi trường hợp «không được thấy» trả **404** (`ERR-001` bài / `ERR-012` nhóm). 403 chỉ dùng khi caller **đã** ở trong audience và chỉ thiếu quyền hành động. Trả 403 cho một bài mà caller không được thấy là **rò sự tồn tại**.
>
> Hệ quả cụ thể cho hai mã dễ dùng sai:
> - **`ERR-002` (403) chỉ dành cho nhánh GHI** — đăng bài/bình luận vào `org_unit`/`group` mà actor tự chọn nhưng không thuộc. Nhánh ĐỌC **không bao giờ** trả `ERR-002`.
> - **`ERR-009` KHÔNG phải lỗi HTTP** — mention ngoài audience bị bỏ im lặng, request vẫn `201`, danh sách bị bỏ trả ở `data.droppedMentions[]`.

Race ở chốt cuối DB (`23505` thích đôi · phiếu đôi · ack đôi · lưu đôi) phải **bóc mã PG từ `error.cause`** (drizzle bọc lỗi) và quy về mã nghiệp vụ tương ứng — **không** để rơi ra 500.

### 6.6 Idempotency

`@Idempotent()` trên POST tạo: `SOCIAL-API-002` (bài) · `015` (bình luận) · `027` (báo cáo) · `031` (nhóm) · `049` (huy hiệu).

Key **do client sinh khi mở composer/form**, TTL 15′, replay trả `Idempotency-Replayed: true`. Key phải **suy từ nội dung** — không dùng timestamp hay số ngẫu nhiên sinh lại mỗi lần bấm.

`PUT …/reaction` và `PUT …/poll/vote` idempotent **theo bản chất** (đặt trạng thái, không cộng dồn) nên không cần decorator.

---

## 7. Sự kiện realtime

| Event | Room | Payload | Gate lúc join |
| --- | --- | --- | --- |
| `feed:post.created` | `co:{companyId}:feed` | DTO bài §6.1 đã mask | `view:feed` |
| `feed:post.created` | `co:{companyId}:feedgroup:{groupId}` | như trên | `view:feed` **+ membership** |
| `feed:comment.created` | cả hai room trên | DTO bình luận đã mask | như trên |
| `feed:reaction.changed` | cả hai room trên | `{ targetType, targetId, likeCount }` | như trên |

- **Payload = DTO của REST**, không bao giờ là hàng thô (`io.emit` thẳng row bị cấm — CLAUDE.md §5).
- Room nhóm cần gate **riêng** — có `view:feed` không đủ để vào room của nhóm riêng tư.
- FE chỉ hiện badge «N bài mới» + cập nhật số đếm; **không** tự chèn bài vào dòng cuộn đang đọc.

---

## 8. Hai tầng guard + audit

- Cặp quyền khai ở **decorator route** *và* kiểm lại ở **service**; census QA so từng route theo MÃ ở cả hai tầng.
- Ghi `audit_logs` **cùng transaction** cho: `006` moderation · `029` xử lý báo cáo · `038`/`039` thành viên nhóm · `046` xét duyệt sáng kiến · `049`/`050`/`051` huy hiệu · `053` export.
- `object_type` audit mới: `feed_post` · `feed_comment` · `feed_group` · `feed_report` (UNION-ADD — DB-17 §3.2).
- Payload audit **không** chứa nội dung bài đầy đủ, chỉ `{postId, field, from, to}`.

---

## 9. Trạng thái hiện thực (đối chiếu code)

| Thành phần | Trạng thái 18/09/2026 |
| --- | --- |
| `apps/api/src/social/` | **Chưa có** — module mới của `S16-SOCIAL-BE-1` |
| `apps/api/src/integrations/social/` (fbpost) | **Đang chạy** — KHÔNG đụng (SOC-DEC-002) |
| `packages/contracts/src/social/feed*.ts` | Chưa có — `S16-SOCIAL-DB-1` |
| Route-census | Chưa có mục SOCIAL nội bộ; thêm 53 lúc BE-1..BE-3 land |

---

## 10. Liên quan

[SPEC-16 SOCIAL](<../SPEC/SPEC-16 SOCIAL.md>) · [DB-17](<../DB/DB-17 SOCIAL Database Design.md>) · [Ma trận phân quyền §9h](<../permission-matrix-spec.md>) · [API-01 Tổng quan](<API-01 TỔNG QUAN.md>) · [DECISIONS-08 fbpost](<../DECISIONS/DECISIONS-08_Social_Satellite_App.md>) · [Kế hoạch wave](<../plans/S16-SOCIAL-WAVE.md>)
