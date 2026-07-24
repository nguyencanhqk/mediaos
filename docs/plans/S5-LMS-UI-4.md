# S5-LMS-UI-4 — LMS hòa vào chrome MediaOS (App Switcher · Logo · Menu avatar)

> Track **LOCAL** — `apps/lms` gitignore, ship = `next build` + restart NSSM `MediaOS-LMS` (3400).
> Nối tiếp `S5-LMS-UI-3` (đã port KHUNG): WO này làm cho các nút chrome (lưới ứng dụng, logo, avatar)
> hành xử như thể đang đứng **trong** MediaOS, thay vì một hệ LMS riêng.

---

## 1. Vấn đề (owner nêu 2026-07-25, kèm 2 ảnh MediaOS)

Sau UI-3, khung đã khớp nhưng LMS vẫn là **hệ đóng**: App Switcher chỉ list 3 app nội bộ LMS
(Học tập · Trò chuyện · Hệ thống), logo về `/course`, menu avatar là dialog nội bộ. Owner muốn:

| # | Yêu cầu | Hiện tại |
| --- | --- | --- |
| 1 | App Switcher = **launcher toàn MediaOS** (10 app giống ảnh) | chỉ 3 app LMS |
| 2 | Bấm logo → `funtimemediacorp.com/home` | `<Link href="/course">` nội bộ |
| 3 | Menu avatar = của cả hệ thống (Cá nhân · Tài khoản · Đổi MK · Đăng xuất) trỏ MediaOS | dialog đổi avatar/MK nội bộ LMS |
| 4 | Trò chuyện + Hệ thống ra khỏi switcher → về sidebar | nằm trong switcher |

**Owner chốt (AskUserQuestion 2026-07-25):**
- App Switcher: **nhảy sang MediaOS cùng tab**, không gate quyền ở LMS (MediaOS tự chặn khi tới).
- Chat: tạm về sidebar; **định hướng dài hạn = module CHAT nội bộ MediaOS (SPEC-15)** — ngoài WO này.
- Menu avatar: **trỏ về MediaOS**.

---

## 2. Ràng buộc cốt lõi

9 app MediaOS **chỉ tồn tại ở `funtimemediacorp.com`**, không có route trong LMS ⇒ tile của chúng phải
là **link cross-origin** (`<a href>`, không phải `next/link`). Chỉ "Đào tạo" (`appKey: lms`) là nội bộ
→ `/course`.

Nguồn URL: `env.MEDIAOS_APP_URL` (`lib/platform/env.ts`) — **server-only**, đã set
`https://funtimemediacorp.com` ở `.env.production`. Đọc ở `layout.tsx` (server component) rồi **truyền
props** xuống `SiteHeader → AppSwitcher / NavUser` — KHÔNG thêm `NEXT_PUBLIC_*` (tránh nở env public).

**Fail-soft khi `MEDIAOS_APP_URL` rỗng** (local dev chưa set): App Switcher chỉ hiện "Đào tạo"; logo về
`/course`; menu avatar ẩn 3 mục MediaOS, giữ Đăng xuất. App không vỡ.

---

## 3. Danh sách app (khớp APP_REGISTRY của MediaOS — `packages/web-core/src/lib/registry.ts:506`)

| Thứ tự | Nhãn (vi) | rootPath | Loại |
| --- | --- | --- | --- |
| 1 | Dashboard | `/dashboard` | external |
| 2 | Nhân sự | `/hr` | external |
| 3 | Chấm công | `/attendance` | external |
| 4 | Nghỉ phép | `/leave` | external |
| 5 | Công việc | `/tasks` | external |
| 6 | Thông báo | `/notifications` | external |
| 7 | Cá nhân | `/me` | external |
| 8 | Mục tiêu | `/goals` | external |
| 9 | Hệ thống | `/system` | external |
| 10 | Đào tạo | `/course` | **nội bộ** (đánh dấu "Đang mở") |

Không port "Gần đây" — LMS không biết user vừa mở app MediaOS nào (state đó sống ở MediaOS). Switcher
chỉ còn "Tất cả ứng dụng".

---

## 4. File chạm

| File | Thay đổi |
| --- | --- |
| `app/(app)/layout.tsx` | đọc `env.MEDIAOS_APP_URL` → truyền `mediaosAppUrl` xuống `SiteHeader` |
| `components/sidebar/mediaos-apps.tsx` **(mới)** | định nghĩa 10 app (key · nhãn vi/en · icon tabler · path · màu · internal?) |
| `components/sidebar/app-switcher.tsx` | render launcher MediaOS (external `<a>` + Đào tạo `<Link>`); nhận `mediaosAppUrl`; bỏ recent |
| `components/sidebar/app-tile.tsx` | `AppTile` hỗ trợ `external` → `<a href>` thay `<Link>` |
| `components/sidebar/site-header.tsx` | logo → `{mediaosAppUrl}/home` (`<a>`); truyền `mediaosAppUrl` xuống switcher + nav-user |
| `components/sidebar/nav-user.tsx` | menu: Cá nhân `/me` · Tài khoản `/me/account` · Đổi MK `/me/security/password` (external) + Ngôn ngữ (giữ) + Đăng xuất; **gỡ** dialog đổi avatar + đổi MK nội bộ |
| `components/sidebar/app-sidebar.tsx` | thêm mục **Trò chuyện** (`/chat`) vào sidebar |

