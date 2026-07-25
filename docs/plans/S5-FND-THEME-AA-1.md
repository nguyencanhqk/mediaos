# S5-FND-THEME-AA-1 — Kéo token trượt AA lên ≥4.5 tại NGUỒN

> Vá **tại nguồn** `packages/ui/src/styles/theme.css` rồi **port** sang `apps/lms/app/globals.css`.
> Đây là vá **tương phản**, KHÔNG phải đổi bảng màu: giữ nguyên sắc, chỉ tối đi một nấc.

## 1. Vì sao có WO này

`S5-LMS-UI-1` port token MediaOS sang LMS rồi đo AA 32 cặp: **29 đạt, 4 trượt sát ngưỡng** ở chế độ
light. Cả 4 **kế thừa nguyên giá trị** từ `theme.css` — tức lỗi nằm ở NGUỒN và đã hiện diện trên
`apps/app` · `console` · `auth` từ trước, không do UI-1 gây ra. UI-1 cố ý **không** sửa riêng ở LMS
(sửa một bên = tạo đúng thứ drift cả wave đang đi xoá) ⇒ tách ra WO này.

Phạm vi nổ vì thế **rộng hơn LMS**: `theme.css` là nguồn token của cả 3 app MediaOS.

## 2. Công cụ — `scripts/contrast-check.mjs`

UI-1 đo tay. Đo tay lần nữa = làm lại từ đầu ⇒ đóng băng thành script trong repo:

```bash
node scripts/contrast-check.mjs                 # đo nguồn token MediaOS
node scripts/contrast-check.mjs --all           # đo CẢ hai file + so token hai bên
node scripts/contrast-check.mjs --diff a b      # chỉ so hai file
```

Nội dung: độ chói tương đối sRGB theo WCAG 2.1, **32 cặp × 2 chế độ = 64 phép đo**, cộng thêm khối
kiểm **bất biến giá trị** (`--danger` = `--destructive`; `--brand` = `--info` ở light; `--chrome`
giống nhau ở cả hai chế độ). Exit 1 khi có cặp dưới ngưỡng hoặc hai file lệch ⇒ chạy được trong CI.

Giới hạn có chủ ý: chỉ đọc hex đặc trong `:root` / `.dark`. Token dạng `color-mix()`/`var()` (khối
`.chrome-surface` của LMS) phụ thuộc ngữ cảnh runtime, không đo tĩnh được — smoke bằng mắt.

## 3. Thay đổi

| Token                           | Cũ                    | Mới                   | Ghi chú                                   |
| ------------------------------- | --------------------- | --------------------- | ----------------------------------------- |
| `--brand` (light)               | `#0879b2`             | `#0771a6`             | giữ sắc, tối một nấc                      |
| `--info` (light)                | `#0879b2`             | `#0771a6`             | trùng `--brand` theo thiết kế             |
| `--danger` (light)              | `#d92d20`             | `#d12b1f`             |                                           |
| `--destructive` (light)         | `#d92d20`             | `#d12b1f`             | **phải đổi cùng `--danger`** — xem §3.1   |
| `--grid-line` (light)           | `rgba(8,121,178,.06)` | `rgba(7,113,166,.06)` | dẫn xuất từ `--brand`, theo nó            |
| `--brand-foreground` (**dark**) | `#ffffff`             | `#06121f`             | ngoài dự kiến ban đầu — xem §3.2          |
| `--chat` (LMS, light)           | `#0879b2`             | `#0771a6`             | token LMS-only, theo `--info` (UI-1 §3.1) |

### 3.1 Vì sao `--destructive` phải đi cùng `--danger`

Hai token đang **trùng giá trị theo thiết kế** (cùng một đỏ cho chip cảnh báo và nút xoá). Đổi một
cái là chúng tách đôi — nút xoá một màu, chip cảnh báo một màu khác. Script có khối `MUST_MATCH` để
lần sau không ai đổi lẻ được mà không bị báo.

Đổi `--destructive` thì cặp `destructive-foreground(#ffffff)/destructive` **tăng** tương phản
(4.83 → 5.15), an toàn.

### 3.2 Cặp thứ NĂM mà bản đo 32-cặp bỏ sót — `.dark` `brand-foreground/brand`

WO seed ghi _"chế độ DARK đã đạt hết (thấp nhất 5.90) — KHÔNG đụng khối .dark"_. Chạy script phủ đủ
64 phép đo thì lộ ra bản đo cũ **không có cặp này**: dark `--brand-foreground` `#ffffff` trên
`--brand` `#1fa9e0` = **2.69** — dưới cả ngưỡng 3.0 mà WCAG 1.4.11 đòi cho thành phần giao diện.

Đã kiểm chỗ dùng thật trước khi kết luận:

- **Không có chữ nào** đặt trên `bg-brand`. Cả 12 call-site đều là bề mặt đồ hoạ: thanh tiến độ
  (`TrainingProgressBar`, `TaskChecklistPanel`, `TaskSubtaskPanel`, `ProjectProgressWidget`,
  `TaskFilePanel`, `EmployeeFilesTab`, `ProjectReportPage`), chấm chỉ báo cây task, chấm `live-dot`.
