# S16-SOCIAL-AVATARPRESIGN-1 — ký `avatarUrl` của TOÀN module SOCIAL qua `AvatarPresignService`

> Zone 🔴 **red** · **FULL gate** (đường ký tệp): `security-reviewer` + `database-reviewer` + `silent-failure-hunter`
> (+ `santa-method` cho vế BE — chạm 10 trường DTO danh tính + kênh WS). Vế FE: `react-reviewer` + `typescript-reviewer`.
> Owner đã ký **K4** (29/09/2026, ở S16-SOCIAL-BE-2D): ký qua `AvatarPresignService` TRONG WO này. Deny-path RED trước;
> trước PR chạy `bash harness/check.sh --all --lane-db=avatarpresign` (int-spec phải CHẠY, không skip).
> Lane DB `mediaos_avatarpresign`. Mọi số đo ở §2 chạy ngày 02/10/2026 trên worktree `MediaOS-avatarpresign` @ `14afbb5f`.

## 1. Bối cảnh — cái gì sai (dòng code HIỆN TẠI)

**Cột `employee_profiles.avatar_url` lưu `fileId` (UUID), không phải URL** (`packages/contracts/src/me.ts:354`, ghi bởi
`MeAvatarService.setAvatar` / `HrEmployeeAvatarService`). Cột ĐA-NGƯỜI-GHI: `createEmployeeProfileSchema.avatarUrl` /
`updateEmployeeProfileSchema.avatarUrl` (`packages/contracts/src/employees.ts:88` · `:106`, `z.string().url()`) nhận cả
`javascript:`/`data:`/`http://host-lạ` (đo M5); profile-change-request ghi `avatar_file_id` verbatim. _(Backlog trỏ
`employees.ts:28` — đó là schema RESPONSE; hai đường GHI là `:88`/`:106`.)_

SOCIAL chiếu THẲNG cột thô ra **10 trường DTO / 12 điểm SELECT** (đo M3 — mọi điểm trả đúng fileId, kể cả giá trị bị đầu độc):

| #   | Route                                         | SELECT thô (repository)                                          | Dựng DTO (service/mapper)                                                                      |
| --- | --------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 1   | `001/002/003/004/010/020/023/025` tác giả bài | `social-posts.repository.ts:302` (`authorAvatarUrl`)             | `social.mapper.ts:33-43` `authorOf` ← `social-posts.service.ts:727-788` `decorate`             |
| 2   | `006` (response kiểm duyệt)                   | (cùng `POST_COLUMNS`)                                            | `social-posts-moderation.service.ts:74-92` (tx riêng, KHÔNG qua `decorate`)                    |
| 3   | khối `kudos` trên thẻ + `047`                 | `social-kudos.repository.ts:431` (`recipientsOfTx`, `CASE … K1`) | `social-post-blocks.ts:73-81` · `social.mapper.ts:148-153` · `social-kudos.service.ts:146-152` |
| 4   | `014/015/016` tác giả bình luận               | `social-comments.repository.ts:145`                              | `social-comments.service.ts:398-434` `decorate`                                                |
| 5   | `013` người thả cảm xúc                       | `social-reactions.repository.ts:141`                             | `social-reactions.service.ts:159-172`                                                          |
| 6   | `022` đã đọc / chưa đọc                       | `social-news.repository.ts:133` · `:226`                         | `social-news.service.ts:170-214` (`toAckPerson:207-214`)                                       |
| 7   | `026` sinh nhật (khoá **`avatar`**)           | `social-discovery.repository.ts:92`                              | `social-discovery.service.ts:137-164`                                                          |
| 8   | `037` thành viên nhóm                         | `social-group-members.repository.ts:111`                         | `social-groups.service.ts:308-321` · `:639-649`                                                |
| 9   | `059` danh bạ người nhận vinh danh            | `social-kudos.repository.ts:580`                                 | `social-kudos.service.ts:167-190`                                                              |
| 10  | `028/029` reporter · resolver · tác giả đích  | `social-reports.repository.ts:83` · `:86` · `:91`                | `social-reports.service.ts:541-597` (`person` + `toReportDto`)                                 |

**WS:** `emitPostCreated` (`social-posts.service.ts:827-850`) và `emitCommentCreated` (`social-comments.service.ts:533-546`)
dàn `...rest` ⇒ `author.avatarUrl` lên room cả công ty (đo M3/P10); schema WS (`packages/contracts/src/realtime.ts:350-379`)
chỉ `.omit` khoá cấp 1 — **`.omit` không với tới khoá lồng** (tiền lệ CHAT `wsChatRoomPeerSchema`, `realtime.ts:181-208`).

**Hệ quả:** (a) FE không tải được ảnh — 5 bề mặt đang truyền cột thô làm `src` (`PostCard.tsx:84` · `CommentList.tsx:67` ·
`BirthdayWidget.tsx:90` · `GroupMembersTab.tsx:123` · `GroupRequestsTab.tsx:88`) ⇒ `<img src="<uuid>">` = URL tương đối ⇒
ảnh vỡ; bề mặt kudos/059 (FE-2C) và danh sách đã đọc `NewsPage.tsx:221` cố ý CHỈ chữ cái đầu. (b) Nếu "sửa" bằng ký mù
`files.getDownloadUrl(avatar_url)` ⇒ **IDOR đọc tệp nội-tenant** (đặt `avatar_url` = fileId hợp đồng/phiếu lương/ảnh người khác).

