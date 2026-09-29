# S16-SOCIAL-FE-2 — FE track B: Bình chọn · Sáng kiến · Nhóm · Vinh danh

> Trạng thái: **plan v2 (29/09/2026)** — `plan-reviewer` lượt 1 BLOCK (0 CRITICAL · 5 HIGH · 5 MEDIUM
> · 5 LOW), đã vá hết ở **§8** (§8 GHI ĐÈ §3–§6 nơi mâu thuẫn). Owner ký S1 · S2 · S3(a) 29/09/2026. Nhánh `feat/s16-social-fe-2` cắt từ
> master `50b3bc64`. Zone amber, gate LIGHT (`notes` của WO). Quyền chỉ qua `useCan`/`PermissionGate`
> + vai trò nhóm từ DTO.

## 0. Tóm tắt quyết định phạm vi

WO gốc gom 4 màn (006 Nhóm · 007 Bình chọn · 008 Sáng kiến · 009 Vinh danh) + composer 3 loại + 3
widget rail phải. Đo ở §1 cho thấy **hai trong bốn cụm KHÔNG dựng được trọn vẹn bằng hợp đồng BE hiện
có** (§2). ⇒ Tách 3 lát, mỗi lát một PR:

| Lát | Nội dung | Phụ thuộc BE | Phiên |
| --- | --- | --- | --- |
| **A** (WO này, id giữ `S16-SOCIAL-FE-2`) | Bình chọn (composer · khối poll trong thẻ bài · màn 007 · widget «Bình chọn đang mở») + Sáng kiến (composer · thân bài idea · màn 008 + xét duyệt) | Không — `040..046` đủ | này |
| **B** (`S16-SOCIAL-FE-2B`, seed mới) | Nhóm 006: danh sách · trang nhóm (feed `groupId`) · thành viên · xin vào/duyệt · cài đặt · composer `audience='group'` · «Nhóm của tôi» rail | Không — `030..039` + `001?groupId` đủ; **badge «bài mới» theo nhóm chờ `BE-2C`** (G3) | sau |
| **C** (`S16-SOCIAL-FE-2C`, seed mới) | Vinh danh 009: composer kudos · khối kudos trong thẻ bài · màn danh sách · widget «Vinh danh tháng này» | **CÓ** — G1 + G2 chặn composer và thẻ bài | sau BE |

`S16-SOCIAL-FE-3` đổi `depends_on` từ `[FE-2]` thành `[FE-2, FE-2B, FE-2C]` (ô liên kết nhanh + màn
010..012 cần cả rail đã đủ khối).

## 1. Phép đo (đã chạy, 29/09/2026 trên `50b3bc64`)

