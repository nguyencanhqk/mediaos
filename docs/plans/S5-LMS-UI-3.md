# S5-LMS-UI-3 — Port CẤU TRÚC SHELL của LMS về khung MediaOS

> Track **LOCAL** — `apps/lms` nằm trọn trong `.gitignore` (dòng 8), có `pnpm-lock.yaml` + Next.js 15
> riêng, **không import được `@mediaos/ui`**. "Dùng chung" ở đây = **port cấu trúc**, không phải chia sẻ
> component. Ship = `next build` + restart NSSM `MediaOS-LMS` (PORT 3400), **không PR**.
>
> Phân biệt với các WO láng giềng: `S5-LMS-UI-1` = token màu (đã xong) · `S5-LMS-UI-2` = primitive
> (button/badge/table) · **WO này = KHUNG** (vị trí topbar ↔ sidebar, anatomy topbar, ngôn ngữ nav).

---

## 1. Vấn đề (owner nêu 2026-07-24, kèm ảnh)

| Điểm lệch | MediaOS (`apps/app`) | LMS hiện tại |
| --- | --- | --- |
| **Vị trí topbar** | `ProtectedShell` = `h-dvh flex-col` → topbar **full-width** trên cùng, sidebar nằm **dưới** | `SidebarProvider` + `variant="inset"` → sidebar **cao full màn từ y=0**, header chỉ chiếm nửa phải |
| **Brand** | trong topbar (`GlobalTopbar.tsx:110`) | trong sidebar (`app-sidebar.tsx:189`) |
| **Lớp nền header** | 1 lớp `bg-chrome`, không sticky (shell đã khóa `h-dvh`) | `sticky top-0 z-50 bg-background/95 backdrop-blur` **bọc ngoài** header `bg-chrome` ⇒ 2 lớp chồng |
| **Anatomy topbar** | `[menu][logo][icon+tên module] … [Tổng quan][theme][chuông] │ [avatar]` | `[trigger][AppSwitcher][tên app] … [Khóa học của tôi][theme][chuông][NavUser]` — switcher nằm TRÁI |
| **Sidebar** | `w-60` ↔ `w-14` (icon-rail), `bg-card`, nhóm có nhãn (`TỔNG QUAN`/`NGHIỆP VỤ`/…) | `18rem`, offcanvas (ẩn hẳn), phẳng không nhóm, `--sidebar-primary` **đổi màu theo khu** (admin đỏ / learning xanh) |
| **Cuộn** | shell khóa `h-dvh`, chỉ `<main>` cuộn | document cuộn |

Chiều cao header đã khớp từ `S5-LMS-UI-2` (`--header-height: 14`); cái lệch là **điểm bắt đầu** của
thanh trên.

---

## 2. Phạm vi

**LÀM:** cấu trúc khung + anatomy topbar + ngôn ngữ nav của sidebar.

**KHÔNG LÀM (đóng phạm vi):** đổi route, luồng học/thi, quyền, API, nội dung trang. Thông báo chỉ
**chuyển chỗ trong topbar**, không đụng nguồn dữ liệu — hợp nhất về NOTI là `S5-LMS-NOTI-1/2`.

---

## 3. Thiết kế

### 3.1 Khung — `app/(app)/layout.tsx`

`SidebarTrigger` gọi `useSidebar()` nên **phải nằm trong `SidebarProvider`** ⇒ không đưa `SiteHeader` ra
ngoài provider. Thay vào đó **đổi trục của wrapper** thành cột:

```tsx
<SidebarProvider
  className="h-dvh min-h-0 flex-col"          // wrapper gốc là flex-row + min-h-svh → đổi trục
  style={{
    "--sidebar-width": "15rem",                // khớp w-60 của ModuleSidebar (18rem → 15rem)
    "--sidebar-top": "3.5rem",                 // MỚI — sidebar bắt đầu DƯỚI topbar
    "--header-height": "calc(var(--spacing) * 14)",
  }}
>
  <AppPresenceHeartbeat />
  <SiteHeader … />                             {/* con đầu → full-width */}
  <div className="flex min-h-0 w-full flex-1">
    <AppSidebar collapsible="icon" … />        {/* bỏ variant="inset" → variant mặc định "sidebar" (có border-r) */}
    <SidebarInset className="min-w-0 overflow-y-auto [scrollbar-gutter:stable]">
      {children}
    </SidebarInset>
  </div>
</SidebarProvider>
```

