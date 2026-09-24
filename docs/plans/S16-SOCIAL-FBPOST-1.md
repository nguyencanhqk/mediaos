# S16-SOCIAL-FBPOST-1 — gộp «Đăng bài Facebook» vào rail SOCIAL (SOC-DEC-002)

> Zone **green** · gate **LIGHT** (thuần FE) · `depends_on` DOC-1 + FE-1 (cả hai ĐÃ merge: #526, #535).
> Vế còn lại của quyết định D13 ở `S16-SOCIAL-FE-1` — đọc `packages/web-core/src/lib/registry.ts`
> docblock hai ô `social`(90) và `fbpost`(90.5) trước khi sửa.

---

## §1. ĐO TRÊN MASTER 24/09/2026 — bằng chứng, đừng đo lại

| #   | Đo được                                                                                               | Nguồn                                            |
| --- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| 1   | Khe `sidebar-extensions.ts` render **CUỐI** nav: `{Extension && !collapsed && <Extension />}`         | `ModuleSidebar.tsx:343`                          |
| 2   | 🔴 Khe đó **KHÔNG render khi sidebar thu gọn** (icon-mode)                                            | cùng dòng 343                                    |
| 3   | Ô Home lẫn AppSwitcher dùng **CÙNG MỘT** `getVisibleApps(APP_REGISTRY, …)`                            | `HomePortalLayout.tsx:55` · `AppSwitcher.tsx:70` |
| 4   | Ô cổng thông tin SOCIAL gate `view:feed`; **cả 6 mục** `SOCIAL_SIDEBAR_V2` cũng gate `view:feed`      | `registry.ts:784` · `sidebar/social.ts`          |
| 5   | `app.fbpost` = «Đăng bài Facebook» ĐÃ CÓ trong i18n nav (không cần khoá mới)                          | `i18n/locales/vi/nav.ts:26`                      |
| 6   | `AppRegistryItem` KHÔNG có trường nào tách «hiện ở Home» khỏi «hiện ở AppSwitcher»                    | `registry.ts:529-547`                            |
| 7   | `registry.spec.ts` assert `order` tăng dần **theo vị trí mảng** ⇒ ô `fbpost` phải ở nguyên chỗ (90.5) | docblock ô `fbpost`                              |

---

## §2. 🔴 Điều `done_when` (a) đọc thoáng sẽ làm SAI

(a) nói «gỡ ô riêng khỏi Home». Nếu hiểu là **xoá hẳn khỏi `APP_REGISTRY`** thì:

- ô Home lẫn entry AppSwitcher **cùng mất** (đo #3 — một hàm, hai nơi gọi);
- người **chỉ** có `view:social-post` (không có `view:feed`) **không vào được `/feed`** (đo #4) ⇒ không
  bao giờ thấy rail SOCIAL ⇒ **mất sạch đường vào fbpost**;
- đúng «cửa sổ tile chết» mà FE-1 cố tình tách ô 90.5 để TRÁNH, và `done_when` (b) **cấm** tái tạo.

Thêm: kể cả người có `view:feed`, khi họ thu gọn sidebar (icon-mode) thì mục rail **biến mất** (đo #2)
⇒ rail một mình KHÔNG phải một đường vào đủ.

⇒ **Đọc đúng:** gỡ khỏi **lưới ô Home**, GIỮ entry trong **AppSwitcher** — đúng chữ `done_when` (b)
(«giữ tile tạm hoặc entry trong AppSwitcher»).

---

## §3. Quyết định

| Mã     | Quyết định                                                                                                                                   | Vì sao                                                                                                                                                                                 |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D1** | Mục rail = khe CÓ SẴN `sidebar-extensions.ts`, component `SocialFbpostLink`                                                                  | Không chạm `SidebarItemMeta` ⇒ không chạm 13 module + 2 snapshot `sidebar-tree.*.txt`. Gọi thẳng `openSocial()` nên giữ nguyên «SSO mở thẳng, fallback `/social`». Tự nằm CUỐI (đo #1) |
| **D2** | Thêm trường **tuỳ chọn** `switcherOnly?: boolean` vào `AppRegistryItem`; đặt `true` cho ô `fbpost`; `HomePortalLayout` lọc nó khỏi lưới Home | Tách được «Home» khỏi «AppSwitcher» mà đo #6 nói hiện chưa tách được. Additive, đúng MỘT ô dùng ⇒ không đụng ô nào khác. Giữ vị trí mảng 90.5 (đo #7)                                  |
| **D3** | Gate mục rail = `view:social-post` **HOẶC** `manage:social-account`                                                                          | Đúng `done_when` (a). KHÔNG đổi quyền/seed/API (WO green)                                                                                                                              |
| **D4** | KHÔNG đổi `rootPath`/`defaultRoute` `/social` của ô `fbpost`                                                                                 | `/social` là đường LỖI (trang trung chuyển hiện thông báo đọc được); đường thường đi qua `openSocial()`                                                                                |

**Chờ chữ ký owner (không chặn thi công, mặc định theo D2):**

1. D2 giữ entry fbpost trong AppSwitcher — nếu owner muốn **xoá hẳn** khỏi `APP_REGISTRY` thì phải chấp
   nhận người `view:social-post`-only mất đường vào, HOẶC mở `view:feed` cho họ (đổi quyền ⇒ **tách WO**).
2. Mục rail vắng ở icon-mode (đo #2). Vá đúng nghĩa đòi đổi `SidebarItemMeta` + 2 snapshot ⇒ ngoài phạm
   vi WO green. Hiện dựa vào AppSwitcher làm đường vào luôn-có.

---

## §4. Phép ĐO CỔNG (ca phải ĐỎ nếu bỏ bản vá)

| #   | Ca                                                                                                               | Đo vế nào                                         |
| --- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| C1  | `getVisibleApps` vẫn trả ô `fbpost` cho người có `view:social-post`                                              | D2 không bịt AppSwitcher                          |
| C2  | Lưới Home lọc HẾT ô `switcherOnly`                                                                               | D2 — bỏ filter thì ca ĐỎ                          |
| C3  | Mảng `APP_REGISTRY` vẫn có `order` tăng dần theo vị trí                                                          | đo #7                                             |
| C4  | Rail SOCIAL: có `view:social-post` ⇒ thấy mục; có `manage:social-account` ⇒ thấy; **không cặp nào** ⇒ KHÔNG thấy | D3 (ca DENY + 2 ca ALLOW — ca DENY rỗng không đủ) |
| C5  | Bấm mục ⇒ gọi `openSocial`; `openSocial` lỗi ⇒ điều hướng `/social`                                              | D1 giữ hành vi cũ                                 |

---

## §5. Thi công 24/09/2026 — và HAI LỖI THẬT của master phát hiện dọc đường

Cả hai cùng MỘT gốc: `S16-SOCIAL-FE-1` cho hai ô dùng chung `moduleCode: "SOCIAL"` và **đổi nghĩa**
`appKey: "social"` (vệ tinh → cổng thông tin), nhưng `AppSwitcher` vẫn nhận diện theo giá trị cũ. Không
cổng nào trong kho bắt được vì `layouts/home/` **không có spec nào** trước WO này.

| #   | Lỗi (trên master, trước WO này)                                               | Hệ quả người dùng thấy                                                                                                                                                 | Vá                                                                         |
| --- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| B1  | `AppSwitcher.doNavigate` kiểm `app.appKey === "social"` để gọi `openSocial()` | Chọn «Mạng xã hội» bị SSO đẩy **thẳng ra ứng dụng Facebook**, KHÔNG bao giờ tới `/feed`; còn «Đăng bài Facebook» rơi về trang trung chuyển `/social` thay vì vào thẳng | Tách map thuần `cross-domain-apps.ts`, khoá `fbpost` (không phải `social`) |
| B2  | `handleSelect` + badge «Đang mở» so theo `moduleCode` một mình                | Đang ở `/feed` thì «Đăng bài Facebook» bị coi là "đang mở" ⇒ **bấm chết** (chỉ đóng overlay) + badge sai — đúng lúc cần nó nhất (rail không render ở icon-mode)        | Vị từ `isCurrentApp()`: app cross-domain KHÔNG bao giờ là "app đang mở"    |

### Phép đo (đã chạy, kèm ĐỘT BIẾN)

| Ca                                                                        | Kết quả                   | Đột biến chứng minh ca không rỗng                                                                                                                  |
| ------------------------------------------------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `registry.spec.ts` +5 ca (C1 · C2 · C2b · C2c · C3)                       | 167/167 PASS              | Bỏ `switcherOnly: true` ⇒ **C2 + C2b ĐỎ** đúng thông điệp assert (`expected [ 'me', 'fbpost' ] to not include 'fbpost'`), KHÔNG phải lỗi biên dịch |
| `cross-domain-apps.spec.ts` (mới, 9 ca)                                   | 9/9 PASS                  | Khoá `"social"` quay lại map ⇒ ca B1 ĐỎ; so theo `moduleCode` ⇒ ca B2 ĐỎ                                                                           |
| `SocialFbpostLink.spec.tsx` (mới, 5 ca: 2 ALLOW · 1 DENY · 2 hành vi bấm) | 5/5 PASS                  | Vô hiệu dòng gate ⇒ **C4-deny ĐỎ** (`expect(element).not.toBeInTheDocument()`)                                                                     |
| `social-wiring.spec.ts` +2 ca (rail đăng ký · không thêm mục tĩnh)        | 18/18 PASS                | —                                                                                                                                                  |
| `vitest run src/layouts src/routes/social` (gồm snapshot sidebar)         | **29 file / 312 ca PASS** | snapshot `sidebar-tree.*.txt` KHÔNG đổi (đúng D1)                                                                                                  |
| `pnpm typecheck`                                                          | 10/10 task PASS           | —                                                                                                                                                  |

### Lệch so với `done_when` (có chủ ý, đã giải trình ở §2)

`done_when` (a) nói «không còn là ô riêng ở Home». Đã làm: ô **rời lưới Home** (`getHomeGridApps`) nhưng
**giữ trong AppSwitcher** (`getVisibleApps`) — vì xoá hẳn khỏi `APP_REGISTRY` sẽ cắt đường vào của người
chỉ có `view:social-post` và của người thu gọn sidebar. Đây là chữ của `done_when` (b), không phải nới
phạm vi. `@testing-library/user-event` KHÔNG có trong kho ⇒ ca bấm dùng `fireEvent` + `waitFor`.