| # | Đo | Kết quả |
| --- | --- | --- |
| M1 | `feedPostSchema` (`packages/contracts/src/social-api.ts:185-217`) có chở chi tiết poll/idea/kudos? | **KHÔNG.** Chỉ `type: z.string()` + `body` (nullable với poll/kudos). |
| M2 | Có schema RESPONSE trong contracts cho `040/041/042/043/044/045/046/047/048`? | **KHÔNG** — `social-api-polls.ts` (44 dòng) · `social-api-ideas.ts` (62) · `social-api-kudos.ts` (151) chỉ có schema REQUEST + catalog huy hiệu quản trị. Hình dạng response sống trong service BE. |
| M3 | Hình dạng `041/042/043/044` | **MỘT** hình dạng cho cả 4: `SocialPollsService.readResultsTx` (`social-polls.service.ts:397-419`) = `{pollId, postId, question, status, multipleChoice, isAnonymous, closesAt, totalVoters, myVote: string[], options: [{id,label,voteCount}]}`. |
| M4 | Hình dạng `040` | `{data: [{pollId, postId, question, status, isAnonymous, closesAt, closedAt, createdAt}], page, limit, total}` (`social-polls.service.ts:54-80`). **Không** `multipleChoice`, **không** số phiếu. |
| M5 | Hình dạng `045` / `046` | `045`: `{data: [{ideaId, postId, status, body, reviewNote (MASK D19 — null với người không phải tác giả/`approve:feed-idea`), reviewer: {fullName}|null, reviewedAt, createdAt}], page, limit, total}` (`social-ideas.service.ts:19-28,55-85,221-233`). **Không có tác giả.** `046`: `{postId, ideaId, status, reviewedAt}` (`:162`). `IdeaItemDto.status` khai `string` (`:22`), repo có `FeedIdeaStatusDto` (`social-ideas.repository.ts:27`). |
| M6 | FSM sáng kiến | 3 cạnh: `submitted→under_review`, `under_review→accepted`, `under_review→rejected` (SPEC-16 §13.3; `feedIdeaReviewTargetSchema` loại `submitted`). `rejected` bắt buộc note (422 ở service). |
| M7 | Cặp tạo theo loại (`SOCIAL_POST_TYPE_PAIRS`, `social-route-pairs.const.ts:394-410`) | `poll → create:feed-poll` · `idea → create:feed-idea` · `kudos → create:feed-kudos` — seed `0578:75-86` cấp **cả 4 vai canonical** @Company. `approve:feed-idea` → `hr` + `company-admin` (`0578:102-103`). |
| M8 | Đóng poll `044` | chủ bài **hoặc** `manage:feed-post` (`assertCanMutateContent`, `social-polls.service.ts:204`). |
| M9 | web-core `socialApi` (`packages/web-core/src/lib/social-api.ts`, 316 dòng) | Chỉ Nhóm A + 020..026. **0 hàm** cho `030..048`. `socialKeys` (`query-keys.ts:1377`) chưa có nhánh polls/ideas/groups/kudos. |
| M10 | Sidebar | `SOCIAL_SIDEBAR_V2` (`layouts/workspace/sidebar/social.ts`) **đã khai sẵn** `social.ideas` `/feed/ideas` · `social.polls` `/feed/polls` · `social.groups` `/feed/groups`, cắt bởi `pruneUnbuiltScreens` ⇒ thêm route là mục tự hiện. `social-wiring.spec.ts:112` ghim tập `["social.feed","social.news","social.saved"]` ⇒ PHẢI sửa theo. |
| M11 | `ROUTE_REGISTRY` SOCIAL | order 92..97 (`registry.ts:2227-2291`); 98/99 trống (100+ ở `:867…` thuộc `APP_REGISTRY`, mảng khác). |
| M12 | Composer FE-1 | `FeedComposer.tsx` (236 dòng) ĐÚNG 2 nút, ca **C4** ghim số 2 như «cổng chống mở phạm vi». `isFullyRenderableType` (`feed-format.ts:82`) = `share|news` ⇒ bài `idea` hôm nay KHÔNG vẽ thân (dù body bắt buộc với idea). |
| M13 | Đường báo lỗi ghi | `ActionErrorBanner` (`kind` × `forbidden`) + i18n `actionError.{forbidden,generic}.<kind>`; `useFeedActions` có `actionError`. Bài học FE-1: **0 `onError` ⇒ mọi ghi hỏng im lặng** — mỗi `useMutation` mới PHẢI có `onError`. |
| M14 | Ô chọn người cho nhân viên thường | `EmployeeMultiPickerDialog` đi `GET /hr/employees` scope `read:employee` — vai `employee` giữ **`read:employee@Own`** (`permission-matrix-spec.md:73,103`) ⇒ nhân viên thường chỉ thấy CHÍNH MÌNH. Không route SOCIAL nào liệt kê đồng nghiệp dưới `view:feed`. |
| M15 | Coverage | `test:social-cov` chạy `src/routes/social src/layouts/portal src/hooks` (`apps/app/package.json:14`) ⇒ file mới dưới `routes/social/**` tự vào cổng. |

## 2. Khoảng trống BE (chặn lát C, một phần lát B) — cần owner chốt

