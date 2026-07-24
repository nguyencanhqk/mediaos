# S5-LMS-UI-2 — Đồng bộ COMPONENT LÕI của LMS với packages/ui

> Track **LOCAL** — `apps/lms` nằm trong `.gitignore` (dòng 8), **không phải repo riêng** ⇒ code LMS
> KHÔNG có lịch sử git, chỉ `docs/plans` + `harness/` commit được. Ship = `next build` + restart NSSM
> `MediaOS-LMS` (PORT 3400), không PR.
>
> **Ghi hồi cố 2026-07-25.** Phần code chạy trong phiên 2026-07-24 (ledger `S5-LMS-UI-2` từ 13:26Z) đã
> lên PROD; tài liệu này viết sau để đóng WO — mục §1-§3 dựng lại từ ledger + đọc code thật, §5 ghi phần
> phiên đóng WO làm thêm, §6 ghi thẳng cái CHƯA làm.

---

## 1. Giả định ban đầu bị lật ngược

WO seed với tiền đề *"LMS lệch chuẩn, kéo LMS về `packages/ui`"*. Khảo sát mở màn đo ra điều **ngược
lại**: `packages/ui` mới là bên ở thế hệ shadcn **cũ hơn** (button 4 biến thể / `h-10` / `ring-2` so với
6 biến thể + 3 cỡ icon / `h-9` / `ring-[3px]` bên LMS). Làm đúng chữ WO = **hạ cấp** LMS và gãy 189
call-site.

Owner chốt **nâng nguồn** ⇒ tách `S5-FND-UI-GEN-1` (nâng `packages/ui` lên thế hệ mới, 1501 call-site
trên 3 app) và thêm vào `depends_on` của WO này. Ledger ghi mốc `blocked` 14:02Z.

`S5-FND-UI-GEN-1` merged **#277** (`4de45e6b`) — chốt 3 con số làm đầu vào cho WO này:

| Quyết định | Giá trị |
| --- | --- |
| Chiều cao control mặc định | `h-10` |
| Bán kính | `--radius: 0.625rem` |
| Badge | `rounded-full` |

---

## 2. Phần đã làm ở phiên 2026-07-24 (11 file)

| File | Nội dung |
| --- | --- |
| `app/globals.css` | `--radius` → `0.625rem` ở cả `:root` và `.dark`; `--header-height` 48px → **56px** khớp `h-14` của `GlobalTopbar` |
| `components/ui/badge.tsx` | +5 biến thể trạng thái `brand/success/warning/danger/muted` (dùng token `--*-muted` + `--*`), `rounded-full` |
| `components/ui/button.tsx` | `h-10` mặc định (`sm` `h-9` · `lg` `h-11`) |
| `components/ui/input.tsx` · `select.tsx` | `h-10` đồng loạt (select qua `data-[size=default]:h-10`) |
| `components/ui/table.tsx` | về ngôn ngữ DataTable MediaOS: header `px-4 py-3` + `text-xs uppercase tracking-wide`, ô dữ liệu `px-4 py-3.5` |
| `components/ui/skeleton.tsx` · `themeToggle.tsx` | đồng bộ token/bo góc |
| `components/ui/sidebar.tsx` | `SidebarGroupLabel` khớp nhãn nhóm `ModuleSidebar` (`text-[11px]` + `tracking-wider`) |
| `components/sidebar/AdminNotificationBell.tsx` | badge đếm `bg-rose-500` → `bg-destructive`/`text-destructive-foreground` |
| `components/sidebar/my-learning-menu.tsx` | chip emerald → `bg-success-muted` + `text-success` |
| `components/sidebar/nav-user.tsx` | thang độ mạnh mật khẩu → token theo ngữ nghĩa: yếu `danger` · trung bình `warning` · khá `info` · mạnh `success` |

Ledger `milestone` 16:17Z: *"tsc 0, build BUILD_ID TVFulx3TAHxO-MUwcMkcJ, utility verify trong CSS
build. CHỜ restart 3400"*.

---

## 3. Trạng thái deploy (đo lại 2026-07-25)

