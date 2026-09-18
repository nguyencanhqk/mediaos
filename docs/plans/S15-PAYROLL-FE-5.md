# S15-PAYROLL-FE-5 — Sửa / xoá mềm phiên bản hồ sơ lương (PAYROLL-API-022)

> Nợ G3 của `S15-PAYROLL-FE-1` §6. Client `payrollApi.updateSalaryProfile` **đã có từ FE-1**; chưa nơi nào
> trong `apps/app` gọi. WO này nối dây UI ở tab «Lịch sử lương» của **PAY-SCREEN-007**.
>
> 🟡 **LIGHT gate** (typescript-reviewer + quality-gate). Không migration · không đổi BE · không đổi contracts.

---

## 0. Đo trước khi vẽ nút (ĐÃ ĐO — không suy đoán)

Mọi dòng dưới đây đọc từ code THẬT, không từ tiêu đề WO.

| Điều                | Nguồn đo                                                                             | Kết quả                                                                                                                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cặp gác 022         | `payroll-route-pairs.const.ts:88`                                                    | `salaryProfileUpdate = pair("manage","salary-profile", sensitive=true)`                                                                                                                                                     |
| Cặp gác 020 (tạo)   | cùng file `:87`                                                                      | **CÙNG cặp** `manage:salary-profile` ⇒ ai tạo được thì sửa/xoá được                                                                                                                                                         |
| Xoá                 | `updateSalaryProfileSchema.delete: z.literal(true)`                                  | **Không có route DELETE** — xoá mềm đi qua chính PATCH 022                                                                                                                                                                  |
| Nhánh xoá ở service | `salary-profiles.service.ts:241-253`                                                 | `if (dto.delete === true)` ⇒ `softDeleteTx` rồi **return ngay**; mọi field khác trong cùng thân bị **bỏ qua** ⇒ payload xoá phải là `{ delete: true }` ĐƠN ĐỘC                                                              |
| Tiền đề chặn xoá    | cả `service.update` lẫn `repo.softDeleteTx`                                          | **KHÔNG có** — không kiểm phiếu lương đã phát hành, không kiểm kỳ đóng băng. Comment service: `payslips` giữ `salary_profile_id` + snapshot ĐÓNG BĂNG nên xoá ở đây không hồi tố số cũ ⇒ **không vẽ điều kiện BE không có** |
| Xoá bản đã xoá      | `scope()` = `company_id` + `deleted_at IS NULL` (`salary-profiles.repository.ts:32`) | bản đã xoá không còn đọc được ⇒ 404                                                                                                                                                                                         |
| `items` VẮNG        | `service.update` §🔴 + contracts §327                                                | **KHÔNG chạm `salary_profile_items` VÀ KHÔNG chạm cột `allowances`.** `undefined ≠ []` — coi vắng như rỗng là **xoá sạch phụ cấp trong im lặng**                                                                            |
| `note`              | update schema: `.max(500).nullable().optional()`                                     | xoá ghi chú = gửi **`null`** (khác create: create không nullable)                                                                                                                                                           |
| `userId`            | update schema                                                                        | **KHÔNG có khoá** — không đổi người của một phiên bản                                                                                                                                                                       |
| Mask tiền ở 021/022 | `payroll-access.service.ts:129` + `MONEY_FREE_ROUTES`                                | `salaryProfileDetail`/`salaryProfileUpdate` **KHÔNG** thuộc set ⇒ `canSeeMoney = true`. Qua được cổng là thấy tiền; kiểu contracts vẫn khai `optional` (xem D6)                                                             |

**Mã lỗi 022 tới được FE** (đối chiếu `payroll.errors.ts` + `PAYROLL_ERROR_KINDS`):

| HTTP | kind                             | Khi nào                                           | Khoá i18n (đã có sẵn)                |
| ---- | -------------------------------- | ------------------------------------------------- | ------------------------------------ |
| 404  | `not-found`                      | id sai · bản vừa bị người khác xoá                | `errors.notFound`                    |
| 409  | `effective-date-exists`          | đổi `effectiveDate` trùng bản khác của cùng người | `errors.effectiveDateExists`         |
| 409  | `profile-item-duplicate`         | hai dòng `items[]` cùng `componentCode`           | `errors.profileItemDuplicate`        |
| 422  | `profile-item-unknown-component` | mã ngoài catalog công ty                          | `errors.profileItemUnknownComponent` |
| 422  | `profile-item-wrong-type`        | mã có nhưng `valueType ≠ profile_item`            | `errors.profileItemWrongType`        |
| 400  | —                                | `.strict()` khoá lạ · mirror CHECK                | `errors.generic`                     |

⇒ **0 `kind` mới.** `payroll-error-kind-census.spec.ts` không phải đụng tới.

---

## 1. Phạm vi