| # | Khoảng trống | Hệ quả nếu FE làm liều | Đề xuất |
| --- | --- | --- | --- |
| **G1** | Thẻ bài `kudos` không có dữ liệu để vẽ: `feedPostSchema` không chở người nhận/huy hiệu/lời nhắn (M1); `047` chỉ liệt theo tháng/gần đây, **không lọc theo `postId`** | Thẻ kudos trong feed chỉ còn vỏ (R16 hiện tại), hoặc FE phải kéo `047` rồi dò `postId` — sai với bài cũ hơn trang đầu | WO BE mới **`S16-SOCIAL-BE-2D`**: thêm khối `kudos?` (và nên cả `poll?` tóm tắt · `idea?` trạng thái) OPTIONAL vào `feedPostSchema`, nạp theo LÔ (khuôn `mentions` BE-1D) |
| **G2** | Composer kudos cần chọn **đồng nghiệp** (`recipientEmployeeIds`) mà nhân viên thường không liệt kê được ai (M14) | Composer kudos chỉ dùng được với HR/admin — 45/46 người dùng thấy ô chọn rỗng | Cùng WO `BE-2D`: route tra người `view:feed` (tên+avatar nhân sự `active`, `q` tối thiểu N ký tự, trần kết quả) — là **quyết định danh bạ** (cùng lớp oracle của `ERR-009`) ⇒ owner ký |
| **G3** | Badge «bài mới» theo nhóm ở rail cần room WS nhóm — chính là `S16-SOCIAL-BE-2C` (chưa làm) | — | Lát B ship «Nhóm của tôi» **không badge**, badge nối khi BE-2C xong |
| G4 | Pill trạng thái sáng kiến trên thẻ bài trong feed | Chỉ màn 008 hiện pill (M5 có `status`); thẻ feed chỉ hiện nhãn «Sáng kiến» + link sang 008 | Nối khi `BE-2D` thêm `idea?` vào DTO bài. KHÔNG chặn lát A |

## 3. Quyết định lát A

- **D1 — Schema response vào contracts** (M2): thêm vào `social-api-polls.ts` · `social-api-ideas.ts`:
  `feedPollOptionResultSchema` · `feedPollResultsSchema` (041..044) · `feedPollListItemSchema` ·
  `feedPollPageSchema` (040) · `feedIdeaItemSchema` · `feedIdeaPageSchema` (045) ·
  `feedIdeaReviewResultSchema` (046). Không `.strict()` (khuôn response hiện có). `status` dùng enum
  (`feedPollStatusSchema`/`feedIdeaStatusSchema`), KHÔNG `z.string()`.
- **D2 — Neo kiểu BE ↔ contracts, TYPE-ONLY** (mở `paths` thêm 2 file BE): chú thích kiểu trả về
  `Promise<FeedPollResultsDto>` / `Promise<FeedPollPageDto>` ở `SocialPollsService.{list,vote,
  withdrawVote,results,close}` và `Promise<FeedIdeaPageDto>` / `Promise<FeedIdeaReviewResultDto>` ở
  `SocialIdeasService.{list,review}`; `IdeaItemDto` (`:19-28`) thay bằng type từ contracts
  (`status: string` → enum). **Không đổi hành vi runtime.** Lý do: không có neo này thì schema FE
  là bản sao tay của interface BE — lệch là **Zod ném lúc chạy** ở FE (màn lỗi) thay vì **TS đỏ lúc
  build**. Nếu owner không muốn chạm `apps/api` ở WO FE ⇒ bỏ D2, rủi ro trôi ghi nợ.
- **D3 — Client** `socialApi` thêm 7 hàm (`listPolls` · `votePoll` · `withdrawPollVote` ·
  `getPollResults` · `closePoll` · `listIdeas` · `reviewIdea`), parse bằng schema D1. `socialKeys`
  thêm `polls: {allOf, list(params), results(postId)}` · `ideas: {allOf, list(params)}`.
- **D4 — Composer 4 nút**: Chia sẻ · Tin tức (`manage:feed-news`, như cũ) · **Bình chọn**
  (`create:feed-poll`) · **Sáng kiến** (`create:feed-idea`). Vinh danh VẮNG cho tới lát C (G1/G2) —
  C4 đổi từ «đúng 2» thành «đúng 4 và KHÔNG có kudos», docblock ghi lý do mới. Form poll tách
  component `PollComposerFields` (câu hỏi · 2–10 lựa chọn thêm/bớt · 1/nhiều · ẩn danh · hạn đóng
  tuỳ chọn). Kiểm phía client mirror luật service (2–10, hạn ở tương lai) để chặn sớm, **nhưng** mã
  422/409 của server vẫn được hiện (không nuốt).