**Công cụ đúng đã có** — `AvatarPresignService.resolveEmployeeAvatars(companyId, subjects, callerTx?)`
(`apps/api/src/foundation/files/avatar-presign.service.ts:54-125`), dùng ở HR (`hr-read.service.ts:67`), org-chart
(`hr-org-chart.service.ts:66`), CHAT (`chat-members.service.ts:74`, `chat-rooms.service.ts:150`), TASK
(`task-core.service.ts:1393`). Luật (đo M1/M4):

- UUID ⇒ chỉ ký khi `findVerifiedAvatarsTx` (`file.repository.ts:104-134`) trả hàng: link `ME/avatar/Avatar` SỐNG ·
  `image/%` · `Uploaded` · `<> Infected` · tệp chưa xoá · `files.owner_user_id = file_links.created_by` · khớp ĐÚNG cặp
  `(employeeId = link.entity_id, fileId)`.
- Chuỗi bắt đầu đúng `http://` / `https://` (phân biệt hoa thường) ⇒ passthrough; mọi thứ khác ⇒ bỏ (initials).
- Có `callerTx` ⇒ KHÔNG mở `withTenant` (`:85-89`). Storage lỗi ⇒ bỏ + `logger.warn` (fail-soft có log, `:101-123`).
- Trả `Map<employeeId, url>` — vắng = initials.

**KHÔNG file SOCIAL nào gọi nó** (grep `resolveEmployeeAvatars` trong `apps/api/src/social` = 0).

## 2. Phép đo (đã chạy — không đo = coi là chưa biết)

Runner = `bash "<scratchpad>/run-lane-vitest.sh" "/c/dev 2/MediaOS-avatarpresign" avatarpresign …`. Probe tạm
`zz-probe-avatarpresign.int-spec.ts` (nguồn ở `scratchpad/probes/avatarpresign/`) được CHÉP vào `apps/api/test/integration/`
để glob vitest nhặt, chạy, rồi XOÁ ngay (`git status` sạch sau đó).

| #   | Đo cái gì                                  | Cách đo                                                                                                                                                                                                                                                                                                                 | Kết quả quan sát                                                                                                                                                                                                                                                  |
| --- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | Luật xác minh của dịch vụ ký               | runner `src/foundation/files/avatar-presign.service.spec.ts test/integration/avatar-presign.int-spec.ts`                                                                                                                                                                                                                | 2 file, **18/18 pass**; int-spec CHẠY thật (9 ca, 1211 ms — không skip): non-image / không link / Pending / Infected / link xoá / sai linkType / cross-tenant / forge (`owner ≠ created_by`) ⇒ 0 hàng; HR-managed ⇒ 1 hàng                                        |
| M2  | Spec hiện ghim giá trị THÔ                 | runner `test/integration/social-be2d-blocks-recipients.int-spec.ts -t "B1\+B2\|R8\|B6"`                                                                                                                                                                                                                                 | 3 pass / 20 skip. `B1+B2` assert `avatarUrl: AV` (UUID ngẫu nhiên, KHÔNG có tệp) trên `003`/`001`/`047` ⇒ spec đang ghim hành vi thô — PHẢI sửa có chủ đích (§5)                                                                                                  |
| M3  | Mọi điểm chiếu SOCIAL trả gì hôm nay       | probe P1–P10 (tác giả có avatar ĐÃ XÁC MINH; người xem bị đầu độc `avatar_url` = fileId của tác giả)                                                                                                                                                                                                                    | `003`/`001`/`015`/`014`/`013`/`002-kudos`/`047`/`059`/`037`/`022`/`026`/`028`(reporter + snapshot) **đều trả fileId thô**; người bị đầu độc hiện fileId của người KHÁC; WS `feed:post.created` + `feed:comment.created` mang `author.avatarUrl` thô               |
| M4  | `resolveEmployeeAvatars` trên env lane     | probe P11, gọi thẳng `app.get(AvatarPresignService)`                                                                                                                                                                                                                                                                    | tác giả ⇒ URL có `X-Amz-Signature=`, `X-Amz-Expires=300`, chứa fileId trong path; đầu độc chéo ⇒ vắng; `javascript:` · `JAVASCRIPT:` · `data:` · `vbscript:` · `//host` · `" https://…"` · `HTTPS://…` ⇒ vắng; `http://…` và `https://…` ⇒ passthrough nguyên văn |
| M5  | Đường GHI nhận gì                          | probe P11: `createEmployeeProfileSchema` / `updateEmployeeProfileSchema` `.shape.avatarUrl.safeParse(...)`                                                                                                                                                                                                              | `javascript:alert(1)` ⇒ **true** (cả create/update) · `data:image/png;base64,…` ⇒ true · `http://tracker…` ⇒ true                                                                                                                                                 |
| M6  | Số câu/tx của `GET /social/feed` hôm nay   | probe P12, `captureQueries` sau 1 lượt làm nóng, trang 14 thẻ                                                                                                                                                                                                                                                           | **27 câu · 5 `begin` · 0 câu cổng avatar** (`file_links` + tham số `'Avatar'`). 5 tx = quyền · scope · `listFeed` · `decorate` (tags/reactions/saved/mentions/kudos×2) · đính kèm                                                                                 |
| M7  | `callerTx` vs lồng `withTenant`            | probe P12: `withTenant(c, tx => resolve(c, s, tx))` vs `withTenant(c, () => resolve(c, s))`                                                                                                                                                                                                                             | callerTx: **1 `begin`**, 1 câu cổng, tổng 4 · lồng: **2 `begin`**, tổng 7 ⇒ lời gọi thiếu `tx` trong tx mở một kết nối + tx THỨ HAI (hình dạng treo PgBouncer khi pool `max:20` cạn — `social-reports.service.ts:376-380`)                                        |
| M8  | FE hôm nay                                 | `pnpm --filter @mediaos/app exec vitest run` 8 spec (KudosBlock · KudosPage · KudosComposerFields · PostCard · CommentList · FeedWidgets · GroupAdminTabs · NewsPage)                                                                                                                                                   | **8/8 file pass** (15+10+17+28+22+16+18+15 ca). Ca «không `<img>`» xanh: `KudosBlock.spec.tsx:118-121` · `KudosComposerFields.spec.tsx:115-123` · `KudosPage.spec.tsx:123-128` · `:207-218` (widget)                                                              |
| M9  | Baseline contracts + ratchet + unit SOCIAL | `pnpm --filter @mediaos/contracts exec vitest run src/social-ws.spec.ts src/social-feed-blocks.spec.ts` · `cd apps/api && pnpm exec vitest run test/foundation/identity-projection-ratchet.unit-spec.ts src/social/social.mapper.spec.ts src/social/social-post-blocks.spec.ts src/social/social-news-noti-cap.spec.ts` | contracts 2 file / 41 pass · api 4 file / 43 pass (ratchet xanh trước khi sửa)                                                                                                                                                                                    |
| M10 | `Avatar` FE + chính sách cache             | đọc `packages/ui/src/components/ui/avatar.tsx:27-44` · `apps/app/src/main.tsx:25-32`                                                                                                                                                                                                                                    | `<img src loading="lazy">` khi `src` truthy, **KHÔNG `onError`** (URL hết hạn ⇒ ảnh vỡ, không rơi về initials) · `staleTime 30s`, `gcTime 5'`, `refetchOnWindowFocus:false`                                                                                       |
| M11 | FE tiêu thụ WS bảng tin                    | grep `FEED_POST_CREATED\|FEED_COMMENT_CREATED` trong `apps/app` + `packages/web-core`                                                                                                                                                                                                                                   | chỉ `apps/app/src/hooks/use-feed-realtime.ts:75` nghe `feed:post.created` (CHỈ đếm); **không ai** nghe `feed:comment.created` ⇒ bóc `author.avatarUrl` không tốn gì ở FE                                                                                          |
| M12 | DI                                         | đọc `files.module.ts:74-89` · `social.module.ts:91-94` · grep `new Social*Service(` trong spec                                                                                                                                                                                                                          | `FilesModule` export `AvatarPresignService`; `SocialModule` đã import `FilesModule`; đúng 1 chỗ dựng tay: `social-news-noti-cap.spec.ts:38`                                                                                                                       |
| M13 | TTL ký                                     | đọc `storage/object-storage.service.ts:92` + M4                                                                                                                                                                                                                                                                         | mặc định `S3_PRESIGN_TTL_SEC` 300 s = `X-Amz-Expires=300` đo được                                                                                                                                                                                                 |
| M14 | Lệnh chạy probe                            | lần 1 runner thường                                                                                                                                                                                                                                                                                                     | `ERR_IPC_CHANNEL_CLOSED`, 0 ca ⇒ chạy lại `--no-file-parallelism` ⇒ 10/10 pass (luật 9). Khi thi công: lệnh int-spec mặc định thêm cờ này nếu gặp lại                                                                                                             |

