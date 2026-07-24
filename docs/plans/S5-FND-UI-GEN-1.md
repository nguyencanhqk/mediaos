# S5-FND-UI-GEN-1 — Nâng primitive `packages/ui` lên thế hệ shadcn mới

> Zone **yellow**: chạm design system dùng chung của `apps/app` · `console` · `auth` — **1.501 call-site**.
> Nhánh `wo/S5-FND-UI-GEN-1`, có PR (khác hai WO LMS trước vốn là track LOCAL).

## 1. Vì sao có WO này

Sinh ra giữa chừng `S5-LMS-UI-2`. WO đó seed với giả định "LMS lệch chuẩn, kéo LMS về `packages/ui`".
Đo thực tế thì **ngược lại** — `packages/ui` mới là bên ở thế hệ cũ hơn:

| | `packages/ui` | `apps/lms` |
| --- | --- | --- |
| button | 4 biến thể · 3 cỡ · `focus-visible:ring-2` | 6 biến thể · 6 cỡ (+`icon`/`icon-sm`/`icon-lg`) · `border-ring + ring-ring/50 + ring-[3px]` · `data-slot` · `aria-invalid` |
| input | `h-10` · `ring-2` · `border-border` | `h-9` · ring 3px · `border-input` · `shadow-xs` · `file:`/`selection:` · `text-base md:text-sm` |
| badge | **có `brand`/`success`/`warning`/`danger`/`muted`** | chỉ 4 biến thể gốc |

Làm đúng chữ UI-2 = hạ cấp LMS + gãy 189 call-site LMS. Owner chốt **sửa nguồn**.

## 2. Nguyên tắc chốt (owner để tôi đi theo đề xuất)

> **Lấy API + ngôn ngữ focus-ring của thế hệ mới. GIỮ số đo hình học của MediaOS.**

- **Chiều cao control: giữ `h-10`** (không lấy `h-9`). Đổi mật độ control là thay đổi *thấy được* trên 3 app
  đang chạy production; rủi ro không tương xứng với mục tiêu là "đọc ra cùng một hệ".
- **Radius: giữ `0.625rem`** làm chuẩn thương hiệu. `S5-LMS-UI-2` port sang LMS (LMS đang `0.5rem`).
- **Badge giữ dáng viên thuốc `rounded-full`** của MediaOS (LMS `rounded-md` → UI-2 đổi theo).

Hệ quả: sau WO này `packages/ui` **không** giống hệt LMS về số đo — mà LMS sẽ chỉnh theo ở UI-2.
Đây là chiều đúng, vì số đo là quyết định thương hiệu còn API/focus-ring là chất lượng kỹ thuật.

## 3. Phạm vi THẬT — hẹp hơn tiêu đề WO

Khảo sát cho thấy 2 trong 6 primitive **không thể nâng theo nghĩa "port thế hệ mới"**:

| Primitive | Kết luận | Lý do |
| --- | --- | --- |
| **button** | ✅ nâng đầy đủ | thay đổi thuần **cộng thêm**, không phá call-site nào |
| **badge** | ✅ nâng, giữ biến thể riêng | như trên |
| **input** | ✅ nâng (chỉ class) | không đổi API |
| **select** | ⚠️ **chỉ đồng bộ class** | MediaOS là `<select>` **thuần** (244 `<option>` ở call-site); LMS là `@radix-ui/react-select` với `SelectTrigger`/`SelectContent`/`SelectItem`. Đổi = viết lại 125 call-site ⇒ **WO riêng nếu owner muốn**, không nhét vào đây |
| **card** | ⚠️ **gần như không đụng** | LMS card mặc định `gap-6 py-6` + container query. Áp vào là đổi mô hình padding của **118 call-site** đang tự đặt padding ⇒ vỡ layout hàng loạt. Chỉ thêm `data-slot` |
| **table** | ⛔ không đụng | MediaOS không có `Table` thô — chỉ có wrapper `DataTable` (69 call-site) vốn ĐÃ là bên đẹp hơn. Việc ngược lại (LMS học theo) thuộc UI-2 |

Nói thẳng: WO này **không** làm "select/card/table lên thế hệ mới" như tiêu đề gợi ý. Phần đó hoặc bất khả
thi trong một WO (select), hoặc rủi ro cao mà lợi ích thấp (card), hoặc thuộc chiều ngược lại (table).

## 4. Vá kèm — lỗi thật phát hiện khi đọc

`button` biến thể `destructive` đang dùng `text-primary-foreground` (`#06121f` — mực navy) trên nền đỏ.
Token đúng là `--destructive-foreground` (`#ffffff` ở light, `#1b0b0b` ở dark) và **đã được map sẵn**
trong `@theme inline` (theme.css dòng 144) nhưng gần như không ai dùng (2 chỗ).

Tại sao token đúng hơn `text-white` mà LMS hard-code: ở dark, `--destructive` là `#f87171` (đỏ *nhạt*),
chữ trắng trên đó chỉ ~2.2:1; token cho chữ gần-đen `#1b0b0b` mới đọc được.

## 5. Cấm đánh mất (port stock shadcn đè lên là mất sạch, typecheck vẫn xanh)

1. **Badge biến thể riêng của MediaOS**: `brand` · `success` · `warning` · `danger` · `muted`
   (đang dùng: `warning` 12 · `success` 4 · `brand` 2). Spec neo `bg-success-muted`/`bg-danger-muted`/`bg-warning-muted`.
2. **Dialog** không phải Radix thô mà là wrapper `DialogProps {title, description}` — **87 call-site**.
3. **DataTable** là wrapper riêng — **69 call-site**.

WO này **không chạm** dialog/data-table; ghi ra đây để lần sau không ai "dọn cho gọn".

## 6. Lưới an toàn

- `cd packages/ui && npx vitest run` — mốc **15 file / 74 test XANH** (đã chạy trước khi sửa).
- `TURBO_FORCE=1 pnpm typecheck` — mốc **10/10 task, 0 lỗi** (`TURBO_FORCE` bắt buộc: turbo có thể
  in xanh từ cache, xem memory `turbo-cache-false-green`).
- Đỏ là **dừng và sửa code**, không sửa test cho vừa code.

## 7. Nghiệm thu

1. 74 test cũ vẫn xanh + thêm test cho biến thể/cỡ mới.
2. Badge còn đủ 5 biến thể riêng; Dialog + DataTable API nguyên vẹn.
3. `TURBO_FORCE=1 pnpm typecheck` vẫn 0 lỗi; `pnpm build` 3 app xanh.
4. Smoke light+dark 3 app: nút mọi biến thể/cỡ, form (ring mới), badge trạng thái, bảng, dialog.
5. Ghi lại trong plan quyết định `h-10` + `0.625rem` — **đầu vào bắt buộc của `S5-LMS-UI-2`**.