- **D5 — Khối poll trong thẻ bài**: `PostCard` vẽ `<PollBlock postId>` khi `type==='poll'`; khối tự
  tải `043` (lazy theo thẻ — N thẻ poll trên một trang = N request; chấp nhận ở lát A, gỡ khi `BE-2D`
  nhúng tóm tắt poll vào DTO bài). Radio (một lựa chọn) / checkbox (nhiều), thanh % theo
  `voteCount/totalVoters`, đánh dấu `myVote`, «Rút phiếu» khi có `myVote` và còn `open`, «Đóng bình
  chọn» khi `open` **và** (`post.isMine` **hoặc** `useCan('manage','feed-post')`). Kết quả mutation
  ghi thẳng vào cache `socialKeys.polls.results(postId)` (041..044 trả đủ trạng thái — không cần gọi
  lại `043`). 409 `ERR-016` (poll vừa đóng) ⇒ banner + invalidate `results`.
- **D6 — Thân bài `idea`**: `isFullyRenderableType` thêm `idea` (body bắt buộc với idea — M12), thẻ
  thêm nhãn «Sáng kiến» + link `/feed/ideas`. Pill trạng thái chỉ ở màn 008 (G4).
- **D7 — Màn 007 `/feed/polls`**: tab Đang mở / Đã đóng / Tất cả → `status` của `040`; phân trang
  OFFSET; mỗi dòng: câu hỏi · pill trạng thái · nhãn ẩn danh · mốc đóng · link `/feed/posts/$postId`
  (khối poll đầy đủ ở màn chi tiết). Loading / error + thử lại / empty.
- **D8 — Màn 008 `/feed/ideas`**: lọc 4 trạng thái + Tất cả; dòng: thân rút gọn · pill · người
  duyệt/lúc duyệt · `reviewNote` (chỉ khi server trả khác null — masking là việc của server) · link
  bài. Nút «Xét duyệt» bọc `PermissionGate approve:feed-idea`; hộp thoại chỉ đưa các ĐÍCH hợp lệ
  theo FSM từ trạng thái hiện tại (hàm thuần `ideaReviewTargets(status)`, test vét cạn 4 trạng
  thái); `rejected` bắt buộc ghi chú phía client **và** hiện 422 server nếu lọt; 409 `ERR-019`
  (người khác duyệt trước) ⇒ banner + invalidate `ideas`.
- **D9 — Widget «Bình chọn đang mở»** rail phải: `040 status=open limit=5`, `enabled: canViewFeed`
  (khuôn `SocialPortalShell`), empty state, link bài.
- **D10 — Route**: `social.polls` `/feed/polls` SOC-SCREEN-007 order 98 · `social.ideas`
  `/feed/ideas` SOC-SCREEN-008 order 99, `requiredPermissions: ["view:feed"]`, `MODULE_PORTAL`;
  sidebar tự hiện (M10). i18n `routeTitle.socialPolls/socialIdeas` ở `web-core/.../nav.ts`.
- **D11 — Mọi `useMutation` mới có `onError`** → `ActionErrorBanner` với kind mới `vote` ·
  `pollClose` · `ideaReview` (403 tách khỏi lỗi chung). Ca test đếm: mỗi mutation có ca lỗi.

## 4. Các bước lát A