**Trong:** tab «Lịch sử lương» (`EmployeeSalaryHistoryTab` + `SalaryProfileVersionCard`) ·
`SalaryProfileFormDialog` thêm chế độ sửa · logic thuần ở `salary-profile-form.ts` · i18n `vi/payroll.ts` · spec.

**Ngoài (KHÔNG làm):** PAY-SCREEN-004 `SalaryProfileListPage` (màn danh sách toàn công ty — WO khác nếu muốn) ·
đổi contracts/BE · nợ N1 tách `PayrollPeriodDetailPage` · `sidebar-registry` (S15-UI-SHELL-2).

---

## 2. Quyết định thiết kế

### D1 — Nút Sửa/Xoá nằm trong THÂN ĐÃ MỞ của thẻ phiên bản, không ở hàng tiêu đề

Hàng tiêu đề của `SalaryProfileVersionCard` **chính là một `<button>`** bọc cả hàng. Nhét nút vào đó là
`<button>` lồng `<button>` — HTML không hợp lệ, và React cảnh báo hydrate.

Ba cái lợi khác, không chỉ tránh lồng thẻ:

1. **Form sửa CẦN chi tiết 021** (`items[]` · `insuranceSalary` · `probationSalary` · `payRatioPct` · `note`) —
   `SalaryProfileListItemDto` chỉ có `baseSalary`/`salaryType`/`pitPayer`. Nút chỉ mọc khi thân đã mở ⇒ lúc bấm,
   dữ liệu prefill **đã có trong tay**, không phải tải-rồi-mở-form.
2. **Không đẻ hàng audit giả.** 021 ghi `action:"read"` (SPEC-11 §18.1). Vẽ nút ở hàng tiêu đề mà muốn prefill thì
   phải prefetch chi tiết mọi phiên bản ⇒ đúng cái bẫy FE-1 đã ăn (`payroll-period-tabs`, 20 phiên bản = 20 hàng
   audit «đã xem lương» không hề xảy ra).
3. Người dùng **nhìn thấy cái mình sắp sửa** trước khi bấm.

### D2 — Sửa = `SalaryProfileFormDialog` + prop `profile`, KHÔNG dựng hộp thứ hai

`profile: SalaryProfileDto | null` — `null` giữ nguyên hành vi tạo (0 call-site cũ phải đổi). Khác biệt ở chế độ sửa:

- tiêu đề/nút: `salaryProfileForm.editTitle` / `editSubmit`;
- ô «Nhân sự» **readOnly** (schema 022 không có `userId`);
- `effectiveDate` **vẫn sửa được** (schema có) — hint nói trùng ngày ⇒ 409;
- gọi `payrollApi.updateSalaryProfile(profile.id, payload)` — **không `Idempotency-Key`** (route 022 không
  `@Idempotent`; 020 mới có).

### D3 — 🔴 Payload sửa = **DIFF**, chỉ trường NGƯỜI DÙNG THẬT SỰ ĐỔI

Đây là quyết định quan trọng nhất của WO, và nó bịt ba lỗ cùng lúc:

1. **Phụ cấp không bị xoá trong im lặng.** Phiên bản «di sản» (v1: có cột `allowances`, 0 dòng `items`) prefill ra
   `items: []`. Gửi nguyên form ⇒ `items: []` ⇒ BE `replaceItemsTx([])` + mirror `allowances = []` ⇒ **mất sạch phụ
   cấp, không lỗi nào phát ra, kỳ sau trả thiếu tiền**. Diff ⇒ người dùng không đụng bảng phụ cấp thì khoá `items`
   **vắng** ⇒ BE không chạm gì.
2. **Thiếu `view:salary-component`** ⇒ bảng phụ cấp không render ⇒ `items` không bao giờ dirty ⇒ không bao giờ gửi.
   (Luật 3 của FE-1 giữ nguyên, nay mạnh hơn: ở chế độ sửa nó là hàng rào chống mất tiền chứ không chỉ chống bịa.)
3. **Thân rỗng vẫn sinh hàng audit** `changedFields: []` (đo ở `service.update:255`) ⇒ nút Lưu **khoá** khi chưa
   đổi gì (`salaryProfileForm.noChange`).

Cùng khuôn với `PaymentBatchEditDialog` của FE-7 («chỉ gửi trường THẬT SỰ đổi») — không sáng tác kiểu thứ hai.

### D4 — Xoá = `ConfirmDialog` riêng, payload `{ delete: true }` đơn độc

`ConfirmDialog` (destructive) chứ không phải bấm-hai-lần như `BudgetFormDialog`: hồ sơ lương là dữ liệu tiền theo
phiên bản, một cú bấm nhầm trên timeline đắt hơn một dòng ngân sách.

