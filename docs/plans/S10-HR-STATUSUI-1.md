# S10-HR-STATUSUI-1 — Nút "Đổi trạng thái nhân viên" (HR-FUNC-006)

> Micro-plan crown-jewel. Chạm FSM + audit + khoá tài khoản + thu hồi phòng chat ⇒ **FULL gate**
> (`security-reviewer` + `silent-failure-hunter`). Không migration.
> **v2** — sửa theo `plan-reviewer` vòng 1 (BLOCK, 6 lỗ chặn + 7 cảnh báo). Thay đổi lớn nhất so với v1:
> đổi tên field `effectiveDate` → **`endDate`** (B2), nâng `STATUS_TRANSITIONS` lên contracts (B1),
> KHÔNG alias `LOCKING_STATUSES` (B6).

## 1. Vấn đề (đo 16-17/08/2026, không suy đoán)

| Tầng | Hiện trạng |
| --- | --- |
| BE endpoint | ✅ ĐÃ SHIP từ S2-HR-BE-2 — `POST /hr/employees/:id/change-status`, gate `('change-status','employee')` (`hr-write.controller.ts:67-74`) |
| BE FSM | ✅ `STATUS_TRANSITIONS` (`hr-write.service.ts:73-78`): active→inactive/resigned/terminated · inactive→active/resigned/terminated · resigned→terminated · **terminated = []** (CUỐI) |
| BE ghi | ✅ cùng 1 tx `withTenant`: `setStatusTx` + `insertStatusHistoryTx` + audit `change-status` + `lockUserTx` (tuỳ chọn) + `lmsSync.enqueueSync` + `chatSync.syncUserDerivedMembershipTx` |
| Quyền | ✅ cặp seed THẬT mig 0444, grant `hr` + `company-admin` scope Company, `is_sensitive=false` (`auth-seed-canonical-roles.int-spec.ts:67-68,117`); KHÔNG có trong `SENSITIVE_CAPABILITY_ALLOWLIST` ⇒ FE dùng `useCan` (không `useCanExact`) |
| FE | ❌ **CHƯA BAO GIỜ NỐI**: `hr-api.ts` không có `changeStatus`; `HR_ENGINE_PAIRS` không có cặp; `EmployeeDetailPage.tsx:222-261` chỉ có 3 nút (Quay lại · Hợp đồng · Sửa) |
| Hợp đồng | 🔴 **LỖ**: `changeEmployeeStatusSchema` (`employee-write.ts:154-161`) chỉ có `{newStatus, reason?, lockUser}` — không có ngày, trong khi SPEC-03 §11.5 / §18.3 rule 5 đòi ngày nghỉ việc khi Resigned/Terminated |

**Gốc rễ triệu chứng owner gặp** (người đã nghỉ vẫn hiện "Đang làm việc"): `PATCH /hr/employees/:id` cố ý
KHÔNG đổi `status` (`employee-write.ts:80-82`), và **không có job/cron nào** đọc `end_date` để suy ra
`status` (quét toàn `apps/api/src` — `end_date` chỉ dùng cho accrual/carryover phép + cảnh báo chấm công).
Hành vi hiện tại ĐÚNG THIẾT KẾ; cái thiếu là **đường đi hợp lệ cho người dùng**.

SPEC-03 §17 dòng 1024 nói thẳng: *"Không cho cập nhật trạng thái nhân viên bằng cách sửa trực tiếp field…
nên dùng chức năng Đổi trạng thái"* ⇒ vá bằng **NÚT**, TUYỆT ĐỐI không bằng trigger/cron suy diễn.

## 2. Quyết định thiết kế (chốt trước khi code)

### D1 — ngày đi CÙNG lượt gọi, KHÔNG 2 lượt

Mở rộng `changeEmployeeStatusSchema`. **CẤM** phương án FE gọi `PATCH endDate` rồi `POST change-status`:
lượt hai hỏng để lại ĐÚNG trạng thái sai lệch owner đang gặp.

### D2 — tên field là `endDate`, KHÔNG phải `effectiveDate` ⚠️ (đổi ở v2)