| Bước | Việc | File |
| --- | --- | --- |
| T0 | backlog: FE-2 `in_progress`, thu hẹp `title`/`done_when` về lát A, seed `FE-2B`/`FE-2C`/`BE-2D`, sửa `depends_on` FE-3, mở `paths` cho D2 | `harness/backlog.mjs` |
| T1 | Schema response D1 + spec contracts | `packages/contracts/src/social-api-{polls,ideas}.ts` (+spec) |
| T2 | Neo kiểu D2 (type-only) | `apps/api/src/social/social-{polls,ideas}.service.ts` |
| T3 | Client + query keys D3 (+spec URL/method/parse) | `packages/web-core/src/lib/{social-api,query-keys}.ts` |
| T4 | `PollBlock` + hàm thuần tính % + spec | `routes/social/feed/components/PollBlock.tsx`, `lib/poll-format.ts` |
| T5 | `PostCard` nhánh poll/idea + `isFullyRenderableType` + spec C27 cập nhật | `PostCard.tsx`, `feed-format.ts` |
| T6 | Composer 4 nút + `PollComposerFields` + spec (C4 mới) | `FeedComposer.tsx`, `PollComposerFields.tsx` |
| T7 | Màn 007 + 008 (+ hộp thoại xét duyệt, `ideaReviewTargets`) + spec | `routes/social/polls/PollsPage.tsx`, `routes/social/ideas/IdeasPage.tsx`, `IdeaReviewDialog.tsx` |
| T8 | Widget rail + `SocialPortalShell` | `components/OpenPollsWidget.tsx` |
| T9 | Registry + router + i18n + `social-wiring.spec` | `registry.ts`, `router.tsx`, `nav.ts`, `social.ts` |
| T10 | `check.sh --quick` → `pnpm --filter @mediaos/app test:social-cov` → gate LIGHT → PR | — |

## 5. Ca test bắt buộc (mỗi ca DENY đứng cạnh ca ALLOW)

- **P1** nút «Bình chọn»: không `create:feed-poll` ⇒ vắng · có ⇒ hiện; tương tự **P2** «Sáng kiến» /
  `create:feed-idea`. **C4'** tập nút = `{share, news?, poll, idea}`, KHÔNG có kudos.
- **P3** form poll: 1 lựa chọn ⇒ nút Đăng khoá · 11 lựa chọn ⇒ không thêm được · hạn đã qua ⇒ báo
  lỗi; payload đúng hình `createFeedPostSchema` (parse bằng chính schema — không so object tay):
  `type:'poll'`, không `body` khi bỏ trống, `closesAt` ISO có offset.
- **P4** `PollBlock`: một-lựa-chọn vẽ radio, nhiều vẽ checkbox; bỏ phiếu gọi `PUT …/poll/vote` với
  `optionIds`; % đúng khi `totalVoters=0` (không chia 0, không `NaN%`); «Rút phiếu» chỉ khi có
  `myVote` + `open`; `closed` ⇒ input disabled + nhãn.
- **P5** «Đóng bình chọn»: người khác + không `manage:feed-post` ⇒ vắng · `isMine` ⇒ hiện ·
  `manage:feed-post` (không phải chủ) ⇒ hiện · poll `closed` ⇒ vắng.
- **P6** lỗi ghi: vote 409 ⇒ `feed-action-error` kind `vote` + query `results` bị invalidate; 403 ⇒
  nhánh `forbidden`; close 500 ⇒ banner (mutant bỏ `onError` phải ĐỎ ca này).
- **I1** `ideaReviewTargets`: `submitted→[under_review]` · `under_review→[accepted,rejected]` ·
  `accepted→[]` · `rejected→[]` (vét cạn; trạng thái terminal ⇒ nút xét duyệt vắng).
- **I2** nút «Xét duyệt»: không `approve:feed-idea` ⇒ vắng · có ⇒ hiện.
- **I3** chọn `rejected` không ghi chú ⇒ không gửi được; gửi đúng body `reviewFeedIdeaSchema`; 409 ⇒
  banner kind `ideaReview` + invalidate `ideas`; 422 ⇒ banner.
- **I4** `reviewNote: null` ⇒ không vẽ khối ghi chú (không vẽ chữ «null»).
- **L1** màn 007/008: loading · error + thử lại · empty; đổi tab/lọc ⇒ query mang đúng `status`.
- **W1** widget: `canViewFeed=false` ⇒ không gọi `040` (spy 0 lần) · có ⇒ gọi `status=open`.
- **R1** `social-wiring`: sidebar có `social.polls` + `social.ideas`, `social.groups` VẪN bị cắt;
  2 route mới gate `view:feed`, `MODULE_PORTAL`.
- **K1** contracts: `feedPollResultsSchema` parse mẫu đúng hình M3; `feedIdeaItemSchema` từ chối
  `status` ngoài enum.