**Bẫy đã soát:**

| Bẫy                                      | Áp dụng?                                                                                                                                                          |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `withTenant` lồng = treo im lặng         | **CÓ** — đo M7. Thiết kế: mọi lời gọi ký nằm TRONG tx sẵn có, `tx` là tham số BẮT BUỘC (§4.1) + ca A/B đếm `begin` (§5 T-CNT)                                     |
| `tx.execute` trả timestamptz chuỗi thô   | Không — không thêm `tx.execute`; cổng avatar dùng builder                                                                                                         |
| Nghỉ việc KHÔNG bị xoá mềm               | Có, đã đúng: `026`/`037`/`059` lọc `status='active'`; kudos GIỮ người nghỉ (S6) ⇒ ảnh của họ cũng được ký (link vẫn sống). Ký KHÔNG đổi TẬP người được chiếu      |
| `UPDATE … RETURNING` trả giá trị sau     | Không — WO chỉ đọc                                                                                                                                                |
| `PermissionGuard` ném thông điệp cố định | Không — không thêm cổng/route/mã lỗi                                                                                                                              |
| Mã lỗi SOCIAL ở `error.code`             | Không — không mã lỗi mới                                                                                                                                          |
| Spec phải nằm trong glob vitest          | Có — int-spec mới ở `test/integration/*.int-spec.ts`, spec cấu trúc ở `src/social/*.spec.ts`, contracts ở `src/*.spec.ts` (đều đã đo chạy ở M1/M8/M9)             |
| Chạy từng spec che rò fixture chéo       | Có — §8 bước 9 chạy MỌI spec SOCIAL + avatar trong MỘT lượt trên lane                                                                                             |
| Census/ratchet nâng có chủ đích          | Có — spec cấu trúc mới ghim **12** điểm SELECT thô; identity ratchet giữ nguyên khoá (đổi tên khoá SELECT trong hàm cũ không đổi `file#function`) — chạy lại ở §8 |

## 3. Bất biến phải giữ

