# Plan S16-SOCIAL-FE-1 — FE track A: template cổng thông tin 3 cột + `SOC-SCREEN-001..005` + bật module SOCIAL

> ⚠️ **GATE PHÂN TẦNG — sửa sau review (finding #1, CRITICAL).** WO khai `zone:"amber"` nhưng **T9 ship migration + đổi cổng quyền** (`APP_REGISTRY.requiredAnyPermissions` · `MODULE_APP_METADATA.requiredAny`). `harness/policy.md:12` + CLAUDE.md §6: diff chạm **migration** ⇒ 🔴 đỏ.
> - **T0–T8, T10 (5 màn + layout + sidebar + realtime + ME)** → 🟡 **LIGHT gate** (`typescript-reviewer` + `react-reviewer` + `quality-gate`).
> - **T9 (migration + metadata + 2 sổ test)** → 🔴 **commit RIÊNG**, **FULL gate** (`security-reviewer` + `database-reviewer` + `silent-failure-hunter`) + **chữ ký owner**, **KHÔNG auto-merge**.
> - Trước khi mở PR: `bash harness/check.sh --all` (hoặc `REQUIRE_LANE_DB=1`), không chỉ `--lane-db=`.
>
> Nguồn sự thật thi công:
> [SPEC-16 §9/§11/§13.7/§14/§16/§17.3/§22](<../spec/SPEC-16 SOCIAL.md>) · [UI-07 §34b](<../UI/UI-07_Module_Workspace_Template_Design.md>) ·
> [API-19](<../API Design/API-19_SOCIAL_API_Design.md>) §5.1/§5.1b/§5.1c/§6.1/§7 · tiền lệ [S15-PAYROLL-FE-1](S15-PAYROLL-FE-1.md) (bật module khuôn `0567`) ·
> [S16-SOCIAL-BE-1](S16-SOCIAL-BE-1.md) / [BE-1B](S16-SOCIAL-BE-1B.md) (hợp đồng route thật).
>
> **KHÔNG nhân bản spec vào đây** — mọi luật nghiệp vụ trỏ về `docs/spec/SPEC-16 SOCIAL.md` kèm số mục.
>
> Nhánh: `feat/s16-social-fe-1`, cắt từ `origin/master` `5f8434c0` (đã gồm BE-1 #530 · BE-1B #532 · BE-2A #533).

---

## §0. Bước 0 — PHÉP ĐO TRƯỚC KHI CODE

Bảng M1..M18. Cột **Kết luận** đã ĐO XONG được ghi thẳng; dòng **CHỜ** phải tự đo trước khi gõ dòng code đầu tiên và **dán kết quả vào chính ô đó** (sửa file plan này, commit cùng bước T0).

### 0.1 Đã đo (đừng đo lại)

| # | Câu hỏi | Lệnh / nguồn | Kết luận (đo 23/09/2026 trên `5f8434c0`) |
| --- | --- | --- | --- |
| **M1** | Migration head hiện tại để đánh số tiếp? | `tail -30 apps/api/migrations/meta/_journal.json` | **`0585`** = `0585_s16socialbe1b_noti_news_template_fix`, journal `idx 252`, `when 1717587374000`. ⇒ migration của WO này **tạm tính `0586`** — nhưng xem **M2**, con số này CÓ THỂ trôi. |
| **M2** | Có PR nào đang mở sẽ chiếm số trước không? | brief owner + `gh pr list` | **CÓ: `S16-SOCIAL-BE-2B-1` (PR #534) đang mở**, chưa merge. Nếu nó merge trước và mang migration thì head dịch lên. ⇒ **đánh số lúc REBASE cuối cùng, không đánh lúc bắt đầu** (SOC-DEC-001: "migration nối tiếp head lúc merge"). |
| **M3** | Hàng `modules.SOCIAL` đã có chưa, `is_active` đang là gì? | `grep -n "'SOCIAL'" apps/api/migrations/0435*.sql` | **ĐÃ CÓ từ `0435` dòng 300**: `('SOCIAL','Mạng xã hội nội bộ','Extension', false, false, false, 13)` — cột `(module_code, name, module_group, is_core, is_mvp, is_active, sort_order)` ⇒ `is_active = false`. **⇒ là UPDATE, KHÔNG phải INSERT** (`INSERT … ON CONFLICT DO NOTHING` sẽ là NO-OP im lặng). |
| **M4** | Migration SOCIAL nào đang assert `is_active=false` (bẫy `module-enable-guard-blocks-next-wo`)? | `grep -n "is_active" apps/api/migrations/057[7-9]*.sql apps/api/migrations/058[0-5]*.sql` | **KHÔNG CÓ.** Mọi khớp trong `0580/0582` đều là cột `feed_kudos_badges.is_active` (catalog huy hiệu), không liên quan `modules`. ⇒ **KHÔNG phải nới guard nào** — khác hẳn ca ROOM/ASSET. DB-1/DB-2 đã tuân SPEC-16 §23.1b. |
| **M5** | `MODULE_APP_METADATA` khai ở file nào, có `SOCIAL` chưa? | `apps/api/src/foundation/module-catalog/module-app-metadata.ts` (205 dòng) | 13 key: `AUTH HR ATT LEAVE TASK DASH NOTI ME GOAL ASSET ROOM RECRUIT PAYROLL`. **KHÔNG có `SOCIAL`** ⇒ phải APPEND. Khuôn gần nhất = entry `PAYROLL` (dòng 179-186): `{route, icon, requiredAny:[EnginePair], feCodes:[string]}`. |
| **M6** | Cổng nào sẽ ĐỎ khi bật module mà quên metadata? | `module-app-metadata-coverage.int.spec.ts` docblock | Ca **C1** ghi nguyên văn: _"Đỏ khi wave sau bật module mà quên metadata — **bàn giao S16-SOCIAL-FE-1**"_. Cổng này gọi đích danh WO này. Cần `LANE_DB` mới chạy. |
| **M7** | `SOCIAL` có đang nằm trong danh sách miễn trừ metadata không? | `grep -n "SOCIAL" apps/api/test/foundation/module-app-metadata-ratchet.unit-spec.ts` | **CÓ — dòng 243**: `SOCIAL: "Phase 4 — mig 0435:300 is_active=false; wave S16-SOCIAL sẽ bật cùng metadata"`. ⇒ **PHẢI XOÁ dòng này cùng commit thêm metadata**, nếu không ca `[3] DOUBLE_LISTED` đỏ ("mã đã EXEMPT thì KHÔNG được đồng thời có metadata"). |
| **M8** | Danh sách module active/inactive trong migration-smoke? | `apps/api/test/integration/migration-smoke.int-spec.ts:95,114` | `EXTENSION_ACTIVE_MODULES = ["ASSET","ROOM","RECRUIT","PAYROLL"]` (dòng 95) · `EXTENSION_INACTIVE_MODULES = ["CHAT","SOCIAL"]` (dòng 114). ⇒ **CHUYỂN `"SOCIAL"` từ INACTIVE sang ACTIVE, không chỉ GỠ** — danh sách ACTIVE assert DƯƠNG TÍNH `is_active=true`, chỉ gỡ sẽ để lọt ca "migration quên chạy" (tiền lệ ghi ngay tại dòng 110-113 cho PAYROLL). |
| **M9** | `ROUTE_REGISTRY` ở đâu, hình dạng gì, thêm route có tự hiện mục sidebar không? | `packages/web-core/src/lib/registry.ts:990` + `:417-431` | `ROUTE_REGISTRY: readonly RouteMeta[]`. `RouteMeta = {routeKey, path, layout: LayoutType, moduleCode?, screenCode?, titleKey, isPublic?, showInSidebar?, showInAppSwitcher?, featureFlag?, order?}` + `extends PermissionRequirement`. **KHÔNG tự sinh mục sidebar**: sidebar là dữ liệu RIÊNG ở `SIDEBAR_REGISTRY`. Quan hệ DUY NHẤT là `pruneUnbuiltScreens()` — nó CẮT mục sidebar mà `path` không có trong `ROUTE_REGISTRY`. ⇒ **hai bảng, phải khai CẢ HAI**; `ROUTE_REGISTRY` quyết định mục có bị cắt hay không. |
| **M10** | `LayoutType` có giá trị nào cho portal 3 cột chưa? | `registry.ts:415` | `type LayoutType = "AUTH" \| "HOME_PORTAL" \| "MODULE_WORKSPACE" \| "ACCOUNT" \| "ERROR"` — **KHÔNG có giá trị portal**. ⇒ quyết định **D3**. |
| **M11** | `ModuleCode` đã có `"SOCIAL"` chưa? | `registry.ts:16-36` | **ĐÃ CÓ** (dòng 34). Không phải đụng union type. |
| **M12** | Sidebar đã tách chưa, khuôn một file module thế nào? | `ls apps/app/src/layouts/workspace/sidebar/` | **13 file**: `asset att dash goal hr leave me noti payroll recruit room system task`. Khuôn (mẫu `room.ts`): `export const <MOD>_SIDEBAR: readonly SidebarItemMeta[] = [{sidebarKey, moduleCode, label, path, icon, group, order, requiredPermissions}]`. Barrel `sidebar-registry.ts` (~85 dòng) = 1 dòng import + 1 dòng trong khối `export {}` + 1 dòng trong `SIDEBAR_REGISTRY`. |
| **M13** | `SidebarItemMeta` có trường gì? | `registry.ts:900-929` | `{sidebarKey, moduleCode, label, path?, icon?, group?, order, badgeKey?, children?, featureFlag?, isDivider?, collapsible?, defaultCollapsed?}` + `PermissionRequirement` (`requiredPermissions` = ĐỦ CẢ / `requiredAnyPermissions` = MỘT TRONG). **KHÔNG có khái niệm liên kết ngoài/onClick** (vì thế FBPOST-1 phải dùng `sidebar-extensions.ts`, không phải file này). |
| **M14** | Snapshot ghim cây sidebar — ghim cái gì? | `sidebar-registry.snapshot.spec.ts` + `__snapshots__/` | **2 file**: `sidebar-tree.raw.txt` (cây KHAI BÁO — thứ tự khoá `SIDEBAR_REGISTRY` + mọi trường hiển thị + cặp quyền) và `sidebar-tree.by-permission.txt` (cây THẤY ĐƯỢC sau `filterSidebarItems` theo từng bộ quyền). ⇒ **thêm module SOCIAL làm ĐỎ CẢ HAI** — đỏ CÓ CHỦ ĐÍCH, xem T6. |
| **M15** | `pruneUnbuiltScreens()` nằm đâu, export chưa? | `apps/app/src/layouts/workspace/sidebar/payroll.ts:26` | `export function pruneUnbuiltScreens(items): SidebarItemMeta[]` — ĐÃ export, barrel re-export. Cắt lá không có `path` trong `ROUTE_REGISTRY`; node LAI (có `path` + có con) thì HẠ xuống thành hàng đại diện nhóm chứ không vứt nhánh. ⇒ quyết định **D9**. |
| **M16** | Cặp quyền `feed-*` THẬT trong seed? | `grep -nE "^\s*\('(view\|create\|manage\|approve)'" apps/api/migrations/0578*.sql` | **ĐÚNG 14 cặp**, tất cả `is_sensitive = false`: `view:feed` · `create:feed-post` · `create:feed-comment` · `create:feed-poll` · `create:feed-idea` · `create:feed-kudos` · `create:feed-group` · `manage:feed-news` · `manage:feed-post` · `manage:feed-group` · `manage:feed-kudos` · `manage:feed-report` · `approve:feed-idea` · `view:feed-report`. |
| **M17** | FE gate nhận cặp ENGINE hay mã FE? | `packages/web-core/src/hooks/use-can.ts` + `components/permission-gate.tsx` | `useCan(action, resourceType)` — **cặp engine**, tra `capabilities` với fallback wildcard `*:res` → `act:*` → `*:*`. `useCanExact` chỉ dùng cho cặp `is_sensitive`. ⇒ **mọi cặp `feed-*` dùng `useCan`, KHÔNG `useCanExact`** (M16: không cặp nào sensitive). `<PermissionGate action= resourceType= fallback=>`. |
| **M19** | Tile Home SOCIAL đã tồn tại chưa? | `packages/web-core/src/lib/registry.ts:743-762` | **ĐÃ CÓ** (S9): `{appKey:"social", moduleCode:"SOCIAL", nameKey:"app.social", icon:"megaphone", rootPath:"/social", defaultRoute:"/social", category:"collaboration", requiredAnyPermissions:["view:social-post"], status:"active", order:90}`. ⇒ **D13** — sửa tile này, KHÔNG thêm tile thứ hai. |
| **M20** | Cổng hiển thị tile Home tính thế nào? | `registry.ts:874-894` `getVisibleApps` | `status` hiệu dụng = `session.modules[moduleCode].status ?? app.status`; **chỉ khi `active` mới kiểm quyền**. ⚠️ `ModuleWorkspaceLayout.buildSessionFromStore()` hiện trả `modules: []` (có `// TODO(BE)`) ⇒ status luôn rơi về `app.status` của hằng. Nghĩa là **bật `modules.is_active` KHÔNG tự làm tile đổi hành vi ở FE** — quyền mới là thứ quyết định. |
| **M21** | Thêm module thứ 14 làm đỏ snapshot ở mấy chỗ? | `sidebar-registry.snapshot.spec.ts:118-149` | **1 khối** `### SOCIAL` trong `sidebar-tree.raw.txt` + **5 khối** trong `sidebar-tree.by-permission.txt` (mỗi bộ quyền `ALL`/`ME_ONLY`/`EMPLOYEE`/`HR_ISH`/`PAYROLL_PARTIAL` một khối). Thứ tự khối = thứ tự khoá object `SIDEBAR_REGISTRY` ⇒ **D14**. **Test 3** ("không quyền nào ⇒ mọi module rỗng") sẽ ĐỎ nếu bất kỳ mục SOCIAL nào thiếu CẢ `requiredPermissions` lẫn `requiredAnyPermissions` (không yêu cầu ⇒ `allowed: true` ⇒ lọt cổng-rỗng). |
| **M22** | Nhãn sidebar có qua i18n không? | `registry.ts:903` + `sidebar-registry.ts:5` | **KHÔNG** — `SidebarItemMeta.label` là chuỗi tiếng Việt literal ("sidebar render nhanh, không qua i18n key"). Chỉ `RouteMeta.titleKey` và `APP_REGISTRY.nameKey/descKey` mới qua i18n. `group` cũng là chuỗi thô: `ModuleSidebar.tsx:256` render `GROUP_LABELS[group] ?? group`, nhóm lạ **xếp cuối theo thứ tự xuất hiện đầu tiên**. |
| **M18** | WS: FE phải join room không? | `apps/api/src/realtime/realtime.gateway.ts:145-170` + `rooms.ts:80` | **KHÔNG.** Server tự `client.join(feedRoomName(companyId))` lúc connect, sau khi tự kiểm `view:feed`, **fail-SOFT** (thiếu quyền/lỗi ⇒ chỉ không join, phiên vẫn sống). Room = `co:{companyId}:feed`. FE chỉ `socket.on(...)`. Chỉ có room company — **KHÔNG có room `feedgroup`/`org_unit`** (chưa hiện thực). |

### 0.2 Phép đo CHỜ — phải tự chạy trước khi code, dán kết quả vào đây

| # | Câu hỏi | Lệnh để đo | Chỗ dán kết quả |
| --- | --- | --- | --- |
| **W1** | Head migration THẬT lúc rebase cuối (M2 nói con số sẽ trôi) | `git fetch origin && git log --oneline origin/master -1 && tail -20 apps/api/migrations/meta/_journal.json` | **ĐO 23/09/2026 trên `5f8434c0`**: tag head = `0585_s16socialbe1b_noti_news_template_fix`, idx = `252`, when = `1717587374000` ⇒ migration WO này = **`0586`**, journal **`idx: 253`**, **`when: 1717587375000`** (`when` phải TĂNG NGẶT — sai ⇒ áp sai thứ tự / bỏ qua im lặng trên DB dùng chung). **Chỉ đo lại nếu rebase cuối thấy head đổi.** |
| **W2** | PR #534 (BE-2B-1) đã merge chưa, có mang contracts poll/idea/kudos không | `gh pr view 534 --json state,mergedAt` | **ĐO 23/09/2026: `OPEN`, chưa merge** (14/14 CI xanh, chặn bởi `REVIEW_REQUIRED`). **`git diff --name-only origin/master...origin/feat/s16-social-be-2b -- apps/api/migrations/` trả RỖNG ⇒ nhánh đó KHÔNG mang migration ⇒ băng `0586` trống thật.** Nếu nó merge trước thì **vẫn KHÔNG mở rộng phạm vi**: composer giữ 2 nút (D2), việc 3 nút là của FE-2 |
| **W3** | ~~`titleKey` i18n khai ở đâu~~ — **ĐÃ ĐO, không còn chờ** | — | **3 việc**: ① tạo `apps/app/src/i18n/locales/vi/social.ts` (`export default {…}`) + `import socialVi` và `social: socialVi,` trong `apps/app/src/i18n/index.ts`; ② `nav:routeTitle.<key>` cho 5 route — **deep-merge qua khối `nav: { routeTitle: {…} }` ở CUỐI `i18n/index.ts`** (khuôn đã có sẵn cho `notiEvents`/`chat`); ③ `nav:app.social`/`nav:appDesc.social` đã có sẵn từ S9 (tile dùng) — chỉ đổi văn nếu cần. Chỉ có locale `vi`. |
| **W4** | ~~`ModuleWorkspaceLayout` được router gọi ở đâu~~ — **ĐÃ ĐO, không còn chờ** | — | `apps/app/src/router.tsx:93-135`: `buildModuleRouteContent(meta, node)` **hard-code `ModuleWorkspaceLayout`** (KHÔNG đọc `meta.layout`), `makeModuleRoute(...)` là khuôn dựng route. ⇒ cần viết **`buildPortalRouteContent`** song song, và đây chính là lý do **D3 phải gắn răng thật** (xem D3 đã sửa) |
| **W5** | ~~ME khai mục ở đâu~~ — **ĐÃ ĐO, không còn chờ** | — | `apps/app/src/layouts/workspace/sidebar/me.ts` (260 dòng, 18 mục), KHÔNG phải `routes/me/`. **Tiền lệ ĐÚNG HÌNH DẠNG đã có 2 lần**: `me.lms` (dòng 226-238, `path:"/lms"`, `requiredAnyPermissions:["access:lms"]`, `group:"Đào tạo"`) và `me.chat` (dòng 239-260, `path:"/chat"`, `["access:chat"]`, `group:"Trao đổi"`). ⇒ thêm 2 mục `me.feed.mine` + `me.feed.saved` (`/feed/saved`), `moduleCode:"ME"`, `requiredAnyPermissions:["view:feed"]`, `group:"Trao đổi"`. ⚠️ `group` của ME dùng **nhãn tiếng Việt nguyên văn**, không phải key enum.<br>🔴 **SỬA SAU REVIEW (finding #2, HIGH):** bản đầu ghi `path:"/feed/profiles/$me"` — **SAI, sẽ thành link chết 404**. Hai lý do đo được: (a) route thật theo D1 là `/feed/profiles/$employeeId`, không có route `$me`; (b) `ME_SIDEBAR` **KHÔNG** đi qua `pruneUnbuiltScreens` (chỉ `PAYROLL` có — `sidebar-registry.ts:70` vs `:75`) nên mục **không tự ẩn**, và `SidebarItemMeta` không có `onClick` (M13) nên không thể giải `$me` lúc bấm. ⇒ **Chốt: khai route TĨNH `/feed/profiles/me`** như một entry RIÊNG trong `ROUTE_REGISTRY` (page tự đọc user hiện tại rồi render lại `ProfilePostsPage`). Và **mở rộng C20** để phủ cả 2 mục ME mới, không chỉ `SOCIAL_SIDEBAR`. |
| **W6** | Trần `order` đang dùng trong `ROUTE_REGISTRY` để chọn dải cho SOCIAL không đụng module khác | `grep -n "order:" packages/web-core/src/lib/registry.ts \| tail -20` | _(điền: dải trống chọn cho SOCIAL = `____`)_ |
| **W7** | 🔴 **Đường đăng ký tệp cho SOCIAL** — xem R1/§2 D8. Có endpoint `POST /social/files/upload-url` + `/confirm` không? | `grep -rn "upload-url" apps/api/src/social/ apps/api/src/foundation/files/` | _(điền — đo sơ bộ 23/09: **KHÔNG CÓ**; `foundation/files` đòi cặp `*:foundation-file` mà employee không có)_ |
| **W8** | Bộ emoji CHAT export tên gì để composer reaction dùng lại | `grep -rn "CHAT_REACTION_EMOJIS\|chatReactionEmojiSchema" packages/contracts/src/chat.ts \| head` | _(điền)_ |
| **W9** | Số spec/ca hiện tại của `apps/app` để so trước–sau | `pnpm --filter @mediaos/app test --reporter=dot 2>&1 \| tail -20` (đọc dòng `EXIT=`) | _(điền: `___ file / ___ ca`, exit `___`)_ |

---

## §1. Phạm vi & KHÔNG-phạm-vi

### 1.1 Trong phạm vi

1. **Layout cổng thông tin 3 cột** — thư mục MỚI `apps/app/src/layouts/portal/` (UI-07 §34b.6 nói rõ: _"**không** sửa `layouts/workspace/`"_).
2. **`SOC-SCREEN-001` Bảng tin** — composer (2 nút, xem D2) · thẻ bài · lọc/sắp xếp · badge «N bài mới» · reaction · bình luận.
3. **`SOC-SCREEN-002` Chi tiết bài** — bài + toàn bộ bình luận + danh sách người thích.
4. **`SOC-SCREEN-003` Tin tức** — danh sách + ghim + «Xác nhận đã đọc» + «danh sách đã đọc» (gate riêng).
5. **`SOC-SCREEN-004` Đã lưu**.
6. **`SOC-SCREEN-005` Trang cá nhân** — bài của tôi / của đồng nghiệp.
7. **Rail phải**: widget Sinh nhật (Hôm nay/Tuần/Tháng + «Gửi lời chúc») · Tin nổi bật.
8. **Ô tìm kiếm SOCIAL trên topbar** (`SOCIAL-API-023`).
9. **ME**: 2 mục mới «Bài viết của tôi» · «Đã lưu» + preference ẩn sinh nhật (`showBirthday`).
10. **Bật module**: migration `UPDATE modules SET is_active=true` khuôn `0567` + `MODULE_APP_METADATA.SOCIAL` + 2 sổ test (M7, M8).
11. **`sidebar/social.ts`** + barrel + cập nhật snapshot CÓ CHỦ ĐÍCH.

### 1.2 NGOÀI phạm vi (chạm vào = scope creep, tách WO)

| Hạng mục | Vì sao ngoài | Ai làm |
| --- | --- | --- |
| **Bình chọn · Sáng kiến · Vinh danh** (poll/idea/kudos) | BE-2B-1 (PR #534) **chưa merge** ⇒ không có contracts/route. Composer **KHÔNG** render 3 nút này (D2) | `S16-SOCIAL-FE-2` |
| **Nhóm** (`SOC-SCREEN-006`) | BE-2A đã merge nhưng thuộc track B của FE | `S16-SOCIAL-FE-2` |
| **Kiểm duyệt · Thống kê · Huy hiệu** (`SOC-SCREEN-010..012`) | Track C | `S16-SOCIAL-FE-3` |
| **Tile «Đăng bài Facebook»** | `apps/app/src/routes/social/{SocialRedirectPage.tsx,open-social.ts}` là vệ tinh fbpost của **S9**. WO này **KHÔNG xoá, KHÔNG đổi, KHÔNG di chuyển** chúng; `/social` giữ nguyên hành vi redirect SSO | `S16-SOCIAL-FBPOST-1` |
| **Màn báo cáo / hàng đợi kiểm duyệt** | `SOCIAL-API-028/029` gate `view:feed-report`/`manage:feed-report` — track C | `S16-SOCIAL-FE-3` |
| **Widget DASH `SOCIAL-WIDGET-001/002`** | SPEC-16 §17.3 — cần đăng ký 3 bản đồ FE (memory `fe-widget-slug-map-is-unchecked-runtime-gate`) | nợ §8 |

### 1.3 Ranh giới đường dẫn — QUAN TRỌNG

`/social` **đã bị chiếm** bởi trang redirect fbpost (router.tsx:2983-2985). Portal mới **KHÔNG** được cướp đường dẫn đó ở WO này (done_when của FBPOST-1 mới là nơi hợp nhất). ⇒ **D1**.

---

## §2. Quyết định thiết kế (D1..D12)

| # | Quyết định | Lý do | Phương án loại bỏ |
| --- | --- | --- | --- |
| **D1** | **Đường dẫn gốc portal = `/feed`**, KHÔNG phải `/social`. Các màn: `/feed` (001) · `/feed/posts/$postId` (002) · `/feed/news` (003) · `/feed/saved` (004) · `/feed/profiles/$employeeId` (005) | `/social` đang là trang trung chuyển SSO fbpost (§1.3). Chiếm chỗ ở WO này sẽ (a) phá đường lỗi fbpost đang chạy, (b) lấn done_when của FBPOST-1. `/feed` khớp tiền tố resource thật (`feed`, `feed-post`…) nên đọc code không phải dịch nghĩa hai lần | ① `/social/*` — vỡ fbpost ngay. ② `/social/feed` lồng dưới trang redirect — hai ngữ nghĩa trong một cây route, `pruneUnbuiltScreens` và breadcrumb đều nhập nhằng |
| **D2** | **Composer chỉ 2 nút: «Chia sẻ» (`share`) và «Tin tức» (`news`)**. Nút «Tin tức» bọc `<PermissionGate action="manage" resourceType="feed-news">` | `feedCreatableTypeSchema = z.enum(["share","news"])` (contracts `social-api.ts`) — BE-1 **từ chối** 3 type kia. Render nút mở form rồi ăn 422 là UI dối. UI-07 §34b.2 ghi `*` = nút Tin tức gate `manage:feed-news` | ① 5 nút disabled — SPEC-16 §14 đòi "forbidden = **ẩn**, không hiện rồi báo lỗi". ② 5 nút + tooltip "sắp có" — vẫn là 3 lời hứa không giữ được |
| **D3** | **Thêm `"MODULE_PORTAL"` vào `LayoutType`** (web-core registry.ts:415), route SOCIAL khai `layout: "MODULE_PORTAL"` | 🔴 **LÝ DO BAN ĐẦU SAI — SỬA SAU REVIEW (finding #6).** Bản đầu viết «mọi consumer đọc `layout` … tin rằng đây là khuôn 2 cột» và «`switch` nào thiếu nhánh sẽ ĐỎ typecheck». **Cả hai vế đều SAI về sự kiện**: quét toàn kho, **KHÔNG file nào đọc `RouteMeta.layout` lúc chạy** — layout do hàm dựng route chọn (`router.tsx:93-107`, `buildModuleRouteContent` hard-code `ModuleWorkspaceLayout`); `registry.ts:415,421` chỉ KHAI union + 1 field. Thêm nhánh union hôm nay là **metadata trơ, KHÔNG cổng nào đỏ** (đúng lớp lỗi memory `gate-measurement-row-can-be-unsatisfiable`).<br>**Vẫn giữ `"MODULE_PORTAL"`, nhưng PHẢI gắn răng thật — chọn 1:** ① `LAYOUT_BUILDERS: Record<LayoutType, (meta,node)=>ReactElement>` ⇒ thiếu nhánh mới **đỏ typecheck thật** (khuyến nghị); ② ca trong C20: mọi entry `ROUTE_REGISTRY` có `layout==="MODULE_PORTAL"` phải được dựng bằng `buildPortalRouteContent`, và không entry `MODULE_WORKSPACE` nào dùng `PortalLayout`. **N7 («rà mọi switch») là việc RỖNG — đã xoá.** | ① Tái dùng `MODULE_WORKSPACE` + cờ phụ `isPortal` — hai nguồn sự thật cho một câu hỏi. ② `"HOME_PORTAL"` — đã có nghĩa khác (trang chủ app switcher, UI-06) |
| **D4** | **Layout 3 cột bằng CSS Grid + container query-free breakpoint Tailwind**: `grid-cols-1` mặc định; `lg:` (≥1024px) `grid-cols-[240px_minmax(0,1fr)_300px]`; cột giữa `max-w-[680px] mx-auto`. Dưới 1024px: rail trái render thành **thanh tab ngang dính trên** (`sticky top-0 overflow-x-auto`), rail phải **xuống cuối DOM** | UI-07 §34b.3 chốt đúng 3 con số này. Thứ tự DOM đặt **feed TRƯỚC rail phải** để mobile không phải reorder bằng CSS (rail phải tự rơi xuống cuối) — reorder bằng `order-*` làm thứ tự tab-focus lệch thứ tự nhìn thấy, hỏng a11y | ① Flexbox 3 cột — không ghim được bề rộng cố định 2 rail mà vẫn cho cột giữa co. ② Drawer cho rail trái dưới 1024px — UI-07 §34b.3 loại tường minh: _"**không** dùng drawer… thanh tab ngang rẻ hơn và không nuốt một lớp tương tác"_ |
| **D5** | **Render body bài = plain text + linkify + `#tag`/`@mention` thành `<Link>`**, qua một hàm thuần `parseFeedBody(body): FeedBodyToken[]` trả mảng token `{kind:"text"\|"url"\|"tag"\|"mention", …}`, component map token → React node. **TUYỆT ĐỐI KHÔNG `dangerouslySetInnerHTML`** | BE lưu body **plain text** (backlog BE-1 note: _"body lưu plain text, FE render an toàn (không HTML)"_). Tokenize rồi render bằng React node là con đường DUY NHẤT vừa có link vừa không có cửa XSS. Hàm thuần ⇒ test được không cần DOM | ① `dangerouslySetInnerHTML` + sanitizer — thêm phụ thuộc, và một lần cấu hình sai sanitizer là một lỗ XSS cho toàn công ty. ② Regex replace ra chuỗi HTML — cùng lỗ, tệ hơn |
| **D6** | **Lọc/sắp xếp giữ trong URL search** bằng TanStack Router `validateSearch` + Zod, **tái dùng `listFeedQuerySchema` của contracts** (bỏ `cursor`/`limit` khỏi search vì chúng thuộc infinite query, không thuộc URL) | Contracts đã là nguồn sự thật DTO. Khai lại schema ở FE = hai nguồn, drift chắc chắn. URL mang trạng thái ⇒ chia sẻ được link đã lọc, back/forward đúng, reload không mất ngữ cảnh | ① `useState` — mất khi reload, không chia sẻ được. ② `useLocalPref` — lọc là **ngữ cảnh điều hướng**, không phải sở thích cá nhân; ghi vào localStorage làm link chia sẻ mở ra khác nhau ở mỗi máy |
| **D7** | **Badge «N bài mới» = bộ đếm trong `useFeedRealtime`**, KHÔNG chèn bài. Bấm badge ⇒ `queryClient.invalidateQueries(feedKeys.list(search))` + cuộn lên đầu + reset đếm về 0 | Hai lý do độc lập: (a) SPEC-16 §13.7 + SOC-DEC-010 cấm tự chèn; (b) **kỹ thuật: payload WS KHÔNG dựng nổi một thẻ bài** — `wsFeedPostCreatedEventSchema` omit `myReaction`/`savedByMe`/`isMine`/`status` và attachment bị strip `url` (không presign qua WS). Chèn thẳng sẽ ra thẻ thiếu ảnh, thiếu trạng thái "tôi đã thích chưa" | ① Chèn optimistic rồi refetch — nháy giao diện + hai nguồn sự thật cho một thẻ. ② Polling — tốn request, và đã có WS miễn phí |
| **D8** | **Đính kèm tệp: CẮT KHỎI FE-1**, chuyển nợ (xem §8 N1). Composer FE-1 chỉ có text + mention + emoji | W7/R1: **không tồn tại `POST /social/files/upload-url`**. Đường duy nhất còn lại là `foundation/files` đòi cặp `*:foundation-file` mà employee KHÔNG được cấp ⇒ nút đính kèm sẽ 403 cho đúng nhóm người dùng chính. Dựng UI cho một đường không đi được là làm giả | ① Gọi thẳng `foundation/files` — 403 cho employee, tức tính năng chết cho 90% người dùng. ② Tự mở endpoint trong WO FE — đổi zone từ amber sang đỏ (chạm permission + file-service), phá hợp đồng `paths` |
| **D9** | **TÁCH `pruneUnbuiltScreens` ra `apps/app/src/layouts/workspace/sidebar/prune-unbuilt.ts`**, `payroll.ts` và `social.ts` cùng import; barrel re-export **giữ nguyên tên export** | UI-07 §34b.6 yêu cầu tường minh: _"mục chưa có màn tự ẩn (`pruneUnbuiltScreens()`)"_ ⇒ SOCIAL là **module thứ hai** cần nó — đúng điều kiện kích hoạt nợ đã ghi ở `s15-ui-shell-2-wave-state`. Để nguyên trong `payroll.ts` thì `social.ts` phải import từ file của module khác = phụ thuộc chéo vô nghĩa | ① Copy hàm sang `social.ts` — vi phạm DRY, hai bản sẽ lệch. ② Import chéo `./payroll` — đọc code tưởng SOCIAL phụ thuộc PAYROLL |
| **D10** | **Sidebar SOCIAL khai ĐẦY ĐỦ 6 mục track A+B** (Bảng tin · Tin tức · Đã lưu · Sáng kiến · Bình chọn · Nhóm) rồi bọc `pruneUnbuiltScreens` — FE-1 chỉ khai 3 route đầu nên 3 mục sau **tự ẩn** | Đúng lời hứa của hàm (D9): WO sau chỉ thêm route là mục tự hiện, không phải quay lại sửa file sidebar. Khuôn y hệt `PAYROLL_SIDEBAR_V2` | Khai dần từng WO — mỗi WO sau lại phải sửa `social.ts` + cập nhật snapshot lần nữa (3 lần đỏ snapshot thay vì 1) |
| **D11** | **Rail trái = `ModuleSidebar` sẵn có**, không viết sidebar riêng cho portal | Giữ đúng một cơ chế điều hướng (gate quyền, `filterSidebarItems`, snapshot ghim) cho toàn hệ. Portal chỉ khác **khung chứa**, không khác **luật hiển thị** | Viết rail riêng — mất `filterSidebarItems`, mất snapshot, và forbidden-thì-ẩn (SPEC-16 §14) phải hiện thực lại bằng tay |
| **D12** | **Widget Sinh nhật: schema FE `.nullable()` cho `fullName`/`avatar`** đúng như contracts; «Gửi lời chúc» **mở composer prefill** `@mention` + không tự gửi | `feedBirthdaySchema` (contracts) có `fullName: string\|null`, `avatar: string\|null`, và khoá là **`avatar`** chứ không phải `avatarUrl` — gõ nhầm sẽ ném ZodError dù HTTP 200 (memory `server-masking-needs-optional-fe-schema`). SOC-DEC-003: **không có bài hệ thống tự sinh** ⇒ nút chỉ mở composer, người dùng tự bấm đăng | Tự POST bài chúc mừng — tạo bài hệ thống, vi phạm SOC-DEC-003 |
| **D13** | ✍️ **OWNER KÝ 23/09/2026 — HAI TILE, không một.** ① **Sửa** tile `social` đang có thành portal: `rootPath`/`defaultRoute` `/social` → **`/feed`**, `requiredAnyPermissions: ["view:social-post"]` → **`["view:feed"]`**; `appKey`/`nameKey`/`icon`/`order` giữ nguyên. ② **THÊM** tile thứ hai cho vệ tinh: `appKey:"fbpost"`, tên **«Đăng bài Facebook»** (nameKey riêng), `requiredAnyPermissions:["view:social-post"]`, `rootPath`/`defaultRoute` **`/social`**, `moduleCode:"SOCIAL"`, `order` liền sau | **ĐO ĐƯỢC (registry.ts:743-762)**: tile SOCIAL **ĐÃ TỒN TẠI** từ S9 và đang gate bằng cặp fbpost `view:social-post`. `done_when` của WO này đòi _"ô Home «Mạng xã hội» hiện theo module + `view:feed`"_ ⇒ **không thể thoả nếu không sửa chính tile đó**. Thêm tile thứ hai = 2 ô cùng tên trên Home. 🔴 **Vì sao KHÔNG sửa-một-tile như bản đầu (finding #4, HIGH):** sửa thẳng làm người **chỉ** có `view:social-post` **mất ô Home** cho tới khi FBPOST-1 chạy — đúng "cửa sổ tile chết" mà `done_when` của FBPOST-1 (`backlog.mjs:16826-16827`) cấm tái tạo. Hai tile khác TÊN nên phản bác «hai ô cùng tên» của bản đầu **không áp dụng**: người có cả hai quyền thấy «Mạng xã hội» (portal) + «Đăng bài Facebook» (vệ tinh) — đúng quan hệ cha/tiện-ích-con của SOC-DEC-002. FBPOST-1 sau đó **gộp tile thứ hai vào sidebar SOCIAL** và gỡ nó khỏi Home, không phải dựng lại từ đầu | ① **Sửa một tile, chấp nhận hồi quy** — owner loại: tile chết cho nhóm fbpost-only. ② **OR-gate `["view:feed","view:social-post"]`** — owner loại, và `registry.ts:756-758` chốt nguyên tắc «ô hiện ra thì bấm vào phải vào được»: người fbpost-only sẽ bị đá vào `/feed` rồi ăn 403. ③ Để nguyên tile cũ — `done_when` gạch 4 KHÔNG đóng được |
| **D14** | **Chèn khoá `SOCIAL` vào CUỐI object `SIDEBAR_REGISTRY`** (sau `PAYROLL`) | Thứ tự khoá của object literal **chính là thứ tự khối `### <MODULE>`** trong `sidebar-tree.raw.txt`. Chèn giữa ⇒ mọi khối sau dịch chỗ ⇒ diff khổng lồ, không đọc được như "thay đổi điều hướng" (T6) | Chèn theo alphabet — đẹp trên giấy, diff 13 khối trên thực tế |

---

## §3. Cây file sẽ thêm/sửa

> Trần dự án **800 dòng/file**; mục tiêu 200–400. Ước lượng dưới đây là **trần tự đặt** — file nào chạm 400 thì tách tiếp, đừng để đến 800.

### 3.1 Thêm mới — `apps/app/src/layouts/portal/`

| File | ~dòng | Nội dung |
| --- | --- | --- |
| `PortalLayout.tsx` | 140 | Khung grid 3 cột (D4), slot `leftRail`/`children`/`rightRail`, `<1024px` đổi rail trái thành tab ngang |
| `PortalLeftRail.tsx` | 110 | Thẻ danh tính (avatar · tên · «Trang cá nhân») + `<ModuleSidebar moduleCode="SOCIAL">` (D11) |
| `PortalRightRail.tsx` | 90 | Khung xếp chồng các khối widget + skeleton từng khối (UI-07 §34b.5) |
| `PortalTabBar.tsx` | 80 | Thanh tab ngang cuộn ngang cho <1024px, dựng từ cùng nguồn `SIDEBAR_REGISTRY.SOCIAL` |
| `portal-layout.spec.tsx` | 130 | Ca responsive + thứ tự DOM + focus-visible |

### 3.2 Thêm mới — `apps/app/src/routes/social/feed/` (KHÔNG đụng 2 file fbpost cùng thư mục cha)

| File | ~dòng | Nội dung |
| --- | --- | --- |
| `FeedPage.tsx` | 220 | `SOC-SCREEN-001` — composer + bộ lọc + danh sách vô hạn + badge |
| `PostDetailPage.tsx` | 190 | `SOC-SCREEN-002` |
| `NewsPage.tsx` | 200 | `SOC-SCREEN-003` — ghim · ack · danh sách đã đọc (gate `manage:feed-news`) |
| `SavedPage.tsx` | 110 | `SOC-SCREEN-004` |
| `ProfilePostsPage.tsx` | 140 | `SOC-SCREEN-005` |
| `components/FeedComposer.tsx` | 230 | 2 nút (D2) · mention · emoji · đang-gửi khoá nút |
| `components/PostCard.tsx` | 260 | Anatomy UI-07 §34b.4 · «Xem thêm» >6 dòng · lưới ảnh · menu ⋯ theo quyền |
| `components/PostBody.tsx` | 90 | Render token của `parseFeedBody` (D5) |
| `components/ReactionBar.tsx` | 150 | Picker bộ emoji CHAT (W8) |
| `components/CommentList.tsx` | 200 | 1 cấp + trả lời |
| `components/CommentComposer.tsx` | 160 | mention · emoji (KHÔNG đính kèm — D8) |
| `components/NewFeedPostsBadge.tsx` | 70 | Badge «N bài mới» (D7) |
| `components/BirthdayWidget.tsx` | 150 | Hôm nay/Tuần/Tháng + «Gửi lời chúc» (D12) |
| `components/HighlightNewsWidget.tsx` | 100 | Tin nổi bật (rail phải) |
| `components/FeedSearchBox.tsx` | 110 | Ô tìm kiếm topbar (`SOCIAL-API-023`) |
| `lib/parse-feed-body.ts` | 120 | Hàm thuần tokenize (D5) |
| `lib/feed-search-params.ts` | 70 | `validateSearch` Zod từ `listFeedQuerySchema` (D6) |
| `*.spec.tsx` × ~10 | 900 tổng | xem §6 |

### 3.3 Thêm mới — khác

| File | ~dòng | Nội dung |
| --- | --- | --- |
| `apps/app/src/hooks/use-feed-realtime.ts` | 130 | Khuôn `use-chat-realtime.ts`; gate `useCan("view","feed")`; 3 listener `WS_EVENTS.FEED_*`; Zod-parse; `socket.off` đối xứng |
| `apps/app/src/layouts/workspace/sidebar/social.ts` | 90 | `SOCIAL_SIDEBAR` (D10) |
| `apps/app/src/layouts/workspace/sidebar/prune-unbuilt.ts` | 60 | Chuyển nguyên hàm từ `payroll.ts` (D9) |
| `packages/web-core/src/lib/social-api.ts` | 280 | Client + `socialKeys` query keys (khuôn `chat-api.ts`) |
| `apps/api/migrations/<W1>_s16socialfe1_enable_social_module.sql` | 60 | Khuôn `0567` |

### 3.4 Sửa file có sẵn (append/khối additive)

| File | Thay đổi |
| --- | --- |
| `packages/web-core/src/lib/registry.ts` | `LayoutType` += `"MODULE_PORTAL"` (D3) · `ROUTE_REGISTRY` += 5 entry SOCIAL · **SỬA tile `APP_REGISTRY` SOCIAL đã có ở dòng 743-762** (D13) — KHÔNG thêm tile mới |
| `packages/web-core/src/index.ts` | export `social-api` |
| `apps/app/src/layouts/workspace/sidebar-registry.ts` | +1 import, +1 export, +1 dòng `SIDEBAR_REGISTRY.SOCIAL`, đổi import `pruneUnbuiltScreens` sang `./sidebar/prune-unbuilt` |
| `apps/app/src/layouts/workspace/sidebar/payroll.ts` | GỠ hàm, import từ `./prune-unbuilt` |
| `apps/app/src/layouts/workspace/__snapshots__/*.txt` | Cập nhật CÓ CHỦ ĐÍCH (T6) |
| `apps/app/src/router.tsx` | +5 route SOCIAL dùng `MODULE_PORTAL`; **KHÔNG đụng `socialRedirectRoute`** |
| `apps/app/src/i18n/**` | `routeTitle.*` cho 5 route (W3) |
| `apps/app/src/routes/me/**` + `sidebar/me.ts` | 2 mục ME + ô `showBirthday` (W5) |
| `apps/api/src/foundation/module-catalog/module-app-metadata.ts` | APPEND `SOCIAL` |
| `apps/api/test/foundation/module-app-metadata-ratchet.unit-spec.ts` | **XOÁ dòng 243** (M7) |
| `apps/api/test/integration/migration-smoke.int-spec.ts` | CHUYỂN `"SOCIAL"` INACTIVE→ACTIVE (M8) |
| `harness/backlog.mjs` | Cập nhật `S16-SOCIAL-FE-1` + nợ §8 |

---

## §4. Thứ tự thi công T0..T10

| Bước | Việc | Tiêu chí XONG (đo được) |
| --- | --- | --- |
| **T0** | Chạy toàn bộ **W1..W9** của §0.2, dán kết quả vào chính bảng đó; commit `docs(social): FE-1 đóng phép đo §0` | Bảng §0.2 không còn ô `_(điền)_` |
| **T1** | **Hợp đồng đường ống**: `LayoutType += "MODULE_PORTAL"` (D3) · `web-core/src/lib/social-api.ts` + `socialKeys` · build `contracts` rồi `web-core` | `pnpm --filter @mediaos/web-core build` xanh; `pnpm typecheck` xanh |
| **T2** | **Layout portal** (§3.1) + spec responsive | `portal-layout.spec.tsx` xanh; thứ tự DOM feed-trước-rail-phải được assert |
| **T3** | **Sidebar**: tách `prune-unbuilt.ts` (D9) → `social.ts` (D10) → barrel. **CHƯA** cập nhật snapshot | `sidebar-registry.snapshot.spec.ts` **ĐỎ** — đây là kết quả MONG ĐỢI, chứng minh cổng có răng |
| **T4** | **`ROUTE_REGISTRY` + router**: 5 route `/feed*`, `layout:"MODULE_PORTAL"`, `screenCode:"SOC-SCREEN-00x"`, `requiredPermissions:["view:feed"]`, `showInSidebar` | `use-current-route-meta` khớp; điều hướng tay tới cả 5 đường dẫn không 404 |
| **T5** | **5 màn + component** (§3.2) — theo thứ tự 001 → 002 → 003 → 004 → 005 | Mỗi màn đủ 5 trạng thái SPEC-16 §14 |
| **T6** | **Cập nhật snapshot CÓ CHỦ ĐÍCH**: `pnpm --filter @mediaos/app test -u`, rồi **ĐỌC diff 2 file `.txt` như đọc thay đổi điều hướng của PR** | Diff CHỈ thêm khối `### SOCIAL`, không đổi dòng nào của 13 module cũ. **Nghiệm cổng còn răng**: đổi tạm `order` của một mục SOCIAL 10→11 ⇒ spec ĐỎ; trả về ⇒ xanh. Ghi lại 2 kết quả này vào PR |
| **T7** | **Realtime**: `use-feed-realtime.ts`, mount cạnh `useChatRealtime()` trong `ProtectedShell` | Badge tăng khi giả lập `feed:post.created`; **KHÔNG** có bài nào được chèn vào danh sách (assert dương tính) |
| **T8** | **ME**: 2 mục + ô `showBirthday` (PATCH `/me/preferences`, khoá `showBirthday: boolean\|null`) | Bật/tắt rồi reload giữ giá trị; `null` render là "đang hiện" |
| **T9** | **BẬT MODULE — 4 việc CÙNG MỘT COMMIT** (thiếu một là đỏ):<br>① migration `<W1>` `UPDATE modules SET is_active=true WHERE module_code='SOCIAL' AND deleted_at IS NULL` + **dòng journal** (thiếu ⇒ bị BỎ QUA im lặng) + hậu kiểm `RAISE EXCEPTION` nếu vẫn chưa active;<br>② `MODULE_APP_METADATA.SOCIAL`;<br>③ **XOÁ** `EXEMPT_MODULES.SOCIAL` (M7);<br>④ **CHUYỂN** `"SOCIAL"` INACTIVE→ACTIVE (M8) | Migration đếm TRƯỚC khi UPDATE (`ROW_COUNT` sau UPDATE không phân biệt "không có hàng" với "đã đúng giá trị"). **KHÔNG assert `is_active` của module khác** (`wiring-spec-must-not-pin-other-modules-state`). Guard forward-compat: replay nguyên file không RAISE. Ratchet + coverage spec xanh trên `LANE_DB` |
| **T10** | Cập nhật `harness/backlog.mjs` (status + nợ §8), regen STATUS, chạy §9 | §9 xanh hết |

> **Vì sao T9 đứng SAU T5**: bật `is_active` là tuyên bố "module đã launch" (DB-10 §10.2). Bật trước khi có màn ⇒ ô Home «Mạng xã hội» trỏ vào phòng trống. Đây đúng là điều SPEC-16 §23.1b bắt DB-1/DB-2 không được làm và giao cho WO này làm **sau cùng**.

---

## §5. Cổng quyền FE

### 5.1 Luật bất di

1. **CẤM hard-code permission.** Mọi gate qua `<PermissionGate action= resourceType=>` hoặc `useCan(action, resourceType)`.
2. **Dùng `useCan`, KHÔNG `useCanExact`** — M16: cả 14 cặp `feed-*` đều `is_sensitive=false`, nên hành vi đúng là có fallback wildcard (khớp BE).
3. **Masking là việc của SERVER.** FE không tự che. Ví dụ thật: `feedPostSchema.status` là **optional** — BE chỉ trả cho tác giả / người có `manage:feed-post`. FE **không được** khai `status` bắt buộc trong bất kỳ schema phái sinh nào (memory `server-masking-needs-optional-fe-schema`: server bỏ khoá mà FE khai bắt buộc ⇒ ZodError dù HTTP 200 ⇒ **trắng trang cho đúng nhóm vừa được bảo vệ**). Tương tự `feedReportDto.reporter` có thể `null` (SOC-DEC-011).
4. **Forbidden = ẨN mục khỏi rail**, không hiện rồi báo lỗi (SPEC-16 §14). Cơ chế sẵn có: `requiredPermissions` trong `SidebarItemMeta` + `filterSidebarItems`.
5. **TUYỆT ĐỐI KHÔNG bịa cặp.** SPEC-16 §11.2: thích/bỏ thích · lưu/bỏ lưu · đánh dấu đã xem · xác nhận đã đọc · báo cáo **KHÔNG có cặp riêng** — chúng đi theo `view:feed` + sở hữu hàng (`user_id = actor`). Viết `useCan("create","feed-reaction")` là bịa: cặp đó **không tồn tại trong seed** ⇒ `capabilities` không bao giờ có khoá đó ⇒ nút thích **ẩn vĩnh viễn với mọi người**, và không cổng nào bắt được.

### 5.2 Bảng gate từng điểm chạm (cặp lấy từ M16 + bảng route BE)

| Điểm chạm FE | Cặp engine | `useCan(...)` |
| --- | --- | --- |
| Vào portal / rail SOCIAL / mọi màn 001-005 | `view:feed` | `useCan("view","feed")` |
| Nút composer «Chia sẻ» | `create:feed-post` | `useCan("create","feed-post")` |
| Nút composer «Tin tức» (D2) | `create:feed-post` **và** `manage:feed-news` | cả hai — BE-1 `tier1IsFloor` |
| Gửi bình luận / trả lời | `create:feed-comment` | `useCan("create","feed-comment")` |
| Thích · bỏ thích · đổi emoji | **`view:feed`** (§11.2) | `useCan("view","feed")` |
| Lưu · bỏ lưu · đánh dấu đã xem · xác nhận đã đọc | **`view:feed`** (§11.2) | `useCan("view","feed")` |
| Menu ⋯ → Sửa · Xoá bài của MÌNH | `view:feed` + `post.isMine` | `isMine` từ DTO, không phải quyền |
| Menu ⋯ → Xoá/ẩn bài NGƯỜI KHÁC · Khoá bình luận | `manage:feed-post` | `useCan("manage","feed-post")` |
| Menu ⋯ → Ghim / bỏ ghim | **`manage:feed-news`** (KHÔNG phải `manage:feed-post`) | `SOCIAL_MODERATION_FIELD_PAIRS.pinned` của BE ánh xạ `pinned → manage:feed-news` |
| ~~Menu ⋯ → Báo cáo~~ | — | ✍️ **OWNER KÝ 23/09/2026: GỠ khỏi FE-1** (finding #3, HIGH — plan bản đầu tự mâu thuẫn). FE-1 **không** ship nút lẫn hộp thoại soạn báo cáo. Lý do: nợ cảnh báo tự-lộ-danh-tính của **SOC-DEC-011** đi theo **form soạn báo cáo**, không theo màn hàng đợi — ship nút mà thiếu cảnh báo là đúng cái hại spec đã lường trước. Cả nút + dialog + cảnh báo đi cùng nhau ở `S16-SOCIAL-FE-3` (xem N2) |
| Màn Tin tức — danh sách + ack | `view:feed` | |
| Tin tức → **«Danh sách đã đọc»** (`SOCIAL-API-022`) | **`manage:feed-news`** | `<PermissionGate action="manage" resourceType="feed-news">` |
| Tạo tin tức (`type:"news"`) | `create:feed-post` + `manage:feed-news` | |
| Widget Sinh nhật (`SOCIAL-API-026`) | `view:feed` | KHÔNG cặp HR (SOC-DEC-007) |
| Tìm kiếm topbar (`023`) · Thẻ (`024`) · Trang cá nhân (`025`) | `view:feed` | |

> ⚠️ **Bẫy «nút ⋯ vắng ≠ mục vắng»** (UI-07 §34b.4): ca deny phải xác nhận **mục trong menu** không có, không chỉ nút mở menu không render. Nếu không, một thay đổi làm nút biến mất vì lý do khác sẽ làm ca deny xanh giả. Đã dính ở S15-PAYROLL-FE-7.

---

## §6. Kế hoạch test

### 6.1 Luật

- **Mỗi màn ≥1 ca.** Mỗi ca gate phải có **cặp ALLOW + DENY** — ca deny đứng một mình là **xanh-rỗng** (nó xanh cả khi nút bị hỏng vì lý do khác).
- **Build trước khi chạy**: `pnpm --filter @mediaos/contracts build && pnpm --filter @mediaos/web-core build` **TRƯỚC** mọi lượt spec của `apps/app` — dist cũ gây trắng trang / typecheck đỏ oan (memory `stale-contracts-dist-typecheck-false-red`, `web-core-stale-dist-white-page`).
- **Đọc `EXIT=`, đừng đọc dòng cuối**: full-suite `apps/app` hay chết `ERR_IPC_CHANNEL_CLOSED` (tinypool) **SAU KHI ĐÃ PASS**. Chạy `--reporter=dot`, ghi log, đọc `EXIT=`.
- **`pnpm test -- <path>` KHÔNG lọc** — nó chạy TOÀN BỘ suite (memory). Lọc bằng `pnpm --filter @mediaos/app exec vitest run <path>`.

### 6.2 Ma trận ca

| # | Màn / đơn vị | ALLOW | DENY (đối chứng) |
| --- | --- | --- | --- |
| C1 | `PortalLayout` | ≥1024px: 3 cột, cột giữa `max-w-680` | <1024px: rail trái = tab ngang, rail phải là node **cuối** trong DOM |
| C2 | `SOC-SCREEN-001` Bảng tin | có `view:feed` ⇒ danh sách + composer render | thiếu `view:feed` ⇒ mục **ẩn khỏi rail** (không phải hiện rồi 403) |
| C3 | Composer nút «Tin tức» | có `manage:feed-news` ⇒ nút HIỆN | **không** có ⇒ nút KHÔNG render (và chỉ còn đúng 1 nút «Chia sẻ») |
| C4 | Composer — số nút | đúng **2** nút | **không có** nút poll/idea/kudos nào (chặn scope creep bằng test) |
| C5 | Menu ⋯ — ghim | có `manage:feed-news` ⇒ **mục** «Ghim» có trong menu | có `manage:feed-post` nhưng KHÔNG có `manage:feed-news` ⇒ **mở menu ra** và assert **mục** «Ghim» vắng (không assert nút ⋯ vắng) |
| C6 | Menu ⋯ — xoá bài người khác | `manage:feed-post` ⇒ mục «Xoá» có | chỉ `view:feed` + `isMine=false` ⇒ mục «Xoá» vắng, **nhưng mục «Sao chép liên kết» vẫn có** (đối chứng menu không rỗng vì lý do khác). 🔴 **SỬA SAU REVIEW (finding #3):** bản đầu dùng «Báo cáo» làm đối chứng — nay đã gỡ khỏi FE-1, dùng mục **không cần quyền** nào khác thay thế. Nếu `PostCard` cuối cùng không có mục nào ngoài quyền thì ca này phải assert **nút ⋯ vẫn render** + menu mở được, chứ KHÔNG được bỏ vế đối chứng |
| C7 | Nút Thích | chỉ `view:feed` ⇒ nút **HIỆN** (§11.2) | — ca này là lưới chống bịa cặp `create:feed-reaction`: nếu ai đó thêm gate sai, ca ALLOW này ĐỎ |
| C8 | `SOC-SCREEN-002` Chi tiết | render bài + bình luận + người thích | bài đã xoá ⇒ empty "không tìm thấy", không vỡ |
| C9 | `SOC-SCREEN-003` Tin tức | `view:feed` ⇒ danh sách + nút «Xác nhận đã đọc» | thiếu `manage:feed-news` ⇒ tab/nút **«Danh sách đã đọc» vắng**; có ⇒ hiện |
| C10 | `SOC-SCREEN-004` Đã lưu | có bài ⇒ danh sách | rỗng ⇒ empty **riêng** ("chưa lưu bài nào") |
| C11 | `SOC-SCREEN-005` Trang cá nhân | bài của người khác render | của chính mình ⇒ nhãn khác |
| C12 | 3 empty khác nhau (§14) | — | assert 3 chuỗi KHÁC NHAU: "chưa có bài nào" · "không có kết quả tìm kiếm" · "đã lưu rỗng" (dùng `not.toBe` giữa các chuỗi để chống copy-paste) |
| C13 | Loading / Error | skeleton **thẻ bài** (không spinner giữa trang) | error ⇒ khối lỗi **trong cột feed**, hai rail còn nguyên, có nút «Thử lại» |
| C14 | `parseFeedBody` (thuần) | `#tag` → link `/feed?tag=`, `@mention` → link profile, URL → link | chuỗi `<img src=x onerror=alert(1)>` render thành **text**, và assert **không** có element `img` nào; `dangerouslySetInnerHTML` không xuất hiện trong cây |
| C15 | `useFeedRealtime` badge | 3 event `feed:post.created` ⇒ badge "3 bài mới" | **assert danh sách bài KHÔNG đổi độ dài** (D7) |
| C16 | `useFeedRealtime` gate | có `view:feed` ⇒ có đăng ký listener | không có ⇒ **không** `socket.on`; unmount ⇒ `socket.off` đối xứng (đếm on == đếm off) |
| C17 | URL search (D6) | `?sort=latest&tag=x` ⇒ query gọi đúng tham số | tham số rác ⇒ Zod rơi về mặc định, không crash |
| C18 | Sidebar snapshot | 2 file `.txt` khớp | **nghiệm răng HAI VẾ** (finding #13): ① đổi `order` 1 mục SOCIAL ⇒ `sidebar-tree.raw.txt` ĐỎ; ② **gỡ `requiredAnyPermissions` của 1 mục SOCIAL ⇒ `sidebar-tree.by-permission.txt` + Test 3 phải ĐỎ**. Vế ② là thứ DUY NHẤT chứng minh «forbidden = ẩn» (SPEC-16 §14) — chỉ nghiệm vế ① là chưa động tới nó. Ghi CẢ HAI cặp đỏ→xanh vào PR |
| C23 | Widget «Tin nổi bật» | có tin ⇒ render danh sách | rỗng ⇒ empty riêng, không vỡ rail phải |
| C24 | Ô tìm kiếm portal (`SOCIAL-API-023`) | gõ ⇒ gọi đúng route 023 | thiếu `view:feed` ⇒ ô **không render** |
| C25 | ME — 2 mục + `showBirthday` | có `view:feed` ⇒ 2 mục hiện, `path` tồn tại trong `ROUTE_REGISTRY` | thiếu `view:feed` ⇒ 2 mục vắng; `showBirthday` bật/tắt persist, `null` render là «đang hiện» |
| C26 | **Trạng thái «đang gửi»** (SPEC-16 §14, trạng thái thứ 5) | composer gửi ⇒ nút **khoá** + hiện tiến trình | bấm 2 lần liên tiếp ⇒ **chỉ 1 request** (chống double-submit) |
| C19 | `pruneUnbuiltScreens` sau tách (D9) | 3 mục có route ⇒ hiện | 3 mục track B chưa có route ⇒ **bị cắt**; PAYROLL vẫn prune y như trước (chống hồi quy khi tách file) |
| C20 | **routes-authz wiring** | mọi entry `ROUTE_REGISTRY` moduleCode SOCIAL có `requiredPermissions` chứa `view:feed` | không entry SOCIAL nào `isPublic: true`; mọi `path` của `SOCIAL_SIDEBAR` sau prune đều tồn tại trong `ROUTE_REGISTRY` (chống link chết) |
| C21 | Birthday widget (D12) | `{fullName:null, avatar:null}` render fallback, **không** ZodError | payload có khoá `avatarUrl` thay vì `avatar` ⇒ ca ĐỎ (ghim đúng tên khoá) |
| C22 | Module metadata (BE) | `MODULE_APP_METADATA.SOCIAL` tồn tại; **`requiredAny`** (KHÔNG phải `permissions` — finding #14, tên trường sai ở bản đầu) chứa `{action:"view", resourceType:"feed"}`; **`metadata.route === APP_REGISTRY(social).defaultRoute === "/feed"`** (ràng D13 và T9② vào nhau, khuôn `module-app-metadata.ts:179-185`) | ratchet: 0 vi phạm `MISSING_METADATA`/`ORPHAN_METADATA`/**`DOUBLE_LISTED`** |

### 6.3 Lệnh chạy

```bash
# BẮT BUỘC trước mọi lượt spec của apps/app
pnpm --filter @mediaos/contracts build
pnpm --filter @mediaos/web-core build

# FE
pnpm --filter @mediaos/app test --reporter=dot 2>&1 | tee /tmp/app.log; echo "EXIT=$?"
pnpm --filter @mediaos/app exec vitest run src/routes/social src/layouts/portal   # lọc đúng cụm
pnpm --filter @mediaos/app test -u                                                # CHỈ ở T6

# BE (2 sổ + ratchet) — cần Postgres + LANE_DB
bash scripts/lane-db-setup.sh socialfe1
export LANE_DB=mediaos_socialfe1
pnpm --filter @mediaos/api exec vitest run test/foundation/module-app-metadata-ratchet.unit-spec.ts
pnpm --filter @mediaos/api exec vitest run src/foundation/module-catalog/module-app-metadata-coverage.int.spec.ts
pnpm --filter @mediaos/api exec vitest run test/integration/migration-smoke.int-spec.ts
```

---

## §7. Rủi ro & bẫy đã biết

| # | Rủi ro | Dấu hiệu | Cách chặn |
| --- | --- | --- | --- |
| **R1** | 🔴 **Không có đường đăng ký tệp cho SOCIAL** — `POST /social/files/upload-url` + `/confirm` KHÔNG tồn tại; `foundation/files` đòi `*:foundation-file` mà employee không có | Nút đính kèm 403 cho gần hết người dùng | **D8**: cắt đính kèm khỏi FE-1, ghi nợ N1. **Phát hiện lại lúc T0 qua W7** — nếu ai đó đã mở endpoint thì mở lại phạm vi có kiểm soát |
| **R2** | **Snapshot sidebar đỏ** khi thêm module thứ 14 | `sidebar-registry.snapshot.spec.ts` đỏ ở T3 | **Đỏ CÓ CHỦ ĐÍCH.** T6 cập nhật `-u` rồi ĐỌC diff; nghiệm cổng còn răng bằng vi phạm thật (đổi `order` ⇒ đỏ). Không bao giờ `-u` mù |
| **R3** | **dist cũ của `web-core`/`contracts`** ⇒ trắng trang lúc chạy hoặc typecheck đỏ oan | Lỗi không liên quan gì tới diff | Luôn build 2 package **trước** spec (§6.1). Nghi ngờ ⇒ xoá `dist/` rồi build lại |
| **R4** | **Module-enable guard chặn WO kế** | Ca idempotency replay migration ném `P0001` | M4 đã đo: **không migration SOCIAL nào assert `is_active=false`** ⇒ rủi ro này KHÔNG hiện hữu. Nhưng migration MỚI của T9 **tự nó** không được assert trạng thái module khác, và phải replay được |
| **R5** | **Quên 1 trong 4 việc của T9** | Migration chạy nhưng `getMyApps` im lặng bỏ SOCIAL (fail-soft `logger.warn` + `continue`) — **không test nào đỏ nếu thiếu cả 2 sổ** | T9 làm **4 việc một commit**; cổng C22 + `migration-smoke` bắt. Đặc biệt: **XOÁ `EXEMPT_MODULES.SOCIAL`** (M7) — quên là `DOUBLE_LISTED` đỏ |
| **R6** | **Migration thiếu dòng journal** ⇒ bị BỎ QUA trong im lặng | Migrate "thành công" mà `is_active` vẫn false | Thêm dòng journal cùng file; hậu kiểm `RAISE EXCEPTION` nếu sau UPDATE vẫn chưa active |
| **R7** | **Slug widget FE là cổng runtime không được kiểm** (memory `fe-widget-slug-map-is-unchecked-runtime-gate`) | Widget ném "widget chưa có FE slug mapping" mọi lần mở, mọi spec vẫn xanh | FE-1 **KHÔNG** thêm widget DASH (ngoài phạm vi §1.2). Khi FE-3 thêm `SOCIAL-WIDGET-001/002` phải sửa **3** bản đồ: `DASH_WIDGET_CODE` · `WIDGET_COMPONENTS` · **`DASH_WIDGET_SLUG`** (web-core) |
| **R8** | **Server masking cần schema FE optional** | ZodError dù HTTP 200 ⇒ trắng trang cho đúng role vừa được bảo vệ | `feedPostSchema.status` optional · `feedReportDto.reporter` nullable · `feedBirthdaySchema.fullName/avatar` nullable. **Nghiệm pin đỏ**: gỡ `.optional()`, chạy lại, phải thấy đúng ca mới đỏ — đừng tin suông |
| **R9** | **Khoá `avatar` vs `avatarUrl`** — birthday DTO dùng `avatar`, phần còn lại dùng `avatarUrl` | Widget sinh nhật trắng | C21 ghim đúng tên khoá bằng ca ĐỎ |
| **R10** | **Bịa cặp quyền** cho tương tác cá nhân | Nút thích ẩn với mọi người, không cổng nào bắt | §5.1 luật 5 + ca **C7 ALLOW** (chỉ `view:feed` mà nút phải HIỆN) |
| **R11** | **Chiếm `/social`** làm vỡ đường SSO fbpost | Trang lỗi fbpost 404 | **D1**: portal ở `/feed`; `socialRedirectRoute` (router.tsx:2983) không được đụng |
| **R12** | **Tách `pruneUnbuiltScreens` làm hồi quy PAYROLL** | Mục PAYROLL biến mất/link chết | C19 assert PAYROLL prune y như trước khi tách |
| **R13** | **File chạm trần 800** | `PostCard.tsx`/`FeedComposer.tsx` phình | Trần tự đặt 400 (§3); chạm 400 ⇒ tách component con ngay, không đợi 800 |
| **R14** | **`ERR_IPC_CHANNEL_CLOSED`** đọc như đỏ thật | Full-suite `apps/app` chết ở cuối sau khi đã pass | Đọc `EXIT=`, không đọc dòng cuối (§6.1) |
| **R15** | **Số migration trôi** vì PR #534 merge trước | Xung đột số / journal | W1 đo lại lúc rebase cuối; đánh số ở bước cuối cùng, không ở bước đầu |

---

## §8. Nợ bàn giao

| # | Nợ | Vì sao để lại | Giao cho |
| --- | --- | --- | --- |
| **N1** | 🔴 **Đính kèm ảnh/video cho bài & bình luận** — cần 2 route bọc own-scope `POST /social/files/upload-url` + `POST /social/files/:id/confirm` | ✍️ **OWNER KÝ 23/09/2026**: cắt khỏi FE-1 (D8), seed WO BE riêng. D8 đã được reviewer **cố phá và không phá được**: `apps/api/src/social/*.controller*.ts` không có route file nào; `FilesController` gate toàn bộ bằng `*:foundation-file` (`files.controller.ts:49-64`); migration `0569` còn **RAISE EXCEPTION** nếu recruiter/hr được cấp cặp đó ⇒ employee chắc chắn không có | **`S16-SOCIAL-BE-1C`** (đã seed vào backlog) rồi `S16-SOCIAL-FE-2` dựng UI.<br>💡 **Đường RẺ do reviewer tìm ra — ghi để BE-1C không làm quá tay:** tiền lệ `avatar-own-scope-presign-wrapper` chứng minh **`FileService` KHÔNG gate — gate nằm ở `FilesController`**. Nên BE-1C chỉ cần **2 route bọc own-scope** (gate `create:feed-post` / `create:feed-comment`) gọi thẳng `files.upload` / `files.confirmUpload`: **KHÔNG cặp quyền mới, KHÔNG migration**. `SocialFileResolver` + `social-attachments.service.ts` đã sẵn phía server, chỉ thiếu cửa vào |
| **N2** | **Cảnh báo lúc soạn báo cáo** — người tố giác có thể tự lộ danh tính qua trường `note` tự do | SOC-DEC-011 ghi tường minh đây là **nợ FE**. Màn báo cáo/hàng đợi thuộc track C | `S16-SOCIAL-FE-3` (màn `SOC-SCREEN-010`). Nếu FE-2 làm nút «Báo cáo» trong menu ⋯ trước thì **cảnh báo đi cùng nút đó**, không đợi FE-3 |
| **N3** | **Composer 3 nút poll/idea/kudos** | BE-2B-1 chưa merge (D2) | `S16-SOCIAL-FE-2` |
| **N4** | **Tile «Đăng bài Facebook»** gộp vào rail SOCIAL qua `sidebar-extensions.ts` | Ranh giới §1.3 | `S16-SOCIAL-FBPOST-1` |
| **N5** | **Widget DASH `SOCIAL-WIDGET-001/002`** — nhớ 3 bản đồ (R7) | Ngoài phạm vi | `S16-SOCIAL-FE-3` |
| **N6** | **Room WS `co:{c}:feedgroup:{groupId}`** chưa hiện thực phía BE; không có room cho `audience='org_unit'` ⇒ badge chỉ đếm bài `audience='company'` | Giới hạn BE hôm nay, không phải lỗi FE | Ghi chú trong UI? **Không** — im lặng là đúng ở v1; mở WO khi FE-2 làm Nhóm |
| ~~**N7**~~ | ~~`LayoutType` thêm nhánh — rà mọi `switch`~~ | 🔴 **XOÁ (finding #6): việc RỖNG.** Không file nào đọc `RouteMeta.layout` ⇒ không có `switch` nào để rà. Thay bằng yêu cầu **gắn răng thật** đã ghi ở D3 | — |
| **N8** | **Nút «Báo cáo» + hộp thoại soạn báo cáo + cảnh báo tự-lộ-danh-tính** (SOC-DEC-011) | ✍️ Owner ký 23/09/2026: gỡ khỏi FE-1 (§5.2). Nợ đi theo **form soạn**, không theo màn hàng đợi — ship nút mà thiếu cảnh báo là đúng cái hại spec lường trước | `S16-SOCIAL-FE-3` — **ba thứ đi cùng một lượt**, không tách |

---

## §9. Lệnh đóng WO

```bash
# 0) Đồng bộ + đo lại số migration (W1)
git fetch origin && git rebase origin/master
tail -20 apps/api/migrations/meta/_journal.json

# 1) Build theo thứ tự phụ thuộc
pnpm --filter @mediaos/contracts build
pnpm --filter @mediaos/web-core build
pnpm build

# 2) Tĩnh
pnpm lint
pnpm typecheck

# 3) FE — 3 app (đọc EXIT=, KHÔNG đọc dòng cuối)
pnpm --filter @mediaos/app  test --reporter=dot 2>&1 | tee /tmp/app.log;  echo "EXIT=$?"
pnpm --filter @mediaos/console test --reporter=dot 2>&1 | tee /tmp/con.log; echo "EXIT=$?"
pnpm --filter @mediaos/auth test --reporter=dot 2>&1 | tee /tmp/auth.log; echo "EXIT=$?"

# 4) Cổng coverage
#    🔴 SỬA SAU REVIEW (finding #10): `test:chat-cov` CHẠY src/layouts nhưng `coverage.include`
#    chỉ là `src/components/chat/**` (apps/app/vitest.config.ts:37-45) ⇒ nó KHÔNG ĐO một dòng nào
#    của routes/social hay layouts/portal. Nhầm phạm vi CHẠY với phạm vi ĐO.
#    ✍️ OWNER KÝ 23/09/2026: thêm script đo riêng, ngưỡng 80 (khuôn test:chat-cov).
pnpm --filter @mediaos/app test:chat-cov      # giữ — chống hồi quy cụm chat
pnpm --filter @mediaos/app test:social-cov    # MỚI: include src/routes/social/**, src/layouts/portal/**

# 5) BE — 2 sổ module + ratchet + migration smoke (CẦN Postgres + LANE_DB)
bash scripts/lane-db-setup.sh socialfe1
export LANE_DB=mediaos_socialfe1
pnpm db:migrate
pnpm --filter @mediaos/api exec vitest run \
  test/foundation/module-app-metadata-ratchet.unit-spec.ts \
  src/foundation/module-catalog/module-app-metadata-coverage.int.spec.ts \
  test/integration/migration-smoke.int-spec.ts

# 6) Cổng tổng — chạy NHƯ CI (đừng pipe qua tail)
bash harness/check.sh --lane-db=socialfe1

# 7) Nghiệm SNAPSHOT CÒN RĂNG (bắt buộc ghi kết quả vào PR)
#    đổi tạm order của 1 mục trong sidebar/social.ts 10 -> 11
pnpm --filter @mediaos/app exec vitest run src/layouts/workspace/sidebar-registry.snapshot.spec.ts   # PHẢI ĐỎ
#    trả về 10
pnpm --filter @mediaos/app exec vitest run src/layouts/workspace/sidebar-registry.snapshot.spec.ts   # PHẢI XANH
```

**Điều kiện mở PR:** mục 1-6 xanh · mục 7 cho đúng cặp ĐỎ→XANH · bảng §0.2 đã điền hết · `harness/backlog.mjs` đã cập nhật · diff 2 file `__snapshots__/*.txt` chỉ thêm khối `### SOCIAL`.

---

## §10. Tự kiểm đối chiếu `done_when`

| `done_when` (backlog) | Mục của plan phủ |
| --- | --- |
| Template portal 3 cột riêng (240/680/300), theme, keyboard/focus, <1024px tab ngang + rail phải xuống cuối, không đụng UI-07 2 cột | D3 · D4 · §3.1 · T2 · C1 |
| Bảng tin: composer theo quyền · thẻ bài · lưới ảnh · xem thêm · reaction · bình luận · badge WS · lọc/sắp xếp trong URL · empty/loading/error | D2 · D5 · D6 · D7 · §3.2 · T5 · C2-C8, C12-C15, C17 — ⚠️ **đính kèm CẮT (D8/N1)**, phần "bình luận đính kèm" của done_when **không** thoả ở WO này, phải ghi rõ trong PR |
| Tin tức: ghim/bỏ ghim · xác nhận đọc · danh sách đã đọc (chỉ `manage:feed-news`); Sinh nhật Hôm nay/Tuần/Tháng + «Gửi lời chúc»; ME 2 mục + preference ẩn sinh nhật | §5.2 · D12 · T5 · T8 · C9 · C21 |
| Migration bật `modules.is_active` (guard forward-compat, không assert module khác) + `MODULE_APP_METADATA`; ô Home hiện theo module + `view:feed`; test ≥ ca mỗi màn + routes-authz wiring; typecheck/build/test 3 app xanh | M3-M8 · T9 · C20 · C22 · §9 |

> ⚠️ **Một lệch done_when phải nêu tường minh trong PR**: gạch "bình luận mention/**đính kèm**/emoji" không đóng được vì R1 (không có đường đăng ký tệp). Mention + emoji **có**; đính kèm chuyển N1. Đây là lệch hợp đồng, không phải quên — cần chữ ký owner.

---

## §11. Sổ vết review — `plan-reviewer` VERDICT: BLOCK → đã vá (23/09/2026)

Plan bản đầu bị **BLOCK** với 15 finding. Bảng dưới là trạng thái từng cái; các mục ✍️ đã có **chữ ký owner 23/09/2026**.

| # | Sev | Điều sai | Trạng thái |
| --- | --- | --- | --- |
| 1 | CRITICAL | WO khai amber nhưng T9 ship migration ⇒ phải đỏ/FULL gate | ✅ vá — đầu file, T9 tách commit riêng |
| 2 | HIGH | Mục ME trỏ `/feed/profiles/$me` = link chết (ME không qua `pruneUnbuiltScreens`) | ✅ vá — W5, route tĩnh `/feed/profiles/me` + mở rộng C20 |
| 3 | HIGH | Mâu thuẫn nút «Báo cáo» vs nợ SOC-DEC-011 | ✍️ owner: **gỡ khỏi FE-1** — §5.2, C6, N8 |
| 4 | HIGH | D13 gây hồi quy ô Home cho người fbpost-only | ✍️ owner: **hai tile** — D13 |
| 5 | HIGH | `paths` WO không phủ 3 file plan bắt sửa | ✍️ owner: mở `paths` — làm ở **T0**, không đợi T10 |
| 6 | MED-HIGH | D3 sai sự kiện: không ai đọc `RouteMeta.layout`, không `switch` nào đỏ | ✅ vá — D3 gắn răng thật, **N7 xoá** |
| 7 | MEDIUM | Thiếu ca cho Tin nổi bật · ô tìm kiếm · ME · trạng thái «đang gửi» | ✅ vá — **C23–C26** |
| 8 | MEDIUM | Ô tìm kiếm chưa có file gắn kết, chưa quyết toàn cục hay chỉ portal | ✅ chốt — đặt trong **PortalLayout header**, KHÔNG đụng `GlobalTopbar` (0 hồi quy cho 13 module khác) |
| 9 | MEDIUM | W1 để ngỏ số migration, không nói `when` phải tăng ngặt | ✅ vá — W1/W2 ghim `0586` · `idx 253` · `when 1717587375000` |
| 10 | MEDIUM | Nhầm phạm vi CHẠY với phạm vi ĐO của coverage | ✍️ owner: thêm **`test:social-cov`** — §9 mục 4 |
| 11 | MEDIUM | Im lặng bỏ «dải ô liên kết nhanh» (phần của `SOC-SCREEN-001`) | ✅ vá — xem ghi chú dưới bảng |
| 12 | MEDIUM | Mâu thuẫn: trích UI-07 «không sửa `layouts/workspace/`» rồi sửa 4 file ở đó | ✅ diễn giải — xem ghi chú dưới bảng |
| 13 | LOW-MED | Chỉ nghiệm 1 trong 2 snapshot; vế by-permission chưa có răng | ✅ vá — **C18 hai vế** |
| 14 | LOW | Sai tên trường `permissions` → `requiredAny`; thiếu ràng buộc `route` ↔ `defaultRoute` | ✅ vá — C22 |
| 15 | LOW | Tách `pruneUnbuiltScreens` phải giữ cả 2 đường import công khai | ✅ đã có ở D9/C19 — giữ |

**Finding #11 — «dải ô liên kết nhanh»:** SPEC-16 §9 liệt kê nó là một phần của `SOC-SCREEN-001`, nhưng nó thuộc **SC-14 track C** (SPEC-16 §5.1 dòng 131) và đã nằm trong `done_when` của `S16-SOCIAL-FE-3`. ⇒ **`SOC-SCREEN-001` ship THIẾU phần này ở FE-1** — nói rõ trong PR, không im lặng. ✍️ owner ký hoãn sang FE-3.

**Finding #12 — diễn giải luật UI-07 §34b.6:** luật «không sửa `layouts/workspace/`» nhắm vào **component khuôn 2 cột** (`ModuleWorkspaceLayout` và bạn của nó). **Dữ liệu sidebar** (`sidebar/*.ts`, barrel `sidebar-registry.ts`) là **ngoại lệ có chủ đích** vì `ModuleSidebar` dùng chung cho mọi module — D11 chọn tái dùng chính nó thay vì viết rail riêng, nên phải khai dữ liệu ở đúng chỗ đang có.

### Chữ ký owner 23/09/2026 — 8 mục

1. ✍️ **Cắt đính kèm** khỏi FE-1; seed `S16-SOCIAL-BE-1C` (2 route bọc own-scope, **không cặp quyền mới, không migration**). ⇒ `done_when` gạch 2 phần «đính kèm» **không đóng** ở WO này.
2. ✍️ **Ô Home: hai tile** — `social` → portal `/feed` gate `view:feed`; thêm `fbpost` → `/social` gate `view:social-post`.
3. ✍️ **T9 = commit riêng, FULL gate + người chốt** (chạm migration ⇒ đỏ theo `harness/policy.md`).
4. ✍️ **Mở `paths`** của WO: `+apps/api/test/**`, `+apps/app/src/hooks/**`.
5. ✍️ **Thêm cổng `test:social-cov`** (ngưỡng 80) cho `routes/social/**` + `layouts/portal/**`.
6. ✍️ **Gỡ «Báo cáo»** khỏi FE-1; nút + dialog + cảnh báo SOC-DEC-011 đi cùng nhau ở FE-3.
7. ✍️ **Hoãn «dải ô liên kết nhanh»** (SC-14) sang FE-3.
8. ⚠️ **Cần owner biết trước khi merge:** cổng `module-app-metadata-coverage.int.spec.ts` gọi đích danh WO này (M6) **cần `LANE_DB`**. Máy thi công không có Postgres/Docker ⇒ WO đóng mà cổng chưa từng chạy thật. Bắt buộc `bash harness/check.sh --all` trước khi mở PR.

### Điều reviewer KIỂM CHỨNG LÀ ĐÚNG (giữ nguyên, đừng bàn lại)

- **D8 cắt đính kèm là ĐÚNG** — reviewer cố phá không được (bằng chứng ở N1).
- 4 con số migration/module đã được **đo độc lập hai lần** (người gọi + reviewer), khớp.
- `feedCreatableTypeSchema = ["share","news"]` (`social-api.ts:82`) ⇒ D2 đúng.
- `feedBirthdaySchema.avatar` nullable (`social-api-b.ts:239-243`) ⇒ D12 đúng, khoá là `avatar` không phải `avatarUrl`.
- `feedPostSchema.status.optional()` (`social-api.ts:167`) ⇒ R8 đúng.
- 3 event `WS_EVENTS.FEED_*` (`realtime.ts:70-72`) ⇒ T7 đúng.
- **T9 đúng 4 việc, KHÔNG có việc thứ 5** — reviewer quét `"SOCIAL"` toàn `apps/api` (`openapi-modules.ts:151` đã có SOCIAL; catalog NOTI đã do DB-2 đóng).
