# S16-SOCIAL-FE-2C — FE track B / lát C: SOC-SCREEN-009 Vinh danh

> Trạng thái: **plan v1 (29/09/2026)** — chờ `plan-reviewer`. Nhánh `feat/s16-social-fe-2c` cắt từ master
> `c8b9d637` (sau merge BE-2D #555). Zone amber, gate LIGHT. Quyền chỉ qua `useCan`/`PermissionGate`.
> Đo bằng workflow đọc 5 mảng + critic (29/09/2026, trên `c8b9d637`) — trích ở §1.

## 0. Phạm vi + chữ ký owner

Composer kudos (≤10 người nhận · huy hiệu · `isOfficial`) · khối kudos trên thẻ bài · màn danh sách theo
tháng `/feed/kudos` · widget rail «Vinh danh tháng này».

> ✍️ **Owner ký 29/09/2026 (4/4 theo khuyến nghị):**
> **O1** widget = **5 lượt mới nhất** của tháng hiện tại (`047?month=<tháng giờ công ty>&limit=5`), không gộp theo người.
> **O2** **thêm mục sidebar** «Vinh danh» `/feed/kudos` sau «Bình chọn» (lệch UI-07 rail trái — chấp nhận).
> **O3** **ẩn** nút «Vinh danh» ở composer NHÓM (`groupId`) — kudos chỉ soạn ở Bảng tin công ty.
> **O4** cho WO chạm `apps/api/src/social/social-kudos.service.ts` ở mức **TYPE-ONLY** (neo kiểu `048`).

## 1. Phép đo (29/09/2026 trên `c8b9d637`)

| # | Đo | Kết quả |
| --- | --- | --- |
| M1 | Tạo kudos | KHÔNG có route riêng — `POST /social/posts` `type:'kudos'` (`social.controllers.ts:87-94`, `@Idempotent`). T1 `create:feed-post`; T2 `create:feed-kudos@Company` (`social-route-pairs.const.ts:418`); `isOfficial:true` đòi thêm `manage:feed-kudos@Company` (`:442-444`) — thiếu ⇒ **403 `SOCIAL-ERR-KUDOS-OFFICIAL-DENIED`** TRƯỚC khi mở tx (`social-posts.service.ts:186-190`), KHÔNG ép về false. |
| M2 | Payload | `kudos:{recipientEmployeeIds: uuid[] (Zod KHÔNG trần độ dài), badgeId?: uuid (KHÔNG nullable — gửi `null` là 400), message: trim 1..4000 BẮT BUỘC, isOfficial default false}.strict()` (`contracts social-api.ts:434-447`); `body` tuỳ chọn với kudos. Service: lowercase + khử trùng rồi mới ép **1..10** (`social-post-types.ts:110-111,175-178`) ⇒ trùng bị gộp IM LẶNG. `KUDOS_RECIPIENT_MIN/MAX` **không có trong contracts** (grep 0). |
| M3 | Thứ tự lỗi 002-kudos | 403 T1 → 403 `KUDOS-CREATE-REQUIRED` → 403 `KUDOS-OFFICIAL-DENIED` → (tx) 404 `012`/403 `002` audience → 422 `KUDOS-RECIPIENT-LIMIT` → 422 `KUDOS-SELF-RECIPIENT` → 422 `SOCIAL-ERR-022` (huy hiệu thiếu/tắt/tenant khác) → 422 `KUDOS-RECIPIENT-INVALID`. Sau #554 mã nằm ở `error.code` (`isSocialErrorCode`). |
| M4 | `047 GET /social/kudos` | `view:feed`; query `{page≤10000=1, limit≤100=20, month?}` `.strict()`; `month` `^(19\|20)\d{2}-(0[1-9]\|1[0-2])$`; **vắng `month` = GẦN ĐÂY, không phải tháng này** (`social-api-kudos.ts:40`); biên tháng theo **giờ công ty** `COALESCE(companies.timezone,'Asia/Ho_Chi_Minh')` (`social-kudos.repository.ts:290-295`); sort `created_at DESC, id`; item = khối kudos + `postId` + `createdAt` (`feedKudosPageSchema`). Không có `status` bài (quản lý/tác giả thấy cả kudos của bài ẩn). |
| M5 | `048 GET /social/kudos-badges` | `view:feed`; `{page, limit≤100=50}`; chỉ huy hiệu bật; hàng `{id,code,name,description\|null,icon\|null,position}` (`KudosBadgeRow`, repo `:246-253`). **Không có schema response trong contracts; `listBadges` không khai kiểu trả về** (`social-kudos.service.ts:216`). `kudosBadgeAdminSchema` đòi `isActive/createdAt/updatedAt` ⇒ parse 048 bằng nó là NÉM. |
| M6 | `059 GET /social/kudos/recipients?q=` | Gác **`create:feed-kudos`** (K3 của BE-2D — plan FE-2 §7 S3 ghi `view:feed` là CŨ). Chỉ `q`, `.strict()`; `q` chuẩn hoá NFC + gộp khoảng trắng; **≥2 chữ/số `\p{L}\p{N}`** (không phải độ dài), ≤100, cấm `\p{Cc}\p{Cf}` ⇒ `"a."` là 400. Trần 20 + `truncated`. Loại chính người gọi theo `users.id` (repo `:594`), chỉ người active. Kết quả `{employeeId, fullName: string, avatarUrl}` — KHÔNG `isFormerEmployee`. |
| M7 | Khối `post.kudos?` | `{kudosId, message\|null, isOfficial, badge\|null, recipients[{employeeId, fullName\|null, avatarUrl\|null, isFormerEmployee}]}`. VẮNG (không bao giờ `null`) khi: loại khác · response `006` · payload WS · hàng mồ côi · API cũ. `recipients: []` VẪN trả (kèm log lỗi BE). Người nhận xếp theo `employeeId`, không theo thứ tự chọn. `fullName:null` ⇔ hồ sơ/TK xoá mềm (`isFormerEmployee:true`) HOẶC không có TK (cờ theo `status`, có thể `false`). |
| M8 | Avatar | `avatarUrl` ở khối/047/059 là cột THÔ `employee_profiles.avatar_url` (fileId hoặc chuỗi tuỳ ý, đa-người-ghi). `Avatar` (`packages/ui avatar.tsx:37-41`) vẽ `<img src>` khi có `src`, không `onError`, không prop «chỉ chữ cái» ⇒ cách DUY NHẤT là **không truyền `src`** (tiền lệ `NewsPage.tsx:221`). ⚠️ `PostCard.tsx:82` · `CommentList.tsx:67` · `BirthdayWidget.tsx:90` · 2 tab nhóm ĐANG truyền cột thô làm `src` — không WO nào sở hữu phía FE (§7 N1). |
| M9 | Composer | `FeedComposer.tsx` 308 dòng, `ComposerType` 4 giá trị (`:39`), nút gác `PermissionGate` theo `SOCIAL_POST_TYPE_PAIRS`. Ca **C4** (`FeedComposer.spec.tsx:68-95`) ghim 4 nút + VẮNG kudos (kể cả `*:*`). C3 (chỉ `create:feed-post` ⇒ 1 nút) giữ xanh nếu kudos gác `create:feed-kudos`. `FeedComposer` còn mount ở `GroupPostsTab.tsx:99` với `groupId`. |
| M10 | Đọc lỗi | `useCreatePost.onError`: `reason = groupId ? groupErrorReason("post", err) : null` (`use-create-post.ts:72`) ⇒ ở bảng tin MỌI 422 kudos rơi về câu chung; `use-create-post.spec.tsx:84-94` ghim `reason:null` cho ERR-012 ở bảng tin. `ACTION_ERROR_REASONS` đóng (`ActionErrorBanner.tsx:57-63`), `ActionErrorBanner.spec` lặp qua tập ⇒ reason mới tự bị kiểm i18n. `socialErrorCode(err)` (`group-errors.ts:55`) đọc `code` + tiền tố cũ. |
| M11 | Idempotency | Khoá `social-post_${hash64(JSON.stringify(body))}` ⇒ **thứ tự `recipientEmployeeIds` đổi khoá**. Gửi lại nội dung Y HỆT trong 900 s ⇒ server phát lại bài đầu (201), không tạo bài mới — chấp nhận (cùng luật mọi loại bài). |
| M12 | Tháng giờ công ty ở FE | `/auth/me` không trả `company.timezone`; `companyTimeZone()` (`routes/rooms/room-time.ts:31-33`) = `DEFAULT_TIMEZONE` (`Asia/Ho_Chi_Minh`) — điểm đọc DUY NHẤT, đã có tiền lệ import chéo module (`RoomTodayWidget`, `MeRoomBookingsPage`). Helper `currentMonth()` của attendance/leave dùng đồng hồ MÁY — tiền lệ SAI. |
| M13 | URL search | Parser thật `JSON.parse` từng giá trị: `?month=2026-09` ⇒ chuỗi; `?month=202609`/`?month=9` ⇒ SỐ; `?page=2` ⇒ số. Tiền lệ đúng `group-route-search.ts:36-47`; `feed-route-search.ts:51-52` là tiền lệ SAI (bỏ số). |
| M14 | Route/nav | Registry SOCIAL: order cuối 101 ⇒ **102** trống. Route tạo trực tiếp `createRoute` + `getMeta` (không `makeModuleRoute` — mất literal type). Sidebar `SOCIAL_SIDEBAR_V2` **không khai sẵn** mục kudos (`social.ts:36-93`); `DynamicIcon` không có `award` (rơi về `Circle`). `social-wiring.spec.ts`: 6 mục sidebar (`:46`) · 10 route (`:90`). 2 snapshot sidebar regen bằng `-u`. |
| M15 | Huy hiệu icon | Seed `0582:66-70`: `users-round` · `lightbulb` · `heart-handshake` · `graduation-cap` · `rocket` — `DynamicIcon` chỉ có `lightbulb`. DB-17 nói icon CÓ THỂ là emoji; contract nói tên lucide ⇒ FE nhận cả hai. |
| M16 | Test infra | `SocialPortalShell.spec.tsx:42-48` spread `socialApi` thật — query mới không mock là chạy `apiFetch` thật. `social-cov` (80% 4 trục, CI-only) đo `src/routes/social/**`. web-core `exports` trỏ `dist` ⇒ rebuild contracts + web-core trước test app. |
| M17 | Hashtag trong lời nhắn | Tag chỉ lập chỉ mục từ `body` (`social-posts.service.ts:290`) ⇒ vẽ `message` qua `PostBody` tạo link `#tag` tới bộ lọc KHÔNG chứa bài này. |

## 2. Quyết định

- **D1 — contracts** (`social-api-kudos.ts`, + spec):
  - `KUDOS_RECIPIENT_MIN = 1` · `KUDOS_RECIPIENT_MAX = 10` — bản sao có ghi chú nguồn `apps/api/src/social/social-post-types.ts:110-111` (khuôn `POLL_OPTIONS_MAX`). Zod payload KHÔNG đổi (luật ở service, có chủ đích).
  - `kudosBadgeSchema` (048 công khai: `id` uuid · `code` · `name` · `description` nullable · `icon` nullable · `position` int) + `kudosBadgePageSchema` `{data,page,limit,total}` + type. Không `.strict()` (khuôn response).
- **D2 — neo kiểu BE (O4, TYPE-ONLY)**: `SocialKudosService.listBadges(...): Promise<KudosBadgePageDto>` + import type. KHÔNG đụng thân method, KHÔNG `as`. Bắt: thiếu/đổi tên trường, đổi nullability. Không bắt: tinh chỉnh uuid/int, trường THỪA phía BE.
- **D3 — client** `packages/web-core/src/lib/social-kudos-api.ts` (tách khỏi `social-api.ts` 389 dòng, khuôn `social-groups-api.ts`): `socialKudosApi.list(query)` → `GET /social/kudos` parse `feedKudosPageSchema`; `.searchRecipients(q)` → `GET /social/kudos/recipients?q=` parse `kudosRecipientSearchResultSchema` (KHÔNG gửi page/limit); `.listBadges(query)` → `GET /social/kudos-badges` parse `kudosBadgePageSchema`. Không hàm tạo — dùng `socialApi.createPost`. `socialKeys.kudos = {allOf, lists, list(params), recipients(q), badges(params)}` (append cuối `socialKeys`). Export ở `index.ts`.
- **D4 — nháp thuần** `routes/social/kudos/lib/kudos-draft.ts`: `KudosDraft {recipients: KudosRecipientCandidateDto[] (thứ tự chọn — cho chip), badgeId: string|null, isOfficial: boolean}` · `EMPTY_KUDOS_DRAFT` (so tham chiếu = cờ «đã sửa», khuôn poll) · `addKudosRecipient` (khử trùng theo `employeeId` lowercase, đủ 10 ⇒ trả NGUYÊN nháp) · `removeKudosRecipient` · `validateKudosDraft(draft, message)` ⇒ lỗi đầu tiên theo thứ tự trường: `recipientsRequired` · `recipientsTooMany` · `messageRequired` · `messageTooLong` · `buildKudosPayload(draft, message, canOfficial)` ⇒ `recipientEmployeeIds` **lowercase + khử trùng + SẮP XẾP** (M11 — khoá idempotency ổn định), `message` đã trim, `isOfficial: draft.isOfficial && canOfficial`, `badgeId` chỉ khi khác null (M2).
- **D5 — `KudosComposerFields`** (controlled, khuôn `PollComposerFields`; file `routes/social/kudos/components/`):
  - Ô tìm (label thật) → `useDebouncedValue(q, 300)` (`@/hooks/use-debounced-value`, chỉ IMPORT) → `kudosRecipientSearchQuerySchema.safeParse({q})`; query `socialKeys.kudos.recipients(parsed.q)` **enabled chỉ khi** parse OK **và** `useCan("create","feed-kudos")` (M6). Parse hỏng ⇒ gợi ý «Gõ ít nhất 2 chữ» và KHÔNG vẽ danh sách.
  - Kết quả: `role="listbox"` + `role="option"`, bấm ⇒ `onChange(addKudosRecipient(...))`; người đã chọn ⇒ `aria-selected` + disabled; đủ 10 ⇒ mọi option disabled + dòng «Đã đủ 10 người». `truncated` ⇒ «Gõ thêm để thu hẹp». Loading / lỗi (KHÔNG chặn soạn — «Không tải được danh bạ») / rỗng.
  - Chip đã chọn: `<Avatar name size="sm" />` **không `src`** + tên + nút bỏ (`aria-label`). Đếm `n/10`.
  - Huy hiệu: `<select>` native, option đầu «Không gắn huy hiệu» (`""` ⇒ `badgeId:null`), còn lại từ `048` (`limit:100`, 1 trang — catalog seed 5 hàng; >100 ghi nợ). Loading ⇒ select disabled; lỗi ⇒ chỉ còn «Không gắn huy hiệu» + dòng báo.
  - `isOfficial`: checkbox trong `<PermissionGate action="manage" resourceType="feed-kudos">` (nhãn «Vinh danh chính thức (dấu công ty)»).
  - State (từ khoá, kết quả) sống trong component này; NHÁP (người nhận/huy hiệu/cờ) sống ở `FeedComposer` ⇒ query pending không làm mất lựa chọn (bẫy TanStack FE-2B).
- **D6 — `FeedComposer`**: `ComposerType` + `"kudos"`; nút `Award` gác `<PermissionGate action="create" resourceType="feed-kudos">` **và `!groupId`** (O3). Ô soạn chính = **lời nhắn** (bắt buộc, trần `FEED_BODY_MAX`), placeholder riêng; KHÔNG gửi `body`. `contentReady` = `validateKudosDraft(...).ok`; dòng lỗi nháp hiện khi `touched || kudosDraft !== EMPTY_KUDOS_DRAFT` (khuôn poll). `buildDto` kudos = `{type:"kudos", audience:"company", requiresAck:false, kudos: buildKudosPayload(...)}` (O3 ⇒ không bao giờ `group`). Resolve ⇒ dọn `kudosDraft`; reject ⇒ giữ nguyên (hộp H2). Docblock 4 nút ⇒ 5 nút.
- **D7 — lỗi + cache** (`use-create-post.ts`, `use-feed-actions.ts`, file mới `kudos/lib/kudos-errors.ts`):
  - `kudosErrorReason(err)` qua `socialErrorCode`: `KUDOS_CREATE_REQUIRED→kudosCreateDenied` · `KUDOS_OFFICIAL_DENIED→kudosOfficialDenied` · `KUDOS_SELF_RECIPIENT→kudosSelf` · `KUDOS_RECIPIENT_LIMIT→kudosRecipientLimit` · `KUDOS_RECIPIENT_INVALID→kudosRecipientInvalid` · `KUDOS_BADGE_INVALID (022)→kudosBadgeInvalid`; khác ⇒ `null`. `onError`: `reason = kudosErrorReason(err) ?? (groupId ? groupErrorReason("post", err) : null)` — ca ERR-012 bảng tin vẫn `null`. `KUDOS_BADGE_INVALID` ⇒ invalidate `socialKeys.kudos.badges()` (huy hiệu vừa bị tắt).
  - 6 reason mới vào `ACTION_ERROR_REASONS` + `actionError.reason.*` (chữ nói ĐÚNG lý do — done_when #1 «hiện 422 nếu lọt»).
  - `onSuccess` `type==='kudos'` ⇒ invalidate `socialKeys.kudos.lists()`. `invalidatePostLists` (xoá/ẩn) thêm `kudos.lists()`.
- **D8 — `KudosBlock`** (thuần, props `block: FeedKudosBlockDto`, KHÔNG `useQuery`): tiêu đề = icon huy hiệu + tên huy hiệu (hoặc «Vinh danh» khi `badge:null`) + pill «Chính thức» khi `isOfficial`; danh sách người nhận: `<Avatar name size="sm" />` **không `src`** + tên (`fullName ?? t("kudos.unknownRecipient")` = «Đồng nghiệp» — KHÔNG dùng `post.unknownAuthor` «đã rời công ty», sai với người không có TK) + pill «Đã nghỉ việc» CHỈ theo `isFormerEmployee`; tên là `<Link to="/feed/profiles/$employeeId">` khi `fullName !== null`, ngược lại `<span>`. `message` vẽ **chữ thuần** `whitespace-pre-line break-words` (M17 — không qua `PostBody`), `null` ⇒ bỏ. `recipients: []` ⇒ bỏ danh sách (không vẽ chữ lạ). `PostCard`: `post.type==='kudos' && post.kudos && <KudosBlock …/>` (cùng khe với `PollBlock`); `isFullyRenderableType` thêm `kudos` (bài từ client khác có `body` vẫn hiện; `PostBody` tự null khi body null) ⇒ C27 (kudos KHÔNG khối) giữ nguyên là ca «vắng khối».
- **D9 — `KudosBadgeIcon`**: map CỐ ĐỊNH tên→component lucide (`award` · `trophy` · `medal` · `star` · `heart` · `sparkles` · `users-round` · `lightbulb` · `heart-handshake` · `graduation-cap` · `rocket`); chuỗi chứa `\p{Extended_Pictographic}` và ≤ 8 code point ⇒ vẽ như CHỮ (`aria-hidden`); còn lại / `null` ⇒ `Award`. Không tra cứu cả namespace lucide.
- **D10 — màn 009 `/feed/kudos`** (`routes/social/kudos/KudosPage.tsx`): `validateSearch` = `kudos-route-search.ts` `{month?: string (chỉ chuỗi qua `kudosMonthSchema.safeParse`), page?: number (2..10000, khuôn `pageParam`)}` — không ném; mặc định `month` = tháng hiện tại giờ công ty. Đầu màn: tiêu đề + điều hướng tháng (‹ · «Tháng 9/2026» · ›; › disabled khi ≥ tháng hiện tại; ‹ disabled ở `1900-01`); đổi tháng ⇒ bỏ `page`. Danh sách: mỗi dòng `KudosBlock` + chân dòng (thời gian `createdAt` + link «Xem bài» `/feed/posts/$postId`). `keepPreviousData`; loading (skeleton) · lỗi + thử lại · rỗng («Chưa có lời vinh danh nào trong tháng này»); `OffsetPager` đọc `page/limit/total` server trả.
- **D11 — tháng** `routes/social/kudos/lib/kudos-month.ts` (thuần): `currentKudosMonth(now: Date)` = `partsIn(now, companyTimeZone())` → `YYYY-MM` (import từ `@/routes/rooms/room-time` — điểm đọc tz duy nhất, M12); `shiftKudosMonth(month, ±1)` số học chuỗi, ra ngoài `1900-01..2099-12` ⇒ `null`; `formatKudosMonth` qua i18n. Tính lại mỗi render (không memo) ⇒ tab mở qua nửa đêm cuối tháng tự sang tháng mới ở lần render kế.
- **D12 — widget «Vinh danh tháng này»** (`routes/social/kudos/components/KudosThisMonthWidget.tsx`, trình bày thuần): shell gọi `socialKudosApi.list({month: currentKudosMonth(new Date()), limit: 5})`, `enabled: canViewFeed` (047 gác `view:feed`); đặt GIỮA «Bình chọn đang mở» và «Nhóm của tôi» (thứ tự UI-07). Dòng: icon huy hiệu + tối đa 3 tên người nhận + «+N» + link bài; «Xem tất cả» → `/feed/kudos`; rỗng/loading/lỗi qua `PortalWidgetBlock`.
- **D13 — route/nav (O2)**: registry `social.kudos` `/feed/kudos` `MODULE_PORTAL` `SOC-SCREEN-009` `routeTitle.socialKudos` `view:feed` `showInSidebar` order **102**; router lazy import + `createRoute` (+`validateSearch`) + dòng trong cây route; sidebar `SOCIAL_SIDEBAR_V2` thêm `social.kudos` «Vinh danh» icon `award` group `operation` order **55**; `DynamicIcon` thêm `award`; `nav.ts` `routeTitle.socialKudos`; regen 2 snapshot sidebar (trích diff vào PR); `social-wiring.spec` 6→7 mục · 10→11 route · ca R mới cho 009.
- **D14 — i18n**: file mới `apps/app/src/i18n/locales/vi/social-kudos.ts` mount `kudos` trong `social.ts` (khuôn `social-groups.ts`); khoá composer vào `composer.typeKudos` · `composer.kudosPlaceholder` · `composer.kudos.*`; reason vào `actionError.reason.*`. Viết lại chú thích `social.ts:33-35`.
- **D15 — Avatar (M8)**: MỌI bề mặt kudos của WO này (khối · màn 009 · widget · chip + kết quả ô chọn) chỉ chữ cái đầu — spec assert `container.querySelector("img") === null`. Chỗ `src` thô sẵn có ngoài kudos KHÔNG đụng (§7 N1).
- **D16 — docblock cũ phải sửa**: `FeedComposer.tsx:4-11,38` · `FeedComposer.spec.tsx:4-6` · `feed-format.ts:80-82` · `PostCard.tsx:13-14,128-129` · `PostCard.spec.tsx:199` · `SocialPortalShell.tsx:7-8` · `social.ts:33-35` (i18n) · `sidebar/social.ts` đầu file (6→7 mục).

## 3. Các bước

| Bước | Việc | File |
| --- | --- | --- |
| T0 | backlog FE-2C: `paths` + `apps/api/src/social/social-kudos.service.ts` (O4); `notes` ghi O1–O4; AVATARPRESIGN-1 thêm vế FE (§7 N1); seed nợ N2 | `harness/backlog.mjs` |
| T1 | D1 contracts + spec; rebuild contracts | `packages/contracts/src/social-api-kudos.ts` (+spec) |
| T2 | D2 neo kiểu; `pnpm --filter @mediaos/api typecheck` | `apps/api/src/social/social-kudos.service.ts` |
| T3 | D3 client + keys + spec; rebuild web-core | `packages/web-core/src/lib/{social-kudos-api,query-keys,index}.ts` |
| T4 | D4 + D11 hàm thuần + spec | `routes/social/kudos/lib/{kudos-draft,kudos-month,kudos-errors}.ts` |
| T5 | D8 + D9 `KudosBlock` + `KudosBadgeIcon` + `PostCard` + `feed-format` + spec | `routes/social/kudos/components/*`, `feed/components/PostCard.tsx` |
| T6 | D5 + D6 + D7 composer + lỗi + cache + spec (C4 mới) | `KudosComposerFields.tsx`, `FeedComposer.tsx`, `use-create-post.ts`, `use-feed-actions.ts`, `ActionErrorBanner.tsx` |
| T7 | D10 màn 009 + search parser + spec | `routes/social/kudos/{KudosPage.tsx,lib/kudos-route-search.ts}` |
| T8 | D12 widget + shell + spec | `KudosThisMonthWidget.tsx`, `SocialPortalShell.tsx` (+spec) |
| T9 | D13 + D14 registry/router/sidebar/icon/i18n + wiring + snapshot | `registry.ts`, `router.tsx`, `nav.ts`, `sidebar/social.ts`, `DynamicIcon.tsx`, `i18n/.../social{,-kudos}.ts` |
| T10 | `check.sh --quick` → `test:social-cov` (đọc số) → mutant → gate LIGHT → `check.sh --all` → PR | — |

## 4. Ca test bắt buộc (mỗi ca DENY đứng cạnh ca ALLOW)

- **K1** contracts: `kudosBadgePageSchema` parse mẫu đúng hình `KudosBadgeRow` (+`description:null`, `icon:null`); từ chối `id` không uuid. `KUDOS_RECIPIENT_MAX === 10`.
- **A1** client: `list({month,limit})` ⇒ `GET /social/kudos?limit=5&month=2026-09` + schema `feedKudosPageSchema`; `searchRecipients("an")` ⇒ `?q=an`, KHÔNG `page`/`limit`; `listBadges` ⇒ `/social/kudos-badges` + parse mẫu thật.
- **C4''** composer đủ quyền ⇒ ĐÚNG 5 nút `{share,news,poll,idea,kudos}`; `*:*` ⇒ 5 gồm kudos. **DENY** đủ quyền trừ `create:feed-kudos` ⇒ 4, vắng kudos. **ALLOW** chỉ `create:feed-post`+`create:feed-kudos` ⇒ `{share,kudos}`. **G1 (O3)** `groupId` + đủ quyền ⇒ vắng kudos. C3 giữ nguyên.
- **KD** nháp: thêm trùng (khác hoa-thường) ⇒ 1 lần; người thứ 11 ⇒ nháp NGUYÊN tham chiếu; bỏ người; thứ tự lỗi; payload `recipientEmployeeIds` đã SẮP XẾP + lowercase (chọn B rồi A ⇒ `[a,b]`); `badgeId` vắng khi null; `isOfficial:false` khi `!canOfficial` dù nháp true; payload ĐẦY ĐỦ `createFeedPostSchema.safeParse(...).success`.
- **KF** ô chọn: gõ `"a"` / `"a."` ⇒ spy `searchRecipients` **0 lần** + gợi ý; `"an"` ⇒ gọi với `"an"`; `"  An  "` ⇒ gọi với `"An"`; không `create:feed-kudos` ⇒ 0 lần; `truncated` ⇒ gợi ý; bấm ứng viên ⇒ chip; 10 người ⇒ option disabled; bỏ chip; **không `<img>`** trong vùng chọn; checkbox «chính thức» DENY/ALLOW theo `manage:feed-kudos`; select huy hiệu hiện huy hiệu 048 (đợi option xuất hiện — bẫy race `<select>` nạp bất đồng bộ) + mặc định «Không gắn».
- **KS** gửi: payload qua schema; reject ⇒ nháp + lời nhắn còn nguyên; resolve ⇒ dọn; nút khoá khi đang gửi.
- **KE** lỗi (`use-create-post.spec`): `ApiError(422,"SOCIAL-ERR-KUDOS-SELF-RECIPIENT")` ở bảng tin ⇒ `reason:"kudosSelf"`; 403 `…OFFICIAL-DENIED` ⇒ `kudosOfficialDenied` + `forbidden:true`; 422 `SOCIAL-ERR-022` ⇒ `kudosBadgeInvalid` + invalidate `kudos.badges`; ERR-012 bảng tin ⇒ vẫn `null` (ca cũ). Tạo kudos thành công ⇒ invalidate `kudos.lists()`; `invalidatePostLists` gồm `kudos.lists()`.
- **KB** khối: tên người nhận; pill «Đã nghỉ việc» ⇔ `isFormerEmployee`; `fullName:null`+`isFormerEmployee:false` ⇒ «Đồng nghiệp», KHÔNG pill, KHÔNG link; `fullName` có ⇒ link `/feed/profiles/$employeeId`; `badge:null` ⇒ «Vinh danh»; icon lạ ⇒ mặc định; emoji ⇒ chữ; `isOfficial` ⇒ pill; `message:null` ⇒ không chữ «null»; `recipients:[]` không ném; **không `<img>`**. PostCard kudos CÓ khối ⇒ `kudos-block`; C27 (kudos KHÔNG khối) ⇒ vẫn suy biến, không `kudos-block`.
- **KM** tháng: `currentKudosMonth(new Date("2026-09-30T17:30:00Z"))` = `"2026-10"` (00:30 ngày 1/10 giờ VN — mutant dùng UTC/`getMonth` máy ĐỎ); `shift("2026-01",-1)="2025-12"`; `shift("2026-12",+1)="2027-01"`; `shift("1900-01",-1)=null`.
- **KR** search parser ăn ĐẦU RA parser thật: `?month=2026-09` ⇒ giữ; `?month=202609` (số) ⇒ bỏ; `?month=2026-13` ⇒ bỏ; `?page=2` (số) ⇒ 2; `?page=1` ⇒ bỏ.
- **KP** màn 009: loading · lỗi + thử lại · rỗng; mặc định gọi `month` = tháng hiện tại; ‹ ⇒ tháng trước + bỏ page; › disabled ở tháng hiện tại; dòng có link «Xem bài».
- **KW** widget: `view:feed` vắng ⇒ spy `list` 0 lần; có ⇒ gọi `{month:<hiện tại>, limit:5}`; rỗng; 5 người nhận ⇒ 3 tên + «+2»; «Xem tất cả» → `/feed/kudos`; không `<img>`.
- **R1** wiring: sidebar 7 mục gồm `social.kudos`; 11 route; `SOC-SCREEN-009` gate `view:feed`, `MODULE_PORTAL`; snapshot regen (diff trích PR).
- **I1** `ActionErrorBanner.spec` (lặp tập reason) xanh với 6 reason mới — chữ ≠ khoá thô.

## 5. Gate & kiểm

- Trong vòng: `bash harness/check.sh --quick`. Trước gate: rebuild contracts + web-core; `pnpm --filter @mediaos/app test:social-cov` (đọc 4 số, sàn 80) + `pnpm --filter @mediaos/api typecheck` (D2) + spec contracts/web-core.
- Mutant tối thiểu (mỗi cái đỏ ĐÚNG ca, đúng thông điệp): (m1) bỏ `!groupId` ⇒ G1; (m2) bỏ sắp xếp payload ⇒ KD; (m3) truyền `src` cho Avatar ở `KudosBlock` ⇒ KB no-img; (m4) cổng `q.length>=2` thay schema ⇒ KF `"a."`; (m5) tháng theo UTC ⇒ KM; (m6) bỏ `kudosErrorReason` ⇒ KE; (m7) đảo kiểu D2 (`description` → `string`) ⇒ api typecheck đỏ.
- Gate LIGHT (Opus): `typescript-reviewer` + reviewer React trên diff. Trước PR: `bash harness/check.sh --all`.
- **Điều kiện MERGE (owner)**: PROD API đã ở ≥ #555 (BE-2D). FE auto-deploy khi merge, API deploy tay — FE-2C gặp API cũ ⇒ `059` 404 (ô chọn báo lỗi, không vỡ màn) và thẻ kudos suy biến. Ghi đầu PR body.

## 6. Rủi ro

- **R1** scope mù của `useCan` (L11 FE-2): vai tuỳ biến giữ `create:feed-kudos`/`manage:feed-kudos` ở scope < Company thấy nút rồi ăn 403 ⇒ đã có reason `kudosCreateDenied`/`kudosOfficialDenied` nói đúng lý do. Vai canonical hôm nay chỉ Company.
- **R2** kudos của bài ẩn hiện ở 047 với quản lý/tác giả (M4) — không đánh dấu được (047 không chở status). Chấp nhận.
- **R3** Tự vinh danh: server loại ở 059 và chặn 422 ở 002; FE không lọc được (auth store không có `employeeId`) — nhánh 422 chỉ tới được bằng client khác ⇒ test bằng `ApiError` mock.
- **R4** catalog >100 huy hiệu bị cắt ở select (1 trang) — seed 5; ghi nợ.

## 7. Nợ / ngoài phạm vi (ghi vào PR)

- **N1** `src` thô ngoài kudos (`PostCard.tsx:82` · `CommentList.tsx:67` · `BirthdayWidget.tsx:90` · `GroupMembersTab.tsx:123` · `GroupRequestsTab.tsx:88`) — `S16-SOCIAL-AVATARPRESIGN-1` là WO BE, paths không có `apps/app` ⇒ T0 bổ sung vế FE vào WO đó: «sau khi ký URL: bật lại `src` ở bề mặt kudos/059 (FE-2C chỉ vẽ chữ cái)».
- **N2** `PollBlock` chưa seed cache `043` từ `post.poll`, pill sáng kiến chưa đọc `post.idea` (BE-2D đã chở; không WO nào sở hữu) ⇒ seed WO FE amber `S16-SOCIAL-FEBLOCKSEED-1`.
- **N3** Wireframe «N lượt/người» cần route tổng hợp BE — O1 chọn không làm.
- **N4** API-19 row 047 thiếu mô tả `month`/`page`/`limit` — docs nợ, không chặn.

## 8. Lượt 2 — vá theo `plan-reviewer` (29/09/2026, BLOCK 2 HIGH · 6 MEDIUM · 0 CRITICAL) — GHI ĐÈ §2–§5

Reviewer xác nhận M1–M17 đúng, không vi phạm `paths`, O1–O4 không bị ảnh hưởng. Tự xác minh H1 (`query-keys.ts:1446-1449`) + H2 (`PollsPage.spec.tsx:25-28`).

| Finding | Vá |
| --- | --- |
| **H1** `kudos.badges()` invalidate KHÔNG khớp `badges({limit:100})` (so khớp theo PHẦN TỬ) | `socialKeys.kudos.badges` KHÔNG tham số (1 trang, `limit` cố định trong client) ⇒ key duy nhất. KE seed ĐÚNG key thật rồi assert `getQueryState(key)?.isInvalidated`; cùng cách cho `kudos.lists()` với key widget `list({month,limit:5})` + key màn 009. |
| **H2** mock `Link` bỏ `params` ⇒ link sai id vẫn xanh | Spec mới dùng mock NỘI SUY params (khuôn `PollsPage.spec.tsx:25-28`, mở rộng cho `$employeeId`). KB/KP/KW assert `href === "/feed/posts/<postId>"` + KHÔNG chứa `kudosId`; `/feed/profiles/<employeeId>`. |
| **M-a** «không `<img>`» xanh vì fixture `avatarUrl:null` | MỌI fixture no-img (KB/KF/KW/KP) mang `avatarUrl` KHÁC rỗng (`"https://x.invalid/p.png"`). m3 mở rộng: `src` ở danh sách 059 + widget cũng phải đỏ. |
| **M-b** ca DENY của KF xanh trước khi debounce 300ms nổ | Chờ QUA debounce trước khi assert 0 lần (ca ALLOW `"an"` cùng nhịp — `waitFor` spy gọi); DENY chờ cùng mốc rồi assert 0. |
| **M-c** m5/KM chỉ đỏ trên máy KHÔNG ở giờ VN | KM mock `companyTimeZone` → `"Pacific/Kiritimati"` (UTC+14) và/hoặc đặt ca biên sao cho giờ máy VN cũng khác; KW/KP `vi.setSystemTime(new Date("2026-09-30T17:30:00Z"))` (fake CHỈ `Date`) + assert literal `"2026-10"`. |
| **M-d** `badgeId` cũ còn trong nháp sau 022 | Khi reason `kudosBadgeInvalid` HOẶC danh sách 048 mới không còn `draft.badgeId` ⇒ `KudosComposerFields` đặt `badgeId:null` (effect so tập id). Ca test riêng. |
| **M-e** 2 `role="alert"` trùng (body rỗng/quá dài + lỗi nháp) | `kudos` bị LOẠI khỏi 2 alert chung (`!isPoll && !isKudos`, `tooLong && !isKudos`); nháp kudos sở hữu `messageRequired`/`messageTooLong` + lỗi người nhận — MỘT alert `composer-kudos-error`. |
| **M-f** spec cũ gãy / gọi mạng thật | `SocialPortalShell.spec` factory thêm `socialKudosApi:{...actual.socialKudosApi, list}`; ca kudos của composer dùng `renderWithProviders` + mock `socialKudosApi` (KF/KS ở file MỚI `KudosComposerFields.spec.tsx`, `FeedComposer.spec` 439 dòng chỉ nhận C4''/G1); `social-wiring.spec` sửa cả mảng thứ tự `:47-54` (kudos giữa polls/groups) · tập `showInSidebar` `:116-126` · tiêu đề `:88`/`:102`. |
| L | D16 thêm: `use-create-post.ts:10-15` · `use-create-post.spec.tsx:83-84` · `PostCard.spec.tsx:197,206` · `ActionErrorBanner.tsx:52-56` · `sidebar/social.ts:8,16-17`. Danh sách 059 = danh sách NÚT thường (bỏ `role=listbox` — anti-pattern với con là button). Emoji huy hiệu bọc `<bdi>`. Widget dùng cùng fallback tên. Màn 009: `createdAt` qua `relativeTime`; `page` quá trang cuối (`total>0`, `data=[]`) ⇒ KHÔNG hiện «chưa có vinh danh» mà hiện pager/nút về trang 1. `-u` chỉ trên file snapshot sidebar. m7: rebuild contracts giữa mutant và api typecheck. `KUDOS_RECIPIENT_MAX` nhân đôi không lưới — ghi PR. |