1. **`company_id` + RLS:** cổng xác minh đi qua `tx` của tenant (RLS+FORCE `files`/`file_links`) + `eq(company_id)` tường minh — không đổi (`file.repository.ts:120,125`). Không đọc tệp tenant khác (ca cross-tenant §5).
2. **Không lồng `withTenant`** (M7): ký CHỈ trong tx sẵn có của mỗi route; số `begin` mỗi request KHÔNG đổi.
3. **Không bao giờ ký giá trị chưa xác minh** — đường DUY NHẤT từ cột thô ra DTO là `SignedAvatars.urlOf(employeeId)`; cột thô KHÔNG lên DTO dưới bất kỳ khoá nào.
4. **Che danh tính đi TRƯỚC ký:** K1 (xoá mềm ⇒ `null` trong SQL), D13-a (reporter ẩn với scope < Company), `showBirthday=false` (ẩn dòng) — người đã bị che KHÔNG vào danh sách ký (không phát sinh URL, không lọt vào tham số câu cổng).
5. **Fail-soft về `null`**, không 500 cả trang: cặp không khớp / storage lỗi ⇒ initials (giữ `logger.warn` của dịch vụ).
6. **WS hẹp hơn REST:** `author.avatarUrl` VẮNG trên `feed:post.created` + `feed:comment.created` — hai tầng độc lập (bóc ở nguồn + schema lồng).
7. **Không thêm khoá DTO, không đổi tên khoá** (`avatar` của `026` giữ nguyên — SPEC-16 §3.5); không `userId` mới; tập khoá đóng (`R8`, `H5-keys`, `B1`) giữ.
8. **Append-only/soft-delete:** WO chỉ đọc — không ghi `audit_logs`, không `file_access_logs`, không bump `download_count` (đúng hợp đồng thumbnail của dịch vụ).
9. **+1 câu/trang, không N+1:** ≤ 1 câu cổng avatar mỗi request bất kể số dòng; 0 câu khi trang không có avatar dạng UUID.

## 4. Thiết kế

### 4.1 `apps/api/src/social/social-avatar-signer.ts` (MỚI, ~90 dòng) — điểm ký DUY NHẤT của SOCIAL

```ts
/** Một điểm chiếu: chủ hàng + giá trị THÔ `employee_profiles.avatar_url` (fileId | URL | null). */
export interface SocialAvatarRef {
  employeeId: string | null;
  avatarRaw: string | null;
}
/** URL ĐÃ KÝ theo employeeId — `urlOf` là cửa DUY NHẤT để một avatar lên DTO. */
export interface SignedAvatars {
  urlOf(employeeId: string | null): string | null;
}
export const NO_AVATARS: SignedAvatars;

@Injectable()
export class SocialAvatarSigner {
  constructor(private readonly presign: AvatarPresignService) {}
  /** `tx` BẮT BUỘC — không có overload tự mở withTenant (M7). */
  async signTx(
    tx: TenantTx,
    companyId: string,
    refs: Iterable<SocialAvatarRef>,
  ): Promise<SignedAvatars>;
}
```

- Gom `refs` → `Map<employeeId, raw>` (bỏ `employeeId`/`raw` null; trùng người = một subject) ⇒ rỗng ⇒ `NO_AVATARS`, **không** gọi dịch vụ (0 câu).
- Gọi `presign.resolveEmployeeAvatars(companyId, subjects, tx)` — LUÔN 3 đối số.
- Lưới cuối (phòng thủ chiều sâu, không đổi chính sách): giá trị trả về không khớp `^https?://` ⇒ coi như vắng + `logger.error` (một bản đổi của dịch vụ dùng chung không được lặng lẽ đẩy scheme lạ ra FE).
- Đăng ký provider trong `social.module.ts` (khối additive). Hàm thuần `kudosRecipientDto(r, avatars)` cũng ở đây: MỘT luật người nhận cho thẻ + `047` (BE-2D D4).

### 4.2 Repository — đổi tên khoá thô ⇒ trình biên dịch liệt kê MỌI chỗ phải sửa

Đổi khoá SELECT + kiểu hàng (giữ nguyên câu SQL, giữ `CASE … K1`):
`authorAvatarUrl`→`authorAvatarRaw` (`social-posts.repository.ts:302,326` · `social-comments.repository.ts:145,159`) ·
`avatarUrl`→`avatarRaw` (`social-reactions.repository.ts:141,219` · `social-news.repository.ts:133,226,318` ·
`social-group-members.repository.ts:111,223` · `social-kudos.repository.ts:237,431,535,580`) · `avatar`→`avatarRaw`
(`social-discovery.repository.ts:92,146`) · `reporterAvatarUrl/resolverAvatarUrl/targetAuthorAvatarUrl`→`…AvatarRaw`
(`social-reports.repository.ts:83,86,91,118,121,127`). Sau bước này `pnpm --filter @mediaos/api typecheck` ĐỎ ở đúng các
điểm dựng DTO của §1 — đó là checklist, không sót được.

### 4.3 Điểm dựng DTO — ký TRONG tx sẵn có, +1 câu