## 6. Gate & kiểm

- Trong vòng: `bash harness/check.sh --quick`. Trước PR: `pnpm --filter @mediaos/app test:social-cov`
  (đọc số, không tin «xanh») + `bash harness/check.sh` (full, không cần `LANE_DB` — lát A không đổi
  DB/permission; D2 là type-only).
- Gate LIGHT: `typescript-reviewer` (+ react) trên diff. Mutant tối thiểu: bỏ `onError` ở vote ·
  đảo cổng close (`||`→`&&`) · `ideaReviewTargets` trả thêm `submitted` — mỗi cái phải đỏ đúng ca.
- `grep -c onError apps/app/src/routes/social` trước/sau: tăng đúng số mutation mới.

## 7. Cần owner ký

- **S1** tách 3 lát như §0 (lát A = WO này; seed FE-2B/FE-2C/BE-2D; FE-3 phụ thuộc cả 3).
- **S2** D2 — cho WO FE chạm `apps/api/src/social/social-{polls,ideas}.service.ts` ở mức TYPE-ONLY.
- **S3** G2 — hướng cho ô chọn người nhận vinh danh: (a) route tra người mới dưới `view:feed` ở
  BE-2D · (b) chỉ HR/admin soạn kudos (dùng picker HR hiện có) · (c) khác.

> ✍️ **Owner ký 29/09/2026:** S1 tách 3 lát ✅ · S2 D2 type-only ✅ · S3 hướng (a) route tra người
> dưới `view:feed` ở `BE-2D` (FULL gate) ✅.

## 8. Lượt 2 — vá theo `plan-reviewer` (GHI ĐÈ §3–§6)

