# S5-LMS-UI-1 — Đồng bộ TOKEN màu LMS ↔ MediaOS

> **Track LOCAL.** `apps/lms` nằm trong `.gitignore` (dòng 8) ⇒ **file này là artifact duy nhất commit được**.
> Ship = `pnpm build` trong `apps/lms` → restart NSSM `MediaOS-LMS` (3400). **Không PR.**
> Kỷ luật track LOCAL: `docs/plans/S5-LMS-WAVE.md` §3.

## 1. Vấn đề

`S5-LMS-APP-1` đã chuẩn hoá **điều hướng** (`/` redirect · `/course` chính · ẩn `employee/*` · app-switcher),
nhưng phần **nhìn** vẫn là design system riêng:

| | MediaOS (`packages/ui/src/styles/theme.css`) | LMS (`apps/lms/app/globals.css`) trước WO |
| --- | --- | --- |
| primary | `#1fa9e0` (keycap xanh sáng, giống hệt light+dark) | `#BADDAD` (xanh lá pastel, hard-code 2 chỗ) |
| nền light | `#f3f6fb` giấy xanh lạnh | `oklch(0.9809 0.0025 228.7836)` |
| chrome | `--chrome: #0f1a2e` **navy hằng số cả hai chế độ** | không có; sidebar đổi màu theo theme, header `bg-background/95` |
| trạng thái | `--success/--warning/--danger/--info` (+ `-muted`) | không có ⇒ component dùng màu Tailwind rời |

⇒ nhân viên nhảy MediaOS → LMS thấy **hai sản phẩm khác nhau**.

## 2. Ràng buộc

- **KHÔNG import được `@mediaos/ui`**: `apps/lms` có `pnpm-workspace.yaml` + lock riêng (Next.js 15.5.9, ngoài
  turbo repo MediaOS) ⇒ đồng bộ bằng **PORT giá trị** + ghi chú nguồn ở đầu file, **không** bằng dependency.
- **Giữ nguyên cơ chế**: `@custom-variant dark (&:is(.dark *))` + `@theme inline` của LMS không đổi.
  Theme toggle = `next-themes` đổi class `dark` trên `<html>` — cùng cơ chế MediaOS, giữ nguyên, **không** ép
  chung storage key (khác subdomain `train.*` nên localStorage vốn không chia sẻ).
- **Không đổi tên biến/class**: hai bên cùng shadcn + Tailwind v4 nên trùng tên (`--background`, `--card`,
  `--primary`, `--sidebar-*`, `--radius`) ⇒ việc cần làm là thay **GIÁ TRỊ**.
- **Phạm vi đóng**: chỉ lớp trình bày. Cấm đụng logic/route/API.

## 3. Cách làm

### 3.1 Port token màu (`apps/lms/app/globals.css`)

`:root` và `.dark` thay giá trị theo `theme.css`. Bổ sung nhóm token MediaOS có mà LMS thiếu —
`--brand*`, `--success*`, `--warning*`, `--danger*`, `--info*`, `--chrome*` — và map vào `@theme inline`
(nếu không map thì utility `bg-chrome`, `text-success` không tồn tại). **S5-LMS-UI-2 sẽ tiêu thụ nhóm
trạng thái này** để thay màu Tailwind rời.

Token LMS-only **giữ nguyên tên, chỉ đổi giá trị cho hợp phổ**: `--chart-1..5` (MediaOS chưa có token
chart nào — grep `packages/ui` + `apps/app` trả 0) ⇒ suy ra từ **gradient phổ Funtime** trong `theme.css`
(`#16a085 → #1fa9e0 → #36a94e → #f5b50c → #f0641e`). `--chat` theo `--info`.

**Giữ nguyên, dời sang UI-2:** `--radius` (LMS `0.5rem` vs MediaOS `0.625rem` — thuộc "bo góc"),
`--font-sans` (Poppins vs Inter — thuộc "cỡ chữ"), shadow scale, `--spacing`.
Lý do: `--header-height = calc(var(--spacing) * 12)` và radius chạm hình khối mọi primitive ⇒ đổi ở
UI-1 sẽ trộn hai loại rủi ro trong một lần smoke.

### 3.2 Chrome navy hằng số

- **Sidebar**: primitive `components/ui/sidebar.tsx` đã dùng nhất quán `--sidebar*` (đã đối chiếu:
  `bg-sidebar`, `text-sidebar-foreground`, `bg-sidebar-primary/12`, `border-sidebar-border`) ⇒ **chỉ cần
  đặt `--sidebar*` = navy giống nhau ở CẢ `:root` và `.dark`**, không đụng component.
- **Site-header**: `bg-background/95` → `bg-chrome text-chrome-foreground`, viền `border-white/10`
  (khớp `apps/app/src/layouts/topbar/GlobalTopbar.tsx:93`).

**Bẫy đã lường**: header chứa con dùng token thường (`text-foreground`, `text-muted-foreground`,
`hover:bg-accent`, `border-border` — 8 chỗ ở `sidebar/*.tsx`). Trên nền navy **ở chế độ light** thì mực
navy chìm vào nền → đúng thứ `done_when` cấm. Không đi vá từng chỗ (vừa sót vừa lấn sang UI-2), mà dùng
**class `.chrome-surface` ghi đè biến CSS theo phạm vi**:

```css
.chrome-surface {
  --background: var(--chrome);
  --foreground: var(--chrome-foreground);
  --muted-foreground: color-mix(in oklab, var(--chrome-foreground) 72%, transparent);
  --accent: color-mix(in oklab, #ffffff 10%, transparent);
  --border: color-mix(in oklab, #ffffff 12%, transparent);
}
```

Hợp lệ vì `@theme inline` khiến utility phát ra `color: var(--foreground)` **đọc tại chỗ dùng** ⇒ ghi đè
trên `<header>` cascade xuống mọi con. Nội dung dropdown (`NavUser`, `AdminNotificationBell`,
`AppSwitcher`, `MyLearningMenu`) đi qua Radix Portal ra `document.body` ⇒ **thoát khỏi phạm vi**, giữ màu
panel bình thường — đúng như MediaOS.

### 3.3 Vá kèm: `components/ui/themeToggle.tsx`

Nút toggle là **chrome control** nên thuộc WO này. Hiện hard-code `bg-neutral-200 dark:bg-[#BBD8EA]` và
`ring-[hsl(var(--border))]` — vòng ring **hỏng sẵn**: `--border` là hex, bọc `hsl()` ra giá trị không hợp
lệ ⇒ ring không bao giờ hiện. Chuyển sang token chrome.

### 3.4 Mở rộng phạm vi (owner chốt giữa chừng)

Verify sau build phát hiện CSS build **vẫn còn `#BADDAD`** dù `globals.css` đã sạch ⇒ quét ra **cả bảng
màu cũ bị hard-code dạng arbitrary value** ngoài file token:

| Hex | Số lần | Vai trò cũ | Ở đâu |
| --- | --- | --- | --- |
| `#BADDAD` | 38 | primary | 3 form auth · 6 file chat |
| `#367588` | 38 | focus ring · ô OTP đang gõ | 3 form auth · `components/ui/input.tsx` |
| `#BBD8EA` | 16 | hàng được chọn · tab active | chat |
| `#a8d0a8` | 2 | hover FAB chat | `ChatWidget.tsx` |

Tổng **11 file**. Owner chốt làm hết trong UI-1 (thay vì đẩy sang UI-2) — cùng một loại thay đổi cơ học,
và gộp lại thì chỉ build + restart PROD một lần.

Ánh xạ theo **ngữ nghĩa**, không thay máy móc:

| Cũ | Mới | Vì sao |
| --- | --- | --- |
| `focus-visible:border-[#367588]` · `[#BADDAD]` | `border-ring ring-ring/40` | focus là việc của `--ring` |
| `bg-[#BADDAD] hover:bg-[#a8d0a8] text-white` (FAB) | `bg-primary hover:bg-primary/90 text-primary-foreground` | `text-white` trên `#1fa9e0` chỉ **2.4:1**; `primary-foreground` đạt **7.01:1** |
| `bg-[#BBD8EA] dark:bg-muted/40` | `bg-accent` | accent tự đúng cả hai chế độ ⇒ bỏ được nhánh `dark:` |
| `data-[state=active]:…text-zinc-900` (×2 nhánh) | `bg-accent text-accent-foreground` | bản cũ ép chữ đen ở **cả dark mode** |

Bỏ được nhiều cặp `dark:` trùng lặp vì `--primary` giống hệt light/dark theo thiết kế MediaOS — khai báo
riêng cho dark là thừa.

## 4. Ngoài phạm vi (để UI-2)

Màu Tailwind rời **theo ngữ nghĩa trạng thái** (không phải bảng màu cũ): `app-tile.tsx` (bảng màu 9 app),
`nav-user.tsx` (`bg-gray-500` avatar fallback, thang độ mạnh mật khẩu), `AdminNotificationBell`
(`bg-rose-500` badge), `my-learning-menu` (chip emerald). Cùng với `--radius`, `--font-*`, thang shadow.

## 4b. Đẻ ra WO mới

Đo AA 32 cặp: 29 đạt, **4 trượt sát** ở light — `brand/background` 4.42 · `brand|info/-muted` 4.06 ·
`danger/danger-muted` 4.23 · `destructive/background` 4.46. Cả 4 **kế thừa nguyên từ `theme.css` của
MediaOS**, đã hiện diện trên `apps/app`·`console`·`auth` từ trước, KHÔNG do WO này gây ra. Cố ý **không**
sửa riêng ở LMS (sẽ tạo đúng thứ drift cả wave đang đi xoá) ⇒ tách **`S5-FND-THEME-AA-1`** (seed
`b9eb965e`): vá tại nguồn `packages/ui` rồi port lại, kèm giá trị đã tính sẵn.

## 5. Nghiệm thu

1. `npx tsc --noEmit` + `pnpm build` trong `apps/lms` xanh.
2. `grep -c BADDAD apps/lms/app/globals.css` = 0.
3. Smoke **light + dark** sau build + restart 3400, phiên thật: `/login` · `/course` ·
   `/course/{slug}/learn` · `/dashboard` · `/exam` · `/manage-courses` · `/admin`
   — không màn nào chữ chìm vào nền, không nút mất viền.
4. Tương phản AA trên các cặp đổi giá trị: `foreground/background`, `muted-foreground/muted`,
   `primary-foreground/primary`, `chrome-foreground/chrome`.
5. Backup `data/app.db` trước khi restart NSSM.