| Route          | Thay đổi                                                                                                                                                                                                                                                                               |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `decorate` bài | `social-posts.service.ts:733-759`: trong callback `withTenant` SAU `loadPostBlocksTx`, `avatars = await this.avatarSigner.signTx(tx, c, [...tác giả, ...người nhận kudos])` — MỘT lời gọi cho cả trang. Truyền `avatars` vào `toFeedPostDto`. Thêm ≤6 dòng (file đã 904 dòng — xem R1) |
| mapper         | `social.mapper.ts`: `toFeedPostDto`/`toFeedCommentDto` nhận `extra.avatars: SignedAvatars` (BẮT BUỘC); `authorOf(row, avatars)` = `avatars.urlOf(row.authorEmployeeId)`; `copyKudos(k, avatars)` qua `kudosRecipientDto`                                                               |
| khối kudos     | `social-post-blocks.ts:51-100`: `PostBlocks.kudos` giữ kiểu NỘI BỘ (`recipients: KudosRecipientRow[]` có `avatarRaw`), KHÔNG còn `FeedKudosBlockDto` — DTO chỉ dựng ở mapper                                                                                                           |
| `006`          | `social-posts-moderation.service.ts:74-84`: ký trong tx thứ hai (tags/reaction/saved), ref = tác giả                                                                                                                                                                                   |
| bình luận      | `social-comments.service.ts:406-424`: ký trong tx của `decorate`                                                                                                                                                                                                                       |
| `013`          | `social-reactions.service.ts:161-164`: callback thành `async`, ký sau `listReactors`                                                                                                                                                                                                   |
| `022`          | `social-news.service.ts:177-198`: ký sau `ackedPeople`/`unackedEmployeesFor`; `toAckPerson(r, avatars)`                                                                                                                                                                                |
| `026`          | `social-discovery.service.ts:143-163`: ký SAU lọc `showBirthday` (chỉ dòng hiển thị); khoá DTO vẫn `avatar`                                                                                                                                                                            |
| `037`          | `social-groups.service.ts:315-320`: ký trong tx; `toFeedGroupMemberDto(row, avatars)`                                                                                                                                                                                                  |
| `047`          | `social-kudos.service.ts:115-127`: ký sau `recipientsOfTx`, cùng tx                                                                                                                                                                                                                    |
| `059`          | `social-kudos.service.ts:172-185`: callback `async`, ký sau `searchKudosRecipientsTx` (chỉ ≤ trần 20 dòng cắt)                                                                                                                                                                         |
| `028`          | `social-reports.service.ts:136-149`: tính `revealReporter` TRƯỚC tx; refs = tác giả đích + resolver + reporter **CHỈ khi** `revealReporter`; `toReportDto(r, reveal, avatars)`                                                                                                         |
| `029`          | `social-reports.service.ts:293-300` (trong `resolveTx`, sau `findReport`): ký với cùng `tx` (+1 câu đọc dưới `lock_timeout` 5 s đã đặt)                                                                                                                                                |

Inject `SocialAvatarSigner` vào 9 service (posts · moderation · comments · reactions · news · discovery · groups · kudos ·
reports); sửa `social-news-noti-cap.spec.ts:38` (+1 đối số).

### 4.4 WS — bóc hai tầng

- `packages/contracts/src/realtime.ts`: `const wsFeedAuthorSchema = feedAuthorSchema.omit({ avatarUrl: true });` (docblock
  khuôn `wsChatRoomPeerSchema`) + `.extend({ author: wsFeedAuthorSchema })` trên `wsFeedPostCreatedEventSchema` và
  `wsFeedCommentCreatedEventSchema`.
- Nguồn: `emitPostCreated`/`emitCommentCreated` dựng `author: { employeeId, fullName }` tường minh (không `...author`).

### 4.5 Contracts + tài liệu (không đổi kiểu dữ liệu)

`avatarUrl` giữ `z.string().nullable()` (D5). Sửa docblock: `social-feed-blocks.ts:29-30`, `social-api-kudos.ts:256`,
`feedAuthorSchema` (`social-api.ts:116-127`), `feedBirthdaySchema` — «URL ĐÃ KÝ (TTL ngắn) hoặc URL http(s) quản trị đặt,
`null` = chữ cái đầu». API-19: §5.1l dòng 143 · ví dụ §6.1 dòng 482 · khối kudos dòng 513 · ví dụ `026` dòng 523 (khoá
đúng là `avatar`, không `avatarUrl`) · §7 thêm luật 4 «`author` trên WS KHÔNG có `avatarUrl`».

### 4.6 FE (lát B)

- Helper `avatarSrc(v)` ở `apps/app/src/routes/social/feed/lib/feed-format.ts`: trả `v` chỉ khi khớp `/^https?:\/\//i`, còn
  lại `undefined` (KHÔNG phải che dữ liệu — che là việc của server; đây là vệ sinh render để FE không bao giờ vẽ fileId làm URL
  tương đối, và để thứ tự deploy FE-tự-động / API-thủ-công vô hại — D8).
- Bật `src={avatarSrc(...)}`: `KudosBlock.tsx:87` · `KudosComposerFields.tsx:100` (chip) + `:268` (ứng viên) · `NewsPage.tsx:221`
  (D4). Đi qua helper ở 5 chỗ đang có `src`: `PostCard.tsx:84` · `CommentList.tsx:67` · `BirthdayWidget.tsx:90` ·
  `GroupMembersTab.tsx:123` · `GroupRequestsTab.tsx:88`. `KudosThisMonthWidget` giữ CHỈ tên (D4) — sửa docblock `:6-7`.
- Sửa hộp 🔴 docblock `KudosBlock.tsx:9-13`, `KudosComposerFields.tsx:15`.

## 5. Test RED trước (deny-path đầu tiên)

**File mới** `apps/api/test/integration/social-avatarpresign-1.int-spec.ts` (gate `hasDb && LANE_DB`, boot
`applyMainPipeline`, parse response bằng schema contracts). Fixture: tenant A + B; `author` có avatar ĐÃ XÁC MINH `V_A`
(tệp image + link `ME/avatar` do chính mình tạo); `viewer` bị đầu độc (`avatar_url = V_A`); `jsP` (`javascript:alert(1)`),
`dataP` (`data:…`), `extP` (`https://cdn.example/a.png`), `foreignP` (= fileId ĐÃ XÁC MINH của người ở tenant B),
`unlinkedP` (ảnh của chính mình, KHÔNG link); `mgrDept` (`view:feed-report@Department`). Mọi khẳng định "vắng/null" đứng
SAU một neo dương trên cùng response.

