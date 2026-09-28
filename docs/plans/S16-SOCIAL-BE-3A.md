# S16-SOCIAL-BE-3A — resolve báo cáo kèm hành động (029) · CRUD huy hiệu vinh danh (049–051 + 056)

> Zone 🔴 red · **FULL gate** (`security-reviewer` + `silent-failure-hunter` + `database-reviewer`) — owner chốt 28/09/2026
> vì 029 thêm phép kiểm quyền + ghi audit. Deny-path RED trước.
> Tách từ `S16-SOCIAL-BE-3` ngày 28/09/2026 (owner chốt tách 3 WO: 3A · 3B thống kê · 3C khôi phục).
> Plan v3 — vá plan-reviewer vòng 1 (4 chặn + 9 cảnh báo) + vòng 2 (deadlock D9 ↔ R7: khoá thứ tự FOR UPDATE).

## 0. Khảo sát — có sẵn / còn thiếu

| Có sẵn | Ở đâu |
| --- | --- |
| `027`/`028`/`029` đã dựng (BE-1B). `resolve()` chỉ đổi `status` + audit `social.report.{status}` | `social-reports.service.ts:129-175` |
| Che `reporter` khi scope < Company (SOC-DEC-011) | `toReportDto(after, isCompany)` |
| `resolveActor("reportResolve")` resolve SẴN `manage:feed-post` (sàn Company) ⇒ `actor.canManagePosts` dùng được, fail-closed | `social-access.service.ts:115,206` |
| Kiểm duyệt theo trường, audit 1 dòng/trường | `social-posts-moderation.service.ts:56` |
| Xoá mềm bài / bình luận + audit khi xoá của người khác | `social-posts.service.ts:459` · `social-comments.service.ts:332` |
| `withTenant` = `db.transaction` ⇒ throw sau câu ghi = rollback cả trạng thái báo cáo lẫn audit | `db.service.ts:83` |
| Catalog `feed_kudos_badges` (unique `feed_kudos_badges_company_code_uq`; không `is_system`/`deleted_at`; app role không DELETE); audit object type `feed_kudos_badge` (mig 0583) | `schema/social.ts:744-772` |
| `048` chỉ trả `is_active=true` — CỐ Ý | `social-api-kudos.ts:49-55` |
| Cặp `manage:feed-report` · `manage:feed-kudos` · `manage:feed-post` đã seed | `0578:51-54, 92-110` |

Không cần migration. Không vòng DI (3 service bơm vào `SocialReportsService` không phụ thuộc ngược nó).

## 1. Quyết định