Nội dung hộp: **ngày hiệu lực** (đã nằm trong audit, không phải bí mật) + câu nói rõ **không ảnh hưởng phiếu lương
đã phát hành** (đúng như BE bảo đảm) + **không ảnh hưởng các phiên bản khác**. 🔴 **KHÔNG in `baseSalary`** vào hộp
xác nhận (BẤT BIẾN #3 — hộp xác nhận không phải chỗ chở tiền), và **không `console.log` payload/giá trị form**.

### D5 — Gate

`useCanExact(manage, salary-profile)` qua `PAYROLL_ENGINE_PAIRS.salaryProfileUpdate` — `useCanExact` chứ không
`useCan`: cặp `is_sensitive` không kế thừa qua wildcard `*:*` ở BE (memory `sensitive-pair-widget-needs-usecanexact`).

⚠️ **Bẫy đã thấy ở FE-7/QA-1, ghi ra để spec không xanh-rỗng:** cặp sửa **trùng** cặp tạo. Ca DENY không được lấy
«không thấy nút Sửa» làm bằng chứng suông — cùng bộ quyền đó nút «+ Phiên bản lương» cũng vắng, nên ca sẽ xanh cả
khi code hỏng. Ca DENY phải neo: mở thân thẻ ra, **thân hiện được** (`view` có) mà **cả Sửa lẫn Xoá đều vắng**, và
`updateSalaryProfile` **không được gọi**.

### D6 — Fail-closed khi tiền bị mask

`SalaryProfileDto.baseSalary` là `optional` trong contracts. Vắng khoá ⇒ prefill sẽ ra `""` ⇒ người dùng hoặc phải
gõ lại lương mù, hoặc (tệ hơn) submit rồi ghi đè bằng số họ đoán. ⇒ **`baseSalary === undefined` ⇒ KHÔNG mọc nút
Sửa** (hiện một dòng hint). Nút **Xoá vẫn mọc** — payload `{delete:true}` không mang giá trị nào nên không có gì để
ghi sai.

Đo được ở BE hiện tại: 021 không thuộc `MONEY_FREE_ROUTES` ⇒ `canSeeMoney` luôn `true` ⇒ **nhánh này chưa với tới
được lúc chạy**. Vẫn giữ vì kiểu dữ liệu cho phép và cờ là cấu hình route (một dòng đổi set là mở nhánh). Neo bằng
spec ở hàm THUẦN (rẻ), không dựng DOM cho nó.

### D8 — 🔴 Hồ sơ «DI SẢN» ⇒ KHOÁ bảng phụ cấp trong hộp sửa (bổ sung sau LIGHT gate)

D3 bịt nhánh «KHÔNG đụng bảng». LIGHT gate (`typescript-reviewer`, verdict BLOCK) chỉ ra nhánh còn hở:
**«CÓ đụng bảng» trên hồ sơ di sản** (`allowances` có, `items` rỗng — trạng thái được chính contracts
thừa nhận, và `SalaryProfileVersionCard` đã có băng cảnh báo cho nó).

Đường mất tiền: prefill đọc `dto.items` ⇒ bảng hiện **RỖNG**, phụ cấp di sản không lộ ra để mà diff.
Người dùng thêm một dòng ⇒ `items` khác rỗng ⇒ BE `resolveItems` dựng `allowances` **CHỈ từ mảng vừa
gửi** rồi ghi đè cả cột (`salary-profiles.service.ts` §update: `allowances: mirror.allowances` +
`replaceItemsTx`) ⇒ khoản cũ **bốc hơi cùng một mã 200**.

⇒ **Fail-closed:** `isLegacyAllowanceProfile(dto)` ⇒ `opts.itemsLocked` ⇒ (a) hộp KHÔNG vẽ
`SalaryProfileItemsEditor`, chỉ vẽ lời giải thích + chỉ đường «tạo phiên bản mới qua danh mục»;
(b) `buildSalaryProfileUpdatePayload` **không bao giờ** phát khoá `items` — hai cờ `catalogAvailable`
và `itemsLocked` ĐỘC LẬP, cùng fail-closed. Các ô khác (ghi chú, ngày, lương…) vẫn sửa bình thường.

**Với dữ liệu hôm nay nhánh này KHÔNG với tới được:** migration `0570` §6c backfill `items` từ
`allowances` cho MỌI hồ sơ chưa xoá, và hai đường ghi còn lại luôn giữ hai nguồn đồng bộ. Giữ vì một
import ngoài luồng hoặc một hồ sơ sót lại là đủ để mất tiền thật, và WO này chính là thứ **mở ra**
đường sửa.

### D9 — Trần `note` 500 kiểm ở client

`updateSalaryProfileSchema.note` `.max(500)`. Sửa ghi chú là đường dùng thường nhất của hộp ⇒ vượt trần
phải có chữ riêng (`salaryProfileForm.noteTooLong`), không rơi vào `errors.generic` của 400.

### D7 — Invalidate + dọn `expanded`

`salaryProfiles.allOf()` (tiền tố phủ cả `list` lẫn `detail`) + `employees.allOf()` (`hasSalaryProfile` của 036/037
đổi khi xoá bản cuối) — y hệt đường tạo.

Sau khi **xoá**: gỡ id khỏi `expanded` TRƯỚC khi invalidate. Không gỡ thì thẻ còn mở trong lúc list đang refetch,
`detailQuery` bắn lại 021 lên bản vừa xoá ⇒ 404 ⇒ nháy «Không tải được chi tiết» rồi thẻ mới biến mất.

---

## 3. Việc theo file

| File                                             | Việc                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `salary-profile-form.ts`                         | + `salaryProfileFormFromDto(dto)` (DTO → state) · `buildSalaryProfileUpdatePayload(initial, current, opts)` (DIFF) · `validateSalaryProfileEdit(initial, current, opts)` (chỉ kiểm trường ĐÃ đổi) · **+ `isLegacyAllowanceProfile(dto)` + cờ `opts.itemsLocked` (D8) · trần `note` (D9)** |
| `SalaryProfileFormDialog.tsx`                    | + prop `profile`; nhánh sửa dùng 3 hàm trên; `payrollErrorText` thay `t(payrollErrorI18nKey(...))`                                                                                                                                                                                        |
| `SalaryProfileVersionCard.tsx`                   | + hàng thao tác trong thân đã mở (Sửa · Xoá) theo D1/D5/D6; + prop `canManage`, `onEdit`, `onDelete`                                                                                                                                                                                      |
| `EmployeeSalaryHistoryTab.tsx`                   | giữ state `editing`/`deleting`; `ConfirmDialog` xoá + mutation; dọn `expanded` (D7)                                                                                                                                                                                                       |
| `i18n/locales/vi/payroll.ts`                     | ~14 khoá mới dưới `salaryProfileForm` + `salaryHistory` (file 701 dòng, trần 800)                                                                                                                                                                                                         |
| `payroll-fe5-salary-profile-edit.spec.tsx` (mới) | ca màn hình: ALLOW/DENY · 409 · dọn expanded                                                                                                                                                                                                                                              |
| `salary-profile-form.spec.ts`                    | + ca cho 3 hàm thuần (diff · di sản · mask · rỗng)                                                                                                                                                                                                                                        |

**Không** đụng: `payroll-errors.ts` (0 kind mới) · `payroll-api.ts` (client đã có) · `query-keys.ts` · contracts · BE.

## 4. Test (RED trước cho ca gate)

**Thuần** (`salary-profile-form.spec.ts`): diff chỉ trường đổi · không đổi ⇒ rỗng · **di sản: không đụng bảng phụ
cấp ⇒ payload VẮNG `items`** · đụng ⇒ CÓ `items` · `catalogAvailable:false` ⇒ không bao giờ có `items` · note xoá ⇒
`null` (không `""`) · validate chỉ chạy trên trường đã đổi (lương trống + không đổi ⇒ hợp lệ) · `baseSalary` đổi
thành 0 ⇒ lỗi. **D8: di sản + thêm một khoản ⇒ payload VẪN vắng `items` (+ 2 ca đối chứng: hồ sơ đã có
`items` ⇒ gửi bình thường; di sản + chỉ đổi ghi chú ⇒ vẫn sửa được). D9: 501 ký tự ⇒ lỗi riêng; đúng 500 ⇒ hợp lệ.**

**Màn hình** (`payroll-fe5-salary-profile-edit.spec.tsx`): ALLOW ⇒ mở thân, có Sửa + Xoá; sửa ghi chú ⇒ PATCH đúng
`(id, {note})` **không kèm `items`/`baseSalary`** · DENY (`useCanExact=false`, `useCan=true`) ⇒ thân mở được, 0 nút,
0 lượt gọi 022 · 409 `effective-date-exists` ⇒ hiện đúng chữ, hộp **không đóng** · xoá ⇒ ConfirmDialog rồi PATCH
`{delete:true}` + thẻ thu gọn · `baseSalary` vắng khoá ⇒ không có nút Sửa (D6) · **di sản ⇒ hộp sửa KHÔNG vẽ bảng phụ cấp, có lời giải
thích, và PATCH ghi chú không kèm `items` (D8 — neo phần NỐI DÂY, ca thuần không bắt được lỗi quên truyền cờ)**.

## 5. Định nghĩa hoàn thành

`pnpm --filter @mediaos/app test` · `typecheck` app/web-core · `build` app xanh · prettier sạch ·
`bash harness/check.sh --quick` xanh · LIGHT gate 2/2 PASS · backlog `S15-PAYROLL-FE-5.status = done`.