| Ca             | Khẳng định                                                                                                                                                                                                                                                                                     | Đỏ trên code hiện tại vì                                   |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| **D-POISON**   | Ma trận 15 route (`003·001·002·004·006·014·015·013·022·026·037·047·059·028·029`): `viewer` ⇒ `avatarUrl === null`; neo: `author` ⇒ khớp `/X-Amz-Signature=/` VÀ `!== V_A`                                                                                                                      | `expected 'b3b2…' to be null` (fileId của `author`, đo M3) |
| **D-SCHEME**   | kudos người nhận `[jsP, dataP]` + `059` tìm `jsP` ⇒ `null`; neo `extP` ⇒ đúng chuỗi                                                                                                                                                                                                            | `expected 'javascript:alert(1)' to be null`                |
| **D-XTENANT**  | `foreignP` ⇒ `null`                                                                                                                                                                                                                                                                            | trả fileId thô                                             |
| **D-UNLINKED** | `unlinkedP` ⇒ `null`                                                                                                                                                                                                                                                                           | trả fileId thô                                             |
| **D-K1**       | người nhận có avatar xác minh: trước xoá mềm hồ sơ ⇒ URL ký (neo); sau ⇒ `null` + `isFormerEmployee:true`                                                                                                                                                                                      | neo đỏ: `expected 'b3b2…' to match /X-Amz-Signature=/`     |
| **D-REPORTER** | `mgrDept` gọi `028`: `reporter === null` VÀ không câu cổng avatar nào mang fileId avatar của reporter trong `values`; neo: có ĐÚNG 1 câu cổng (tác giả đích)                                                                                                                                   | neo đỏ: `expected 0 to be 1` (hôm nay không có câu cổng)   |
| **WS-POST**    | spy `emitFeedPostCreated`: `payload.author` KHÔNG có khoá `avatarUrl`; neo: response `002` `author.avatarUrl` khớp chữ ký                                                                                                                                                                      | `expected {…} not to have property "avatarUrl"`            |
| **WS-CMT**     | như trên với `emitFeedCommentCreated`                                                                                                                                                                                                                                                          | như trên                                                   |
| **T-CNT**      | Với mỗi route của ma trận: đo hai lượt cùng request — (a) avatar UUID có mặt, (b) `UPDATE employee_profiles SET avatar_url=NULL` cho tenant rồi khôi phục: `begin(a) === begin(b)`, `total(a) − total(b) === 1`, `gate(a) === 1`. Feed đo ở trang 3 và 12 thẻ (có kudos) ⇒ `gate === 1` cả hai | `expected 0 to be 1` (gate), M6                            |
| **T-ZERO**     | trang chỉ có avatar `null`/`https://…` ⇒ `gate === 0`                                                                                                                                                                                                                                          | xanh từ đầu — ca canh hồi quy (ký vô cớ)                   |

**Unit** `apps/api/src/social/social-avatar-signer.spec.ts`: rỗng ⇒ không gọi presign · trùng `employeeId` ⇒ 1 subject ·
`employeeId`/`raw` null bị bỏ · `toHaveBeenCalledWith(c, subjects, tx)` · `urlOf(null)`/id lạ ⇒ `null` · giá trị trả về
`javascript:` (presign giả) ⇒ `null` + `logger.error`. RED: module chưa tồn tại (`Failed to load`) — đọc dòng «Test Files».

**Cấu trúc** `apps/api/src/social/social-avatar-sign-structure.spec.ts` (tĩnh, đọc nguồn `src/social/*.ts` không spec):

- S1: đúng **12** dòng chứa `(employeeProfiles|r\w*Emp)\.avatarUrl`, mỗi dòng có khoá khớp `/\b\w*(AvatarRaw|avatarRaw)\s*:/`. RED: `authorAvatarUrl`/`avatarUrl`/`avatar`.
- S2: 0 dòng khớp `/\b(avatarUrl|avatar)\s*:\s*[\w.?]*[aA]vatarRaw\b/` (thô đi thẳng vào khoá DTO).
- S3: `resolveEmployeeAvatars(` xuất hiện ĐÚNG 1 lần, trong `social-avatar-signer.ts`, lời gọi có 3 đối số. RED: 0 lần.

**Contracts** `packages/contracts/src/social-ws.spec.ts` (+2 ca): `.parse` của cả hai schema WS với `author.avatarUrl:"https://signed"` ⇒
`Object.keys(out.author)` = `["employeeId","fullName"]`. RED: còn `avatarUrl`.

**Sửa có chủ đích** `social-be2d-blocks-recipients.int-spec.ts` B1+B2: `AV` ngẫu nhiên ⇒ kỳ vọng `null`; thêm người nhận có
avatar xác minh ⇒ khớp chữ ký. `social.mapper.spec.ts` / `social-post-blocks.spec.ts`: fixture `avatarRaw` + `avatars` giả.

**FE** (lát B, `pnpm --filter @mediaos/app exec vitest run src/routes/social`):

- `KudosBlock.spec.tsx:118` thay bằng: `avatarUrl:"https://x.invalid/p.png"` ⇒ `getByRole("img",{name})` có `src` đó; `null` ⇒ không `img`; fileId ⇒ không `img`. RED: «Unable to find role img».
- `KudosPage.spec.tsx:123-128` · `KudosComposerFields.spec.tsx:115-123` (ứng viên + chip) — tương tự. `:207-218` (widget) GIỮ không `img`.
- `PostCard` · `CommentList` · `FeedWidgets` (sinh nhật, khoá `avatar`) · `GroupAdminTabs` (members + requests) · `NewsPage` (đã đọc): URL https ⇒ `img src`; UUID thô ⇒ KHÔNG `img`. RED ở vế UUID (hôm nay vẽ `<img src="<uuid>">`) và ở `NewsPage` (hôm nay không `src`).

**Mutant (cấy → ca nào đỏ, thông điệp nào; sao lưu bản vá trước khi cấy, KHÔNG `git checkout --`):**

