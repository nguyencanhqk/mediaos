# S16-SOCIAL-BE-1C — ĐƯỜNG ĐĂNG KÝ TỆP cho bài & bình luận

> Zone **yellow** · không migration · không cặp quyền mới · 2 route mới.
> Tách ra 23/09/2026 từ nợ N1 của plan `S16-SOCIAL-FE-1` (owner ký).

---

## §0 — Phép ĐO trước khi viết (done_when đòi «ĐO LẠI, đừng giả định»)

| # | Câu hỏi | Kết quả đo | Nguồn |
| --- | --- | --- | --- |
| M1 | `file_links.object_type` đã UNION-ADD `feed_post`/`feed_comment` chưa? | **Câu hỏi sai chiều.** `file_links` KHÔNG có cột `object_type` — cột thật là `entity_type`, và bảng chỉ có 2 CHECK (`chk_file_links_link_type`, `chk_file_links_access_scope`), **không CHECK nào trên `entity_type`**. Cột tự do, không allow-list ⇒ **0 dòng DDL**, không phải việc DB bị thiếu. | `0579_…_audit_union_object_type.sql:18-23` (đo trên DB thật 19/09/2026) · `db/schema/files.ts:116` |
| M2 | Contract tạo bài/bình luận đã nhận `attachmentIds` chưa? | **Rồi** — `createFeedPostSchema` · `updateFeedPostSchema` · `createFeedCommentSchema` · `updateFeedCommentSchema` đều có `attachmentIds`. Service đã nối: `social-posts.service.ts:288,376` · `social-comments.service.ts:177,261`. ⇒ WO này đúng là **chỉ thiếu CỬA VÀO**. | `packages/contracts/src/social-api.ts` |
| M3 | Tệp vừa đăng ký có tải được không? | **Không — inert.** 0 link ⇒ `SocialAttachmentsService.signOne` chặn ở `links.length === 0`; `GET /foundation/files/:id/download-url` vẫn đòi `download:foundation-file` mà người thường không có. Cổng THẬT nằm ở `canLinkFile`, không ở cửa upload. | `chat-files.service.ts` jsdoc (cùng khuôn) |
| M4 | `canLinkFile` đòi cặp quyền nào? | **HAI cặp khác nhau tuỳ đích**: `create:feed-post` cho `entity_type='feed_post'`, `create:feed-comment` cho `'feed_comment'` (vế 6a). Cộng `view:feed` cho CẢ HAI (vế `readScope`). | `social-file.resolver.ts:136-147` |
| M5 | `PermissionGuard` khai được «một trong hai cặp» không? | **Không** — `@RequirePermission` mang ĐÚNG một cặp tĩnh, guard đọc đúng một `meta`. | `require-permission.decorator.ts` · `permission.guard.ts:76` |
| M6 | Seed có vai nào chỉ có một trong hai cặp không? | Seed `0578:67-74` cấp **cả hai** cho cả 4 vai canonical ⇒ tác động lên vai canonical hôm nay = **0**. Nhưng grant là **per-pair, cấu hình được lúc chạy** ⇒ vai tuỳ biến lệch một cặp là dựng được. | `0578_s16socialdb1_seed_feed_perms.sql` |
| M7 | Route mới có phải `@Idempotent()` không? | **Không.** Danh sách bắt buộc idempotency là danh sách CHỐT theo IMPLEMENTATION-08 §13.2 (8 operationId), không phải luật cho mọi POST; `chat/files/*` cũng không có. `confirm` vốn idempotent (đã `Uploaded` ⇒ 200). | `openapi-contract.e2e-spec.ts:216-245` |

---

## §1 — QUYẾT ĐỊNH D1 (owner chốt 24/09/2026): **sàn `view:feed` + tầng-2 theo `target`**

Tiền lệ CHAT ghi rõ ràng: **upload · confirm · canLink phải hỏi CÙNG một cặp**, nếu không sẽ đẻ ra vai
«tải lên được mà gắn không được» (`chat-files.controller.ts` jsdoc). Với SOCIAL, cặp mà `canLink` hỏi
**phụ thuộc đích** (M4) ⇒ không một cặp tĩnh nào diễn đạt được nó.