Số đo SPEC-03: `:1887` (§14.6 bước 4) "Nhập **ngày hiệu lực**" — **vô điều kiện cho MỌI transition**;
`:1889` (bước 6) "Nếu Resigned/Terminated, nhập **ngày nghỉ việc**" — ngày **THỨ HAI**; `:577` (§11.4
probation→Official) cũng đòi ngày hiệu lực ở transition KHÔNG-exit; `:593` (§11.5) mới là ngày nghỉ việc.

⇒ WO này chỉ thi công được **vế "ngày nghỉ việc"** (cột `employee_profiles.end_date` đã có). Đặt tên
`effectiveDate` sẽ **chiếm chỗ** khái niệm khác trên một schema `.strict()`, ép WO sau phải đổi tên phá
hợp đồng. Dùng `endDate` — khớp đúng cột, khớp đúng key đã có ở `updateHrEmployeeSchema` (`employee-write.ts:95`).

**Lệch SPEC được GIỮ CHỖ, ghi tường minh:** vế "ngày hiệu lực cho MỌI transition" (§14.6 bước 4, §11.4)
**HOÃN** sang WO khác — cần cột mới trên `employee_status_histories` (hiện chỉ có `changed_at`) ⇒ đụng
migration + DB-03. Tên `effectiveDate` để dành cho WO đó.

### D3 — `endDate` BẮT BUỘC khi vào exit-status, TỪ CHỐI khi không

- `newStatus ∈ {resigned, terminated}` ⇒ **bắt buộc**, ghi vào `employee_profiles.end_date`.
- `newStatus ∈ {active, inactive}` ⇒ **400 nếu gửi**. Nhận rồi bỏ đi = đúng bẫy `ui-promises-backend-never-reads`.
- `inactive → active` (tái tuyển) **KHÔNG xoá** `end_date` cũ — ngoài phạm vi WO, nhưng dialog **PHẢI hiện
  `end_date` hiện tại** (đã có ở `employee-read.ts:135`) để HR không mù.
- `resigned → terminated` ⇒ **GHI ĐÈ** `end_date` bằng ngày mới (hành vi chốt, không im lặng). Dialog cảnh
  báo "sẽ thay ngày nghỉ hiện tại DD/MM/YYYY".