| Kiểm chứng | Kết quả |
| --- | --- |
| `.next/BUILD_ID` | `yVo87q3j2TaX9T3uXgf2A`, ghi lúc **23:29** — tức đã có **build lần 2** sau mốc ledger 23:17 |
| Service `MediaOS-LMS` | Running, PID 2736, khởi động **23:52:27** — **sau** build ⇒ tránh được bẫy [[lms-next-build-shares-prod-dist]] |

⇒ **Bản UI-2 đang phục vụ thật trên PROD.** (Bản `next build` này KHÔNG chứa `S5-LMS-UI-3` — các file
khung sửa lúc 23:37-23:41, sau build.)

---

## 4. Quyết định phạm vi: cái gì KHÔNG đổi

**`components/sidebar/app-tile.tsx` — bảng màu 9 ứng dụng: GIỮ màu Tailwind rời.** WO liệt kê file này
trong "màu Tailwind rời còn lại", nhưng `done_when` chỉ đòi khử màu rời ở **component trạng thái**. Bảng
màu này là **màu định danh ứng dụng**, không phải trạng thái — và MediaOS làm y hệt: `MODULE_ACCENT`
trong `apps/app/src/layouts/topbar/GlobalTopbar.tsx:31-40` là palette Tailwind cố định, kèm ghi chú
*"palette cố định là chủ đích"*. Đổi sang token sẽ làm 9 ô ứng dụng trùng màu nhau.

**`components/chat/**` — GIỮ, ngoài phạm vi.** Quét ra ~10 chỗ `bg-gray-500` ở avatar fallback của khu
chat. Không nằm trong danh sách WO, và `/chat` là khu riêng (sidebar bị ẩn). Ghi lại thành nợ ở §6.

---

## 5. Phần phiên đóng WO làm thêm (2026-07-25)

`components/sidebar/nav-user.tsx` — 4 chỗ `AvatarFallback` còn `bg-gray-500`, thay theo đúng quy tắc
MediaOS (đối chiếu `packages/ui/src/components/ui/avatar.tsx:31` và `AvatarMenu.tsx:108`):

- avatar ở **topbar** (trên chrome navy) → `bg-white/15 text-white` — overlay chrome-relative;
- 3 chỗ còn lại (dropdown, hàng người dùng, dialog đổi ảnh — đều trên nền card/popover) →
  `bg-brand-muted text-brand`.

Verify: `npx tsc --noEmit` **0 lỗi** · `npx eslint components/sidebar/nav-user.tsx` **sạch** ·
`grep bg-gray-500 components/sidebar/` **rỗng**.

---

## 6. CHƯA làm — nêu thẳng

1. **Review agent chưa chạy.** `done_when` đòi `typescript-reviewer` + `react-reviewer` local PASS. Phiên
   đóng WO này bị cấm gọi agent (ràng buộc phiên), nên chỉ có: đọc lại toàn bộ diff bằng tay + `tsc` +
   `eslint`. Đây là **thiếu sót đã biết**, không phải "đã pass".
2. **Smoke bằng mắt chưa có kết quả owner báo lại** — cả UI-1 lẫn UI-2 đều dừng ở mức này. Bộ màn hình
   cần soi (light + dark): `/course` · `/course/{slug}/learn` · `/dashboard` · `/exam` ·
   `/manage-courses` (tab learners — bảng nặng) · `/manage-exam/{id}/grading` · `/admin`.
3. **Nợ ghi nhận, chưa seed WO:** ~10 chỗ `bg-gray-500` ở `components/chat/**`; chuỗi `"Strength:"` trong
   `nav-user.tsx` hard-code tiếng Anh (không qua `t(language, …)`), lọt lưới vì UI-2 chỉ đụng màu.
4. **Chưa đồng bộ:** `--font-*` và thang `shadow` giữa LMS ↔ `packages/ui` (ghi sẵn ở đầu
   `app/globals.css`).

Phần "khung sidebar + site-header khớp workspace shell" trong tiêu đề WO **đã tách sang
`S5-LMS-UI-3`** (owner nêu 2026-07-24) — xem `docs/plans/S5-LMS-UI-3.md`.