| Mutant                                      | Đỏ ở                                       | Thông điệp kỳ vọng                                      |
| ------------------------------------------- | ------------------------------------------ | ------------------------------------------------------- |
| mapper `authorOf` trả `row.authorAvatarRaw` | S2 + D-POISON                              | `S2 … social.mapper.ts` · `expected 'b3b2…' to be null` |
| bỏ `tx` ở lời gọi `resolveEmployeeAvatars`  | S3 + unit (`toHaveBeenCalledWith`) + T-CNT | `expected 6 to be 5` (begin)                            |
| `028` thêm reporter vào refs vô điều kiện   | D-REPORTER                                 | `values` chứa fileId reporter                           |
| bỏ `.extend({author: wsFeedAuthorSchema})`  | contracts WS                               | `expected [ …, 'avatarUrl' ] to deeply equal …`         |
| bỏ bóc ở `emitPostCreated`                  | WS-POST                                    | `not to have property "avatarUrl"`                      |
| ký theo từng dòng (vòng `for` gọi `signTx`) | T-CNT                                      | `expected 12 to be 1`                                   |
| FE bỏ `src` ở `KudosBlock` / bỏ `avatarSrc` | spec FE tương ứng                          | «Unable to find role img» / «expected img to be null»   |

Không có đường GHI ⇒ không cần harness đua. Lệch đọc giữa tx `listFeed` và tx `decorate` (người đổi ảnh giữa hai tx) ⇒
cặp cũ có thể không còn link sống ⇒ `null` cho đúng request đó — fail-soft, chấp nhận, ghi ở docblock signer.

## 6. Quyết định owner

| #      | Câu hỏi                                                                                              | Phương án                                                                                            | Khuyến nghị + lý do                                                                                                                                                                                                               | Chặn?          |
| ------ | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| D1     | Ảnh là directory-class trên CẢ 10 trường (gồm nửa «chưa đọc» `022`, danh bạ `059`, sinh nhật `026`)? | (a) có · (b) loại `059`/`022`                                                                        | **(a)** — K4 đã ký cho «toàn module» (tiêu đề WO liệt kê đủ). Ký không mở rộng TẬP người được biết (tên đã chiếu sẵn); tiền lệ CHAT roster. Ghi nhận: `059` liệt kê được ⇒ ảnh của người `active` cũng liệt kê được (cùng lớp K2) | Không (đã K4)  |
| D2     | Passthrough `http(s)` (URL quản trị HR đặt)                                                          | (a) giữ chính sách dịch vụ dùng chung · (b) SOCIAL chỉ nhận fileId, bỏ mọi URL                       | **(a)** — `done_when` cho phép passthrough có lọc scheme, dịch vụ đã lọc (đo M4); đổi = sửa `foundation/**` (ngoài `paths`) và lệch HR/CHAT/TASK. Seed nợ siết đường ghi (M5)                                                     | Không          |
| D3     | Dạng bóc trên WS                                                                                     | (a) VẮNG khoá (`.omit`) · (b) `avatarUrl:null`                                                       | **(a)** — khuôn CHAT; FE chỉ đếm `post.created`, không nghe `comment.created` (M11)                                                                                                                                               | Không          |
| D4     | Phạm vi FE                                                                                           | bật `src` ở KudosBlock + composer + **NewsPage `022`** (ngoài `done_when`); widget tháng giữ CHỈ tên | **Có NewsPage** (cùng route đã được ký, chung `paths`); **widget giữ tên** — chưa từng có `Avatar`, thêm là đổi thiết kế                                                                                                          | Không          |
| D5     | Siết contract `avatarUrl: z.string().url()`                                                          | (a) giữ `z.string()` · (b) `.url()`                                                                  | **(a)** — FE parse response; một giá trị lệch sẽ ZodError TRẮNG cả trang. Hình dạng ép ở BE (signer + int-spec)                                                                                                                   | Không          |
| D6     | URL TTL 300 s + `Avatar` không `onError` (M10/M13) ⇒ ảnh vỡ khi ngồi >5′ rồi cuộn (lazy)             | (a) chấp nhận + seed nợ fallback `onError` ở `packages/ui` · (b) xin TTL riêng cho avatar            | **(a)** — y hệt HR/CHAT/TASK hôm nay; sửa ở `packages/ui` (ngoài `paths`) lợi cho mọi module                                                                                                                                      | Không          |
| D7     | SPEC-16 SOC-DEC-013 (dòng 610) còn ghi «avatar giữ cột thô»                                          | (a) thêm `docs/spec/**` vào `paths` sửa 1 dòng · (b) để docs-only sau                                | **(a)** — tránh drift spec ↔ code                                                                                                                                                                                                 | Không          |
| **D8** | Thứ tự deploy: FE tự deploy khi merge, API PROD thủ công                                             | (a) helper `avatarSrc` + MỘT PR · (b) tách PR FE, chỉ merge sau khi owner deploy API ≥ lát A         | **(a)** — với helper, FE trước API ⇒ chữ cái đầu (tốt hơn ảnh vỡ hôm nay); FE sau API ⇒ ảnh. Không phụ thuộc thứ tự deploy                                                                                                        | **CÓ — lát B** |

## 7. Ngoài phạm vi / nợ đề xuất seed