**Chốt:** body mang `target: 'post' | 'comment'`; decorator khai `view:feed` làm **SÀN THẬT** (không phải
trang trí — `canLinkFile` cũng đòi đúng cặp đó ở vế `readScope`), tầng 2 assert cặp `create` theo `target`.

Đây CHÍNH LÀ hình dạng mà cờ `tier1IsFloor` được định nghĩa để mô tả: _«cặp quyền route thật sự đòi PHỤ
THUỘC VÀO NỘI DUNG REQUEST»_ (`social-route-pairs.const.ts` docblock). Bảng cặp-theo-payload thứ ba của
module: `SOCIAL_FILE_TARGET_PAIRS`, đứng cạnh `SOCIAL_POST_TYPE_PAIRS` (002) và
`SOCIAL_MODERATION_FIELD_PAIRS` (006).

### D1a — `target` là ĐẦU VÀO CỦA CỔNG, KHÔNG phải một khẳng định được tin

Khai `target='comment'` rồi đem tệp gắn vào BÀI là chuyện client làm được, và **không sao cả**: link đi
qua `canLinkFile`/`assertLinkableFilesTx` và ở đó cặp đúng của đích thật được hỏi LẠI, độc lập. `target`
chỉ quyết định **ai được mở cửa upload**, không quyết định tệp gắn được vào đâu. Ghi rõ điều này để lượt
review sau không đi tìm một lỗ «giả mạo target» không tồn tại.

### D1b — Hằng lỗi CÓ TÊN nhưng **KHÔNG SỐ HOÁ**

SPEC-16 §12 đóng ở dải `001..022` và đã dùng hết; thêm một số là **sửa spec**, mà `docs/spec/**` nằm
NGOÀI `paths` của WO này. Nhưng dùng chuỗi `AUTH-ERR-FORBIDDEN` chung cũng sai: int-spec sẽ phải assert
theo câu chữ tự do, và hai nhánh deny khác nhau (`post` vs `comment`) sẽ không phân biệt được.

**Chốt — theo đúng tiền lệ `SOCIAL_ERR.REPORT_DUPLICATE_OPEN` (D5 của BE-1B):** ba hằng CÓ TÊN, tiền tố
`"SOCIAL-ERR: …"` KHÔNG kèm số — `FILE_TARGET_POST_DENIED` · `FILE_TARGET_COMMENT_DENIED` ·
`FILE_NOT_OWNED`. Cả ba vào **TẦNG A** (bằng chứng MẠNH) của `social-error-code-census.spec.ts` ngay từ
đầu: vì không có số, bằng chứng «theo chuỗi mã» vốn không tồn tại cho chúng, nên tầng B một mình sẽ tha
chúng ngay khi có một `throw` bất kỳ. Nếu owner muốn số hoá sau: thêm dòng SPEC-16 §12 rồi đổi hằng, một chỗ.

---

## §2 — Bề mặt thay đổi

| Tầng | File | Việc |
| --- | --- | --- |
| Contract | `packages/contracts/src/social-api.ts` | `socialFileUploadUrlInputSchema` · `socialFileConfirmInputSchema`. **KHÔNG đẻ enum mới**: `feedTargetTypeSchema` (`social.ts:42`) đã là `z.enum(["post","comment"])`, trùng đúng `SocialTargetType` — tái dùng |
| Hằng | `apps/api/src/social/social-route-pairs.const.ts` | 2 key route (`fileUploadUrl`/`fileConfirm`, `tier1IsFloor:true`) + bảng `SOCIAL_FILE_TARGET_PAIRS` |
| Cổng | `apps/api/src/social/social-access.service.ts` | `assertFileTarget(actor, target)` — khuôn `assertKudosOfficial` |
| Lỗi | `apps/api/src/social/social.errors.ts` | 3 hằng + bảng `SOCIAL_FILE_TARGET_DENIED` (D1b) |
| Test | `apps/api/src/social/social-file-target-pairs-structure.spec.ts` (mới) | **C-8** — cấu trúc bảng, khuôn C-6 |
| Service | `apps/api/src/social/social-files.service.ts` (mới) | wrapper own-scope quanh `FileService.upload/confirmUpload` — khuôn `ChatFilesService` |
| Route | `apps/api/src/social/social-files.controller.ts` (mới) | 2 route + `@UseGuards(PermissionGuard)` per-route |
| Wiring | `social.module.ts` · `social.dto.ts` | đăng ký controller/provider + 2 class DTO |
| Census | `test/foundation/social-two-layer-guard-census.unit-spec.ts` | 48 → 50 route · `SOCIAL_CONTROLLERS` · `ROUTE_TO_KEY` · `SERVICE_SITE_TO_KEYS` · nguồn độc lập của D17 |
| Census | `test/foundation/route-http-coverage.e2e-spec.ts` | `MIN_COVERED_COUNT` 680 → **682** = số spec IN RA (`682/682`, 100%) |
| Test | `test/integration/social-be1c-file-door.int-spec.ts` (mới) | ma trận ALLOW/DENY + IDOR |
| Doc | `docs/API Design/API-19_SOCIAL_API_Design.md` | `SOCIAL-API-054/055` |