`tailwind-merge` cho `min-h-0` thắng `min-h-svh` (cùng nhóm `min-h`); `flex-col` là *direction*, không
xung đột với `flex` (*display*) ⇒ wrapper vẫn là flex, chỉ đổi trục.

Bỏ hẳn `<div className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur">` bọc `SiteHeader`
(layout dòng 70) — shell đã khóa `h-dvh` nên topbar đứng yên sẵn, đúng ghi chú ở `GlobalTopbar.tsx:13`.

### 3.2 Primitive — `components/ui/sidebar.tsx`

Sidebar desktop là `fixed inset-y-0 … h-svh` (dòng 234) ⇒ dù đặt trong flex-col nó vẫn dán mép trên
viewport và **đè lên topbar**. Sửa **một chỗ duy nhất**, giữ nguyên mọi hành vi offcanvas/icon/mobile:

| Trước | Sau |
| --- | --- |
| `fixed inset-y-0 … h-svh` | `fixed top-(--sidebar-top) … h-[calc(100svh-var(--sidebar-top))]` |

Kèm hằng mặc định trong `SidebarProvider` (cạnh `SIDEBAR_WIDTH`, dòng 30-32 + 136-137):

```ts
const SIDEBAR_TOP = "0rem"      // mặc định = hành vi CŨ (dán mép trên) cho mọi layout khác
```

`--sidebar-top` khai ở provider style nên **fallback không cần cú pháp arbitrary**; layout nào không
truyền thì giữ nguyên hình dạng cũ ⇒ `(auth)`, `(public)`, `docs/` không bị ảnh hưởng.

Div `sidebar-gap` (dòng 218) không đụng — nó giữ chỗ theo chiều ngang, độc lập với trục dọc.

### 3.3 Topbar — `components/sidebar/site-header.tsx`

Sắp lại theo đúng anatomy MediaOS:

```text
[SidebarTrigger] [logo + tên công ty → /course] │ [tên app hiện tại] … [Khóa học của tôi] [AppSwitcher] [Theme] [Chuông] │ [NavUser]
```

- **Brand lên topbar**: cụm logo + tên công ty giờ hiển thị ở MỌI trang, không chỉ nhánh `!hasSidebar`
  ⇒ gộp hai nhánh `hasSidebar` làm một, tránh brand hiện 2 lần trên `/chat`.
- **AppSwitcher chuyển sang cụm phải**, đứng trước `ThemeToggle` (MediaOS: nút lưới `Grid3x3` +
  nhãn "Tổng quan" ở cụm phải).
- **Divider** `h-5 w-px bg-white/20` sau brand và trước `NavUser` — khớp `GlobalTopbar.tsx:114,141`.
- **`SidebarTrigger`** đang là nút viền `border-border/70 bg-background/80` — trên chrome navy nó nổi
  khối sáng. Override tại chỗ dùng về `text-chrome-foreground/80 hover:bg-white/10`, bỏ viền/nền/shadow
  (giống nút `Menu` của MediaOS, `GlobalTopbar.tsx:96`).

### 3.4 Sidebar — `components/sidebar/app-sidebar.tsx` + `nav-main.tsx`

1. **Bỏ `SidebarHeader`** (logo, dòng 182-196) — brand đã lên topbar; MediaOS `ModuleSidebar` bắt đầu
   thẳng bằng nhóm nav.
2. **Bỏ `sidebarStyle`** đổi `--sidebar-primary` theo khu (dòng 176-178, admin đỏ / learning xanh) —
   MediaOS không có khái niệm này, active dùng token `brand` chung.
3. **Nhóm có nhãn**: thêm prop `label?: string` cho `NavMain` → render `SidebarGroupLabel` với đúng
   ngôn ngữ MediaOS (`text-[11px] font-semibold uppercase tracking-wider text-muted-foreground`,
   `ModuleSidebar.tsx:208`). Chia:
   - khu học: **HỌC TẬP** (Học tập · Khóa học của tôi · Thi cử · Bảng xếp hạng) + **QUẢN LÝ**
     (Quản lý · Thiết lập)
   - khu admin: **QUẢN TRỊ**