- **N1** — siết đường ghi `avatarUrl` (`employees.ts:88/106` nhận `javascript:`/`data:`/`http:` — M5): chỉ fileId hoặc `https:` (WO HR).
- **N2** — `Avatar` (`packages/ui`) `onError` ⇒ rơi về chữ cái đầu (D6) — lợi cho HR/CHAT/TASK/SOCIAL.
- **N3** — đếm trên PROD số hồ sơ có `avatar_url` UUID mà KHÔNG có link `ME/avatar` sống (sẽ thành chữ cái đầu sau WO). Không đo được trong WO (cấm chạm DB PROD); owner chạy câu đọc.
- **N4** — `social-posts.service.ts` đã 904 dòng (>800, không cổng nào ép): tách `decorate`/`emit*` ra file riêng.
- **N5** — ảnh nhóm (`feed_groups.avatar_file_id`, L-c) — tính năng riêng, không đụng.
- Không đổi: `AvatarPresignService`/`findVerifiedAvatarsTx` (foundation), TTL, route, quyền, mã lỗi, migration.

## 8. Thứ tự thi công + lệnh verify

Runner: `R='bash "/c/Users/fmcai/AppData/Local/Temp/claude/c--dev-2-MediaOS/570ccaa2-c81b-4241-ac3f-671f4c986cb3/scratchpad/run-lane-vitest.sh" "/c/dev 2/MediaOS-avatarpresign" avatarpresign'`.

**Lát A — BE + contracts + docs (FULL gate)**

1. RED: viết int-spec mới + unit signer + spec cấu trúc + 2 ca contracts WS → `$R test/integration/social-avatarpresign-1.int-spec.ts src/social/social-avatar-signer.spec.ts src/social/social-avatar-sign-structure.spec.ts` + `pnpm --filter @mediaos/contracts exec vitest run src/social-ws.spec.ts` — xác nhận đỏ ĐÚNG thông điệp §5 (đọc «Test Files»: file signer phải ĐỎ vì không nạp được, không «0 test»).
2. Contracts: `wsFeedAuthorSchema` + docblock → `pnpm --filter @mediaos/contracts build` (tránh `dist` cũ làm typecheck đỏ oan) → contracts spec xanh.
3. `SocialAvatarSigner` + provider → unit xanh.
4. Đổi tên khoá repository (§4.2) → `pnpm --filter @mediaos/api typecheck` liệt kê điểm cần sửa.
5. Sửa từng điểm §4.3 (ký trong tx sẵn có) + mapper + post-blocks + `social-news-noti-cap.spec.ts`.
6. Bóc WS ở nguồn.
7. Sửa B1+B2, mapper/post-blocks spec.
8. Docs: API-19 §5.1l/§6.1/§7 + (D7) SPEC-16 dòng 610.
9. Một lượt cho cả module: `$R --no-file-parallelism social avatar-presign` (lọc theo chuỗi con của đường dẫn — nhặt `src/social/*.spec.ts` + `test/integration/social-*.int-spec.ts` + `avatar-presign*`, kèm cả spec của `src/integrations/social/` — thừa, vô hại); `cd apps/api && pnpm exec vitest run test/foundation/identity-projection-ratchet.unit-spec.ts`; mutant §5.
10. `pnpm typecheck` · `pnpm lint` · FULL gate.

**Lát B — FE (react-reviewer + typescript-reviewer)**

11. RED spec FE §5 → `pnpm --filter @mediaos/app exec vitest run src/routes/social` đỏ đúng chỗ.
12. `avatarSrc` + 9 chỗ `Avatar` + docblock → xanh; `pnpm --filter @mediaos/app typecheck`.

**Trước PR:** `bash harness/check.sh --all --lane-db=avatarpresign` (REQUIRE_LANE_DB — int-spec skip vượt ngưỡng = ĐỎ).

## 9. Rủi ro + kích thước

| #   | Rủi ro                                                        | Giảm thiểu                                                  |
| --- | ------------------------------------------------------------- | ----------------------------------------------------------- |
| R1  | `social-posts.service.ts` 904 dòng — thêm vào file quá trần   | ≤ +6 dòng; logic ở signer; nợ N4                            |
| R2  | Ảnh vỡ sau 5′ (TTL 300 s, lazy, không `onError`, `gcTime 5'`) | D6/N2; cùng hành vi HR/CHAT/TASK                            |
| R3  | FE tự deploy trước API thủ công                               | D8 helper `avatarSrc`                                       |
| R4  | Hồ sơ cũ có fileId không link ⇒ chữ cái đầu                   | Đúng thiết kế self-defending; N3 đếm PROD                   |
| R5  | `029` ký dưới khoá hàng                                       | +1 câu đọc không khoá + HMAC cục bộ; `lock_timeout` 5 s sẵn |
| R6  | Phát lại `@Idempotent` (`002`/`015`) trả URL ký cũ            | Cùng lớp `attachments[].url` hôm nay; TTL ngắn              |
| R7  | Lọt reporter ẩn vào lô ký                                     | refs dựng SAU quyết định che + ca D-REPORTER đọc `values`   |
| R8  | URL ký chứa `companyId/files/<fileId>` (M4)                   | Không rộng hơn hôm nay (fileId đang lộ thô)                 |
| R9  | Spec cấu trúc regex giòn                                      | Thông điệp in file:dòng + cách sửa; đếm 12 nâng có chủ đích |
| R10 | Ratchet danh tính                                             | Đổi tên trong hàm cũ giữ khoá; chạy lại bước 9              |

**Kích thước:** ~28 file. BE src ~+260/−60 (1 file mới + 18 sửa) · contracts ~+40 · docs ~+30 · test BE ~+900 (1 int-spec
mới ~23 ca, unit signer ~8 ca, cấu trúc 3 ca, contracts +2, sửa 4 spec) · FE src ~+35 (10 file) · test FE ~+160 (~14 ca).
Lát A ≈ 75% công; lát B ≈ 25%. Một PR, hai commit lát (D8a); nếu owner chọn D8b thì hai PR.