## §3 — Ma trận ca test (DENY luôn có ALLOW đứng cạnh)

| Ca | Vai (cặp) | Request | Kỳ vọng |
| --- | --- | --- | --- |
| A1 | `view:feed` + cả 2 cặp create | upload `target=post` | **200** + `fileId`/`uploadUrl` |
| A2 | như A1 | upload `target=comment` | **200** |
| A3 | như A1 | confirm tệp CỦA MÌNH | **200** |
| D1 | `view:feed` + `create:feed-post` (KHÔNG có `-comment`) | upload `target=comment` | **403** |
| A4 | **cùng vai D1** | upload `target=post` | **200** ← vế ALLOW ép D1 không xanh-rỗng |
| D2 | `view:feed` + `create:feed-comment` (KHÔNG có `-post`) | upload `target=post` | **403** |
| A5 | **cùng vai D2** | upload `target=comment` | **200** |
| D3 | chỉ `view:feed` | upload cả 2 target | **403** (tầng 2) |
| D4 | KHÔNG có `view:feed` | upload | **403** (tầng 1, guard) |
| D5 | vai đủ quyền | confirm tệp của NGƯỜI KHÁC | **403** IDOR |
| A6 | vai đủ quyền | confirm tệp của mình (sau D5) | **200** ← ALLOW cạnh D5 |

> **D1/A4 và D2/A5 là lý do D1 tồn tại.** Nếu ai đó «đơn giản hoá» về một cặp tĩnh, đúng hai ca đó đỏ.

**KẾT QUẢ (chạy 24/09/2026 trên lane DB `mediaos_be1c`): 17/17 PASS.**

## §3b — PHÉP ĐO CỔNG đã CHẠY THẬT (không phải lời hứa)

| Đột biến | Kỳ vọng | Kết quả ĐO |
| --- | --- | --- |
| Gỡ cả hai lời gọi `assertFileTarget` khỏi `SocialFilesService` | 4 ca DENY tầng-2 đỏ, ca tầng-1 giữ xanh | ✅ **ĐÚNG 4 ca đỏ** — `postOnly+comment` · `commentOnly+post` · `readOnly` (cả 2 target) · `confirm postOnly+comment`; mỗi ca đỏ vì «expected 200 to be 403» (đúng THÔNG ĐIỆP kỳ vọng, không phải đỏ vì 500/biên dịch). Ca «KHÔNG có `view:feed`» vẫn XANH — đúng, nó do `PermissionGuard` tầng-1 gác. |
| `SOCIAL_FILE_TARGET_PAIRS.comment` → `create:feed-post` | ca (c) + (d) của C-8 đỏ, TS KHÔNG đỏ | ✅ đúng 2 ca đỏ, thông điệp «hai target dùng chung cặp: create:feed-post · create:feed-post» |

> Cả hai đột biến đã được KHÔI PHỤC và suite chạy lại xanh (17/17 · 8/8).

## §4 — Nợ ghi nhận

- **SPEC-16 §15 ghi «53 route»**, API-19 sau WO này có 55. `docs/spec/**` NGOÀI `paths` ⇒ không sửa ở
  đây; giao cho WO doc kế tiếp (đề xuất: thêm dòng cụm «Đính kèm · `SOCIAL-API-054..055` · 2»).
- `chat/files/*` (2 route) vẫn **không có mặt trong API-13** — tiền lệ xấu, không nhân bản; nợ của CHAT.