4. **`collapsible="icon"`** thay `offcanvas` — thu gọn thành rail icon như MediaOS thay vì ẩn hẳn.
   `SidebarMenuButton` đã có `tooltip={item.title}` (`nav-main.tsx:76`) nên icon-mode có tooltip sẵn.
   Cây con (`SidebarMenuSub`) chỉ render khi `isParentActive` — ở icon-mode primitive đã ẩn bằng
   `group-data-[collapsible=icon]:hidden`, không cần chặn thêm.

---

## 4. Rủi ro

| # | Rủi ro | Xử lý |
| --- | --- | --- |
| R1 | Đổi trục wrapper + `overflow-y-auto` trên `SidebarInset` ⇒ **document không còn cuộn**; trang nào dùng `sticky top-*` bên trong sẽ neo theo inset, không theo viewport | Smoke kỹ trang dài: `/course`, `/course/{slug}/learn`, `/manage-courses` (bảng dài), `/manage-exam/{id}/grading` |
| R2 | 3 layout con (`course/[slug]/learn`, `manage-exam/[id]`, `admin/exams/[id]`) có thể tự dựng khung/`h-screen` riêng ⇒ chồng chiều cao | Đọc cả 3 TRƯỚC khi sửa; nếu có `h-screen`/`sticky` thì đổi sang `h-full` |
| R3 | Gỡ `variant="inset"` ⇒ mất bo góc + margin content, wrapper mất `bg-sidebar` | Chủ đích (MediaOS content sát viền); kiểm nền vùng trống ở cả light + dark |
| R4 | `/chat` cho `AppSidebar` trả `null` ⇒ không có phần tử `peer` cho `SidebarInset` | `SidebarInset` base là `w-full flex-1`, không phụ thuộc peer ⇒ an toàn; vẫn smoke `/chat` |
| R5 | Sửa `sidebar.tsx` là primitive **dùng chung** | Mặc định `--sidebar-top: 0rem` = hành vi cũ y nguyên; chỉ `(app)` truyền `3.5rem` |
| R6 | `next build` ghi thẳng `.next` mà NSSM đang phục vụ (memory `lms-next-build-shares-prod-dist`) | **Không** build cho tới khi owner chốt; khi ship: backup `data/app.db` → `m prod-update lms` (build **và** restart), verify ở `localhost:3400` chứ không phải domain (Cloudflare cache immutable) |

---

## 5. Definition of Done

- Đặt cạnh MediaOS: topbar LMS **chạy hết chiều ngang**, sidebar bắt đầu **dưới** topbar, brand ở topbar,
  thứ tự nút phải giống nhau, sidebar cùng bề rộng + có nhãn nhóm.
- Thu gọn sidebar → rail icon (không ẩn hẳn), tooltip đúng.
- `npx tsc --noEmit` **0 lỗi** · `npx eslint` sạch trên các file chạm.
- Smoke light + dark sau khi owner cho deploy: `/course` · `/course/{slug}/learn` · `/dashboard` ·
  `/exam` · `/manage-courses` (+ tab learners) · `/manage-exam/{id}/grading` · `/admin` · `/chat` ·
  mobile (drawer sheet vẫn mở/đóng đúng).
- Không đụng route/API/quyền — diff nằm trọn ở lớp trình bày.

---

## 6. Đã thực hiện (2026-07-24)

| File | Thay đổi |
| --- | --- |
| `components/ui/sidebar.tsx` | thêm hằng `SIDEBAR_TOP = "0rem"` + khai `--sidebar-top` ở provider; `fixed inset-y-0 … h-svh` → `fixed top-(--sidebar-top) … h-[calc(100svh-var(--sidebar-top))]` |
| `app/(app)/layout.tsx` | wrapper đổi trục `h-dvh min-h-0 flex-col`; `SiteHeader` lên làm con đầu (full-width); `[sidebar + inset]` bọc trong div flex row; gỡ lớp `sticky/backdrop`; gỡ `variant="inset"`, dùng `collapsible="icon"`; `--sidebar-width` 18rem→15rem, `--sidebar-width-icon` 3rem→3.5rem, `--sidebar-top` 3.5rem; `SidebarInset` thành vùng cuộn duy nhất |
| `components/sidebar/site-header.tsx` | brand lên topbar cho MỌI trang (gộp 2 nhánh `hasSidebar` — hết brand kép ở `/chat`); `AppSwitcher` chuyển sang cụm phải; thêm 2 divider; `SidebarTrigger` về ghost trên nền navy |
| `components/sidebar/app-sidebar.tsx` | bỏ `SidebarHeader` (logo) + prop `appIconUrl`; bỏ `--sidebar-primary` đổi theo khu; tách `navMain` → `learningNav` ("Đào tạo") + `managementNav` ("Quản lý"), admin → "Quản trị" |
| `components/sidebar/nav-main.tsx` | thêm prop `label?` → `SidebarGroupLabel` |