| Finding | Vá |
| --- | --- |
| **H1** D2 không biên dịch nổi trong 2 file | T2 thêm `social-ideas.repository.ts`: `IdeaListRow.status: string` → `FeedIdeaStatusDto` (cột drizzle đã `$type<FeedIdeaStatus>`, `db/schema/social.ts:736`). **CẤM `as`** trong mọi hunk D2. Hunk D2 CHỈ là chú thích kiểu trả về + import — không đụng thân method (hai file có `audit.record`/`resolveActor`). D2 BẮT: thiếu/đổi tên trường · đổi nullability · đổi enum/kiểu. D2 KHÔNG BẮT: tinh chỉnh `uuid`/`datetime`/`int` và trường THỪA phía BE (Zod bóc im lặng). T10 thêm `pnpm --filter @mediaos/api typecheck` + chạy lại spec unit poll/idea của `apps/api/src/social`. |
| **H2** phiếu nhiều-lựa-chọn mất lựa chọn cũ | `vote()` XOÁ hết phiếu của actor rồi GHI `wanted` (`social-polls.service.ts:116-156`) ⇒ PUT LUÔN gửi **CẢ TẬP** đang chọn (`toggleSelection` trả tập đầy đủ). Bỏ ô cuối ⇒ gửi `[]` (service coi là rút phiếu). Ca **P4b**: `myVote=[A]`, tích B ⇒ payload `{optionIds:[A,B]}`. |
| **H3** test cũ sẽ gãy | Thêm vào bước tương ứng: (a) `sidebar-registry.snapshot.spec.ts` — 2 snapshot `sidebar-tree.raw.txt` / `.by-permission.txt` regen bằng `-u`, trích diff vào PR (T9); (b) `social-wiring.spec.ts` `:44-48` · `:84` (6→8) · `:112` (T9); (c) `PostCard.spec.tsx` bọc `QueryClientProvider`, C27 viết lại cho hành vi mới (T5); (d) `FeedComposer.spec.tsx` C4 + ca `*:*` (T6); (e) `SocialPortalShell.spec.tsx` mock `listPolls` (T8). |
| **H4** poll quá hạn mà job chưa đóng | Hàm thuần `isPollAcceptingVotes(r, now)` = `status==='open' && (closesAt==null \|\| Date.parse(closesAt) > now)`. Gác input · «Bỏ phiếu» · «Rút phiếu» · nhãn widget. «Đóng bình chọn» vẫn theo `status==='open'` (đóng tay poll quá hạn là hợp lệ phía server). Ca **P4c**: `closesAt` quá khứ + `status:'open'` ⇒ input disabled + nhãn «Đã hết hạn». |
| **H5** cache cũ | Ma trận invalidate (thêm `FeedPage.tsx` + `use-feed-actions.ts` vào T6): tạo bài `poll` ⇒ `polls.allOf()`; tạo `idea` ⇒ `ideas.allOf()`; xoá/ẩn bài (`invalidatePostLists`) ⇒ cả `polls.allOf()` + `ideas.allOf()`; đóng poll ⇒ ghi `results(postId)` + invalidate `polls.list`; xét duyệt ⇒ invalidate `ideas.allOf()`. Mỗi đường một ca spy `invalidateQueries`. |
| **M6** banner không nói được mã lỗi | Đo: service ném **chuỗi** (`"SOCIAL-ERR-016: …"`), filter gán `code = httpStatusToCode(409)` = mã chung (`all-exceptions.filter.ts:100-103`) ⇒ FE KHÔNG phân biệt được 016/017/`POLL_WRITE_BUSY` bằng `code`. **Bỏ lời hứa «hiện mã 422/409» của D4.** Thay: 3 kind mới `vote` · `pollClose` · `ideaReview` với chữ TRUNG TÍNH + hành vi tự giải thích — vote/close lỗi ⇒ invalidate `results(postId)` nên poll vừa đóng tự hiện «Đã kết thúc»; review 409 ⇒ invalidate `ideas`. Banner của `PollBlock` render TRONG khối (state riêng của khối, không qua `useFeedActions`). Ca: text banner ≠ khoá i18n thô. |
| **M7** kiểm client chưa đủ | Form poll: `question` trim 1–500 · mỗi lựa chọn trim 1–255 (hàng rỗng chặn gửi, không gửi đi) · 2–10 hàng · **chặn nhãn trùng** (sau trim, không phân biệt hoa thường — BE không chặn, 2 ô giống nhau là poll vô nghĩa) · `body` rỗng ⇒ BỎ khoá (không gửi `""`) · `closesAt` = `new Date(v).toISOString()` từ `datetime-local`, phải > now · giữ luật «không dọn khi chưa resolve» cho CẢ các trường poll. Payload P3 parse bằng `createFeedPostSchema.safeParse` trong test. |
| **M8** mô tả của poll mất | Composer poll dùng ô soạn chính làm **mô tả tuỳ chọn**; `isFullyRenderableType` = `share\|news\|poll\|idea` (`PostBody` tự trả null khi body null). `kudos` vẫn suy biến (lát C). |
| **M9** nợ mồ côi | Seed **`S16-SOCIAL-FE-2D`** (FE, amber): UI đính kèm composer + bình luận qua `054/055` (nợ N1 FE-1 · `backlog` BE-1C) · mention thành link (nợ R3 BE-1D) · `droppedMentions` của bình luận (nợ FE-1 §9). Ghi ngoài phạm vi lát A. |
| **M10** done_when | T0 sửa done_when: «routes-authz» = ca R1 `social-wiring`; pill trạng thái sáng kiến chỉ ở màn 008 (G4). Trước PR chạy `bash harness/check.sh --all` (có build 3 app). |
| L11 | `useCan` bỏ qua scope, BE đòi sàn Company cho `manage:feed-post`/`approve:feed-idea` — seed chỉ cấp Company nên hôm nay không lệch; cùng đánh đổi `PostCardMenu.tsx:49-51`. Ghi docblock. |
| L12 | `closePoll` gửi `idempotencyKey: idempotencyKeyFor("social-poll-close", {postId})` (044 có `@Idempotent()`). |
| L13 | `feedIdeaItemSchema.body` `.nullable()` — đã đúng ở T1. |
| L14 | Ghi chú xét duyệt: trim, ≤ `FEED_NOTE_MAX`, rỗng ⇒ BỎ khoá `reviewNote`; hộp thoại báo «ghi chú mới THAY ghi chú cũ» khi item đã có `reviewNote`. |
| L15 | `PollBlock` nhận `postId` + `isMine`. |