- ⚠️ **`after.endDate` trong audit = giá trị THỰC SỰ tồn tại sau lệnh ghi** — `dto.endDate` khi có, ngược
  lại **`row.endDate` giữ nguyên**. **CẤM `dto.endDate ?? null`**: với `active→inactive` (D3 cấm gửi ngày)
  nó sẽ ghi `end_date → null` trong khi cột KHÔNG hề bị chạm ⇒ `audit_logs` append-only (BẤT BIẾN #2) nói
  dối VĨNH VIỄN.
- 📉 **Hệ quả xuôi dòng của GHI ĐÈ** (đo đường đọc `end_date` — đúng 3 chỗ): `leave-accrual.repository.ts:62`
  → `leave-accrual.logic.ts:171/213`; `leave-carryover.repository.ts:107` → `leave-carryover.logic.ts:178`;
  `attendance-alert-noti.repository.ts:281` — **query ATT lọc `status='active'` (`:289`) ⇒ sau khi đổi sang
  resigned/terminated người đó rơi khỏi tập, ghi đè ngày KHÔNG ảnh hưởng ATT**. Vế phép: rút NGẮN `end_date`
  sau khi đã cấp phép **không tự thu hồi được** (`leave_balance_transactions` append-only); nới DÀI thì nhịp
  sau tự bù. PROD đang `accrual_method='None'` nên chưa cháy — nhắc người bấm PROD (§7).
- 🧭 **Tư thế với `PATCH /hr/employees/:id` (endDate) sau khi đã exit: KHÔNG chặn** trong WO này. Hai đường
  ghi cùng cột nhưng **cả hai đều có audit** (`endDate` nằm trong `structuralSnapshot` allowlist,
  `hr-write.service.ts:857`); chặn sẽ giết đường sửa sai chính tả ngày. Nói ra để reviewer sau không tự diễn giải.

### D4 — Ép ở HAI tầng, vị trí assert CHÍNH XÁC ⚠️ (làm rõ ở v2)

- Zod `.refine()` ⇒ 400 tại biên với `path:["endDate"]` (chứng minh pipe chạy TRƯỚC service).
- `changeStatusCore`: assert **SAU** `assertWriteScope` (`:482`), **TRƯỚC** `this.db.withTenant` (`:483`),
  ném `BadRequestException`. Đặt trước `assertWriteScope` sẽ trả lời về payload TRƯỚC khi trả lời về quyền
  (403 biến thành 400) — SAI. Đường gọi service trực tiếp (chat-sync test, seeder) do đó không lách được.

### D5 — Nguồn sự thật cho FSM + exit-status nằm ở CONTRACTS ⚠️ (mới ở v2)

`STATUS_TRANSITIONS` hiện là `const` module-private ở `hr-write.service.ts:73` — **không export**, FE không
với tới. Nếu không nâng lên contracts thì `ChangeStatusDialog` buộc phải viết lại literal FSM ⇒ drift BE↔FE
⇒ đúng cảnh "bấm rồi ăn 422" mà WO cấm.

⇒ Contracts export **hai** hằng: `HR_EMPLOYEE_STATUS_TRANSITIONS` (bản đồ FSM đủ 4 khoá) và
`HR_EMPLOYEE_EXIT_STATUSES = ["resigned","terminated"]`. `hr-write.service.ts:73` **tiêu thụ** (không copy).
Spec ghim: đủ 4 khoá, `terminated: []`.

*Phạm vi "nguồn sự thật duy nhất" = **đường GHI**.* Đường ĐỌC còn 1 literal ở
`hr-read.repository.ts:439` (`findLatestResignationReasonTx`) — ghi nhận, KHÔNG gộp trong WO này (đổi
đường đọc = mở rộng phạm vi ngoài paths WO).

### D6 — `LOCKING_STATUSES` giữ literal RIÊNG, ghim bằng spec — KHÔNG alias ⚠️ (đảo ở v2)

`LOCKING_STATUSES` (`:80`) nghĩa là *"trạng thái mà `lockUser` có hiệu lực"*; `HR_EMPLOYEE_EXIT_STATUSES`
nghĩa là *"trạng thái đòi ngày nghỉ"*. Hôm nay trùng giá trị, **độc lập về ngữ nghĩa**. Dựng cái này TỪ cái
kia = leo thang tiềm ẩn: ai đó thêm `inactive` vào hằng contracts (vì muốn ngày nghỉ) sẽ **lặng lẽ** cho
`lockUser:true` có hiệu lực trên transition **có đường lùi** ⇒ khoá tài khoản đạt tới được qua trạng thái
không-cuối.

⇒ Giữ 2 literal riêng + 1 spec `expect(LOCKING_STATUSES).toEqual(new Set(HR_EMPLOYEE_EXIT_STATUSES))` kèm
chú thích: *đổi một cái buộc phải quyết định lại cái kia*.

⚠️ `LOCKING_STATUSES` hiện là `const` **module-private** (`:80`) ⇒ spec không import được. Phải **export**
nó (tên giữ nguyên) — **CẤM spec khai lại literal** (pin thành tautology = mất đúng cái D6 bảo vệ).

### D7 — 5 điểm gọi hiện có PHẢI sửa, KHÔNG nới assert

`chat-be5-derived-rooms.int-spec.ts:384, 672, 797, 891` gọi `changeStatus(..., {newStatus:"resigned"})` →
sau D4 sẽ ném. Sửa bằng cách **thêm `endDate`**, KHÔNG bằng cách bỏ assert. Dòng `:914` dùng `inactive` ⇒
giữ nguyên (thêm `endDate` vào đó sẽ thành 400). Các ca đó assert thu hồi phòng chat / rollback / scrub
audit — không assert hình dạng DTO ⇒ ý nghĩa gốc không mất.
`hr-write.service.spec.ts`: 5 lời gọi (171/180/196/202/226), chỉ **171 + 202** là `resigned` cần sửa.
`hr-employee-write.int-spec.ts:220-242` gửi `{newStatus:"inactive"}` ⇒ **KHÔNG đỏ, giữ nguyên, không đụng**.

## 3. Điểm chèn (INSERTION POINTS — không phải thân hàm)

| # | File | Việc |
| --- | --- | --- |
| 1 | `packages/contracts/src/hr/employee-write.ts` | Export `HR_EMPLOYEE_STATUS_TRANSITIONS` + `HR_EMPLOYEE_EXIT_STATUSES` (D5); thêm `endDate: isoDate.optional()` vào `changeEmployeeStatusSchema`; `.refine()` HAI CHIỀU (D3) sau `.strict()` |
| 2 | `apps/api/src/employees/hr-write.service.ts:73` | `STATUS_TRANSITIONS` **tiêu thụ** hằng contracts (D5) |
| 3 | `apps/api/src/employees/hr-write.service.ts:80` | `LOCKING_STATUSES` **giữ literal riêng** (D6) + **export** để spec import; thêm chú thích |
| 4 | `apps/api/src/employees/hr-write.service.ts:481` `changeStatusCore` | Assert D4 đúng vị trí; truyền `endDate` xuống `setStatusTx`; audit `before/after` thêm `endDate` theo **đúng luật `after` ở D3** (không `?? null`). **GIỮ NGUYÊN `?? []` ở `:492`** — `row.status as HrEmployeeStatus` là cast KHÔNG an toàn; kiểu narrow từ `as const` có thể khiến lint đề nghị bỏ ⇒ status lạ thành TypeError 500 |
| 4b | `apps/api/src/employees/hr-write.repository.ts:69-90` | **Nới `EmployeeStateRow` + select của `findForUpdateTx` thêm `endDate`** — bắt buộc, vì `changeStatusCore` hiện KHÔNG có nguồn cho `before.endDate`; audit append-only ghi lệch vế là SAI VĨNH VIỄN. ⚠️ mặt cắt DÙNG CHUNG với `linkUser`/`unlinkUser` ⇒ chỉ NỚI, không đổi kiểu field cũ |
| 5 | `apps/api/src/employees/hr-write.repository.ts:215` `setStatusTx` | Thêm tham số `endDate?: string` — **1 UPDATE duy nhất**, chỉ set khi tham số hiện diện (dựng object `set` bất biến) |
| 6 | `packages/web-core/src/lib/hr-api.ts` | `changeEmployeeStatus(id, body)` theo khuôn `linkUser` (response `{id, status}` khai tại chỗ như `hrLinkUserResponseSchema`) |
| 7 | `apps/app/src/routes/hr/constants.ts:101` | `CHANGE_STATUS_EMPLOYEE: { action: "change-status", resourceType: "employee" }` + ghi chú cặp seed mig 0444, `is_sensitive=false` ⇒ `useCan` |
| 8 | `apps/app/src/routes/hr/employees/ChangeStatusDialog.tsx` (MỚI) | Dialog theo khuôn `LinkUserDialog.tsx` + `AccountLinkSection.tsx`. User hiện tại lấy từ `useAuthStore` của `@mediaos/web-core` (`user`), khuôn có ở `ContractsPage.spec.tsx:23` |
| 9 | `apps/app/src/routes/hr/employees/EmployeeDetailPage.tsx:249` | Chèn nút trong `actions` (sau Hợp đồng, trước Sửa), bọc `PermissionGate` |
| 10 | `apps/app/src/routes/hr/employees/EmployeeFormPage.tsx:465-469` | **ĐÓNG CỬA ĐÃ ĐẺ RA BUG** — ô date "Ngày kết thúc" PATCH thẳng `end_date` mà KHÔNG đổi `status`. Sau khi nút land, HR vẫn có thể lặp lại thao tác cũ và lại thấy "Đang làm việc" = đúng nguyên văn tiêu đề WO. Thêm dòng hint dưới ô: *"Điền ngày ở đây KHÔNG đổi trạng thái nhân viên — dùng nút Đổi trạng thái"* + ca FE assert hint hiển thị |
| 11 | `apps/app/src/i18n/locales/vi/hr.ts` | **TÁI DÙNG** `employees.actions.changeStatus` (`:85`, hiện chưa ai dùng) cho nhãn nút; thêm khối `employees.changeStatus.*` cho dialog + hint #10; nhãn trạng thái dùng `status.*` (`:410-421`) — KHÔNG đẻ nhãn thứ hai. Map 409 `"already 'x'"` (`hr-write.service.ts:489-491`) thành câu tiếng Việt đọc được, không để rơi thông báo thô |
| 12 | `harness/backlog.mjs` | Sửa `done_when` của WO: `effectiveDate` → **`endDate`** (D2) + thêm `notes` ghi **lệch SPEC-03 §14.6 bước 4 / §11.4** (ngày hiệu lực cho MỌI transition bị hoãn). Không sửa ⇒ bản ghi lệch chỉ sống trong file plan (không phải nguồn sự thật) và gate nghiệm thu sẽ so lệch |

## 4. Hợp đồng UI của dialog (acceptance)

1. **Lọc theo FSM**: chỉ liệt kê `HR_EMPLOYEE_STATUS_TRANSITIONS[current]`.
2. **Fail-closed với status lạ**: `employee-read.ts:136` khai `status: z.string()` (KHÔNG enum như list ở
   `:75`) ⇒ chuỗi ngoài 4 giá trị phải cho **0 lựa chọn + nút disabled**, không được `.map()` trên `undefined`.
3. **`terminated`** ⇒ rỗng ⇒ nút **disabled + tooltip** giải thích (không để bấm rồi ăn 422).
4. **Cảnh báo một chiều**: `resigned`/`terminated` không có đường lùi qua API — cảnh báo rõ ở bước xác nhận.
5. **Ngày nghỉ việc**: input date CHỈ hiện khi chọn exit-status, bắt buộc. Hiện `end_date` hiện tại nếu có;
   khi `resigned → terminated` cảnh báo sẽ GHI ĐÈ (D3).
6. **Lý do**: ≤500 ký tự (khớp schema), tuỳ chọn.
6b. **`endDate >= startDate`**: BE **KHÔNG** có rule này (cả `updateHrEmployeeSchema` lẫn schema mới) — chỉ
   FE form có (`employee-form-schema.ts:101-103`). Dialog nên chặn, nhưng ghi rõ đây là **validate FE-only,
   KHÔNG phải bất biến BE** (đừng để reviewer tưởng server đang ép).
7. **Khoá tài khoản**: checkbox CHỈ hiện khi exit-status; **ẩn/disable khi `employee.userId === useAuthStore().user.id`**
   (BE đã chặn tự khoá ở `hr-write.service.ts:510`).
8. **Không nuốt lỗi**: `ChatSyncRevokeError` (`:531-537`) ⇒ trạng thái CHƯA đổi ⇒ FE hiện lỗi `role="alert"`,
   TUYỆT ĐỐI không toast "thành công".
9. **Chống bấm đúp**: nút xác nhận `disabled` khi mutation pending (route KHÔNG có `@Idempotent()`; bấm đúp
   không ghi trùng nhờ `oldStatus === newStatus → 409` ở `:489-491`, nhưng thông báo khó hiểu).
10. Sau thành công: invalidate `hrKeys.employees` (list + detail) để badge đổi ngay.

## 5. Test (RED trước)

**Int-spec MỚI** `apps/api/test/integration/hr-change-status-http.int-spec.ts` — HTTP thật,
`bash scripts/lane-db-setup.sh hrstatus` → `export LANE_DB=mediaos_hrstatus` (thiếu ⇒ SKIP = xanh-giả).
Mỗi ca dùng **user riêng** (bẫy rate-limit per-user). Actor là role canonical `hr`/`company-admin` —
**KHÔNG super-admin** (test bằng SA = tautology).

**"Canonical" nghĩa CƠ CHẾ, không phải nhãn:** system role `company_id IS NULL` do mig 0444 seed
(`auth-seed-canonical-roles.int-spec.ts:172-183`), gắn qua `user_roles`. ⚠️ Tiền lệ ngay trong suite HR lại
là role **ad-hoc** (`hr-employee-write.int-spec.ts:88-100 grantEmployeeWrite`) — đừng dán nhãn "canonical"
lên role ad-hoc. Ràng buộc fixture: chỉ-số unique "1 user ↔ ≤1 hồ sơ active" ⇒ **tự tạo hồ sơ cho user
actor**, đừng giả định có sẵn; `seedPermissionCatalog` là catalog TOÀN CỤC `DO NOTHING` ⇒ khai
`change-status:employee` đúng `is_sensitive=false`.

| Ca | Kỳ vọng |
| --- | --- |
| (a) thiếu `endDate` khi → `resigned` | 400 ở biên **VÀ** `status` không đổi **VÀ** `end_date` không đổi **VÀ** 0 hàng history **VÀ** 0 audit |
| (a2) gửi `endDate` khi → `inactive` | 400 (D3 chiều nghịch) + 0 ghi |
| (b) ALLOW → `resigned` | 2xx + `status` + `end_date` + **1** hàng history + **1** audit `change-status`, trong MỘT lượt gọi |
| (b2) ALLOW `resigned → terminated` | `end_date` bị **GHI ĐÈ** bằng ngày mới (ghim hành vi D3) |
| (c) `terminated → active` | 422 + `end_date` không đổi + 0 ghi |
| (d) thiếu quyền | 403 + 0 audit + `end_date` không đổi |
| (e) 2-tenant: actor công ty A trên id công ty B | 404, không rò tồn tại, 0 ghi |
| **(f) ALLOW khoá** — actor canonical đổi hồ sơ **NGƯỜI KHÁC** → `resigned` + `lockUser:true` | `users.status='suspended'` **VÀ** `locked_at IS NOT NULL` ← **ca dương bắt buộc**, thiếu nó thì (f2) xanh RỖNG (bài học `deny-cases-vacuous-without-allow-case`) |
| **(f2) DENY tự khoá** — actor canonical **đang liên kết CHÍNH hồ sơ đó** + `lockUser:true` | ⚠️ **ĐỌC LẠI DB xác nhận `employee_profiles.user_id = <actor.userId>` TRƯỚC khi assert** — chặn `:510` là `row.userId && row.userId !== user.id`, fixture quên liên kết (`user_id IS NULL`) ⇒ ca xanh vì LÝ DO SAI. Sau đó assert `users.status` không đổi |
| **(g) `active → inactive`** (audit không nói dối) | audit `after.endDate === before.endDate` **VÀ** cột `end_date` trong DB KHÔNG đổi — ghim luật `after` ở D3, chống `?? null` |

**Unit BE** `hr-write.service.spec.ts`:

- Cập nhật lời gọi 171 + 202 (D7).
- ⚠️ **Sửa `makeRepo` (`:58-96`) trả `endDate` GIÁ TRỊ THẬT** (vd `"2026-01-31"`). Mặc định hiện tại không
  có `endDate` và mock ép `as never` nên không đỏ typecheck ⇒ ca audit sẽ so `undefined` với `undefined`
  và **PASS RỖNG**.
- **Ca assert D4**: gọi thẳng `svc.changeStatus(actorA, EMP_ID, {newStatus:'resigned', lockUser:false})`
  (thiếu ngày, bỏ qua Zod) ⇒ ném **VÀ** `repo.findForUpdateTx` · `setStatusTx` · `insertStatusHistoryTx` ·
  `lockUserTx` · `audit.record` · `lmsSync.enqueueSync` · `chatSync.syncUserDerivedMembershipTx` **đều
  KHÔNG được gọi** — đó mới đúng mệnh đề "ném TRƯỚC khi mở tx".
- **Ca ghim D5/D6**: `HR_EMPLOYEE_STATUS_TRANSITIONS` đủ 4 khoá + `terminated: []`;
  `LOCKING_STATUSES` (import, KHÔNG khai lại) deep-equal `new Set(HR_EMPLOYEE_EXIT_STATUSES)`.
- **Ca audit**: `audit.record` nhận **đúng giá trị** `before.endDate` (= giá trị `makeRepo` trả) và
  `after.endDate` theo luật D3 — cho CẢ ca exit (đổi) lẫn ca non-exit (giữ nguyên).

**FE spec** `ChangeStatusDialog.spec.tsx`: lọc FSM đúng cho cả 4 trạng thái nguồn · **status lạ ⇒ 0 lựa
chọn + disabled** · exit hiện ngày+checkbox · non-exit ẩn cả hai · self-profile ẩn checkbox · lỗi BE hiện
`role="alert"` · nút disabled khi pending. `EmployeeDetailPage.spec.tsx`: `useCan=false` ⇒ KHÔNG thấy nút.

## 6. Trình tự thi công

1. RED: viết int-spec (a)-(f2) + unit + FE spec → chạy → ĐỎ đúng lý do.
2. Contracts (#1) → `pnpm --filter @mediaos/contracts build` (dual dist).
3. BE (#2-#5) + sửa điểm gọi (D7) → int-spec XANH.
4. web-core (#6) → **REBUILD dist** (bài học `web-core-stale-dist`: dist không tự build, triệu chứng là
   trang trắng chứ không phải lỗi biên dịch).
5. FE (#7-#11) → FE spec XANH.
6. `harness/backlog.mjs` (#12): sửa `done_when` + `notes` cho khớp D2.
7. `bash harness/check.sh --lane-db` → FULL gate → PR.

## 7. Ràng buộc / KHÔNG làm

- ❌ KHÔNG migration. Nếu giữa chừng thấy "cần ngày hiệu lực RIÊNG cho mọi transition" ⇒ **WO KHÁC** (D2).
- ❌ KHÔNG sửa lệch tên trạng thái SPEC-03 §14.6 (5 tên) ↔ DB CHECK (4 giá trị) — quyết định CÓ CHỦ Ý
  (`employee-write.ts:18-19`). FE dùng đúng 4 giá trị DB, dịch qua `hr.status.*`.
- ❌ KHÔNG hard-code role ở FE; gate bằng `useCan`/`PermissionGate` với cặp seed thật.
- ❌ KHÔNG nới `assertWriteScope`, KHÔNG nới ngưỡng rate-limit env, KHÔNG đụng đường ĐỌC (`hr-read.*`).
- ❌ **KHÔNG phát thông báo NOTI.** `HR_EMPLOYEE_STATUS_CHANGED` có trong catalog nhưng `isEnabled:false`
  (`notification-event-catalog.const.ts:138`) ⇒ im lặng là ĐÚNG. Ghi ra đây để gate không đòi (WO src có
  trích SPEC-03 §9.5).
- ℹ️ Hệ quả nhỏ của D4, KHÔNG phải hồi quy: gọi `{newStatus:'resigned'}` thiếu ngày trên hồ sơ **đã**
  `resigned` giờ trả **400 thay vì 409**. Vô hại — ghi để reviewer khỏi tưởng lùi.
- 📏 **Phép đo bắt buộc trước khi đổi hợp đồng** (`.strict()` + `endDate` bắt buộc = thay đổi PHÁ VỠ):
  quét `apps/lms`, `apps/social`, `scripts/**` xác nhận **không client nào khác** gọi
  `POST /hr/employees/:id/change-status`. Kết quả ghi vào PR body.
- 🔧 Việc VẬN HÀNH đi kèm (ngoài Definition of Done của code): sau khi nút land, **người** bấm đổi trạng
  thái thật cho hồ sơ đang sai trên PROD — PROD bật 2FA, không automation headless. ⚠️ Hồ sơ đó đã có
  `end_date` set; bấm `resigned` sẽ **GHI ĐÈ** ⇒ nhắc người bấm **nhập lại đúng 08/08/2026**.