Route avatar khớp MediaOS `AvatarMenu.tsx:21-25`: `/me` · `/me/account` · `/me/security/password`.

---

## 5. Rủi ro

| # | Rủi ro | Xử lý |
| --- | --- | --- |
| R1 | `MEDIAOS_APP_URL` rỗng lúc build local ⇒ tile external `href` sai | Fail-soft §2: rỗng → ẩn tile external, chỉ Đào tạo |
| R2 | Gỡ dialog đổi MK/avatar khỏi `nav-user.tsx` (~490 dòng) làm rơi state/handler → eslint unused | Gỡ trọn cụm (state + handler + dialog JSX + import icon) trong 1 nhịp, chạy eslint ngay |
| R3 | `/chat` vẫn ẩn sidebar (chat full-screen) ⇒ vào chat mất mục điều hướng | Chủ đích: mục sidebar là **lối vào**; trong chat vẫn full-screen. Ra bằng switcher/logo |
| R4 | Cross-origin nhảy sang MediaOS khi CHƯA có session ở đó | User vào LMS qua SSO từ MediaOS ⇒ đã có cookie `funtimemediacorp.com`. Nếu hết hạn, MediaOS tự redirect login — không phải việc của LMS |
| R5 | Đổi màu/format 9 app cross-origin — nếu MediaOS đổi rootPath thì lệch | Danh sách là bản **sao chép có chủ đích** (2 workspace tách rời); ghi chú nguồn ở đầu `mediaos-apps.tsx` để đồng bộ tay khi MediaOS đổi |

---

## 6. Definition of Done

- App Switcher trong LMS hiện đủ 10 app giống ảnh MediaOS; bấm 9 app → `funtimemediacorp.com/{path}`
  cùng tab; bấm Đào tạo → `/course`.
- Logo → `funtimemediacorp.com/home`.
- Menu avatar: Cá nhân/Tài khoản/Đổi mật khẩu → MediaOS; Đăng xuất → đăng xuất LMS.
- Trò chuyện là mục sidebar; Hệ thống (admin LMS) vẫn ở nhóm Quản trị.
- `MEDIAOS_APP_URL` rỗng → fail-soft, app không vỡ.
- `tsc --noEmit` 0 lỗi · `eslint` sạch · build + restart 3400 · verify BUILD_ID mới + CSS/HTML live.

---

## 8. Đã thực hiện (2026-07-25)

| File | Thay đổi |
| --- | --- |
| `components/sidebar/mediaos-apps.tsx` **(mới)** | 10 app khớp APP_REGISTRY: 9 external + Đào tạo internal; `mediaosAppHref(app, base)` (external+base rỗng → null); màu định danh literal (Tailwind quét được) |
| `components/sidebar/app-tile.tsx` | `AppTile` thêm cờ `external` → render `<a href>` (không prefetch) thay `<Link>` |
| `components/sidebar/app-switcher.tsx` | viết lại thành launcher MediaOS; nhận `mediaosAppUrl`; bỏ khu "Gần đây" + `useRecentApps` + localStorage; tile `href===null` bị lọc (fail-soft) |
| `components/sidebar/site-header.tsx` | logo → `{base}/home` (`<a>`) khi có base, else `<Link href="/course">`; truyền `mediaosAppUrl` xuống `AppSwitcher` + `NavUser` |
| `components/sidebar/nav-user.tsx` | **gỡ trọn** dialog đổi avatar + đổi mật khẩu nội bộ (state/handler/JSX/import ~250 dòng); menu mới: Cá nhân `/me` · Tài khoản `/me/account` · Đổi MK `/me/security/password` (external, ẩn khi base rỗng) + Ngôn ngữ (giữ) + Đăng xuất (local) |
| `components/sidebar/app-sidebar.tsx` | thêm nhóm "Trao đổi" → mục Trò chuyện (`/chat`) ở khu không-admin |
| `app/(app)/layout.tsx` | đọc `env.MEDIAOS_APP_URL` → truyền `mediaosAppUrl` xuống `SiteHeader` |

**Kiểm chứng:** `npx tsc --noEmit` **0 lỗi** · `npx eslint` 7 file **sạch**.

**Phạm vi giữ nguyên có chủ đích:** trang `(public)` (`Navbar.tsx`) vẫn dùng `AppSwitcher`/`NavUser`
**không** truyền `mediaosAppUrl` ⇒ ở landing (thường trước đăng nhập) switcher chỉ hiện Đào tạo, avatar
menu chỉ Ngôn ngữ + Đăng xuất. Chấp nhận fail-soft; nếu owner muốn landing cũng hòa MediaOS thì mở rộng
truyền URL cho Navbar (WO nhỏ riêng).

**CHƯA làm:** `next build` + restart — giao owner chạy `m prod-update lms` (build **và** restart liền
mạch, tránh cửa sổ lệch manifest như UI-3 §7).

---

## 7. Ghi nhận hướng tương lai (KHÔNG làm ở WO này)

Owner nêu **CHAT nội bộ MediaOS = SPEC-15**. Khi module đó ra đời, "Trò chuyện" sẽ chuyển từ mục sidebar
LMS thành một app MediaOS (thêm vào APP_REGISTRY + switcher), và feature chat của LMS (`components/chat/**`,
`/chat`) sẽ được đánh giá lại để gộp/thay. Chưa có SPEC ⇒ chưa seed WO thực thi.
