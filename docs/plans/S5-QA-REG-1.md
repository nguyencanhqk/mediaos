# S5-QA-REG-1 — QA regression suite MVP + UI-state + responsive/a11y smoke (WS-F · 🟡 yellow)

> LIGHT gate (`typescript-reviewer` + `quality-gate` + `react-reviewer` cho FE). Nguồn: IMPLEMENTATION-08
> §15 (§15.2 regression · §15.3 UI-state · §15.4 responsive/a11y) · QA-02 · QA-08.

## 1. Kết luận khảo sát (quét CẢ 2 glob — bài học S5-SEC-1)

- **Backend regression §15.2 = 10/10 module COVERED.** "Gap ATT" mà khảo sát vòng-1 nêu thực ra ĐÃ phủ bởi
  spec colocated `src/attendance/**` (survey bỏ sót): check-in/out FSM `attendance-be1.int.spec.ts:154/212/302`;
  adjustment submit→approve `attendance-adjustment.int.spec.ts:269/302/485/521`; remote-work create→approve
  `remote-work-request.int.spec.ts:193/215/362/547`. ⇒ **KHÔNG cần gap-test backend.**
- **FE §15.3 UI-state = phần lớn COVERED** (177/195 FE spec assert skeleton/empty/forbidden/isError/retry).
- **FE §15.4 responsive/a11y = net-new DUY NHẤT.** Repo KHÔNG có axe/jest-axe/playwright, 0 matchMedia
  assertion. Responsive layout **thuần CSS (Tailwind breakpoints)** — jsdom KHÔNG đánh giá được → tách:
  - a11y (keyboard/focus/role/aria) → **jsdom-testable** qua `@testing-library/react` + `fireEvent`.
  - responsive/contrast/reduced-motion → **CSS-only** → assert-class tĩnh (proxy) + smoke thủ công ghi evidence.

## 2. Quyết định (owner chọn 2026-07-25)

**§15.4 = "No new dep"**: dùng `@testing-library/react` + `fireEvent` sẵn có (user-event KHÔNG phải dep) +
mock `window.matchMedia` (mẫu `packages/web-core/src/lib/theme.spec.ts:90`). KHÔNG thêm jest-axe/playwright.

## 3. Deliverables

1. **Regression report** `docs/QA/evidence/S5-QA-REG-1-REGRESSION-SIGNOFF.md` (mẫu `S2-QA-2-REGRESSION-SIGNOFF.md`):
   - Bảng §15.2: mỗi nhóm module × P0/P1 → spec phủ (cite file, gồm colocated). Kết luận 10/10 COVERED.
   - Bảng §15.3: mỗi state (Loading/Empty/Error/Forbidden/…) → FE spec/primitive phủ.
   - Bảng §15.4: mỗi mục a11y → spec mới (dưới) hoặc "manual/CSS" có ghi rõ lý do.
2. **§15.4 a11y smoke specs (colocated, no new dep)** — nhỏ, KHÔNG brittle, cho primitive dùng-chung + 1 P0:
   - a11y ForbiddenPage: có `<h1>` heading + message theo reason + action có accessible name.
   - a11y dialog/sheet: `role="dialog"`, đóng bằng **Escape** (fireEvent.keyDown), có accessible title.
   - a11y icon-only button (1 P0 screen): mọi nút icon-only có `aria-label`/accessible name.
   - responsive proxy: assert container P0 có class breakpoint (`md:`/`hidden md:block`/`overflow-x-auto`).
   - (tùy chọn) mock matchMedia cho 1 hook/nhánh nếu có; nếu thuần CSS → ghi manual.
3. **Plan** (file này).

## 4. Ràng buộc

- **KHÔNG sửa `src` sản phẩm** trừ khi cần thêm 1 `aria-label`/`role` tối thiểu cho a11y (justify từng chỗ);
  ưu tiên assert hiện trạng. Không thêm dependency.
- Test **colocated** `apps/app/src/**/*.spec.tsx` (+ `packages/ui` nếu target primitive ở đó) — chạy
  `pnpm --filter @mediaos/web... test`. Không brittle (tránh snapshot toàn trang; assert role/label cụ thể).
- Flaky → khoanh vùng/ổn định. `check.sh` xanh. LIGHT gate.

## 5. Ngoài phạm vi
Backend gap-test (đã 10/10) · axe/playwright/visual-regression · responsive rendering thật (cần browser —
owner chọn no-tooling) · sửa a11y diện rộng (chỉ smoke).