**Kiểm chứng đã chạy:** `npx tsc --noEmit` **0 lỗi** · `npx eslint` trên `app/(app)/layout.tsx` +
`components/sidebar/**` + `components/ui/sidebar.tsx` **sạch**.

**Ghi nhận từ R2 (đã đọc cả 3 layout con):** `manage-exam/[id]` và `admin/exams/[id]` chỉ là wrapper
`space-y-6` — không đụng chiều cao. `course/[slug]/learn/layout.tsx` đặt `html,body{overflow:hidden}` và
trang learn tự tính `h-[calc(100dvh - var(--header-height) - 0.5rem)]` ⇒ **khớp** với shell mới (inset
cũng cao đúng `100dvh − header`), không tràn. Còn lại cần mắt người: `CourseDetailView.tsx:84` và
`manage-exam/[id]/grading/[userId]/page.tsx:57` dùng `min-h-screen` — trong inset đã trừ header nên có
thể dư ~3.5rem chiều cao (thanh cuộn thừa), sửa thành `min-h-full` nếu smoke thấy rõ.

---

## 7. Deploy PROD (2026-07-25, 00:09-00:13)

| Bước | Kết quả |
| --- | --- |
| Backup DB | `c:\tmp\app.db{,-wal,-shm}.bak-S5-LMS-UI-3-20260725-000921` (55.2 MB + 4.07 MB + 32 KB — copy cả `-wal`/`-shm` vì SQLite ở chế độ WAL) |
| `pnpm build` | thành công, `BUILD_ID` `yVo87q3j2TaX9T3uXgf2A` → **`oyyNGlwCGJ3VsLuqh8I3h`** |
| Restart | **`Restart-Service` từ tool THẤT BẠI** — "Cannot open MediaOS-LMS service" (thiếu quyền admin, tool không mở được UAC). Owner chạy tay ⇒ PID 2736 → **40324**, start 00:12:49 |

**Bài học lặp lại:** giữa lúc build xong và lúc restart, `.next` đã là bản mới còn tiến trình vẫn giữ
bản cũ — cửa sổ lệch manifest. Lần sau: xin owner chạy `m prod-update lms` (script tự elevate, build và
restart liền mạch) thay vì build từ tool rồi mới đi xin restart.

**Bằng chứng đã live (không chỉ "đã restart"):**

- CSS bundle `.next/static/css/15e720c562aa7eb8.css` có `.top-(--sidebar-top){top:var(--sidebar-top)}`
  và `height:calc(100svh - var(--sidebar-top))` ⇒ utility của WO này đã được Tailwind sinh thật;
  `bg-brand-muted` cũng có ⇒ bản vá avatar của `S5-LMS-UI-2` cùng lên chuyến này.
- HTML `/login` tham chiếu **`oyyNGlwCGJ3VsLuqh8I3h`** ⇒ tiến trình đang phục vụ đúng bản mới.
- Probe: `/login` 200 (render nút "Đăng nhập qua MediaOS" — SSO-only đang bật) · `/course` 307 ·
  `/dashboard` 307 · `/exam` 200 nhưng thân trang chỉ chứa redirect `/login`, không rò dữ liệu.

**CÒN LẠI:** smoke bằng mắt với phiên thật (§5) — phiên này không có tài khoản đăng nhập nên chỉ kiểm
được tới tầng HTTP/CSS. Nếu thấy vỡ, rollback **không có git** (`apps/lms` gitignore, không phải repo
riêng): hoàn nguyên theo bảng §6 rồi build + restart lại.
