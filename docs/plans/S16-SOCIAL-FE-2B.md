# S16-SOCIAL-FE-2B — FE track B / lát B: SOC-SCREEN-006 Nhóm

> Trạng thái: **plan v2 (29/09/2026)** — `plan-reviewer` lượt 1 BLOCK (2 HIGH · 7 MEDIUM), đã vá ở **§8** (GHI ĐÈ §2–§5). Nhánh `feat/s16-social-fe-2b` cắt từ
> master `4a0d7f80` (sau #551 lát A). Zone amber, gate LIGHT (owner chọn: `plan-reviewer` + LIGHT).
> Quyền chỉ qua `useCan`/`PermissionGate` + vai trò nhóm LẤY TỪ DTO (`myRole`/`myStatus`).
> Owner ký 29/09/2026: **O1** nhóm kín có link mời + nút xin vào · **O2** sửa cả 2 link NOTI hỏng
> trong WO này · **O3** mức review `plan-reviewer` + LIGHT.

## 0. Phạm vi

Làm: danh sách nhóm (`/feed/groups`) · trang nhóm (`/feed/groups/$groupId` = header + tab Bài viết
(feed `?groupId`) / Thành viên / Yêu cầu / Cài đặt) · xin vào / huỷ yêu cầu / rời nhóm · duyệt/từ
chối · đổi vai trò (gồm phong chủ nhóm = đường chuyển owner) · mời ra · sửa/xoá nhóm · tạo nhóm ·
composer `audience='group'` trên trang nhóm · widget «Nhóm của tôi» rail phải (KHÔNG badge) · link
mời nhóm kín (O1) · 2 route chuyển hướng cho link NOTI (O2).

KHÔNG làm (ghi nợ §7): badge bài mới theo nhóm (chờ `BE-2C`) · tên nhóm trên thẻ bài ngoài trang nhóm
(DTO bài chỉ có `groupId`) · ảnh đại diện/ảnh bìa nhóm · báo chủ nhóm khi có yêu cầu mới · mọi sửa
`apps/api` (ngoài `paths`).

## 1. Phép đo (29/09/2026 trên `4a0d7f80`; workflow đọc 5 mảng + critic, trích nguyên văn ở §1.b)

### 1.a Hình dạng response 030..039 (done_when #4)

| Route | BE trả (`social-groups.service.ts`) | Schema contracts | Khớp |
| --- | --- | --- | --- |
| 030 GET `/social/groups` | `{data: FeedGroupDto[], page, limit, total}` `:78` | `feedGroupPageSchema` | ✅ (envelope bọc 1 lớp, `apiFetch` bóc đúng 1 lớp) |
| 031 POST · 032 GET · 033 PATCH · 035 POST join | `FeedGroupDto` (`toFeedGroupDto` `:619-630`) | `feedGroupSchema` | ✅ `createdAt` = `toISOString()` (Z) |
| 034 DELETE | `{deleted: true}` `:186,208` | **VẮNG** | web-core `feedDeletedResultSchema` khớp |
| 036 POST leave | `{left: true}` `:259,298`, HTTP **201** | **VẮNG** | cần schema mới |
| 037 GET members | `{data: FeedGroupMemberDto[], page, limit, total}` `:320` | `feedGroupMemberPageSchema` | ✅ |
| 038 PATCH member | `{userId, role, status}` `:431,499,517` | `feedGroupMemberMutationSchema` | ✅ |
| 039 DELETE member | `{deleted: true}` `:440,478` | docblock contracts `:187-189` KHAI SAI là `feedGroupMemberMutationSchema` | ❌ parse bằng schema đó = ZodError SAU KHI đã mời ra thật |

Schema đọc KHÔNG `.strict()` ⇒ trường thừa phía BE không vỡ. Hai query (`030`/`037`) `.strict()` ⇒
khoá lạ = 400.

### 1.b Hành vi nền tảng (đổi thiết kế FE)

| # | Đo | Kết quả | Hệ quả FE |
| --- | --- | --- | --- |
| M1 | Mã lỗi SOCIAL trên dây | Service ném CHUỖI ⇒ `error.code` chung (`RESOURCE-ERR-CONFLICT`/`-NOT-FOUND`/`AUTH-ERR-FORBIDDEN`); mã `SOCIAL-ERR-0xx` CHỈ ở đầu `message` (`all-exceptions.filter.ts:99-107`). `ApiError.message` giữ nguyên chuỗi (`api-client.ts:189-194`) | done_when #1 (ERR-015 hiện lý do) buộc đọc tiền tố `message`. 409 của `038` = ERR-013 **hoặc** ERR-015 ⇒ status một mình KHÔNG đủ |
| M2 | Danh mục lỗi nhóm (`social.errors.ts:151-214`) | 012 (404) · 013 ×2 nghĩa (409: đã có hàng / lệch trạng thái) · 014 (403) · 015 (409) · `GROUP_NAME_TAKEN` 409 **không số** · `GROUP_MEMBER_NOT_FOUND` 404 **không số** | bảng ánh xạ D3 |
| M3 | `032` với nhóm kín, actor không active (không hàng / `pending`) | **404 ERR-012**; nhóm đã xoá mềm ⇒ 404 cả với chủ cũ; `manage:feed-group` ⇒ 200 | màn 404 lấy từ `032` |
| M4 | `001 ?groupId=<nhóm kín>` khi không phải thành viên | **200 `data:[]`**, không 404; `manage` KHÔNG nới đọc bài | feed không phân biệt «kín» với «rỗng» ⇒ `032` quyết định, feed chỉ chạy khi `canReadPosts` |
| M5 | `030 membership=all` | `public ∪ nhóm có hàng (active HOẶC pending)`; `manage` ⇒ mọi nhóm sống; `mine` = CHỈ active | hàng `private + pending` KHÔNG được link sang trang nhóm (sẽ 404) |
| M6 | `035` join | public ⇒ `active` (+1) · private ⇒ `pending` (0) · đã có hàng ⇒ 409 ERR-013 · nhận UUID trần (không qua cổng thấy nhóm) | đường của link mời O1 |
| M7 | `036` leave | pending ⇒ huỷ yêu cầu · chủ cuối ⇒ 409 ERR-015 · không hàng ⇒ 404 `GROUP_MEMBER_NOT_FOUND` · trả `{left:true}` 201 | «Huỷ yêu cầu» = 036 |
| M8 | `037` | active member bất kỳ vai hoặc `manage`; public + không active ⇒ **403 ERR-014**; lọc nhân sự nghỉ việc (INNER JOIN); `status` optional ⇒ không truyền = LẪN pending | tab Thành viên gửi `status:'active'`, tab Yêu cầu gửi `status:'pending'` |
| M9 | `038` | owner/admin/manage; cấp `owner` chỉ owner hoặc `viaManage`; admin HẠ/MỜI RA được owner (trừ chủ cuối) ; phong owner KHÔNG hạ người phong (nhiều owner cùng lúc) | chuyển owner = phong người khác rồi tự đổi vai của mình |
| M10 | Kẽ BE (critic B5) | admin ĐANG active + có `manage` ⇒ `assertGroupRoleTx` trả `viaManage:false` ⇒ cấp `owner` bị 403 | FE soi gương: `canGrantOwner = role==='owner' \|\| (canManage && role!=='admin')`; ghi nợ BE §7 |
| M11 | `033` | owner/admin/manage; tên trùng (không phân biệt hoa thường, nhóm sống) ⇒ 409 không số; đổi `private→public` KHÔNG tự duyệt `pending` | form cài đặt |
| M12 | `034` | **owner một mình** hoặc manage (admin 403); xoá mềm; không có route khôi phục; bài trong nhóm biến khỏi mọi đường đọc (trừ tác giả) | hộp xác nhận ghi «không khôi phục được» |
| M13 | Idempotency | `@Idempotent` ở 031/035/036, header **tuỳ chọn** (`idempotency.interceptor.ts:69-70`); cache theo `company+user+method+path+key`, TTL 900 s, phát lại response cũ | xem D2 — khoá suy-từ-nội-dung làm HỎNG join→leave→join |
| M14 | Retry | `main.tsx:34` `mutations: {retry:false}`; `apiFetch` không tự thử lại | khoá idempotency ở FE không chống được gì cho toggle 035/036 |
| M15 | Đăng bài vào nhóm (`social-access.service.ts:715-731`) | chỉ `active` (mọi vai); `pending`/không hàng ⇒ 403 ERR-002 (public) hoặc 404 ERR-012 (kín); `manage` KHÔNG giúp | composer chỉ khi `myStatus==='active'` |
| M16 | Bình luận/cảm xúc bài nhóm public | người KHÔNG phải thành viên VẪN bình luận/thả cảm xúc được | không ẩn thanh tương tác theo membership |
| M17 | Realtime | `wsFeedPostCreatedEventSchema.audience = literal('company')`; `emitPostCreated` bỏ bài nhóm | trang nhóm KHÔNG gắn `useFeedRealtime`/`NewFeedPostsBadge` (done_when #3) |
| M18 | Link NOTI | template `'/social/groups/{group_id}'` ×1 · `'/social/posts/{post_id}'` ×7 · `'/social/reports'` ×1 (migrations); `/social` là route KHỚP ĐÚNG (SSO fbpost, `router.tsx:3040`) ⇒ cả 8 link rơi vào catch-all 404 | O2: 2 route chuyển hướng; `/social/reports` thuộc FE-3 (§7) |
| M19 | FE hiện có | `socialApi` 0 hàm nhóm · `socialKeys` 0 nhánh `groups` · `FeedComposer` cứng `audience:'company'` (`:130,:138`) · `SOCIAL_SIDEBAR_V2` đã khai `social.groups` `/feed/groups` (prune cắt) · 0 `AlertDialog`/`DropdownMenu` ở `@mediaos/ui` ⇒ dùng `@/components/ConfirmDialog` (import, không sửa) | — |
| M20 | Ô nhớ màn | `ProtectedRoute` chỉ gác `view:feed` ⇒ 404 nhóm render TRONG trang; `use-current-route-meta` khớp tiền tố dài nhất ⇒ `/feed/groups/<id>` lấy meta `/feed/groups` | route chi tiết vẫn cần meta riêng (title) |
| M21 | `social-wiring.spec.ts` | `:40-53` ghim V2=6/registered=5 + `not.toContain("social.groups")` · `:88` «8 route» · `:114-123` tập `showInSidebar` | T9 sửa theo; khi mọi mục V2 đã dựng, ca «prune THỰC SỰ cắt» mất vế đối chứng ⇒ thêm `prune-unbuilt.spec.ts` |
| M22 | `paths` WO | KHÔNG có `packages/ui/**`, `apps/app/src/components/**`, `apps/app/src/hooks/**`, `apps/api/**` | import được, không sửa được |

## 2. Quyết định

- **D1 — Contracts** (`social-api-groups.ts`): thêm `feedGroupLeftResultSchema = z.object({ left:
  z.literal(true) })` (KHÔNG `.strict()` — khuôn response; `literal(true)` vẫn bắt BE trả sai) +
  type. Sửa docblock `feedGroupMemberMutationSchema` (bỏ «cho cả `039`», ghi `039`/`034` trả
  `{deleted:true}`). Sửa docblock cũ `social-api.ts:356-357` («`audience='group'` từ chối ở SERVICE»
  — sai từ BE-2A). KHÔNG neo kiểu BE (ngoài `paths`) — ghi nợ §7; web-core spec parse payload thật.
- **D2 — Client** `packages/web-core/src/lib/social-groups-api.ts` (file MỚI, giữ `social-api.ts`
  < 400 dòng): `socialGroupsApi = { list, create, get, update, remove, join, leave, listMembers,
  decideMember, removeMember }`, parse bằng schema §1.a (034/039 dùng `feedDeletedResultSchema`).
  Idempotency:
  - `create` → `idempotencyKeyFor("social-group-create", body)` (khuôn `createPost`). Giới hạn đã
    biết: tạo X → xoá X → tạo lại X đúng thân trong 15 phút ⇒ server phát lại nhóm đã xoá ⇒ trang
    nhóm 404. Chấp nhận (hiếm, không mất dữ liệu), ghi docblock.
  - `join`/`leave` → **KHÔNG gửi khoá**. Lý do đo được: (i) đây là TOGGLE — khoá suy từ `{groupId}`
    làm join→leave→join trong 15 phút nhận lại 201 CŨ mà **không tạo hàng** (M13), hỏng im lặng; (ii)
    mutation không retry, `apiFetch` không retry (M14) ⇒ khoá không chống được gì; (iii) trùng lặp đã
    có luật nghiệp vụ chặn (409 ERR-013 / 404) + nút khoá khi đang gửi. Đây là NGOẠI LỆ có chủ ý của
    memory «khoá phải suy từ nội dung» — ghi docblock + ca W1 ghim `idempotencyKey === undefined`.
  - `update`/`remove`/`decideMember`/`removeMember`: BE không `@Idempotent` ⇒ không khoá.
  - `socialKeys.groups = { allOf, list(params), detail(groupId), members(groupId, params) }`. Feed
    nhóm dùng `socialKeys.feed.list({ groupId, sort })` ⇒ nằm dưới `feed.allOf()` đã được invalidate
    sẵn bởi đăng/xoá/ẩn bài.
- **D3 — Ánh xạ lỗi** `routes/social/groups/lib/group-errors.ts` (hàm thuần):
  `socialErrorCode(err): string | null` = tiền tố `^SOCIAL-ERR-(\d{3}):` của `ApiError.message`
  (null với lỗi không phải `ApiError`/ZodError/chuỗi khác). `groupErrorReason(action, err)` →
  `"lastOwner"` (ERR-015) · `"alreadyRequested"` (ERR-013 ở `join`) · `"stateChanged"` (ERR-013 ở
  action khác, hoặc 404 không mã số ở 036/038/039 = người đó không còn hàng) · `"groupGone"` (ERR-012)
  · `"nameTaken"` (409 ở `create`/`update` mà `code` KHÔNG bắt đầu `REQUEST-ERR-IDEMPOTENCY` — suy
  theo NGỮ CẢNH route, không đọc câu chữ không số) · `null` (⇒ banner forbidden/generic như cũ).
  `ActionErrorBanner` thêm prop tuỳ chọn `reason?` (thắng `forbidden`/`generic`, render
  `actionError.reason.<reason>`, `data-reason`) + kind mới `groupJoin · groupLeave · groupCreate ·
  groupUpdate · groupDelete · memberDecide · memberRole · memberRemove`. Fixture test dùng CHUỖI THẬT
  của BE (`new ApiError(409, "RESOURCE-ERR-CONFLICT", "SOCIAL-ERR-015: …")`), chú thích dòng
  `social.errors.ts`. Lưới phía BE giữ định dạng tiền tố: `social-error-code-census.spec.ts`.
- **D4 — Năng lực theo vai** `groups/lib/group-capabilities.ts` (hàm thuần, MỘT chỗ duy nhất soi gương
  cổng BE, từng dòng trích `social-groups.service.ts`). Đầu vào `{group: FeedGroupDto, canManage}`;
  `role = myStatus==='active' ? myRole : null` (hàng `pending` luôn `myRole:'member'` — CHECK DB — nên
  đọc `myRole` thiếu `myStatus` là coi người chờ duyệt như thành viên):
  | Cờ | Công thức | Cổng BE |
  | --- | --- | --- |
  | `canEdit` | role∈{owner,admin} ∨ canManage | `:144-148` |
  | `canDelete` | role=owner ∨ canManage | `:190-191` |
  | `canModerate` (duyệt/từ chối/đổi vai/mời ra) | role∈{owner,admin} ∨ canManage | `:343-368`, `:444-448` |
  | `canGrantOwner` | role=owner ∨ (canManage ∧ role≠admin) | `:404-406` + kẽ M10 |
  | `canListMembers` | role≠null ∨ canManage | `:316-317` |
  | `canReadPosts` | visibility=public ∨ role≠null (**manage KHÔNG**) | predicates `:67-89` |
  | `canPost` | role≠null | M15 |
  | `canJoin` | myStatus=null ∧ public | M6 |
  | `canRequestJoin` | myStatus=null ∧ private | M6 |
  | `canCancelRequest` | myStatus=pending | M7 |
  | `canLeave` | role≠null (chủ cuối vẫn bấm được — BE quyết, FE hiện lý do; KHÔNG đếm owner phía client vì `037` giấu người nghỉ việc còn BE đếm cả họ) | M7 |
  | `canCopyInvite` | role∈{owner,admin} ∨ canManage | O1 |
  | `isManageViewer` | canManage ∧ role=null ∧ private (thấy nhóm, không đọc/đăng bài) | M3/M4 |
  `canOpenGroup(group, canManage)` = ¬(private ∧ myStatus≠active ∧ ¬canManage) — dùng cho link hàng
  danh sách. `canManage = useCan("manage","feed-group")` (bỏ qua scope; seed chỉ cấp Company — cùng
  đánh đổi `PostCardMenu.tsx:49-51`, ghi docblock).
- **D5 — Route + registry**: `social.groups` `/feed/groups` SOC-SCREEN-006 order 100 `showInSidebar`
  · `social.groupDetail` `/feed/groups/$groupId` SOC-SCREEN-006 order 101 (không sidebar);
  `requiredPermissions:["view:feed"]`, `MODULE_PORTAL`, `moduleCode:"SOCIAL"`; khai `createRoute`
  TRỰC TIẾP (literal cho `<Link params>`). `validateSearch` rơi về mặc định, không ném: danh sách
  `{membership:'all'|'mine', q?, page}`; chi tiết `{tab:'posts'|'members'|'requests'|'settings',
  invite?: true}`. i18n `routeTitle.socialGroups` / `socialGroupDetail` (`web-core/.../nav.ts`). Mục
  sidebar `social.groups` tự hiện qua prune (M19).
- **D6 — Màn danh sách** `groups/GroupsPage.tsx`: tab «Tất cả» / «Nhóm của tôi» (→ `membership`), ô
  tìm (trim; rỗng ⇒ bỏ khoá `q`), `OffsetPager`, loading/error+thử lại/empty (empty riêng cho `mine`
  và cho kết quả tìm). Hàng: tên (link chỉ khi `canOpenGroup`) · nhãn Công khai/Riêng tư ·
  `memberCount` · mô tả rút gọn · nút theo `myStatus`: null+public «Tham gia» · null+private «Gửi yêu
  cầu» (chỉ tới được với `manage`) · pending «Đang chờ duyệt» + «Huỷ yêu cầu» · active nhãn «Đã tham
  gia». «Tạo nhóm» bọc `PermissionGate create:feed-group` → `CreateGroupDialog`.
- **D7 — `CreateGroupDialog`**: tên (trim 1–255) · mô tả (trim ≤2000, rỗng ⇒ BỎ khoá) · chế độ
  (radio, bắt buộc, mặc định `public`). Payload qua `createFeedGroupSchema.safeParse` trong test. 409
  `nameTaken` ⇒ lỗi dưới ô tên, giữ nguyên dữ liệu. Thành công ⇒ invalidate `groups.allOf()` +
  `navigate` tới trang nhóm vừa tạo.
- **D8 — Trang nhóm** `groups/GroupPage.tsx` (vỏ) + `components/` tách file:
  - `$groupId` không phải UUID ⇒ `GroupNotFound` NGAY, không gọi API (ParseUUIDPipe trả 400, không 404).
  - `032` với `retry` bỏ qua 404 (khuôn `PostDetailPage.tsx:78`). `ApiError` 404 ⇒ `GroupNotFound`;
    lỗi khác (kể cả ZodError) ⇒ khối lỗi + «Thử lại» — KHÔNG gộp hai nhánh.
  - `GroupNotFound`: chữ TRUNG TÍNH, không nhắc «quyền»/«riêng tư»/«đã xoá» (không dùng lại
    `detail.notFoundBody` vì câu đó có «không còn quyền xem»). Có `?invite=1` ⇒ thêm câu «Nếu bạn
    được mời…» + nút «Gửi yêu cầu tham gia» → `035` → 201 ⇒ «Đã gửi yêu cầu, bạn sẽ nhận thông báo khi
    được duyệt» · 409 ⇒ `alreadyRequested` («Bạn đã gửi yêu cầu, đang chờ duyệt») · 404 ⇒ `groupGone`.
    Câu + nút phụ thuộc DUY NHẤT tham số URL (giống hệt nhau với UUID không tồn tại) ⇒ không oracle
    trước khi bấm; sau khi bấm, oracle chỉ mở cho người đã cầm UUID 122-bit — BE đã chấp nhận
    (`social-groups.repository.ts:153-155`).
  - `GroupHeader`: tên · nhãn chế độ · «N thành viên» (`memberCount` — KHÔNG so với `total` của 037,
    M8) · mô tả · nhãn vai của tôi · nút: Tham gia / Gửi yêu cầu / Huỷ yêu cầu / Rời nhóm (theo D4) ·
    «Sao chép link mời» (`canCopyInvite`): `navigator.clipboard.writeText(url)`, url = `origin +
    /feed/groups/<id>` + (`?invite=1` khi private); hỏng/không có clipboard ⇒ hiện ô chỉ-đọc chứa url
    + lời nhắn tự sao chép (không hỏng im lặng). Rời nhóm: `ConfirmDialog`; thành công ⇒ private ⇒
    `navigate('/feed/groups', replace)` (trang sẽ 404), public ⇒ ở lại, refetch.
  - Tab (`?tab`, sai ⇒ `posts`; tab không đủ năng lực ⇒ rơi về `posts`): **Bài viết** luôn có;
    **Thành viên** khi `canListMembers`; **Yêu cầu** khi `canModerate`; **Cài đặt** khi `canEdit`.
- **D9 — Tab Bài viết** `GroupPostsTab`: `canPost` ⇒ `FeedComposer groupId={id}`; `isManageViewer` ⇒
  khối trạng thái riêng («Bạn đang xem nhóm riêng tư với quyền quản trị; bài viết chỉ hiện với thành
  viên») và **KHÔNG gọi `001`**; `canReadPosts` ⇒ `useInfiniteQuery` `socialKeys.feed.list({groupId,
  sort:'newest'})` → `socialApi.listFeed({groupId, cursor})`, `enabled: groupQuery.isSuccess &&
  canReadPosts`, `FeedPostList` + `useFeedActions` + `ActionErrorBanner` (khuôn `ProfilePostsPage`).
  Public + chưa tham gia ⇒ gợi ý «Tham gia nhóm để đăng bài». Empty «Nhóm chưa có bài» (+ lời mời
  đăng khi `canPost`). KHÔNG `useFeedRealtime`, KHÔNG `NewFeedPostsBadge` (M17).
- **D10 — Composer nhóm**: `FeedComposer` thêm prop tuỳ chọn `groupId?: string` ⇒ `buildDto` đặt
  `audience:'group', groupId` cho MỌI loại (poll/idea/news/share); không truyền ⇒ y như cũ
  (`audience:'company'`, ca FeedPage `:323-339` giữ xanh; C4 = 4 nút giữ nguyên). Placeholder riêng
  `composer.groupPlaceholder`. Mutation đăng bài TÁCH khỏi `FeedPage` thành hook
  `feed/lib/use-create-post.ts` (onMutate dọn lỗi · onSuccess invalidate `feed.allOf` + polls/ideas
  theo loại + callback `onCreated` · onError ⇒ `{forbidden, reason}` qua D3: 404 ERR-012 ⇒
  `groupGone` + invalidate `groups.detail`) dùng chung cho FeedPage và tab Bài viết.
- **D11 — Tab Thành viên** `GroupMembersTab`: `037 {status:'active', page}` + `OffsetPager`. Hàng:
  avatar · tên (null ⇒ «Người dùng») · nhãn vai · ngày tham gia. `canModerate` ⇒ ô chọn vai (Thành
  viên/Quản trị viên + Chủ nhóm CHỈ khi `canGrantOwner`) → `038 {role}`; «Mời ra» → `ConfirmDialog` →
  `039`. Hàng của CHÍNH MÌNH (`useAuthStore` `user.id` = `userId`): KHÔNG có «Mời ra» (dùng Rời nhóm),
  VẪN đổi vai được (đường tự hạ sau khi chuyển owner). Gợi ý tĩnh: «Để chuyển quyền chủ nhóm: phong
  một thành viên làm Chủ nhóm, rồi đổi vai của bạn.» 409 ⇒ `lastOwner`/`stateChanged` qua D3.
- **D12 — Tab Yêu cầu** `GroupRequestsTab`: `037 {status:'pending', page}`; «Duyệt» → `038
  {decision:'approve'}` · «Từ chối» → `ConfirmDialog` → `038 {decision:'reject'}`. Empty «Không có
  yêu cầu nào». Chủ nhóm KHÔNG được báo khi có yêu cầu mới (M-docs D18) ⇒ tab tự kéo khi mở.
- **D13 — Tab Cài đặt** `GroupSettingsTab`: form tên/mô tả/chế độ nạp từ `032`; chỉ gửi trường ĐÃ ĐỔI
  (so sau chuẩn hoá: trim, mô tả rỗng ⇒ `null`); không đổi gì ⇒ nút Lưu khoá (tránh 400 body rỗng);
  đổi chế độ hiện ghi chú hệ quả (→ riêng tư: người ngoài mất quyền đọc bài; → công khai: yêu cầu đang
  chờ VẪN chờ duyệt — M11). 409 `nameTaken` ⇒ lỗi dưới ô tên. Thành công ⇒ `setQueryData(detail)` +
  invalidate `groups.list`. Vùng nguy hiểm «Xoá nhóm» chỉ khi `canDelete` → `ConfirmDialog` (ghi
  «không khôi phục được; bài viết trong nhóm sẽ không còn hiển thị») → `034` → invalidate
  `socialKeys.all` + `navigate('/feed/groups', replace)`.
- **D14 — Widget «Nhóm của tôi»** `feed/components/MyGroupsWidget.tsx` (khuôn `OpenPollsWidget`):
  `030 {membership:'mine', limit: MY_GROUPS_LIMIT=5}`, `enabled: canViewFeed`, empty, link «Xem tất
  cả» → `/feed/groups?membership=mine`. **KHÔNG badge** (done_when #3 — ghi rõ trong PR). Gắn vào
  `SocialPortalShell` sau `OpenPollsWidget`.
- **D15 — Ma trận invalidate** (mỗi dòng một ca spy):
  | Thao tác | Invalidate |
  | --- | --- |
  | tạo nhóm 031 | `groups.allOf()` |
  | sửa 033 | `setQueryData(groups.detail)` + `groups.list` (qua `groups.allOf()` trừ detail đã ghi) |
  | xoá 034 · rời 036 · mời ra 039 | `socialKeys.all` (quyền đọc bài nhóm đổi ⇒ Saved/News/polls/ideas/feed nhóm đều có thể đổi) |
  | xin vào 035 | `groups.allOf()` + `feed.allOf()` (public ⇒ giờ đăng được; pending ⇒ nhãn đổi) |
  | duyệt/từ chối/đổi vai 038 | `groups.allOf()` (memberCount · members · requests) |
  | đăng bài trong nhóm | như D10 (`feed.allOf()` ⇒ gồm feed nhóm) |
  | lỗi 409/404 bất kỳ ở trên | thêm `groups.allOf()` để màn hình tự hiện trạng thái thật |
- **D16 — Mọi `useMutation` mới có `onError`** → `ActionErrorBanner` (kind D3 + `reason`). Đo `grep -c
  onError apps/app/src/routes/social` trước/sau: tăng ĐÚNG số mutation mới.
- **D17 — Link NOTI (O2)** `routes/social/legacy-social-redirects.ts`: hai route
  `/social/groups/$groupId` → `/feed/groups/$groupId` và `/social/posts/$postId` → `/feed/posts/$postId`
  (`beforeLoad` ném `redirect({ to, params, replace: true })`, KHÔNG vào `ROUTE_REGISTRY` — ca
  `social-wiring` «mọi route SOCIAL dưới `/feed`» giữ nguyên). `socialRedirectRoute` `/social` KHÔNG
  đụng. Hàm `beforeLoad` export riêng để test thuần (ném `redirect` đúng `to`/`params`).
- **D18 — Nhãn trạng thái**: SPEC-01 §17 không có nhóm trạng thái cho vai/trạng thái thành viên/chế độ
  nhóm ⇒ khai ở i18n `groups.role.*` · `groups.status.*` · `groups.visibility.*` + map tone một chỗ
  (`group-labels.ts`), không rải literal.
- **D19 — Prune còn vế đối chứng**: `layouts/workspace/sidebar/prune-unbuilt.spec.ts` MỚI — mục giả
  path không có trong registry ⇒ bị cắt; mục có path ⇒ giữ. Ca `social-wiring:40-53` sửa thành «V2 =
  6 = registered» + trỏ sang spec mới cho vế cắt.

## 3. Các bước

| Bước | Việc | File |
| --- | --- | --- |
| T0 | backlog: FE-2B `paths` giữ nguyên (đủ), thêm `plan`, ghi done_when O1/O2; seed nợ BE `S16-SOCIAL-GROUPERR-1` (§7 N1+N2) | `harness/backlog.mjs` |
| T1 | D1 contracts + spec `social-api-groups.spec.ts` (K1) + sửa 2 docblock | `packages/contracts/src/social-api-groups.ts`, `social-api.ts` |
| T2 | D2 `socialGroupsApi` + `socialKeys.groups` + export index + spec W1 | `packages/web-core/src/lib/{social-groups-api,query-keys}.ts`, `index.ts` |
| T3 | D5 registry + nav i18n | `packages/web-core/src/lib/registry.ts`, `i18n/locales/vi/nav.ts` |
| T4 | D3 `group-errors` + D4 `group-capabilities` + D18 `group-labels` + spec (E1, G1) | `apps/app/src/routes/social/groups/lib/*` |
| T5 | `ActionErrorBanner` `reason` + kind mới; i18n khối `groups.*` + `actionError.*` | `feed/components/ActionErrorBanner.tsx`, `i18n/locales/vi/social.ts` |
| T6 | D10 `use-create-post` (tách từ FeedPage) + `FeedComposer groupId` + spec (FeedPage/FeedComposer giữ xanh) | `feed/lib/use-create-post.ts`, `FeedPage.tsx`, `FeedComposer.tsx` |
| T7 | D6 + D7 danh sách + tạo nhóm + spec (L1, C1) | `groups/GroupsPage.tsx`, `components/{GroupListRow,CreateGroupDialog}.tsx`, `lib/group-route-search.ts` |
| T8 | D8 + D9 trang nhóm, header, 404/mời, tab Bài viết + spec (D1, D2, P1) | `groups/GroupPage.tsx`, `components/{GroupHeader,GroupNotFound,GroupPostsTab}.tsx`, `lib/group-invite.ts` |
| T9 | D11 + D12 + D13 ba tab quản trị + spec (M1, R1, S1) | `components/{GroupMembersTab,GroupRequestsTab,GroupSettingsTab}.tsx` |
| T10 | D14 widget + `SocialPortalShell` + spec (W2; mock `socialGroupsApi` ở shell spec) | `feed/components/MyGroupsWidget.tsx`, `SocialPortalShell.tsx` |
| T11 | Router (2 route nhóm + D17) + `social-wiring` + D19 + snapshot sidebar regen `-u` (trích diff vào PR) | `router.tsx`, `routes/social/legacy-social-redirects.ts`, `social-wiring.spec.ts`, `layouts/workspace/sidebar/prune-unbuilt.spec.ts`, `__snapshots__/*` |
| T12 | `check.sh --quick` → `test:social-cov` (đọc số) → web-core + contracts test → `check.sh --all --lane-db=socialfe2b` → gate LIGHT → vá (mỗi vá có ca RED) → PR | — |

Commit theo lát: T0 · T1 · T2+T3 · T4+T5 · T6 · T7 · T8 · T9 · T10+T11.

## 4. Ca test bắt buộc (mỗi ca DENY đứng cạnh ca ALLOW)

- **K1** `feedGroupLeftResultSchema` nhận `{left:true}`, từ chối `{left:false}`/`{}`; `feedGroupSchema`
  parse mẫu đúng `toFeedGroupDto` (có `myRole:null,myStatus:null` và `pending`).
- **W1** 10 hàm: URL/method/body đúng + schema TRUYỀN VÀO `safeParse` payload thật (khuôn
  `social-api.spec.ts`); `list` bỏ `q` rỗng, giữ `membership`; `leave`/`removeMember`/`remove` parse
  đúng `{left}`/`{deleted}`; `create` khoá ổn định theo thân; **`join`/`leave` KHÔNG có
  `idempotencyKey`**; `decideMember` gửi đúng một trong hai dạng union.
- **G1** `groupCapabilities` — bảng vét cạn `myRole × myStatus × visibility × canManage`
  (hợp lệ theo CHECK: pending ⇒ member) so với cột D4; ca riêng: pending KHÔNG có quyền thành viên;
  `manage` KHÔNG mở `canReadPosts`/`canPost` ở nhóm kín; admin+manage KHÔNG `canGrantOwner`;
  `canOpenGroup` private+pending ⇒ false, +manage ⇒ true.
- **E1** `group-errors`: chuỗi BE thật → reason (015 ở 036/038/039 ⇒ `lastOwner`; 013 ở join ⇒
  `alreadyRequested`, ở 038 ⇒ `stateChanged`; 012 ⇒ `groupGone`; 409 create/update ⇒ `nameTaken`;
  409 mã `REQUEST-ERR-IDEMPOTENCY-*` ⇒ KHÔNG `nameTaken`); ZodError / `Error` thường / 500 ⇒ `null`.
- **L1** danh sách: loading · error + thử lại · empty (all / mine / tìm); đổi tab ⇒ query mang
  `membership`; `q` được trim; nút theo `myStatus` (4 trạng thái); hàng private+pending KHÔNG link;
  «Tạo nhóm» vắng khi không `create:feed-group` · hiện khi có; join/leave lỗi ⇒ banner (mutant bỏ
  `onError` phải ĐỎ).
- **C1** tạo nhóm: tên trống ⇒ khoá gửi; payload qua `createFeedGroupSchema.safeParse`; mô tả rỗng ⇒
  không có khoá; 409 ⇒ lỗi ô tên + giữ dữ liệu; thành công ⇒ navigate + invalidate.
- **D1** trang nhóm: `$groupId` không UUID ⇒ 404 và `get` 0 lần; 404 ⇒ `GroupNotFound` (KHÔNG
  `ForbiddenPage`, chữ không chứa «quyền»); 500 ⇒ khối lỗi (không 404); `invite=1` ⇒ nút → `join` →
  201 pending ⇒ thông báo đã gửi · 409 ⇒ `alreadyRequested` · 404 ⇒ `groupGone`; không `invite` ⇒
  không nút.
- **D2** header: bộ nút theo 5 hồ sơ (không hàng public · không hàng private-manage · pending · member
  · owner); rời nhóm 409 ERR-015 ⇒ đúng câu `lastOwner` (không phải khoá i18n thô); rời nhóm private
  thành công ⇒ navigate list; sao chép link: clipboard OK ⇒ báo đã chép, url có `?invite=1` khi
  private · clipboard ném ⇒ ô chỉ-đọc chứa url.
- **P1** tab Bài viết: active ⇒ composer, payload `createFeedPostSchema.safeParse` với
  `audience:'group', groupId`; public chưa tham gia ⇒ KHÔNG composer nhưng `listFeed({groupId})` CÓ gọi;
  manage-viewer nhóm kín ⇒ khối trạng thái riêng + `listFeed` 0 lần; không socket/badge (spy
  `getAppSocket` 0 lần); đăng bài 403 ⇒ banner forbidden; 404 ERR-012 ⇒ `groupGone`.
- **M1** tab Thành viên: gửi `status:'active'`; tab vắng khi không `canListMembers`; option «Chủ nhóm»
  chỉ khi `canGrantOwner`; hàng của tôi không «Mời ra»; mời ra → confirm → `removeMember`, parse
  `{deleted:true}`; 409 ERR-015 ⇒ `lastOwner`.
- **R1** tab Yêu cầu: `status:'pending'`; vắng khi không `canModerate`; duyệt/từ chối gửi đúng body;
  409 ⇒ `stateChanged` + invalidate.
- **S1** tab Cài đặt: chỉ trường đã đổi; không đổi ⇒ khoá Lưu; 409 ⇒ lỗi ô tên; «Xoá nhóm» vắng với
  admin, hiện với owner/manage; xoá → confirm → `remove` → navigate + invalidate `socialKeys.all`.
- **W2** widget: `canViewFeed=false` ⇒ `list` 0 lần; có ⇒ `membership:'mine', limit:5`; empty; không
  phần tử badge.
- **N1** `legacy-social-redirects`: `beforeLoad` ném `redirect` tới `/feed/groups/$groupId` /
  `/feed/posts/$postId` với đúng params, `replace:true`.
- **R2** `social-wiring`: 10 route; `social.groups` hiện sidebar, `social.groupDetail` không; mọi route
  `/feed` + `MODULE_PORTAL` + `view:feed`; snapshot sidebar +1 dòng đúng. **R3** `prune-unbuilt.spec`.
- **I1** ma trận D15: mỗi dòng một spy `invalidateQueries`/`setQueryData`.

## 5. Gate & kiểm

- Vòng: `bash harness/check.sh --quick`. Trước PR: `pnpm --filter @mediaos/app test:social-cov` (đọc
  số; mốc lát A 97.77/91.63/88.23) · `pnpm --filter @mediaos/web-core test` · `pnpm --filter
  @mediaos/contracts test` · `bash harness/check.sh --all --lane-db=socialfe2b` (2 flake có sẵn
  `S18-QA-CHECKALLFLAKE-1` — đỏ đúng 2 ca đó ⇒ chạy riêng xác nhận, báo owner).
- Gate LIGHT (owner O3): `typescript-reviewer` + `react-reviewer` trên diff; lăng kính thêm cho
  404-oracle + suy diễn quyền D4 nằm trong prompt reviewer (không thêm agent).
- Mutant tối thiểu (mỗi cái phải đỏ ĐÚNG ca, khớp thông điệp kỳ vọng): (1) bỏ `onError` ở leave ⇒ D2 ·
  (2) `canReadPosts` thêm `∨ canManage` ⇒ G1 + P1 · (3) `join` gửi khoá `idempotencyKeyFor` ⇒ W1 ·
  (4) gộp nhánh 404 vào khối lỗi chung ⇒ D1 · (5) bỏ vế `myStatus==='active'` khi tính `role` ⇒ G1.
  Sao lưu file trước khi cấy (memory `mutant-revert-git-checkout-wipes-uncommitted-fix`).

## 6. Rủi ro

- `FeedPage` bị tách mutation (D10) — rủi ro hồi quy chỗ `resetNewPosts` + `droppedMentionCount`;
  `FeedPage.spec` hiện có phải xanh NGUYÊN VẸN (không sửa ca cũ để cho xanh).
- `query-keys.ts` (1444) · `registry.ts` · `router.tsx` đã vượt trần 800 TỪ TRƯỚC — chỉ thêm khối nhỏ.
- `i18n/vi/social.ts` 405 dòng + khối nhóm (~130) — nếu vượt 600 thì tách `social-groups.ts` namespace
  con thay vì phình.

## 7. Nợ / ngoài phạm vi (ghi vào PR)

- **N1 (BE)** kẽ M10: admin active + `manage` không cấp được `owner` (`viaManage:false`). FE soi
  gương; sửa ở BE ⇒ nới `canGrantOwner` + ca G1.
- **N2 (BE)** mã SOCIAL chỉ ở `message` ⇒ FE đọc tiền tố (D3). Khuôn ROOM/ASSET đặt `code` vào payload
  — WO BE nên làm cho SOCIAL, khi đó D3 đổi sang `code`. (N1+N2 seed `S16-SOCIAL-GROUPERR-1`.)
- ✅ **ĐÃ TRẢ 29/09/2026 ở `S16-SOCIAL-GROUPERR-1`**: N1 (BE đọc `canManageGroups`, FE `canGrantOwner = isOwner ∨ canManage`) · N2 (mã SOCIAL lên `error.code`, D3 đọc `code` + giữ nhánh LEGACY-PREFIX một bản — owner ký O4).
- N3 badge bài mới theo nhóm ⇐ `S16-SOCIAL-BE-2C`.
- N4 tên nhóm trên thẻ bài ngoài trang nhóm (Saved/News/polls/ideas lẫn bài nhóm) ⇐ DTO bài cần
  `group:{id,name}` (`BE-2D` hoặc WO mới).
- N5 ảnh đại diện/ảnh bìa nhóm — WO riêng (khuôn `chat-room-avatar-*`).
- N6 báo chủ/quản trị nhóm khi có yêu cầu mới (NOTI chỉ tới người xin).
- N7 link NOTI `'/social/reports'` ⇐ FE-3 (màn kiểm duyệt SOC-SCREEN-010).
- N8 không neo kiểu BE↔contracts cho 030..039 (ngoài `paths`); tối thiểu có spec web-core parse payload
  thật.
- N9 (docs) quy tắc «bài nhóm LOẠI khỏi feed chung» (D-OWNER-5/6/7) chỉ có ở plan BE-2A + code, vắng
  khỏi SPEC-16/API-19.

## 8. Lượt 2 — vá theo `plan-reviewer` (29/09/2026, BLOCK 2 HIGH · 7 MEDIUM) — GHI ĐÈ §2–§5

Reviewer XÁC NHẬN đúng: bảng D4 (từng dòng khớp service, kể cả `canGrantOwner`) · tiền tố D3 (mọi
404 của 036/038/039 là `SOCIAL-ERR-012:` hoặc `SOCIAL-ERR: người này…`; 409 của 035 chỉ 013, của
036/039 chỉ 015, của 038 là 013|015, của 033 chỉ tên trùng) · D2 (header tuỳ chọn; không census nào
đòi FE gửi khoá) · O2 (9 template NOTI không query/hash; `NotificationTargetLink` điều hướng phía
client) · mọi file trong `paths`.

| Finding | Vá |
| --- | --- |
| **H1** `?invite=1` tới `validateSearch` là SỐ `1` (router dùng `defaultParseSearch = parseSearchWith(JSON.parse)`, `router-core/searchParams.js:4` — đo lại) ⇒ helper chép khuôn `typeof === "string"` bỏ mất ⇒ nút mời không bao giờ hiện, test tay `{invite:"1"}` vẫn xanh | `group-route-search.ts`: `invite` nhận `1 \| "1" \| true`; `q` nhận chuỗi HOẶC số (đổi lại thành chuỗi, `?q=2024`); `page` nhận số hoặc chuỗi số. **MỌI trường output OPTIONAL**, mặc định giải ở component (khuôn `FeedRouteSearch`) ⇒ `<Link to="/feed/groups">`/`navigate` không bắt buộc `search`. Spec cho validator ăn ĐẦU RA của `parseSearchWith(JSON.parse)("?invite=1&q=2024&page=2")` thật, không object tay |
| **H2** đổi `$groupId` KHÔNG remount ⇒ nháp composer / form cài đặt / thông báo mời của nhóm A sống sang B ⇒ bài đăng NHẦM nhóm, PATCH nhầm nhóm | `GroupPage` render thân dưới `key={groupId}` (một chỗ, phủ mọi con). Ca **H2**: rerender đổi `groupId` ⇒ ô soạn rỗng, form cài đặt mang giá trị của B |
| M1 `sort:'newest'` không tồn tại (`feedSortSchema = ["active","latest"]`, `social-api.ts:69`; query `.strict()`) | MỘT object `{groupId, sort:'latest'}` dùng cho CẢ khoá query lẫn lời gọi `listFeed` |
| M2 bỏ option «Chủ nhóm» khi `!canGrantOwner` ⇒ admin nhìn hàng OWNER thấy select hiện «Thành viên» (sai vai hiện tại) và chọn «Thành viên» không bắn change | Option «Chủ nhóm» LUÔN render, `disabled` khi `!canGrantOwner`. Ca M1b: admin xem hàng owner ⇒ giá trị hiện là «Chủ nhóm», đổi sang «Quản trị viên» gửi `038 {role:'admin'}` |
| M3 composer nhóm mất thông báo `droppedMentions` (bài nhóm bỏ mention người ngoài nhóm với 201 — G13, càng cần hơn feed chung) | `use-create-post` sở hữu `droppedMentionCount`; `GroupPostsTab` vẽ thông báo như FeedPage. 403 (mất tư cách thành viên) ⇒ banner + invalidate `groups.detail`. Ca P1b: 201 `droppedMentions:[x]` ⇒ thông báo |
| M4 N1 chỉ test `beforeLoad` ⇒ xanh dù quên gắn route vào `routeTree`; file tự `createRoute` với `rootRoute` = import vòng | `legacy-social-redirects.ts` chỉ xuất DỮ LIỆU THUẦN `LEGACY_SOCIAL_REDIRECTS = [{path, to, param}]` + hàm `legacyRedirectBeforeLoad(entry)`; `router.tsx` map thành `createRoute` và TRẢI vào `addChildren`. Ca N1b: mảng phủ ĐÚNG hai template NOTI (`/social/groups/{group_id}`, `/social/posts/{post_id}`). Ghi nhận: không có spec cây route trong kho (0 hit `routesByPath\|createMemoryHistory`) — vế «đã gắn vào routeTree» do typecheck `<Link>` không phủ; kiểm tay khi chạy app + ghi PR |
| M5 invalidate thiếu | (a) 403 ở mọi mutation nhóm ⇒ thêm `groups.allOf()` (vai của tôi đã cũ). (b) 034 và 036-private: `removeQueries(groups.detail(id))` + `navigate` TRƯỚC, invalidate `socialKeys.all` SAU — không để detail refetch 404 nháy màn GroupNotFound. (c) thêm khoá tiền tố `groups.lists()` (`[…,"groups","list"]`) — `list(undefined)` KHÔNG khớp một phần `list({membership})` ở v5; I1 assert đúng khoá |
| M6 cứng hoá O1 | (a) `invite=1` ⇒ `join` 0 lần khi mount, CHỈ khi bấm (chống link ép nạn nhân gửi yêu cầu). (b) `$groupId` không UUID ⇒ KHÔNG nút mời. (c) DTO 201 của 035 (mang tên/mô tả nhóm kín) KHÔNG hiện, KHÔNG `setQueryData(detail)`. (d) thông báo «đã gửi» là state trong `GroupNotFound`, component không unmount theo `isFetching` (chỉ theo `isError`/`status`) |
| M7 `alreadyRequested` sai với nhóm public | Đổi thành `alreadyMember` với chữ TRUNG TÍNH khớp BE («Bạn đã là thành viên hoặc đã gửi yêu cầu vào nhóm này»). `groupGone` = «Không tìm thấy nhóm» (BE không phân biệt «đã xoá» với «chưa từng có», ACC:59-63) |
| L | `-u` snapshot CHỈ file sidebar: `pnpm --filter @mediaos/app exec vitest run src/layouts/workspace/sidebar-registry.snapshot.spec.ts -u` · L1 thêm ca ALLOW (hàng active/public CÓ `href=/feed/groups/<id>`, mock `Link` thay `$groupId`) và assert SAU trạng thái đã tải · ca socket/badge render `GroupPage` chứ không chỉ tab · R1 thêm 404 không số (người khác đã xử lý) · 1 ca lặp mọi kind × {forbidden, generic} + mọi `reason` không ra khoá thô · `lastOwner` nhắc «hoặc xoá nhóm» · S1 tên rỗng/khoảng trắng ⇒ khoá Lưu · spec riêng `group-route-search` · D10 chỉ tách khi `FeedPage.spec` giữ NGUYÊN không sửa ca nào |
| D1 (tự vá) | Tiền lệ `feedDeletedResultSchema` (`web-core/social-api.ts:93-103`: BE trả literal thẳng từ service, không qua contracts) ⇒ `feedGroupLeftResultSchema` khai ở `social-groups-api.ts` (web-core), `.strict()` + `literal(true)` như tiền lệ; contracts chỉ sửa docblock (đã làm). K1 chuyển thành ca trong spec web-core |
| Open Q | FE-2 literal `in_progress` — ledger đã `finished` (#551) 29/09 03:07Z ⇒ overlay = done; STATUS xác nhận FE-2B không còn «cần FE-2» |

## 9. Sổ vết thi công (29/09/2026)

| Bước | Commit | Đo |
| --- | --- | --- |
| T0 plan v2 + backlog + seed `S16-SOCIAL-GROUPERR-1` | `6a4cab0f` | backlog 534 item, 0 trùng id |
| T1–T3 contracts docblock + `socialGroupsApi` + `socialKeys.groups` + registry | `959081df` | web-core 188/188 (13 ca mới), typecheck sạch |
| T4–T5 lõi thuần + i18n + `ActionErrorBanner.reason` | `83af0400` | 98 ca (G1 vét cạn 20 tổ hợp, E1 chuỗi BE thật, H1 parser router thật, mọi kind/reason không ra khoá thô) |
| T6 composer nhóm + `useCreatePost` | `06015a21` | `FeedPage.spec` + `FeedComposer.spec` cũ xanh KHÔNG sửa ca nào (48/48) + 9 ca mới |
| T7–T9 + T11 router màn Nhóm | `46b06c4b` | GroupsPage 16 · GroupPage 21 (gồm H2 remount) · tab quản trị 16 · redirect 4 |
| T10–T11 widget + wiring + prune + snapshot | `548938d7` | snapshot +1 dòng mỗi file (đúng dự đoán) |

- `test:social-cov`: **550/550**, 97.56 / 92.03 / 86.77 / 97.56 (ngưỡng 80). `check.sh --quick` XANH.
- Mutant (sao lưu file trước khi cấy): M1 bỏ `onError` leave ⇒ đỏ đúng ca «chủ nhóm cuối» · M2
  `canReadPosts ∨ canManage` ⇒ 3 ca G1 · M3 join gửi khoá ⇒ 1 ca W1 · M4 gộp nhánh 404 ⇒ 3 ca D1 · M5 bỏ
  vế `myStatus` ⇒ 5 ca G1. Không mutant nào đỏ vì lỗi biên dịch.
- **Lệch plan có chủ ý:** (a) D15 `039` mời ra chỉ invalidate `groups.allOf()` (không `socialKeys.all`):
  mời NGƯỜI KHÁC ra không đổi quyền đọc bài của chính actor; (b) D1 `feedGroupLeftResultSchema` ở web-core
  (tiền lệ `feedDeletedResultSchema`), contracts chỉ sửa docblock; (c) thêm `useGroupErrorState`/
  `useGroupMembership` dùng chung hàng danh sách + header + các tab (một đường lỗi/cache).
- Nợ phát hiện khi thi công: `feed-route-search.ts` (FE-1) cùng lỗi H1 — `?q=2024` qua `JSON.parse` thành
  số rồi bị bỏ (`typeof === "string"`) ⇒ tìm kiếm số trên `/feed` mất từ khoá. Ngoài `paths` lát này? — nằm
  trong `routes/social/**` nhưng thuộc màn FE-1; ghi PR, chưa vá.

### 9.1 Gate LIGHT (29/09/2026) — typescript-reviewer PASS · react-reviewer BLOCK ⇒ đã vá

Cả hai reviewer xác nhận độc lập: bảng D4 khớp cổng BE từng dòng · D3 khớp tiền tố + hình dạng dây ·
D2 bỏ khoá join/leave đúng · oracle 404 trung tính · không suy diễn vai ngoài `group-capabilities.ts`.
`check.sh --all --lane-db=socialfe2b` XANH 9/9 trên `548938d7` (2 flake có sẵn không nổ lượt này).

| Finding | Vá | RED (spec mới chạy trên code `548938d7`) |
| --- | --- | --- |
| **HIGH** (react) lỗi/«đã gửi» ở màn 404 mời BIẾN MẤT: `fail()` invalidate `groups.allOf()` ⇒ refetch `032` không `data` ⇒ TanStack v5 `fetchState` đặt `status:'pending'` ⇒ `GroupNotFound` unmount | state + mutation dời vào `useInviteRequest` do `GroupPageBody` giữ; lỗi mời KHÔNG invalidate chi tiết; query 404 đã biết không tự refetch khi focus/reconnect | 2 ca đỏ (ca «đã gửi sống qua refetch» phải treo lượt refetch 30ms — mock từ chối trong microtask thì `pending` không kịp render, xanh giả) |
| **MEDIUM** (react) refetch nền hỏng khi ĐÃ có dữ liệu ⇒ cả trang thành khối lỗi ⇒ mất nháp ô soạn/form | khối lỗi chỉ khi `!data`; có dữ liệu ⇒ cảnh báo nhỏ `group-refresh-error` + «Thử lại» | 1 ca đỏ |
| **MEDIUM** (ts) ca H2 xanh cả khi gỡ `key` (B chưa có cache ⇒ skeleton tự unmount) | seed B vào cache trước rerender | mutant gỡ `key` ⇒ 2 ca H2 đỏ |
| **MEDIUM** (ts) + LOW (react) route chuyển hướng ghép theo VỊ TRÍ mảng + `!` + `as never`, `path` hard-code | union phân biệt + 2 hằng có tên; router đọc `path` từ hằng; `beforeLoad` rẽ theo `kind` (không `as`) | ca N1 thêm «không ghép chéo» |
| LOW (react) gợi ý «Tham gia để đăng bài» với hàng `pending` public | chỉ khi `canJoin` | 1 ca đỏ |
| LOW (ts) manage rời nhóm kín bị đẩy ra danh sách dù vẫn xem được | điều hướng chỉ khi `!canManage` | 1 ca đỏ |
| LOW khối lỗi thiếu `role="alert"`/thân · ép kiểu `e.target.value as` · `changes as` | thêm `role="alert"` + `state.errorBody`; thu hẹp bằng `GROUP_ROLE_OPTIONS.find`; bỏ `as` | — |
| LOW (ts) «điều hướng trước rồi invalidate» không bảo đảm trang cũ đã unmount (Transitioner + Suspense) | GHI NỢ — thẩm mỹ (nháy 1 lượt refetch), không mất dữ liệu | — |

Sau vá: `test:social-cov` **556/556**, 97.42 / 92.08 / 85.9 / 97.42 · `check.sh --quick` XANH.