| # | Quyết định |
| --- | --- |
| D1 | `resolveFeedReportSchema` thêm `action: enum["none","hide_post","lock_comments","delete_target"]` `.default("none")`; `.refine`: `status='dismissed'` ⇒ `action='none'` (400). Client cũ không gửi `action` ⇒ hành vi y hệt trước (ca hồi quy). |
| D2 | Ma trận action × target (hàm thuần, bảng `satisfies Record<FeedTargetType, readonly ReportAction[]>`): **post** → cả 4; **comment** → `none` · `delete_target` (xoá bình luận) · `lock_comments` (khoá bình luận BÀI CHA). Ngoài ma trận ⇒ 422 `SOCIAL-ERR:REPORT_ACTION_INVALID_FOR_TARGET`. |
| D3 | Hành động kèm **chỉ ghi trong audit** (owner 28/09) — metadata `social.report.resolved` thêm `action`; hành động tự ghi audit riêng qua hàm lõi (xem D5 về khi nào có dòng đó). KHÔNG cột mới. |
| D4 | **Bảng cặp theo payload** `SOCIAL_REPORT_ACTION_PAIRS` trong `social-route-pairs.const.ts` (`none: null`, 3 hành động → `manage:feed-post`), `satisfies Record<ReportActionDto, …>`. Phép kiểm D4 ĐỌC bảng này (load-bearing). `reportResolve.tier1IsFloor = true` + thêm nguồn độc lập vào đẳng thức D17 của `social-two-layer-guard-census` + cập nhật C2-b. Thiếu cặp ⇒ 403 `SOCIAL-ERR:REPORT_ACTION_DENIED` (hằng riêng, không mượn `NOT_CONTENT_OWNER`). ⚠️ Khác route gốc CÓ CHỦ Ý: qua 005 tác giả tự xoá bài mình không cần `manage:feed-post`; qua 029 thì cần — hành động kèm là thao tác kiểm duyệt. |
| D5 | Hành động chạy qua **CÙNG hàm lõi tầng tx** với route gốc, nhận target ĐÃ kiểm (hàm lõi KHÔNG tự gọi `assert*Visible`): `SocialPostsModerationService.moderateTx(tx, actor, post, patch)` · `SocialPostsService.removeTx(tx, actor, post)` · `SocialCommentsService.removeTx(tx, actor, comment)`. Route gốc gọi lại chính chúng. Audit hành động theo luật route gốc: xoá nội dung CỦA CHÍNH MÌNH không có dòng `social.*.delete` — ca test tương ứng chỉ kỳ vọng dòng `social.report.resolved`. |
| D6 | **Vá 2 race sẵn có** (luồng báo cáo làm chúng dễ xảy ra — nhiều báo cáo cùng target): (a) UPDATE của `moderateTx` thêm `isNull(deletedAt)` + `.returning()`; 0 hàng ⇒ route 006 trả 404 `POST_NOT_FOUND` như cổng đọc, luồng báo cáo trả 422 `REPORT_ACTION_TARGET_UNAVAILABLE`. (b) `removeTx` bài trả boolean của `softDeletePostTx` và CHỈ audit khi `true` (khớp nhánh bình luận `social-comments.service.ts:344`); route 005 VẪN trả `200 {deleted:true}` khi `false` (hành vi quan sát được giữ nguyên); luồng báo cáo `false` ⇒ 422. |
| D7 | Target qua cổng thường: thêm biến thể KHÔNG ném `findPostVisible`/`findCommentVisible` (trả `null`); `assert*Visible` thành wrapper mỏng ⇒ MỘT vị từ. Luồng báo cáo `null` ⇒ 422 `SOCIAL-ERR:REPORT_ACTION_TARGET_UNAVAILABLE`. KHÔNG catch `NotFoundException` chung. Không đi đường snapshot bypass của hàng đợi. |
| D8 | **Thứ tự** (một tx, `SET LOCAL lock_timeout='5s'` khuôn #537): 404 báo cáo → **khoá thứ tự: `SELECT id FROM feed_reports WHERE company_id=$1 AND target_type=$2 AND target_id=$3 AND status='open' ORDER BY id FOR UPDATE`** (mọi resolve cùng target khoá cùng thứ tự ⇒ không chu trình với D9; KHÔNG dùng advisory lock — tiền lệ fail-open payroll; hết `lock_timeout` (SQLSTATE `55P03`) ⇒ 409 `SOCIAL-ERR:REPORT_BUSY` rõ ràng, KHÔNG 500 vô danh — có ca test) → 403 cặp hành động (D4, chỉ cần `actor` + `dto.action`) → 422 ma trận (D2, `before.targetType`) → câu ghi có điều kiện ⇒ 409 `ERR-021` → đọc target ⇒ 422 (D7) → thực thi hành động ⇒ 422 nếu 0 hàng (D6) → auto-resolve báo cáo anh em (D9) → audit báo cáo. Throw sau câu ghi = rollback toàn bộ. |
| D9 | **Báo cáo anh em** (owner 28/09): khi `action='delete_target'` thành công, mọi báo cáo `open` KHÁC cùng `(company_id, target_type, target_id)` (đã khoá ở D8) chuyển `resolved` trong cùng tx (`resolved_by` = actor, `resolution_note` NULL), mỗi hàng 1 dòng audit `social.report.resolved` metadata `{action:"delete_target", via: <reportId gốc>, from:"open", to:"resolved"}` (`from` của TỪNG hàng, không mượn của báo cáo gốc). Chỉ anh em CÙNG target: xoá bài KHÔNG đóng báo cáo trên bình luận của bài đó — ghi rõ ở API-19 cho FE-3. Chỉ `delete_target` (target biến mất); `hide`/`lock` để nguyên — báo cáo khác có thể nói về điều khác. |
| D10 | `049` POST `/social/kudos-badges` `{code, name, description?, icon?, position?}`; `@Idempotent`; `code` `^[a-z0-9-]{2,32}$`; `name` 1..255 · `description` ≤1000 · `icon` ≤64 · `position` int 0..32767. Trùng ⇒ 409 `SOCIAL-ERR:KUDOS_BADGE_CODE_TAKEN` qua `isUniqueViolationOf("feed_kudos_badges_company_code_uq")` (không bắt `23505` trần). `050` PATCH `{name?, description?, icon?, position?, isActive?}` strict, ≥1 trường, `code` BẤT BIẾN (400). `051` DELETE ⇒ `UPDATE … SET is_active=false WHERE is_active=true RETURNING` — 0 hàng mà huy hiệu tồn tại ⇒ 200 không audit; không tồn tại/tenant khác ⇒ 404 `SOCIAL-ERR:KUDOS_BADGE_NOT_FOUND`. `{badge_id}` qua `ParseUUIDPipe`. Audit cùng tx, payload id + trường đổi. |
| D11 | Huy hiệu hệ thống (5 code seed) không đối xử riêng: tắt/bật lại qua `050 isActive:true` (owner 28/09). Seeder `ON CONFLICT DO NOTHING` không bật lại huy hiệu tenant đã tắt. |
| D12 | **Route mới `SOCIAL-API-056` `GET /social/kudos-badges/manage`** (owner 28/09): `manage:feed-kudos`, OFFSET `{data,page,limit,total}`, trả cả huy hiệu tắt + `isActive`, `ORDER BY position, id`. Ghi **SOC-DEC-012** vào SPEC-16 §22 + cập nhật API-19 (bảng route, tổng route → 56 kể cả nợ 054/055 của BE-1C, SPEC-16 §462 đếm nhóm huy hiệu). `048` giữ nguyên. |
| D13 | Huy hiệu tắt không ảnh hưởng vinh danh cũ (`047` LEFT JOIN đã hỗ trợ); chỉ chặn chọn mới (ERR-022 sẵn có). |
| D14 | **Nợ nhóm riêng tư** (owner 28/09 chấp nhận): bài nhóm riêng tư mà người kiểm duyệt không phải thành viên ⇒ hành động kèm 422, vẫn resolve được với `none`. Seed WO `S16-SOCIAL-GROUPMOD-1` quyết định đường kiểm duyệt nội dung nhóm riêng tư. |

## 2. Việc

1. **Contracts** — `social-api-b.ts` (`action` + refine), `social-api-kudos.ts` (`createKudosBadgeSchema` · `updateKudosBadgeSchema` · `kudosBadgeAdminSchema` · `listKudosBadgesAdminQuerySchema`).
2. **Access** — `findPostVisible`/`findCommentVisible` + wrapper (D7).
3. **Hàm lõi** — `moderateTx` (vá D6a) · `SocialPostsService.removeTx` (vá D6b) · `SocialCommentsService.removeTx`; route gốc gọi lại.
4. **Route pairs** — `SOCIAL_REPORT_ACTION_PAIRS`; `reportResolve.tier1IsFloor=true`; `kudosBadgeCreate/Update/Delete/AdminList` = `manage:feed-kudos`.
5. **`SocialReportsService.resolve`** — D2/D4/D8/D9; nếu file vượt ~550 dòng, tách `social-report-actions.ts` (ma trận thuần + dispatcher).
6. **Huy hiệu** — repo `createBadgeTx`/`updateBadgeTx`/`deactivateBadgeTx`/`listBadgesAdminTx`; service; 4 route vào `SocialKudosController` (route tĩnh `manage` khai trước).
7. **Lỗi** — `REPORT_ACTION_DENIED` · `REPORT_ACTION_INVALID_FOR_TARGET` · `REPORT_ACTION_TARGET_UNAVAILABLE` · `KUDOS_BADGE_CODE_TAKEN` · `KUDOS_BADGE_NOT_FOUND` (không đánh số, tiền tố `SOCIAL-ERR:`), đưa vào `STRONG_EVIDENCE` của `social-error-code-census.spec.ts`.
8. **Census** — `social-two-layer-guard-census.unit-spec.ts`: đếm route 50→54, `ROUTE_TO_KEY` +4, `SERVICE_SITE_TO_KEYS` +method mới, D17 nguồn mới, C2-b; route census runtime + OpenAPI.
9. **Docs** — API-19 (029 `action` + ma trận + D9; 049–051 chi tiết; 056; tổng route); SPEC-16 SOC-DEC-012 + §462; docblock «BE-3» → «BE-3A/3C» (`social-counters.ts:112`, `social-master-data.seeder.ts:47`, `social-kudos.service.ts:14`); seed WO `S16-SOCIAL-GROUPMOD-1` (D14).

## 3. Test (RED trước) — test assert theo HẰNG `SOCIAL_ERR.X`, không theo chuỗi

**Deny-path (int-spec, LANE_DB):**
- R1 vai tuỳ biến `manage:feed-report` KHÔNG `manage:feed-post` + `hide_post` ⇒ 403 `REPORT_ACTION_DENIED`; báo cáo vẫn `open`, bài `published`, 0 audit.
- R2 `delete_target` trên target đã xoá ⇒ 422, báo cáo vẫn `open`.
- R3 `dismissed` + `action≠none` ⇒ 400.
- R4 báo cáo bình luận + `hide_post` ⇒ 422 `REPORT_ACTION_INVALID_FOR_TARGET`.
- R5 bài nhóm riêng tư, HR không thành viên + `hide_post` ⇒ 422; cùng báo cáo `none` ⇒ 200.
- R6 **harness tất định**: tx A giữ khoá hàng báo cáo sau câu ghi; B khởi động và được xác nhận ĐANG CHỜ khoá (`pg_stat_activity.wait_event_type='Lock'`, poll có trần thời gian — không bao giờ chồng lấp ⇒ ĐỎ, không xanh-rỗng); A commit; B ⇒ 409; đúng 1 dòng audit hành động + 1 dòng audit báo cáo.
- R7 hai báo cáo KHÁC nhau cùng bài, cả hai `delete_target` đồng thời (cùng harness) ⇒ ĐÚNG một 200 + một 409 (anh em đã auto-resolve), đúng 1 dòng `social.post.delete`, KHÔNG 500/`40P01`.
- R8 `hide_post` đua với xoá bài ⇒ bài KHÔNG thành `hidden` với `deleted_at` khác NULL.
- R9 giữ khoá target quá `lock_timeout` ⇒ 409 `REPORT_BUSY`, báo cáo vẫn `open`.
- K1 employee gọi `049/050/051/056` ⇒ 403. K2 `badge_id` tenant khác ⇒ 404. K3 code trùng ⇒ 409 `KUDOS_BADGE_CODE_TAKEN`. K4 `code` trong PATCH ⇒ 400. K5 `position` 40000 / `name` 300 ký tự ⇒ 400 (không 500).

**Allow-path:** mỗi action × target ra đúng trạng thái + đúng tập audit; `hide_post`/`lock_comments` trên bài đã ở trạng thái đó ⇒ không dòng audit trường, dòng báo cáo vẫn mang `action`; `hide_post` trên bài `news`; báo cáo bình luận + `lock_comments` khi bài cha `hidden`; comment delete dọn mention/reaction + hạ `comment_count`; D9 anh em resolved + audit `via`; không gửi `action` ⇒ y hệt trước (hồi quy); `051` rồi `050 isActive:true` bật lại huy hiệu hệ thống; `048` không thấy huy hiệu tắt, `056` thấy; `ORDER BY position, id` ổn định khi trùng `position`; `051` lần hai ⇒ 200 không audit.

**Unit:** refine D1; ma trận D2 vét cạn; bảng D4 vét cạn; route 006/005/017 cũ xanh nguyên.

## 4. Rủi ro

- Tách hàm lõi đổi chữ ký nội bộ 3 service dày test — chạy spec 005/006/017 TRƯỚC khi thêm gì.
- Unit spec dựng `new SocialReportsService(...)` theo vị trí sẽ gãy khi thêm 3 dependency — sửa cùng lượt.
- Bật `tier1IsFloor` cho 029 đổi đẳng thức census D17/C2-b — cập nhật có chủ đích, không nới ngưỡng.
- Chạy `bash harness/check.sh --lane-db` (int-spec PHẢI chạy thật, không skip).