- Chỗ dùng thật **duy nhất** của cặp này: chấm 1.5px trong radio chọn vai trò ở console
  ([assign-role-dialog.tsx:147](../../apps/console/src/routes/system/permissions/assign-role-dialog.tsx#L147)).
  Đồ hoạ, không phải chữ — nên đây là lỗi **nhỏ nhưng sống**, không phải chỉ là bẫy tiềm ẩn.

Owner chốt **vá luôn**. Giá trị mới không phải bịa: dark `--brand` = `#1fa9e0` = **giống hệt**
dark `--primary`, mà `--primary-foreground` cho đúng màu đó vốn đã là `#06121f` (7.01). Dùng lại
chính nó ⇒ nhất quán với quyết định sẵn có, 2.69 → **7.01**.

Đây là chỗ **duy nhất** đụng `.dark`; mọi thay đổi còn lại nằm trong `:root`.

## 4. Kết quả đo

`node scripts/contrast-check.mjs --all`

**Trước:** 56/64 đạt AA, thấp nhất 2.69.

| Cặp                      | Chế độ   | Trước   | Sau         |
| ------------------------ | -------- | ------- | ----------- |
| `brand/brand-muted`      | light    | ❌ 4.06 | ✅ **4.54** |
| `info/info-muted`        | light    | ❌ 4.06 | ✅ **4.54** |
| `danger/danger-muted`    | light    | ❌ 4.23 | ✅ **4.51** |
| `brand/background`       | light    | ❌ 4.42 | ✅ **4.94** |
| `info/background`        | light    | ❌ 4.42 | ✅ **4.94** |
| `destructive/background` | light    | ❌ 4.46 | ✅ **4.76** |
| `danger/background`      | light    | ❌ 4.46 | ✅ **4.76** |
| `brand-foreground/brand` | **dark** | ❌ 2.69 | ✅ **7.01** |

Cặp đi kèm cũng tăng (không cặp nào giảm): `brand-foreground/brand` light 4.79 → 5.35 ·
`brand|info/card` 4.79 → 5.35 · `destructive-foreground/destructive` 4.83 → 5.15 ·
`danger|destructive/card` 4.83 → 5.15.

**Sau:** cả hai file **64/64 đạt AA, thấp nhất 4.51**; bất biến giá trị PASS; hai file khớp từng token.

```
── packages/ui/src/styles/theme.css — 64 cặp, ngưỡng AA 4.5 ──
  → 64/64 đạt AA; thấp nhất 4.51
── apps/lms/app/globals.css — 64 cặp, ngưỡng AA 4.5 ──
  → 64/64 đạt AA; thấp nhất 4.51
✅ packages/ui và apps/lms khớp giá trị từng token chung.
```

## 5. Nghiệm thu

| Hạng mục                                                   | Trạng thái                                          |
| ---------------------------------------------------------- | --------------------------------------------------- |
| Không cặp nào < 4.5 ở CẢ light lẫn dark                    | ✅ 64/64, thấp nhất 4.51                            |
| `--danger` = `--destructive`; `--brand` = `--info` (light) | ✅ khối `MUST_MATCH` PASS                           |
| `packages/ui` ↔ `apps/lms` khớp từng token                 | ✅ `--diff` sạch                                    |
| Không còn hex cũ trong source                              | ✅ grep `0879b2\|d92d20\|8,121,178` = 0             |
| `pnpm typecheck`                                           | ✅ 10/10                                            |
| `pnpm build` (app · console · auth + packages)             | ✅ 7/7                                              |
| CSS đã build mang giá trị mới                              | ✅ `0771a6` ×3, `d12b1f` ×2 ở cả 3 `dist`; 0 hex cũ |
| `packages/ui` vitest                                       | ✅ 16 file / 98 test                                |
| `apps/lms` `npx tsc --noEmit`                              | ✅                                                  |
| `apps/lms` `next build` + restart NSSM 3400                | ⏳ **chờ owner** — xem §6                           |
| Smoke light+dark 3 app MediaOS + LMS                       | ⏳ sau deploy                                       |

## 6. Deploy — vì sao tách bước LMS

`apps/lms` **không** đổi `distDir` ⇒ `next build` ghi **thẳng vào `.next` mà NSSM `MediaOS-LMS`
(cổng 3400) đang phục vụ LIVE**. Build mà chưa restart = origin lệch manifest, Cloudflare cache
`immutable` che mất triệu chứng (bẫy đã ghi: `lms-next-build-shares-prod-dist`). Nên bước này là
**deploy PROD thật**, không phải verify — tách ra để owner bấm nút:

1. `node apps/lms/scripts/backup-db.mjs` (backup `data/app.db` trước)
2. `pnpm build` trong `apps/lms`
3. restart NSSM `MediaOS-LMS`
4. verify ở `localhost:3400` (KHÔNG phải domain live — Cloudflare che)

Phía MediaOS đi đường bình thường: PR → merge → deploy.

## 7. Smoke cần làm sau deploy

Đây là vá tương phản ⇒ tiêu chí là **không chỗ nào đổi màu trông thấy rõ**, trừ đúng một chỗ đã biết.

- **3 app MediaOS**, light + dark: nút xoá · chip trạng thái (`danger`/`info`) · link brand ·
  thanh tiến độ (task, hồ sơ nhân sự, đào tạo).
- **Chỗ đổi thấy được duy nhất, có chủ ý:** console → phân quyền → gán vai trò, ở **dark**: chấm
  trong radio đang chọn chuyển từ trắng sang mực navy (2.69 → 7.01, rõ hơn hẳn).
- **LMS**, light + dark: `/course` · `/exam` · `/dashboard` · widget chat (`--chat`).
