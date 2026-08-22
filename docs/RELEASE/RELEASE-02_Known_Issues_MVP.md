# RELEASE-02 — KNOWN ISSUES & DEFER LIST (MVP)

> Sổ vấn đề đã biết tại thời điểm chốt cổng Sprint 5 → Sprint 6. Sinh trong `S5-UAT-1`.
> Chốt: **2026-07-26** · `master` `153e2101` · migration head **0529**.
> Cập nhật: `S6-STAB-1` (KI-021…023) · **`S6-QA-FINAL-1` (KI-024…026)** — `master` `c845a777`.
> Thang mức: `QA-08 §9` (S0 Blocker · S1 Critical · S2 Major · S3 Minor · S4 Trivial).
>
> **Quy tắc của sổ này:** chỉ ghi vấn đề đã **kiểm chứng** (có lệnh/truy vấn/số đo/file:dòng). Không
> ghi nghi ngờ. Mỗi mục có **workaround** và **chủ** — không có mục nào "để đó xem sao".

---

## 1. Bảng tổng hợp

| ID | Vấn đề | Mức | Loại | Chặn UAT | Chặn go-live | Chủ |
| --- | --- | --- | --- | --- | --- | --- |
| ~~**KI-069**~~ | **MỞ VÀ ĐÓNG CÙNG PR 2026-08-19** (`S6-SEC-IDENTITY-PROJ-1`). `GET /leave/admin/balances` — `LeaveAdminService.listBalances` gọi `dataScope.resolveAndAssert('view','leave-balance')` rồi **VỨT giá trị scope trả về**: cổng quyền đúng, nhưng `listBalancesTx` không nhận vị từ nào ⇒ vai giữ `view:leave-balance@Own` nhận trọn danh sách số dư phép kèm `userFullName` của toàn công ty. **Cùng lớp lỗ KI-053** (gate đúng / `data_scope` không được dùng), tìm ra trong pha ĐO của chính WO cơ chế. Rủi ro sống lúc phát hiện = **0** — đo PROD 2026-08-19: vai `employee` (34/35 user sống) chỉ có `view-own:leave-balance@Own`, là cặp KHÁC. **Vẫn cấp số hiệu** dù vá cùng ngày: một phát hiện không có số thì vô hình với bug-scrub, đúng lỗi đã mắc với KI-049. Kèm theo, `ORDER BY … asc(users.fullName)` cũng được vá: che tên mà vẫn sắp theo cột gốc thì **thứ tự hàng tiết lộ thứ tự alphabet của tên vừa che** — bản vá tự biến mình thành oracle. Bằng chứng: `identity-projection-scope.int-spec.ts` D1/D2/D3, và D2 **đã phải sửa một lần** vì lúc đầu nó xanh-RỖNG (chưa seed số dư nào ⇒ "0 hàng mang khoá danh tính" đúng một cách vô nghĩa, vẫn xanh cả khi bản vá bị vô hiệu hoàn toàn) | S3 | Bảo mật (phân quyền) | ❌ | ❌ | `S6-SEC-IDENTITY-PROJ-1` — **ĐÃ ĐÓNG** |
| ~~**KI-070**~~ | **ĐÃ ĐÓNG 2026-08-21 — `S10-SEC-AUDITLOGROW-1`, phạm vi đóng: HAI BẢNG NHẬT KÝ.** `data_scope` của cặp GATE `view:audit-log` nay chặn **TẬP HÀNG** của `login_logs` + `user_security_events`, không chỉ che CỘT danh tính. Vị từ dựng bằng `buildUserScopeConditionOn` (TÁI DÙNG lattice, không viết bản thứ ba) trên `<bảng>.user_id`/`<bảng>.company_id`, đi qua brand `IdentityGrant` với `basis:"scoped-predicate"` và một hàm cổng mới `rowScopeSql()` **assert cả `basis` lẫn BẢNG** trước khi nhả vị từ — soi gương bước đối chiếu bảng đã đóng lỗ B1 của KI-054. **Ba vế của khuyết tật, cả ba đóng:** (V1) tập hàng không có vị từ; (V2) `filter.userId` đi thẳng từ query param — nay bị **GIAO** với vị từ scope (`Own` + `?user_id=<người khác>` ⇒ **0 hàng, HTTP 200**, KHÔNG 403: 403 phân biệt "ngoài scope" với "không có hàng" ⇒ oracle tồn-tại); (V3) **`countTx` — vế KHÔNG có trong sổ KI này, tự tìm ra khi vá**: chỉ vá `findManyTx` thì `data` sạch mà `pagination.total` VẪN phát ra số hàng ngoài scope, một oracle ĐẾM ĐƯỢC và im lặng. `rowScope` nay là tham số **BẮT BUỘC của CẢ HAI** hàm ⇒ quên = ĐỎ typecheck. **Số đo PROD 2026-08-21 (đo lại, không tái dùng số 19/08):** `view:audit-log` có **3 vai** giữ — `SA` (10 người), `QUẢN LÝ CẤP CAO` (4), `company-admin` (2) — **cả ba `@Company`**, 0 hàng `DENY`; `login_logs` 366 hàng, `user_security_events` 65, `users` 48 ⇒ **chưa vai nào chạm được lớp này**, bản vá là chặn lỗ tiềm tàng. **RED-proof (không phải "nhìn xanh"):** vô hiệu `rowScopeSql` (trả `true`) ⇒ **7/14 ca ĐỎ** — R1 (hàng ngoài scope) · R2 (dò UUID qua query param + total) · R3 (bám chủ thể) · R4 (total) · T1 (Team fail-closed) · N1 (hàng `user_id IS NULL`) · X3 (ô `Own × Own` — vế HÀNG của nó gãy); **7 ca GIỮ XANH** (A1/A1b/A2/A3/X2/G1 + **X1**). ⚠️ Con số này ĐO LẠI 2026-08-21 và **đính chính bản nháp ghi "8/14, có X1"**: X1 hỏi *"hàng của CHÍNH MÌNH có còn khoá `email` không"* — câu đó thuộc tầng CỘT, nên vô hiệu vị từ HÀNG không làm nó đỏ, và nó KHÔNG BAO GIỜ được tính là bằng chứng của vế bound-HÀNG. Ghi sai theo chiều "nhiều ca đỏ hơn thực tế" là tự cấp cho mình bằng chứng chưa đo — đúng lớp lỗi mà chính KI-070 tồn tại để chống — đúng vế chống ca DENY xanh-RỖNG. **Phát hiện kèm theo, đáng giữ làm tiền lệ:** `login-blocked-attribution.int-spec.ts` (KI-044) gọi thẳng `viewer.listLoginLogs()` bằng một **UUID tổng hợp không tồn tại trong `users`, không giữ grant nào** — nó đọc được mọi hàng của tenant KHÔNG phải vì seed đúng mà vì **chính lỗ KI-070**. Sau bản vá 4 ca ĐỎ; sửa đúng là seed grant `view:audit-log@Company` THẬT cho mỗi tenant, và ca R3 ("tenant B không đọc được hàng của A") nay nói về một admin B **có quyền đọc thật** thay vì một UUID vốn chẳng đọc được gì. **ORDER BY (`done_when` #4):** đo sạch — 5 khoá sort đều là cột CỦA CHÍNH bảng nhật ký, 0 cột bị che (khác `role-admin`/`leave-admin` đã mắc bẫy KI-069); thêm khoá phụ `desc(id)` (sắp theo MỘT cột + `OFFSET` ⇒ thứ tự không xác định ⇒ mất/lặp hàng giữa các trang) và một ratchet `auth-log-sort-allowlist.spec.ts` **neo vào CỘT drizzle thật**, không neo tên — bản nháp đầu assert "allowlist ∩ {email,fullName} = ∅" là **xanh-RỖNG theo cấu tạo** (khoá sort là snake_case, không bao giờ trùng chuỗi `email`). Ratchet đó pin luôn vùng mù `login_logs.email`/`normalized_email` — hai cột danh tính **vô hình với census** (census chỉ bind `email`/`fullName` tới bảng `users`). ⚠️ **RANH GIỚI CÓ TÊN — đọc trước khi "sửa cho hợp lý":** (1) `Own` trên security-event bám **CHỦ THỂ** (`user_id`), CỐ Ý không `OR actor_user_id` — nới vế actor biến tập hàng thành hàm của LỊCH SỬ HÀNH VI, không luật nào kiểm được; (2) `Team`/`Department` = **0 hàng** và lưới scope **KHÔNG đơn điệu** (giữ đồng thời `@Own` + `@Team` ⇒ resolve ra `Team` ⇒ **MẤT** hàng) — sai về phía hẹp, sàn hoá phải làm cho CẢ ba đường dùng chung lattice (nợ N-1b), không lén vá; (3) **K1** `PERMISSION_GUARD_ENABLED=false` (kill-switch khẩn cấp) **không mở được** hai route này cho người thiếu grant — fail-closed, CHỦ Ý, cấm cho vị từ đọc cờ đó; (4) **K2** guard cache grant 300s còn `getCompanyRoleGrantsWithScope` đọc thẳng DB ⇒ cửa sổ ≤300s sau khi gỡ role: guard cho qua ↔ scope `null` ⇒ **403 CHỦ Ý** (quyền đã bị gỡ thật) — cấm "hoà giải" bằng cách cache luôn nhánh WithScope; (5) **K3** lỗi HẠ TẦNG trong `resolveStrongestScope` cũng fail-closed `null` ⇒ log của bản vá CỐ Ý không chẩn đoán hộ một nguyên nhân, nó bảo đối chiếu với dòng `resolveStrongestScope() infrastructure error` cùng request; (6) 403 của vị từ hàng dùng **NGUYÊN VĂN** chuỗi của `resolveAndAssert` ⇒ `status`/`code`/`type` trùng 403 của guard (chỉ `message` khác — khác biệt đã tồn tại sẵn ở ~101 call-site và chỉ nói về grant của CHÍNH actor). ⚠️ **HAI vế KHÔNG đóng ở đây, mỗi vế một số hiệu — đọc trước khi tin dấu gạch ngang trên KI-070:** (a) `/auth/roles/:id/members` → **`KI-071`**; (b) **`/foundation/audit-logs` (+ `/:id`) → `KI-072`** — **CÙNG cặp gate `view:audit-log` mà WO này vừa bound hàng**, nhưng trên bảng thứ BA (`audit_logs`, **13.146 hàng** đo 21/08 — lớn gấp ~30 lần 366+65 của hai bảng vừa đóng) và **KHÔNG** được bound. Đây là chỗ dấu gạch ngang nguy hiểm nhất: người đọc thấy "KI-070 đóng, cặp `view:audit-log` đã chặn tập hàng" rồi cấp cặp đó ở scope hẹp — đúng lớp lỗi "mô tả phạm vi không có dòng code ép nó" mà chính KI-054 tố cáo. Bản đồ 4-route/3-bảng của cặp này: `docs/permission-matrix-spec.md` | S3 | Bảo mật (phân quyền) | ❌ | ❌ | **ĐÓNG 2026-08-21** — `S10-SEC-AUDITLOGROW-1` |
| **KI-071** | **Vế bound-HÀNG của `GET /auth/roles/:id/members` — TÁCH RA từ KI-070 khi đóng nửa nhật ký, cố ý không để nó chìm theo.** `PermissionAdminRepository.listRoleMembersTx` (`role-admin.repository.ts`) chiếu danh sách thành viên một role với `where` = `roleId` + `companyId` + `notDeleted` + chưa-hết-hạn — **0 vị từ scope**. Sau `S6-SEC-IDENTITY-PROJ-1`, email/họ tên đã bị che theo `data_scope` (KI-053 đóng), nhưng một vai giữ `view:user@Own` **vẫn nhận trọn `userId` + `status` + `expiresAt` của MỌI thành viên** — tức vẫn biết ai thuộc role nào. **Vì sao phải có số hiệu riêng:** KI-070 bao HAI bề mặt (hai bảng nhật ký + role-members) và workaround của nó bảo vệ cả hai; gạch KI-070 mà không tách số sẽ **xoá mất dòng workaround duy nhất** đang bảo vệ route này — đúng lỗi mà chính KI-070 tồn tại để chống, và đúng lớp bẫy đã mắc với KI-049 (phát hiện không có số hiệu thì vô hình với bước bug scrub trước RC). ⚠️ **ĐÍNH CHÍNH workaround gốc, đo lại 2026-08-21:** KI-070 ghi *"không cấp `view:audit-log`/`view:role` ở scope hẹp hơn Company"* — vế `view:role` **SAI**: route này gate **`view:user`** (`role-admin.controller.ts` `@RequirePermission("view","user")`, service còn `assertCan(view,user)` nữa), đúng như hàng KI-053 đã đính chính 2026-08-19. Chép nguyên văn sang đây sẽ đẻ ra một workaround trỏ vào **cặp không phải cổng**. **Workaround ĐÚNG:** không cấp **`view:user`** ở scope hẹp hơn Company cho vai nào. **Số đo PROD 2026-08-21:** 4 vai giữ `view:user`, **cả 4 `@Company`** — `SA` (10 người) · `QUẢN LÝ CẤP CAO` (4) · `company-admin` (2) · `hr` (**0 người giữ**) ⇒ chưa ai chạm được. **Việc thật:** cho `data_scope` chặn tập hàng của `listRoleMembersTx` — cùng khuôn `rowScopeSql` + `basis:"scoped-predicate"` mà `S10-SEC-AUDITLOGROW-1` vừa dựng; ⚠️ ở đây cặp bound (`view:user`) **TRÙNG** cặp gate ⇒ dùng luật fail-closed của `rowScopeFor` (null ⇒ 403 + log), KHÔNG dùng luật `resolveOrNull` của tầng cột. ⚠️ Đọc §7 của `docs/plans/S10-SEC-AUDITLOGROW-1.md` trước khi thi công: lưới scope trên `users` KHÔNG đơn điệu (`Team`/`Department` fail-closed 0 hàng, hẹp hơn `Own`), nên bound hàng ở đây sẽ **kế thừa** nghịch lý đó | S3 | Bảo mật (phân quyền) | ❌ | ❌ | chưa có WO — mở 2026-08-21 bởi `S10-SEC-AUDITLOGROW-1` |
| **KI-072** | **`GET /foundation/audit-logs` (+ `/:id`) — CÙNG cặp gate `view:audit-log` mà `S10-SEC-AUDITLOGROW-1` vừa bound HÀNG, nhưng trên bảng thứ BA và KHÔNG được bound. TÁCH RA khi đóng KI-070, cố ý không để nó chìm theo dấu gạch ngang.** `AuditQueryService.listCompany(companyId, query)` — **chữ ký không có `userId` của actor**, nên nó không resolve `data_scope` được kể cả nếu muốn; `withTenant` + RLS chặn CHÉO TENANT chứ không chặn TRONG tenant. Vai giữ `view:audit-log@Own` đọc trọn `audit_logs` của tenant: `actor_user_id`, `action`, `object_type`/`object_id`, `permission_code`, `data_scope`, `ip`, `user_agent`, `request_id`. **Số đo PROD 2026-08-21:** `audit_logs` **13.146 hàng** (12.786 hàng có `actor_user_id`, **13** actor phân biệt) — so với 366 `login_logs` + 65 `user_security_events` mà KI-070 vừa đóng, bề mặt CÒN MỞ lớn gấp **~30 lần** bề mặt ĐÃ đóng. `?actorUserId=` (`auditLogQuerySchema`) đi thẳng vào `eq(auditLogs.actorUserId, …)` — **đúng hình dạng V2** của KI-070: oracle CÓ ĐIỀU KHIỂN, dò được lịch sử hành động của một UUID bất kỳ trong tenant. `/:id` là chiều thứ hai: `getCompanyDetail` trả trọn một hàng theo id, không vị từ scope. ⚠️ **Đừng nhầm với lớp che đã có:** `AuditMaskerService` redact `before`/`after` — nó che GIÁ TRỊ trong hàng, KHÔNG quyết định hàng nào được trả; và route này **không chiếu email/họ tên** nên tầng KI-053/054 (bound CỘT) không áp dụng ở đây, tức lỗ này KHÔNG có lớp giảm nhẹ nào ngoài workaround. **Vì sao phải có số hiệu riêng thay vì một câu trong KI-070:** workaround của KI-070 (*"không cấp `view:audit-log` ở scope hẹp hơn Company"*) là lớp kiểm soát DUY NHẤT đang bảo vệ route này; gạch KI-070 mà không tách số sẽ xoá đúng dòng đó — cùng lỗi đã mắc với KI-049 (phát hiện không có số hiệu thì vô hình với bug scrub trước RC) và cùng lý do KI-071 được tách. **Workaround (GIỮ NGUYÊN, chuyển sang đây):** không cấp `view:audit-log` ở scope hẹp hơn `Company` cho vai nào. **Số đo PROD 2026-08-21:** 3 vai giữ — `SA` (10 người) · `QUẢN LÝ CẤP CAO` (4) · `company-admin` (2) — **cả ba `@Company`**, 0 hàng `DENY` ⇒ chưa ai chạm được. **Việc thật:** cùng khuôn `rowScopeFor` + `rowScopeSql` + `basis:"scoped-predicate"` mà `S10-SEC-AUDITLOGROW-1` vừa dựng; ở đây cặp bound TRÙNG cặp gate (như hai bảng nhật ký) ⇒ dùng luật fail-closed `null ⇒ 403 + log`, KHÔNG dùng luật `resolveOrNull` của tầng cột. ⚠️ **Quyết định phải chốt TRƯỚC khi code, không lén chọn:** `audit_logs` chỉ có MỘT cột người (`actor_user_id`) ⇒ `Own` = *"hàng do tôi gây ra"*, một ngữ nghĩa KHÁC `login_logs` (`Own` = hàng VỀ tôi). Ai vá phải phát biểu ngữ nghĩa đó ra rồi mới dựng vị từ — soi gương ranh giới D7 của `docs/plans/S10-SEC-AUDITLOGROW-1.md`. Kèm theo: thêm điểm ĐÚC thứ hai ⇒ `ROW_SCOPE_MINT_PINS` ĐỎ, phải ký lại qua FULL gate (đó là thiết kế, không phải phiền toái) | S3 | Bảo mật (phân quyền) | ❌ | ❌ | chưa có WO — mở 2026-08-21 bởi `S10-SEC-AUDITLOGROW-1` |
| ~~**KI-067**~~ | **MỞ VÀ ĐÓNG CÙNG PR 2026-08-18** (`S10-FND-VALKEYSCOPE-1`). **Bốn môi trường (PROD · dev-online · dev local · test) dùng CHUNG một Valkey `redis://localhost:6379` db0, nhưng chỉ `chat:presence` + kênh socket.io mang danh tính môi trường — 16 họ khoá còn lại KHÔNG.** Đo 17/08 trên máy PROD (`valkey-cli INFO keyspace`): **db0 duy nhất, 288 khoá**, phân bố `perm:cap`=253 · `perm:obj`=18 · `rl:forgot`=7 · `rl:ip`=3 · `rl:acct`=3 · `chat:presence`=3 · `replay:2fa-jti`=1 · `idem:`=1 · `2fa-disable|`=1. **dev-online là bản CLONE của PROD** (cùng company `funtime`, cùng userId) ⇒ khoá trùng **bit-by-bit** giữa hai môi trường. Ba hệ quả, im lặng: (1) `perm:cap` là cache **QUYẾT ĐỊNH QUYỀN** đứng TRƯỚC RLS — một lượt nạp ở dev-online phục vụ luôn cho PROD và ngược lại; (2) khoá đăng nhập `rl:ip:*:lock` — đã quan sát thật: gõ sai ở môi trường khác khoá được người dùng PROD; (3) `idem:*` — retry của môi trường này phát lại kết quả của môi trường kia. **Đã đóng:** một chỗ dựng khoá duy nhất `apps/api/src/common/valkey/valkey-key.ts` tái dùng `resolveEnvScope` (S8-CHAT-UX-RT-1, KHÔNG viết phép suy thứ hai) + cổng runtime chỉ-ở-test + census tĩnh. ⚠️ **Cổng runtime KHÔNG bảo vệ production** (chi tiết + lệnh vận hành: §KI-067) | S1 | An ninh / phân quyền / vận hành | ❌ | ❌ | WO `S10-FND-VALKEYSCOPE-1` ✅ |
| ~~**KI-066**~~ | **MỞ VÀ ĐÓNG CÙNG PR 2026-08-18** (`S10-AUTH-IPTRUST-1`). **PROD chạy sau `cloudflared` cùng máy nhưng `TRUST_PROXY` không đặt ⇒ MỌI `req.ip` = `::1`** — đo trên `login_logs` PROD: phân bố IP 30 ngày chỉ có `127.0.0.1`/`::1` + IP fixture, KHÔNG một IP người dùng thật nào. Ba hệ quả cùng lúc, im lặng, không log lỗi: (1) **điều tra mù** — `login_logs.ip_address` vô nghĩa cho forensics; (2) **rate-limit thoái hoá** — khoá per-IP `rl:ip:{slug}|{email}|{ip}` có `ip` là hằng ⇒ biến thành bucket per-account ngưỡng THẤP, nên trần khoá một tài khoản là `LOGIN_MAX_ATTEMPTS=5` chứ không phải `LOGIN_ACCOUNT_MAX_ATTEMPTS=20`, và bucket 20 KHÔNG BAO GIỜ chạm ⇒ khoá được tài khoản bất kỳ bằng 5 lần đoán từ endpoint công khai; (3) **bẫy lên nòng** — `SECURITY_POLICY_ENFORCEMENT_ENABLED` đang bật, ngày đầu admin bật IP-allowlist thì `::1` bị so với CIDR văn phòng ⇒ khoá cả công ty ra ngoài. **Đã đóng:** `TRUST_PROXY=loopback` (chọn từ SỐ ĐO header, không suy từ tài liệu) + nghiệm thu BẰNG HÀNH VI trên PROD. ⚠️ **Bẫy phụ đào được khi vá — xem §KI-066:** đặt biến vào `.env.prod` **KHÔNG có tác dụng gì**, API đọc `.env` | S1 | An ninh / vận hành | ❌ | ❌ | WO `S10-AUTH-IPTRUST-1` ✅ |
| **KI-068** | **4 route ghi trả `500 SYSTEM-ERR-001` thay vì `400` khi body sai hợp đồng — validate KHÔNG chạy ở biên.** Đo bằng HTTP thật (không suy đoán): `POST /api/v1/api-keys` với `scopePermissionIds: []` ⇒ **500**, `error.type = "ZodError"`. Cơ chế 3 bước: (1) handler khai `@Body() dto: CreateApiKeyRequest` — đó là **TYPE** (`z.infer`), KHÔNG phải class `createZodDto` ⇒ `ZodValidationPipe` không có schema để chiếu ⇒ body đi thẳng vào handler, KHÔNG được validate ở biên; (2) handler tự `createApiKeyRequestSchema.parse(dto)` ném **ZodError THÔ**; (3) `AllExceptionsFilter` chỉ hiểu `ZodValidationException` của nestjs-zod (`getZodError()`), không hiểu `ZodError` thô ⇒ rơi vào nhánh 500. ⚠️ Comment tại `api-keys.controller.ts:45` KHẲNG ĐỊNH "ZodValidationPipe đã chạy" — SAI, đúng lớp bẫy `ui-promises-backend-never-reads`. **Cùng hình dạng** (census `@Body()` nhận TYPE + handler tự `.parse()`): `POST /foundation/files/upload` · `POST /foundation/files/:id/confirm` · `POST /foundation/files/:id/links` — **3 route này suy từ hình dạng code, CHƯA đo bằng HTTP** (nói rõ để không lẫn đo với đoán). Đối chiếu cách làm ĐÚNG: `profile-change-request.controller.ts:58` dùng `@UsePipes(new ZodValidationPipe(schema))`. **Hỏng đúng chiều an toàn** (request vẫn bị từ chối, fail-closed) ⇒ KHÔNG phải lỗ bảo mật; hậu quả: client không phân biệt được "payload sai" với "server hỏng", và mọi payload sai bơm 500 GIẢ vào giám sát/cảnh báo. **Ghim:** `apps/api/test/integration/invite-apikeys-http.int-spec.ts` — ca `🔴 GHIM BUG (KI-068)` assert CẢ status 500 LẪN `error.type='ZodError'`; ai vá sẽ thấy nó ĐỎ và phải **LẬT** sang `expect(400)`, cấm nới thành `expect([400,500])` | S3 | Hợp đồng API / xử lý lỗi | ❌ | ❌ | chưa có WO |
| ~~**KI-065**~~ | **ĐÃ ĐÓNG 2026-08-19 — `S10-QA-SECPOLICY-GATE-1`, hướng (a) + ADR `DECISIONS-09`.** Bản vá: **bỏ `requiresReauth` khỏi decorator** của `PATCH /settings/security-policy` (giữ `isSensitive`), **KHÔNG sửa một dòng nào** của `permission.decide.ts`/`permission.guard.ts` — chọn (a) vì codebase **không có step-up thật** (grep 19/08: 0 nơi GHI `req.reauthContext`), nên (b) sẽ phải xây mới cả cơ chế xác thực lại; làm nửa vời là **cửa sau giả**. Sau vá: actor có ALLOW đúng cặp `configure-security-policy:company` **PATCH được (2xx, đọc lại bằng GET thấy giá trị mới)**; thiếu quyền ⇒ 403 **`deny-sensitive`**; wildcard `*:*` (kể cả super-admin) **vẫn KHÔNG đủ**; audit `security_policy.updated` + BẤT BIẾN #4 (actor luôn vào exempt-list) giữ nguyên; công ty B PATCH không đụng được policy công ty A. Ca ghim 403 đã được **LẬT** (xoá ca ghim, thay bằng ALLOW 2xx + DENY thật + cross-tenant + audit — KHÔNG nới assert). Hàng rào chống tái sinh: `test/foundation/reauth-reachability.e2e-spec.ts` (route khai `requiresReauth` mà không có `:param` HOẶC chưa có nơi GHI `reauthContext` ⇒ ĐỎ, tự nhả khi có step-up thật) + `src/security-policy/security-policy.permission-contract.spec.ts` (metadata THẬT nạp vào `decideCan`, chạy trong `pnpm test` mặc định — không phụ thuộc Postgres). Hồi quy chống leo thang: reveal-class có `:id` VẪN `deny-object-required` (`module-registry.deny.int-spec.ts:137`, `platform-entitlements.deny.int-spec.ts:116`). **Nửa thứ hai phát hiện khi vá (vá luôn cùng PR):** cặp `configure-security-policy:company` là `is_sensitive` nhưng KHÔNG nằm trong `SENSITIVE_CAPABILITY_ALLOWLIST` ⇒ `/auth/me` không trả ⇒ màn console `settings/security-policy` render EmptyState 'không có quyền' với CHÍNH company-admin (vai duy nhất có grant; catalog không có hàng wildcard nào để `useCan` rơi vào) — tức vá route ở BE mà thôi thì tính năng VẪN không dùng được. Đã APPEND cặp vào allowlist + `SENSITIVE_SCREEN_GATE_PAIRS` và đổi màn sang `useCanExact` (chống FE-permit/BE-403); có ca đo bằng chính `/auth/me`. Đây là lần lặp thứ 9+ của lớp `capability-allowlist-hides-admin-screens`. Ý định 'đổi chính sách bảo mật cần xác thực lại' KHÔNG bị bỏ — chuyển thành WO `S10-AUTH-STEPUP-1` (hạn gỡ tường minh). **Nguyên văn chẩn đoán 14/08 giữ nguyên bên dưới làm bản ghi:** **`PATCH /api/v1/settings/security-policy` KHÔNG THỂ gọi thành công qua HTTP với BẤT KỲ actor nào — route cấu hình chính sách bảo mật công ty là route CHẾT.** Cơ chế (đọc thẳng code + đo bằng HTTP thật, không suy đoán): `security-policy.controller.ts:34-38` khai `@RequirePermission("configure-security-policy", "company", { isSensitive: true, requiresReauth: true })`, nhưng route **không có `:id` param** ⇒ `resourceId` luôn `null` ⇒ `permission.decide.ts` tính `needsObjectGrant = true` VĨNH VIỄN (không tồn tại object nào để cấp grant) ⇒ **403 `deny-object-required` cho MỌI actor**, kể cả actor có ALLOW company-level đầy đủ trên đúng cặp `configure-security-policy:company`. Điều kiện thoát còn lại — `req.reauthContext` — **không được gán ở BẤT KỲ đâu trong codebase** (grep xác nhận: chỉ có nơi ĐỌC, không có nơi GHI) ⇒ không còn đường nào qua. **Hỏng đúng chiều an toàn (fail-CLOSED)** nên KHÔNG phải lỗ bảo mật; hậu quả là **tính năng cấu hình chính sách bảo mật (ép 2FA · chính sách mật khẩu · phiên) không dùng được qua API** — mọi thay đổi phải sửa thẳng DB `company_security_policies`, đúng cách đã phải làm ở KI-027. **Bằng chứng:** ca `🔴 GHIM BUG (KI-065)` — `apps/api/test/integration/security-mailconfig-http.int-spec.ts:171` — actor có quyền đầy đủ vẫn nhận 403 `deny-object-required`. ⚠️ **Ca đó GHIM hành vi SAI CÓ CHỦ Ý:** người vá bug này sẽ thấy nó **ĐỎ** — đó là dấu hiệu vá ĐÚNG, phải **LẬT** ca sang ALLOW 2xx (+ thêm ca DENY thật cho actor thiếu quyền) rồi mới đóng KI này; **TUYỆT ĐỐI không "sửa test cho khớp" bằng cách nới assert** (bài học `tests-can-pin-a-hole-open`). Cùng lý do đó, `PATCH /settings/security-policy` **không được tính là "đã phủ"** ở KI-025: ca DENY hiện tại là **xanh-RỖNG** — actor đủ quyền và actor không quyền đều nhận 403 nên nó không chứng minh được gì về guard. **Hai hướng vá (là quyết định thiết kế, không phải một dòng sửa):** (a) bỏ `requiresReauth` nếu chưa có step-up thật; (b) định nghĩa resource-id cho singleton (lấy `companyId` làm `resourceId`) **và** gán `req.reauthContext` ở một guard step-up có thật | S2 | Phân quyền / cấu hình bảo mật | ❌ | ❌ | ~~WO `S10-QA-SECPOLICY-GATE-1`~~ **XONG 19/08** |
| ~~**KI-064**~~ | **MỞ VÀ ĐÓNG CÙNG NGÀY 2026-08-13** (`S10-FND-ENVKEY-1`). **`cp .env.example .env` — bước cài đặt lần đầu ghi ở CLAUDE.md §7 — làm API KHÔNG BOOT ĐƯỢC, và đã như vậy từ trước WO này.** Cơ chế ba mảnh, mảnh nào cũng đúng khi đứng một mình: (1) `.env.example` CỐ Ý ship giá trị RỖNG cho secret tắt-mềm (12 khoá) — đúng, vì để rỗng nghĩa là "tính năng tắt"; (2) `load-env.ts:38` gán thẳng `process.env[key] = ""` cho dòng `KEY=` bỏ trống, nó KHÔNG lọc rỗng — đúng, precedence phải giữ nguyên raw; (3) schema đòi `z.string().min(32).optional()` — đúng, secret phải có sàn độ dài. Ghép lại: `""` **không phải** `undefined` ⇒ trượt `.min(32)` ⇒ `loadEnv()` NÉM ⇒ API chết lúc boot. **Đo bằng cách chạy chính `.env.example` qua `loadEnv` sau khi đã điền hết `__SET_ME__`** (mô phỏng người cài đã làm xong phần bắt buộc): ném **7 khoá** — `LMS_SSO_SECRET` · `LMS_SYNC_TOKEN` · `LMS_PROGRESS_TOKEN` · `LMS_NOTI_TOKEN` · `LMS_COMPANY_ID` (uuid, `""` cũng không hợp lệ) · `CLOUDFLARE_TURN_KEY_ID` · `CLOUDFLARE_TURN_API_TOKEN`. Người cài làm ĐÚNG hướng dẫn vẫn nhận "Invalid environment variables" về những token họ chưa từng nghe tên và không hề định bật. **Phân biệt với fail-closed đúng thiết kế:** `__SET_ME__` (S6-SEC-ROTATE-1/KI-043) CỐ Ý không hợp lệ để quên điền thì sập — giữ nguyên, KHÔNG đụng. Lỗi ở đây là nhóm **tắt-mềm**: để rỗng là ý muốn hợp lệ, không phải quên. **Vá:** hai helper `optionalSecret(min)` + `optionalUuid()` áp cùng luật "RỖNG = CHƯA SET" mà `optionalUrl()` đã dùng từ KI-028 — lớp bẫy y hệt, chỉ là chưa ai áp cho nhóm secret; phủ 9 field (7 field trên + `INTERNAL_API_KEY` của chính WO + `SOCIAL_SSO_SECRET`/`SOCIAL_COMPANY_ID` cho đối xứng, tuy chúng chưa có mặt trong `.env.example`). **Sàn độ dài KHÔNG bị nới**: có giá trị thật mà ngắn hơn sàn vẫn ĐỎ ở biên (ca test riêng). **RED-proof:** `env-example-boots.spec.ts` viết TRƯỚC bản vá và ĐỎ đúng 7 khoá đó, xanh sau vá. 94/94 spec `src/config` · 157/157 spec vùng LMS/SOCIAL/CHAT-ICE/ME · typecheck sạch | S2 | Cấu hình / onboarding | ❌ | ❌ | **ĐÓNG 2026-08-13** — `S10-FND-ENVKEY-1` |
| ~~**KI-063**~~ | **ĐÃ ĐÓNG 2026-08-21 — `S10-CHAT-CALLSWEEP-1` (R4 KÝ 2026-08-20, chọn phương án JOB QUÉT).** Job MỚI `CHAT_CALL_STALE_ACTIVE_SWEEP` gặt cuộc gọi `active` → `ended`, nên hàng đó rời khỏi tập `status IN ('ringing','active')` của partial unique `chat_calls_one_live_per_room_uq` và phòng **mời lại được**. **HAI nhánh, HAI ngưỡng, cố ý không gộp** (`docs/plans/S10-CHAT-CALLSWEEP-1.md` §2 — dòng audit phải trả lời được *"gặt vì nhánh nào"*): **(O) MỒ CÔI** = không còn hàng participant nào chưa ngã ngũ (`outcome IS NULL` HOẶC `'accepted'` — đúng tập KHÔNG-hấp-thụ mà `WHERE` của `setParticipantOutcome` cho ghi tiếp), ngưỡng `CHAT_CALL_ORPHAN_GRACE_MS`; **(D) QUÁ THỌ** = trần thọ tuyệt đối `CHAT_CALL_ACTIVE_MAX_MS`, lưới an toàn cho hình dạng KHÔNG đoán trước — cụ thể là nhánh `!ok` của `closeCallParticipationOnRoomExit` để lại một hàng participant "còn treo" vĩnh viễn khiến (O) không bao giờ khớp. Thiếu (D) thì lỗ chỉ **ĐỔI HÌNH DẠNG**. **Trạng thái đích là `ended`, KHÔNG phải `missed`:** `active` kéo theo `accepted_at IS NOT NULL` (`chat_calls_accepted_at_chk`) — cuộc gọi ĐÃ được nhận, ghi `missed` là nói dối lịch sử, đúng loại nhầm lẫn mà docblock `CALL_MISSED` đã tách khỏi `CALL_ENDED` để tránh. **KHÔNG chạm hàng rào R4:** mọi phép ghi vòng đời vẫn nằm trong `ChatCallsService`; `ChatCallRoomExitService` giữ nguyên (không đóng `chat_calls`). **KHÔNG sinh migration** — cột `action` của `audit_logs` là text tự do và `object_type='chat_call'` đã có trong CHECK mig `0546`; job được `WorkerSchedulerService` gom qua `DiscoveryService` nên không cần seed catalog. **jobCode RIÊNG chứ không mở rộng `CHAT_CALL_RINGING_TIMEOUT`:** jobCode là khoá vận hành (PK `system_job_locks`) — đổi tên thì bỏ lại một hàng lock mồ côi và cắt đôi lịch sử run; còn giữ tên cũ mà nhét thêm việc quét `active` vào thì tên nói một đằng code làm một nẻo, đúng lớp lỗi KI-054. **Số đo PROD 2026-08-21 (đo từ HOST qua `DATABASE_DIRECT_URL`, KHÔNG `docker exec` — memory `db-password-verify-must-be-from-host`):** `chat_calls` **0 hàng** (0 `active`, 0 mồ côi, 0 phòng bị chiếm chỗ) — tính năng gọi chưa từng chạy thật ở PROD (CHAT `is_active=false`) ⇒ bản vá này chặn một lỗ **TIỀM TÀNG**, không gỡ một phòng đang kẹt. Ghi rõ con số 0 thay vì bỏ trống: một lần đóng KI không có số đo là một lần tự cấp cho mình bằng chứng chưa đo. **RED-proof (không phải "nhìn xanh") — BA đột biến, mỗi cái bắt một tập ca KHÁC nhau:** M1 vị từ LUÔN SAI ⇒ **5/10 ĐỎ** (R1 mở khoá phòng · R3 trần thọ · P1 kết cục participant · V1 hồi sinh · I1 idempotent); M2 bỏ CẢ HAI ngưỡng (vị từ luôn ĐÚNG) ⇒ **2/10 ĐỎ** (R2 còn người đang nói chuyện · R4 chưa quá ân hạn) — đúng hai ca ÂM mà M1 không đóng đinh được; M3 nới `status` sang `ringing` ⇒ **1/10 ĐỎ** (A1 phân công với job ring-timeout). ⚠️ **Đính chính một ca, ghi lại cho đúng TẦNG:** **P2** (hàng đã hấp thụ `rejected` không bị ghi đè) **KHÔNG đo** guard JS của bản vá — đo bằng M4 (gỡ hẳn `if (!isActiveCallOutcome(...)) continue;`) thì cả 10 ca VẪN XANH. Nó được ghim bởi `WHERE` của `setParticipantOutcome` ở tầng SQL (và đó là lớp đúng); guard JS chỉ là phòng vệ chiều sâu + tránh một phép ghi vô nghĩa. Tính P2 là bằng chứng của guard JS sẽ là tự cấp bằng chứng chưa đo — đúng vế đã phải đính chính ở KI-070 (ca X1). **Ghim chống trôi kèm theo:** `chat-call-stale-active-predicate.spec.ts` đọc CHUỖI SQL sinh ra để khẳng định subquery tương quan mang TÊN BẢNG NGOÀI đầy đủ (`chat_call_participants.call_id = chat_calls.id`). Lý do có ca này: drizzle render cột trong `sql` template KHÔNG kèm tên bảng, nên dựng bằng `chatCalls.id` sẽ ra một `id` trần, resolve về bảng BÊN TRONG, tương quan ĐỨT, `NOT EXISTS` LUÔN đúng và job gặt **MỌI cuộc gọi `active`, kể cả cuộc đang nói chuyện** — hỏng đó trông **Y HỆT thành công** (job chạy, không lỗi, phòng mở khoá, R1 vẫn xanh). Ca này sống ở glob colocated `src/**` nên LUÔN chạy, không SKIP theo `LANE_DB`. Đã chứng minh ĐỎ khi đứt tương quan. **Ngưỡng là ENV có `.default()` LẪN `.max()`** (2 phút/1 giờ · 12 giờ/24 giờ): `.default()` vì biến MỚI không mặc định từng giết fixture int-spec ở một file KHÁC hẳn chỗ gán; `.max()` vì `.positive()` một mình cho phép đặt `CHAT_CALL_ACTIVE_MAX_MS=999999999999`, tức **TẮT LẶNG LẼ** chính lưới an toàn này mà không gì đỏ. ⚠️ **RANH GIỚI CÓ TÊN — đọc trước khi "sửa cho hợp lý":** (1) nhánh (O) bám vào tập PARTICIPANT, KHÔNG bám vào socket đang kết nối — suy từ socket sẽ biến tập hàng thành hàm của trạng thái mạng, không luật nào kiểm được; (2) job này CỐ Ý không chạm `ringing` (việc của `CHAT_CALL_RINGING_TIMEOUT`) — gặt `ringing` thành `ended` là ghi "đã kết thúc" cho một cuộc gọi CHƯA AI BẮT MÁY; (3) độ trễ mở khoá tối đa = 1 nhịp scheduler (mặc định 60s) sau khi ngưỡng chín — đây là job, không phải đường đồng bộ | S3 | Realtime (vòng đời cuộc gọi) | ❌ | ❌ (CHAT `is_active=false`) | **ĐÓNG 2026-08-21** — `S10-CHAT-CALLSWEEP-1` |
| ~~**KI-062**~~ | **MỞ VÀ ĐÓNG CÙNG NGÀY 2026-08-12.** **Giám sát vận hành mù với MỌI mặt PROD ngoài API :3100 — `fbpost` :3500 chết 500 suốt ~15 tiếng (11–12/08) mà 8/8 nhóm cảnh báo vẫn xanh/warn.** Cơ chế sự cố: `next dev` chạy trong `apps/fbpost` **ghi đè chính `.next`** mà NSSM `MediaOS-Social` (`next start`) đang phục vụ ⇒ bundle `devtool:'eval'` ⇒ middleware chạy trên **edge runtime, nơi cấm sinh mã từ chuỗi** ⇒ `EvalError: Code generation from strings disallowed` ở mọi request, kể cả `/login` và cả đường dẫn không tồn tại, qua cả `localhost:3500` lẫn domain. **Khuyết tật được ghi số hiệu ở đây KHÔNG phải sự cố đó mà là sự MÙ:** `scripts/ops-alert-check.mjs` chỉ dò `OPS_BASE_URL` = API :3100, nên `fbpost` :3500 và LMS :3400 — hai **dịch vụ NSSM riêng, chết độc lập** — chưa từng có một phép đo nào. Ba chỉ báo vận hành duy nhất đều nói dối theo đúng nghĩa đen: `Get-Service` = `Running` (tiến trình `next start` vẫn sống, nó chỉ phục vụ bundle hỏng), `social.out.log` in `▲ Next.js 15.5.22` + `✓ Ready in 717ms` mỗi lần boot (Next báo Ready TRƯỚC khi có request nào chạm middleware), và `ops-alert-check` **im lặng** — không phải vì đo thấy tốt mà vì **không đo**. Đây chính xác là chế độ hỏng mà `scripts/lib/ops-alert-rules.mjs` được viết ra để chống ("thiếu dữ liệu ≠ bình thường"), nhưng luật nền đó chỉ bảo vệ những gì ĐÃ nằm trong danh sách đo — nó không tự biết có thứ nằm ngoài danh sách. **Bản vá:** thêm 3 rule. #9/#10 dò **hành vi HTTP thật** của trang công khai (`:3500/login` · `:3400/login`) với `redirect: "manual"` — cố ý không follow, vì để `fetch` tự đi theo thì một trang công khai bị cổng phiên đá về `/login` vẫn hiện "200 ok" (đúng chế độ hỏng đã cắn 12/08 với hai trang chính sách Meta); ≥500 hoặc `ECONNREFUSED`/timeout ⇒ `crit`, 3xx/4xx hoặc 200-mất-dấu-nhận-dạng ⇒ `warn`. #11 dò **nguyên nhân** thay vì hiện tượng: `.next/static/development` hoặc `webpack` + đếm `eval(` trong bundle middleware, đường dẫn lấy **từ `middleware-manifest.json`** chứ không đoán (fbpost dùng nhánh `server/src/middleware.js` vì nguồn ở `src/`, LMS dùng nhánh `server/middleware.js` — đoán mò là sai một trong hai) ⇒ bắt được TRƯỚC khi thành 500 và chỉ thẳng thủ phạm. **Danh sách trang dò RỖNG hoặc `OPS_SITES` rác ⇒ `unknown`, không bao giờ ra xanh** — vì "không dò gì" chính là hình dạng của lỗi này. **Nghiệm thu bằng cách BẺ HỎNG, không bằng cách nhìn xanh:** 8 chế độ hỏng dựng lại thật (trang 500 → `crit` exit 2 · cổng đóng → `crit` exit 2 · 200-trang-trắng → `warn` · 307 → `warn` · `.next/static/development` → `crit` · bundle `eval(` → `crit` exit 2 · chưa build → `unknown` · `OPS_SITES=[]`/rác → `unknown`), 63/63 test đơn vị + 118/118 tooling-tests. **Bằng chứng:** `docs/RELEASE/RELEASE-09` §3. ⚠️ **Ranh giới — đừng đọc thành "fbpost giờ an toàn":** bản vá chỉ **PHÁT HIỆN**, nó KHÔNG ngăn ai chạy `next dev` trên máy PROD; rào chặn đó vẫn là kỷ luật con người. Và luật gốc vẫn còn nguyên: **thêm một mặt PROD mới mà không thêm vào `DEFAULT_SITES` thì nó lại sập âm y hệt** | S2 | Vận hành (giám sát) | — | — | **ĐÓNG 2026-08-12** |
| ~~KI-001~~ | ~~Tài khoản `uat.*` chưa gắn hồ sơ nhân viên~~ — **ĐÃ ĐÓNG 2026-07-26** | S2 | Dữ liệu | — | — | ✔ xong |
| ~~KI-002~~ | ~~Chưa có số dư phép trong công ty `demo`~~ — **ĐÃ ĐÓNG 2026-07-26** | S2 | Dữ liệu | — | — | ✔ xong |
| KI-003 | Loại nghỉ phép có 3 bản trùng chữ thường | S3 | Dữ liệu | ❌ | ❌ | Owner/HR |
| KI-004 | Chưa nhập ngày lễ | S3 | Dữ liệu | ❌ | ⚠️ | Owner/HR |
| KI-005 | Widget "Thông báo" trên dashboard trễ tối đa ~10s | S3 | Sản phẩm | ❌ | ❌ | Sprint 6 |
| KI-006 | LMS→NOTI chưa hoạt động — **migration `0529` ĐÃ áp cho cả PROD+UAT 2026-07-26**; còn thiếu `LMS_NOTI_TOKEN` + deploy | S2→S3 | Vận hành | ❌ | ✅ | Owner/DevOps |
| KI-007 | CI `Security / Dependency scan` đỏ do lỗi công cụ | S3 | CI | ❌ | ⚠️ | Owner/DevOps |
| ~~KI-008~~ | **ĐÓNG 2026-07-29** — `S6-PERF-DB-1` (#307). Drill KHÔNG chạy được kể từ khi Postgres vào container (thiếu pg client trên PATH host); đã vá bằng fallback `DRILL_PSQL`/`DRILL_PG_DUMP`/`DRILL_PG_RESTORE` qua `docker exec`, rồi chạy THẬT: dump → restore DB tạm → verify chuỗi migration + schema/RLS/index → tự dọn = **PASS** (`DEVOPS-13` §3.1). ⚠️ **KHÔNG kéo theo "đã có backup"** — drill tự `pg_dump` tại chỗ; chuyện chưa hề có bản backup định kỳ nào là **KI-050** riêng | S2 | Vận hành | — | — | ✔ xong |
| ~~KI-009~~ | ~~Log chưa có cấu trúc JSON~~ — **ĐÓNG 2026-08-13** (`S10-FND-JSONLOG-1`) | S3 | Quan sát | — | — | ✔ xong |
| KI-010 | Endpoint cũ `GET /employees` chưa phân trang thật (mới chặn bằng cap 2000) | S3 | Sản phẩm | ❌ | ❌ | Sprint 6 |
| ~~KI-011~~ | **ĐÓNG 2026-07-30** — `S6-REL-1`. `scripts/ops-alert-check.mjs` đo THẬT 8 nhóm (backend down · DB readiness đọc BODY vì /health/db fail-soft · **lệch migration** · job Failed · dòng lỗi log · đĩa · tuổi backup · hạn TLS), quyết định ở `scripts/lib/ops-alert-rules.mjs` — **44 test**, và test ĐƯỢC CHẠY (step `tooling-tests` trong `harness/check.sh` + job trong `api.yml`; trước đó test của `scripts/`+`harness/` nằm ngoài vitest workspace nên mồ côi). Luật nền: **thiếu dữ liệu ⇒ `unknown`, KHÔNG phải `ok`** ⇒ exit ≠ 0 — chính luật này bắt ra KI-050 ngay lần chạy đầu. Rule KHÔNG đo được (5xx theo module · login-fail spike · 403 spike · slow query) ghi thẳng "KHÔNG ĐO ĐƯỢC" ở `RELEASE-09` §2, không tick khống. ⚠️ **cần deploy**: owner phải đăng ký scheduled task (`RELEASE-09` §4) thì cảnh báo mới tự chạy | S2 | Vận hành | — | ⚠️ cần đặt lịch | **ĐÓNG** — `S6-REL-1` |
| KI-012 | Accepted-risk **D3**: widget headcount count-only xuyên phòng ban cho HR scope Department | S3 | Bảo mật (đã chấp nhận) | ❌ | ⚠️ cần chữ ký | Owner |
| KI-013 | `refresh` / `resetPassword` không throttle (theo thiết kế, có mitigation) | S3 | Bảo mật (theo thiết kế) | ❌ | ❌ | — |
| ~~KI-014~~ | **ĐÃ ĐÓNG 2026-07-27** (`S6-QA-CHUNK-1`) — truy được gốc: **bug ngược dòng `tinypool@1.1.1`**, `ProcessWorker.send()` chỉ chặn `isTerminating` chứ không kiểm tra kênh IPC đã đóng. **Ba đính chính so với mô tả cũ:** (1) KHÔNG phải "máy bất ổn ngẫu nhiên" — `pnpm test` đỏ **5/5**, tái hiện 100%; (2) KHÔNG phải file/suite thủ phạm — package nạn nhân đổi mỗi lần chạy (kể cả `console` 23 file, `web-core` 39 file); (3) KHÔNG phải lệch Node 24-local vs 22-CI — **Node 22 vẫn crash**; CI xanh vì runner chỉ 2–4 nhân ⇒ 1–3 worker, còn máy này 32 nhân ⇒ 31 worker/package. Vá = `harness/chunk-test.mjs` (chia chunk + hạ trần worker + chạy lại **chỉ** chunk chết vì hạ tầng), `check.sh` dùng trên Windows, CI giữ đường một-lần. Verify: `LANE_DB=mediaos_qachunk bash harness/check.sh --all` → **XANH** (lint+typecheck+test+build), **761/761 file spec** đối chiếu `vitest list`. Số đo đầy đủ: `docs/QA/evidence/S6-QA-CHUNK-1-KI-014-ROOT-CAUSE.md` | S2 | Hạ tầng test (local) | — | — | ✔ xong |
| ~~KI-015~~ | **ĐÓNG 2026-08-13** (`S10-QA-LOGNOISE-1`, qua 3 vòng — lần đóng đầu bị Đội 3 bác vì màn hình vẫn in nhiễu) — truy GỐC bằng đo thật: nguồn DUY NHẤT là `chat-noti-e2e.int-spec.ts` ca 14 — spec CỐ Ý gieo payload lỗi để chứng minh bridge KHÔNG được im lặng nuốt hợp đồng lệch, ĐÃ tự assert dead-letter ⇒ hành vi ĐÚNG-nhưng-ồn, không phải lỗi; nay ĐÃ vá TẠI NƠI PHÁT bằng `withExpectedLoggerErrors` (assert đúng số dòng, không bịt miệng toàn cục) ⇒ đo lại (LANE_DB cô lập riêng, 20 file/381 test `*noti*int-spec.ts`) = **0 dòng nhiễu**, không còn nợ cosmetic. Chi tiết ở mục dưới | S3 | Vệ sinh test | ❌ | — | **ĐÓNG** — `S10-QA-LOGNOISE-1` |
| ~~KI-016~~ | **ĐÓNG 2026-07-30** — `S6-REL-1`. Mỗi build nay đóng băng thành `apps/api/releases/<stamp>` (BẤT BIẾN), service trỏ junction `releases/current`; `m dev-online` biên dịch lại `dist` KHÔNG còn chạm được bản PROD đang chạy. Kèm theo là **đường rollback ứng dụng đầu tiên** của dự án (`m prod-rollback`) — trước đây `dist` bị ghi đè mỗi lần build nên không có bản trước để quay về. Vị trí thư mục là RÀNG BUỘC KỸ THUẬT: phải nằm TRONG `apps/api` để `node_modules` phân giải đi lên trúng `apps/api/node_modules` (pnpm isolated, KHÔNG hoist) — đã chứng minh bằng resolver thật + boot artifact trên DB lane, không bằng lý luận. ⚠️ **cần deploy**: `m prod-cutover` (Administrator) MỘT LẦN; `m prod-status` cảnh báo LOUD khi service còn trỏ `dist` | S2 | Hạ tầng | — | ⚠️ cần cutover | **ĐÓNG** — `S6-REL-1` |
| ~~KI-017~~ | ~~Refresh materialized view dashboard qua `workerDb` hỏng từ G14 ("must be owner")~~ — **ĐÃ ĐÓNG** (2 nửa, 2 WO): privilege ở `S6-SEC-MV-1` (mig 0534, 29/07/2026), lịch chạy ở `S10-DASH-MVREFRESH-1` (2026-08-13) | S3 | Sản phẩm (ngủ) | — | — | **ĐÓNG 2026-08-13** — `S10-DASH-MVREFRESH-1` |
| KI-018 | Dữ liệu demo có trạng thái đơn nghỉ lẫn hoa/thường | S3 | Dữ liệu | ❌ | ❌ | Sprint 6 |
| KI-019 | Chỉ 1 ca làm việc + 1 quy tắc chấm công + 0 phân ca trong DB UAT | S3 | Dữ liệu | ❌ | ❌ | Owner/HR |
| KI-020 | Chưa có dữ liệu GOAL để nghiệm thu | S3 | Dữ liệu | ❌ | ❌ | Owner |
| KI-021 | 3 sự kiện NOTI của ATT bật trong danh mục nhưng **không có producer** (`ATT_MISSING_CHECKOUT` · `ATT_LATE_DETECTED` · `ATT_ABSENT_DETECTED`) | S2 | Sản phẩm | ✅ | ✅ | ĐÓNG `S10-ATT-NOTIPROD-1` 2026-08-15 |
| ~~KI-022~~ | ~~`outboxOf` trong `goal-be2-link.int-spec` không lọc `company_id` ⇒ đỏ-giả ngẫu nhiên~~ — **ĐÃ ĐÓNG 2026-07-26** (`S6-STAB-1`) | S1 | Hạ tầng test | — | — | ✔ xong |
| ~~KI-023~~ | ~~Đua teardown `audit_logs → companies` trong `cleanupTenants` ⇒ đỏ-giả ngẫu nhiên~~ — **ĐÃ ĐÓNG 2026-07-26** (`S6-STAB-1`) | S1 | Hạ tầng test | — | — | ✔ xong |
| ~~KI-024~~ | ~~`foundation-audit.e2e-spec` dùng `action` cố định + đếm tuyệt đối ở System scope ⇒ đỏ-giả **vĩnh viễn** sau một lần chạy bị ngắt~~ — **ĐÃ ĐÓNG 2026-07-26** (`S6-QA-FINAL-1`) | S1 | Hạ tầng test | — | — | ✔ xong |
| KI-025 | **≥116/499 đường dẫn API (≥23,2%) không có bằng chứng test HTTP nào chạm** (đo lại **18/08** bằng `route-http-coverage.e2e-spec.ts` sau khi `S10-QA-ROUTEHTTP-2` land; mốc trước: ≥129/499 ngày 14/08, và 98/346 là số CŨ đã bỏ). **Nhóm rủi ro cao đã đóng: route risk≥5 chưa phủ = 0** (12 → 0) và ratchet `MAX_UNCOVERED_HIGH_RISK` **siết từ 12 xuống 0** ⇒ thêm route risk≥5 không test là ĐỎ ngay tại PR. Giữ **S2**: 23,2% đường dẫn vẫn chưa có bằng chứng nào, đóng hay hạ mức là kết luận của SỐ chứ không phải mong muốn. ⚠️ Số "đã phủ" **383/499 (76,8%) là CẬN TRÊN, không phải số sự thật** — scan khớp verb-set × path-set ở **cấp FILE**, không cấp câu lệnh, và "chạm" không chứng minh có ca ALLOW ⇒ sai số dồn về phía false-positive "covered" ⇒ độ phủ THẬT ≤ 74,1% và **129 là cận DƯỚI của khoảng trống thật**. Rủi ro: phủ ở tầng service nên guard/DTO/envelope của route chưa từng chạy. Đợt 14/08 phủ HTTP thật **5 route risk≥5 (đều có ca ALLOW 2xx thật) + 2 route risk=3** — đính chính câu "5/18 route risk≥5" của vòng trước, xem §KI-025; `PATCH /settings/security-policy` **KHÔNG tính đã phủ** (route chết, chỉ có ca ghim 403 — **KI-065**; **KI-065 ĐÓNG 19/08/2026 ⇒ route này nay CÓ ca ALLOW 2xx thật và tính là đã phủ**). **Đợt 18/08 (`S10-QA-ROUTEHTTP-2`) đóng nốt 12 route risk≥5 còn nợ** — `users/invite` · `api-keys` create/revoke · `auth/users/:id` password-reset/restore/soft-delete · `permissions` assign-role/revoke-role/object-grant PUT+DELETE · `auth/roles/:id` delete/revoke-permission — mỗi route có ca ALLOW 2xx chứng minh bằng HỆ QUẢ + DENY 403 + DTO 400 ở biên + cross-tenant 404 (49 ca, 3 file `invite-apikeys-http` · `authusers-admin-http` · `permadmin-roles-http`). Nợ còn lại là nhóm risk≤3 | S2 | Độ phủ test | ❌ | ❌ | WO `S10-QA-ROUTEHTTP-2` ✅ |
| ~~KI-026~~ | ~~Nhãn `[BLOCKED — service.ts bug]` + chú thích "KNOWN BROKEN" nằm trên một test ĐANG XANH (`attendance-adjustment.int.spec.ts`) — bug đã sửa cùng PR #81 nhưng chú thích không gỡ~~ — **ĐÃ ĐÓNG 2026-07-26** (`S6-QA-FINAL-1`) | S3 | Vệ sinh test | — | — | ✔ xong |
| ~~**KI-027**~~ | **ĐÃ ĐÓNG 2026-07-28** — verify cả 3 lớp trên PROD: (1) `TWO_FACTOR_ENFORCEMENT_ENABLED=true` ở **cả** `.env` lẫn `.env.prod` (sửa 27/7 08:36) và service `MediaOS-API` boot lúc **28/7 08:49** ⇒ guard đọc cờ MỚI, ép đang SỐNG; (2) `roles.requires_two_factor=true` cho `company-admin` + `platform-admin`; (3) `admin@funtimemediacorp.com` **đã enroll TOTP** (`user_totp.enabled_at` khác NULL) ⇒ không có cửa sổ tự-khoá. ~~2FA KHÔNG được ép ở PROD cho `company-admin`~~ | **S1** | Bảo mật (cấu hình) | ✅ | ✅ | **ĐÓNG** |
| ~~**KI-028**~~ | **ĐÃ ĐÓNG 2026-07-28 — `S6-SEC-DBFENCE-1`: bịt NGUỒN RÒ trước, purge sau, cắm chốt hồi quy.** *Lần đóng 27/7 chỉ dọn rác nên rác mọc lại gấp 4,6 lần trong 2 ngày; lần này khác ở chỗ có hàng rào + chốt.* **Chẩn đoán lại — có HAI vector, không phải một** (truy nguyên 72/74 company về đúng spec sinh ra chúng qua tiền tố slug ↔ đối số `label` của `seedCompany`): **V1** spec chỉ gate `hasDb` chạy khi thiếu `LANE_DB` → 58 company; **V2** spec ĐÃ gate `LANE_DB` vẫn ghi vào `mediaos` (LANE_DB=mediaos, hoặc `DATABASE_URL` tường minh thắng precedence) → 14 company. ⇒ **sự có mặt của `LANE_DB` chưa bao giờ là thuộc tính an toàn — TÊN DB ĐÍCH mới là**; đó là lý do vá không nằm ở 56 file spec mà ở resolver. **Vector thứ 3 lộ ra khi vá:** `src/db/check.ts` gọi `main()` ở top-level và `check.spec.ts` import nó ⇒ **mỗi lần chạy unit test là một lần `migrate()` chạy trên DB PROD**, im lặng (nay chốt `require.main === module`). **Hàng rào 3 lớp:** L1 `test/db-target.ts` fail-closed (thiếu LANE_DB ⇒ 3 URL RỖNG ⇒ int-spec SKIP, hết fallback `"mediaos"`; đích ∈ {`mediaos`,`mediaos_dev`} ngoài CI ⇒ THROW) · L2 `test/global-setup.ts` đòi **con dấu `COMMENT ON DATABASE = 'mediaos-test-lane'`** nằm TRONG database — không giả được bằng env, phủ cả 266 file spec ở MỘT chỗ · L3 `scripts/check-prod-test-tenants.mjs` (nối vào `check.sh --all`) đếm tenant test trong PROD, ≠0 ⇒ ĐỎ. **Bằng chứng:** chạy TRỌN suite 449 file api không `LANE_DB` ⇒ **0 company mới** (75→75, trước đây sinh hàng chục) · lane DB chưa đóng dấu ⇒ từ chối chạy, đóng dấu ⇒ 459 test xanh · 19 unit RED-proof cho L1. **Purge (owner duyệt, có dump `mediaos-pre-purge-20260728.dump`):** dry-run ROLLBACK trên chính PROD pass trước, rồi chạy thật — **56.269 dòng theo `company_id` + 74 company + 13 mồ côi (quét tới điểm bất động)**; chốt trước/sau + **quét toàn vẹn FK toàn schema = 0 tham chiếu treo**. **SAU:** company khớp mẫu test **0** · user test active **0** · **0** grant `platform-admin` còn lại · token sống của tenant test **0** · `funtime` **46 user (35 active + 11 locked), 0 dòng bị chạm** (46/46 user ID trùng **byte-for-byte** với dump) · dòng toàn cục **402 → 402** · **0** tham chiếu treo/635 FK · `check-prod-test-tenants.mjs` exit **0**. **FULL gate 2× PASS và cả hai tìm ra lỗ thật:** `security-reviewer` bịt 6 lỗ **trong chính hàng rào** (đáng kể nhất **F-1**: có URL tường minh mà thiếu `LANE_DB` ⇒ URL dựng với tên DB rỗng `…:5432/`, libpq resolve về **tên role** = `mediaos` = PROD và nối THÀNH CÔNG trong khi denylist mù; **F-3**: `lane-db-setup.sh dev` sẽ đóng dấu vĩnh viễn lên `mediaos_dev` = tháo lớp chốt cuối; **F-2**: L2 fail-OPEN khi không nối được DB) — tất cả đã vá + có test. `rls-tenant-isolation-tester` xác nhận RLS nguyên vẹn (diff `--schema-only` trước/sau = **rỗng**; 155 ENABLE · 155 FORCE · 172 POLICY · 17/17 trigger BẬT) nhưng **bác tuyên bố "PROD sạch 100%"**: còn **20 dòng tenant đã xoá trong 2 matview** (`mv_dashboard_output` 11 · `mv_dashboard_task_status` 9) — Postgres **không hỗ trợ RLS trên matview** và purge không `DELETE` được trên đó; **2/7 `company_id` ma không có cả trong dump 28/7 ⇒ tồn dư từ đợt dọn 27/7, chưa đợt nào từng chạm matview**. Đã `REFRESH MATERIALIZED VIEW` (role OWNER) ⇒ **0 dòng ma**, và L3 nay đếm luôn vế này (xem KI-041). ~~**MỞ LẠI 2026-07-28 — containment 27/7 chỉ phủ 16/74 tenant.**~~ Đo lại trên PROD `mediaos`: **74/75 company khớp mẫu tenant test, 0 soft-delete** (16 tạo 24/7 = đúng tập đã xử lý; **58 tạo 26/7 chưa ai chạm**); **226 user `active`**, trong đó **55 có hash argon2/bcrypt THẬT (đăng nhập được)** và **33 giữ role TOÀN CỤC** — giao của hai tập: **13 `company-admin` + 5 `platform-admin` vừa đăng nhập được vừa có role toàn cục**. Hai số verify của lần đóng ("user test còn active = 0", "operator-grant ngoài funtime = 0") **nay đều sai**. Nguồn rò CHƯA bịt: `apps/api/vitest.config.ts:11` lấy `LANE_DB ?? "mediaos"` ⇒ spec chỉ gate `hasDb` (vd `tenant-isolation.int-spec`) ghi thẳng vào DB PROD; run crash (KI-014) bỏ `afterAll` cleanup. **Giảm nhẹ:** email mang hậu tố ngẫu nhiên mỗi lần chạy (không có trong repo) nên không đoán được từ bên ngoài; funtime nguyên vẹn (46 user: 35 active + 11 locked), không có dấu hiệu chạm chéo tenant. ~~ĐÃ ĐÓNG 2026-07-27 (owner chạy `scripts/s6sec1-contain-test-tenants.sql`)~~ — mật khẩu `Passw0rd!test99` có trong 86 file của repo PUBLIC (đã verify argon2 trên hash PROD) | **S1** | Bảo mật | ✅ | ✅ | **ĐÓNG 2026-07-28** — `S6-SEC-DBFENCE-1` |
| ~~**KI-032**~~ | ~~**Tenant admin XOÁ được `role_permissions` của role hệ thống TOÀN CỤC**~~ — **ĐÃ ĐÓNG 2026-07-27** (mig `0530` RESTRICTIVE FOR DELETE + gỡ `DELETE ON roles` + guard `isSystem` ở 2 hàm; RED→GREEN 6/6). **`0530` ĐÃ áp cho PROD** — verify: policy `role_permissions_no_delete_system` cmd=`d` permissive=`f`, grant app trên `roles` = `INSERT,SELECT,UPDATE` (hết `DELETE`). — RLS `USING` cho `company_id IS NULL` mà **DELETE không xét `WITH CHECK`**; service thiếu guard `isSystem`. Ghi chéo tenant, **INSERT khôi phục bị chặn ⇒ không hoàn tác qua app**. PROD: 785 grant toàn cục, `funtime` dùng 2 role toàn cục | **S0** | Bảo mật | ✅ | ✅ | **Owner — GẤP** |
| ~~KI-033~~ | **ĐÃ VÁ 2026-07-27** — thêm audit in-tx cho **CẢ HAI** endpoint report. *Đính chính phạm vi so với bản gate:* không phải "leave lạc đàn giữa hai sibling cùng cổng" — `attendance-report` cũng không audit, và nó gate bằng `view-company:attendance` chứ **không** phải `export`. Đúng là: 2 bản CSV có audit, 2 bản report JSON thì không | S1 | Bảo mật (audit) | — | — | ✔ xong |
| ~~KI-034~~ | **ĐÓNG 2026-07-28** — `S6-SEC-NOTITX-1`. `NotificationsService.create` nay mở **MỘT** `withTenant` bọc cả insert + `outbox.enqueue` + `audit.record` (`repo.create`/`repo.markRead` nhận `tx?`); **gỡ cả hai `.catch` nuốt lỗi**, WS emit chỉ chạy SAU commit. `markRead` **gộp luôn** (không giữ best-effort) — lý do đầy đủ ở `docs/plans/S6-SEC-NOTITX-1.md` §5. Nhánh nuốt lỗi **thứ ba** phát hiện khi thi công: `insert` trả 0 hàng từng `logger.error` rồi trả `null`, trộn lẫn với `null` hợp lệ của "bị preference lọc" ⇒ nay **ném**; `null` chỉ còn MỘT nghĩa. **⚠️ Đính chính tiền đề của KI gốc:** mô tả "đường nóng mọi module gọi" **đã SAI từ S4** — đo lại: `NotificationsService.create` có **0 caller production**; `OutboxNotificationBridge` đi `NotificationEngineService.intake()`, vốn **đã atomic sẵn** (một `withTenant`, lỗi non-dedupe `throw`, không `.catch`). Bán kính runtime của vá này = **0**; giá trị = bịt API công khai mà module khác có thể wire vào ngày mai. **RED-first**: 7 ca ĐỎ trên code cũ (outbox ném · audit ném · không-emit-khi-hỏng · cùng-một-tx · insert-0-hàng · markRead ×2), 2 ca hồi quy xanh cả hai phía ⇒ không phải "đỏ vì mọi thứ đều đỏ". **Hồi quy**: `src/notifications/**` 85/85 · `src/events`+`src/realtime` 62/62 · suite **449/449 file chạy** dưới `LANE_DB` — ⚠️ chỉ chạy được bằng **đường vòng tay** của KI-045 (3 URL tường minh), KHÔNG bằng `harness/check.sh --all`; mỗi lần chạy còn 1 đỏ TRÔI (khác test mỗi lần) nhưng **baseline `master` cho kết quả y hệt** ⇒ flake sẵn có, không do WO này. **FULL gate**: `security-reviewer` PASS 0-CRIT/0-HIGH (tự kiểm chứng độc lập 0-caller + RLS `0010:33-35` + `object_type='notification'` có trong CHECK union `0090_g12:49`); 2 MEDIUM về docstring đã vá trong cùng PR | S1 | Bảo mật (audit) | ✅ | ⚠️ cần deploy | **ĐÓNG** — `S6-SEC-NOTITX-1` |
| ~~KI-035~~ | **ĐÃ VÁ 2026-07-27** + **HẠ MỨC S1 → S3**. *Hai claim của gate đều SAI, đã tự kiểm chứng:* (1) nhánh `if (!db) return;` chỉ chạy cho login **THẤT BẠI pre-auth** (`companyId: null` ở `:202`/`:222`) — hai đường login **thành công** (`:375`/`:507`) đều truyền `companyId` thật nên đi nhánh `withTenant`, KHÔNG có chuyện "cấp token mà không có log"; (2) `emitAccountLocked` **có** log ERROR đầy đủ trong catch (chú thích tại chỗ ghi rõ "KHÔNG nuốt câm"). Lỗi thật còn lại: chỗ bỏ ghi đó **im lặng tuyệt đối** ⇒ đã thêm `logger.warn` | S3 | Bảo mật (quan sát) | — | — | ✔ xong |
| ~~KI-036~~ | ~~`.env.example:91` ship `TWO_FACTOR_ENFORCEMENT_ENABLED=false`~~ — **ĐÃ VÁ 2026-07-27** (đổi thành `true` + cảnh báo thứ tự thao tác) — `cp .env.example .env` là bước cài chuẩn ⇒ **gốc rễ tái diễn** của KI-027 ở mọi deploy mới | S2 | Bảo mật (cấu hình) | ❌ | ⚠️ | WO mới |
| ~~KI-038~~ | **ĐÃ ĐÓNG 2026-07-27** — mig `0531` **đã áp cho PROD** (verify: 2 trigger `enforce_company_id_immutable` trên `notification_%`, `tgenabled='O'`; 199 migration applied) — **cùng họ lỗi với KI-032, trên hai bảng khác**: `notification_events` (59 hàng toàn cục PROD) + `notification_templates` (45) cho phép một tenant `UPDATE … SET company_id=<mình> WHERE company_id IS NULL` ⇒ **cướp trọn danh mục NOTI dùng chung**, commit được, **không hoàn tác qua app**; mọi tenant khác mất catalog ⇒ không tạo nổi thông báo. Hai reviewer độc lập cùng tìm ra ở vòng re-gate. Vá = gắn trigger `enforce_company_id_immutable` (mig 0436) | **S0** | Bảo mật | — | — | ✔ xong |
| ~~KI-039~~ | **ĐÃ VÁ 2026-07-27** — `rls-coverage-assert` assert (b) chỉ kiểm **chuỗi** (`WITH CHECK` có nhắc GUC là xanh) nên **mù** với lớp lỗi KI-038. Thêm **assert (c)**: bảng vừa có khe hở `IS NULL` trong `USING` vừa cho app role `UPDATE` thì bắt buộc phải có trigger bất biến. Đã chứng minh đỏ khi gỡ trigger | S2 | Độ phủ test | — | — | ✔ xong |
| ~~KI-040~~ | **ĐÃ VÁ 2026-07-27** — assertion cô lập tenant mà **chính WO này viết** khi vá KI-033 **không thể đỏ được** (`filter(includes("tenant A"))` không khớp fixture nào); reviewer chứng minh spec vẫn 11/11 xanh giữa một vụ rò audit chéo tenant thật. Đã khôi phục đếm tuyệt đối + nghiệm thu bằng cách gieo policy rò (4 case đỏ) | S1 | Độ phủ test | — | — | ✔ xong |
| ~~**KI-041**~~ | **ĐÃ ĐÓNG 2026-07-29 — `S6-SEC-MV-1` (mig 0534): ranh giới chuyển từ kỷ luật service xuống TẦNG DB.** Matview `mv_dashboard_output`/`mv_dashboard_task_status` mang `company_id` nhưng **Postgres không hỗ trợ RLS trên matview** ⇒ nằm ngoài phép đo 153/153. **Vế RED đo được (lane, 2026-07-29):** role `mediaos_app` chạy `SELECT count(*), count(DISTINCT company_id) FROM mv_dashboard_task_status` KHÔNG mệnh đề lọc ⇒ **56 hàng / 38 tenant** — ranh giới duy nhất là `WHERE company_id = $1` viết tay trong service. **Cách vá (owner chốt "wrapper view + REVOKE"):** REVOKE SELECT trên CẢ HAI matview khỏi `mediaos_app`+`mediaos_worker`; app đọc qua view `security_barrier` `v_dashboard_task_status`/`v_dashboard_output` tự lọc `current_setting('app.current_company_id')` (biến `withTenant()` set), fail-closed 0 hàng ngoài ngữ cảnh. Vế `WHERE company_id` trong service GIỮ NGUYÊN làm đai thứ hai. **KHÔNG DROP `mv_dashboard_output`** dù là họ media-era park: CLAUDE.md §1 chốt "không xóa ở đợt này" và `docs/DB/` không có dòng nào xác nhận park ⇒ điều kiện DROP không thoả. *Đính chính tiền đề WO: nó KHÔNG "0 consumer" — `GET /dashboard/mv-stats` (gate `read:dashboard`) trả CẢ hai nửa; chỉ chưa màn hình nào gọi.* **Đường refresh CHẾT từ G14 cũng đã sửa cùng WO (done_when #5):** đo lại — `mediaos_worker` → REFRESH ⇒ `permission denied`, `mediaos` (owner) → OK và làm **56→54 hàng / 38→37 tenant** ⇒ dữ liệu đã cũ THẬT. Vá bằng hàm `refresh_dashboard_mvs()` **SECURITY DEFINER** owner=`mediaos` (CÓ BYPASSRLS), worker chỉ EXECUTE, `search_path` chốt cứng; **cấm** `ALTER … OWNER TO mediaos_worker` (thiếu BYPASSRLS ⇒ MV **rỗng lặng lẽ**). **Bằng chứng:** 13 ca `dashboard-mv-tenant-barrier.int-spec.ts` xanh; **RED-proof chạy thật** — khôi phục grant cũ trên lane ⇒ đúng 3 ca đỏ, REVOKE lại ⇒ xanh; ca "MV không bị làm rỗng sau refresh" khoá đúng cái bẫy đổi-owner | **S2** | Bảo mật | ✅ | ✅ | **ĐÓNG 2026-07-29** — `S6-SEC-MV-1` |
| ~~KI-042~~ | **ĐÓNG 2026-07-28** — `S6-SEC-LOGINLOG-1`, migration `0532`. Vế `USING` của policy `tenant_isolation` bỏ `OR company_id IS NULL`; `WITH CHECK` giữ **nguyên văn** 0443 và grant append-only (`mediaos_app: SELECT,INSERT` · `mediaos_worker: SELECT`) giữ nguyên. **Lỗ nặng hơn mô tả gốc**: không chỉ đọc chéo khi đứng trong tenant — **NGOÀI mọi ngữ cảnh tenant** app role vẫn đọc được toàn bộ hàng NULL, vì `OR company_id IS NULL` đúng vô điều kiện. **Đo PROD (read-only)**: 314 hàng = 46 attributed + **268 NULL-tenant** (165 `blocked/TooManyAttempts` + 103 `failed/CompanyInactive`), phơi 5 email + 5 IP; N=1 company nên **ảnh hưởng sống = 0**, sửa trước khi mở tenant thứ hai. **Mô hình đọc đã chốt** (docs/DB-02 §7.8): hàng NULL = telemetry pre-auth VÔ CHỦ, không tenant nào đọc được qua đường ứng dụng, chỉ superuser đọc trực tiếp cho forensics; **không xoá dữ liệu** (268 hàng còn nguyên). **Gốc rễ = lỗi chép khuôn** từ `public_holidays` (0434) — ở đó hàng NULL là ngày lễ toàn quốc dùng chung có chủ đích, ở `login_logs` là dấu vết bảo mật người lạ. **Ba lớp test đang ĐÓNG ĐINH lỗ hổng đã bị đảo**: `login-logs-rls (d)` từng assert `toContain("preauth@…")`; `rls-registry` để `skipNoContext: true` (che đúng lỗ này khỏi lưới an toàn cả dự án **suốt từ S2** — nay `login_logs > ngoài ngữ cảnh → 0 row` CHẠY THẬT lần đầu). ⚠️ FULL gate bắt được rằng **bỏ miễn trừ THÔI là xanh vô nghĩa**: `seedRow` chỉ gieo hàng attributed, mà dưới policy CŨ đọc không-GUC chỉ trả về hàng NULL ⇒ 0 row ở cả hai phía, không bao giờ ĐỎ (đã đo: `count = 0`). Đã vá bằng cách gieo thêm hàng `company_id IS NULL` (marker) + dọn trong `cleanupTenants`; chứng minh lại: hoàn nguyên policy ⇒ `tenant-isolation` **1 failed/453 passed**, đỏ đúng ca đó; `me-security-activity` từng assert row `company NULL + user A` **phải hiện** — hình dạng row **không thể sinh ra từ code**. **Bẫy đã đo & ghim 3 lớp**: Postgres áp policy SELECT lên `RETURNING`, nên `INSERT … (NULL,…) RETURNING` bị từ chối trong khi INSERT thường vẫn chạy; đường ghi thật không dùng `.returning()` — thêm vào sẽ **giết log pre-auth trong im lặng** (lỗi bị nuốt vào nhánh best-effort). **RED-first**: hoàn nguyên policy về bản 0443 ⇒ đúng 3 ca deny mới ĐỎ, 5 ca cũ xanh cả hai phía (không nới vế ghi). **Hồi quy**: 8/8 + 10/10 + 6/6 + 16/16 + 6/6 + 5/5, `tenant-isolation` **454 passed/11 skipped**, chain `0000→0532` áp sạch trên DB lane **dựng mới** (200 migration) | S3 | Bảo mật | ✅ | ⚠️ cần deploy | **ĐÓNG** — `S6-SEC-LOGINLOG-1` |
| ~~KI-044~~ | **ĐÓNG 2026-07-29** — `S6-SEC-LOGINLOG-2`. **KHÔNG có migration** (thuần code; head vẫn `0533`) và **KHÔNG nới lại vế `USING`** của `tenant_isolation` — vá đúng chỗ gốc: nhánh 429 nay resolve chủ **BÊN TRONG** thân nhánh rồi mới ghi, nên hàng `blocked/TooManyAttempts` với slug HỢP LỆ mang `company_id` THẬT. **Không đảo thứ tự đường login** ⇒ request KHÔNG bị chặn không tốn thêm một lượt tra DB nào (đây là biến thể của `done_when #1`, **ngược** với nguyên văn "chỉ resolve khi đã qua chặn thô" — chọn có chủ đích vì rẻ hơn; xem plan §2.2). Hàng `CompanyInactive`/slug sai **vẫn NULL** (đó mới là hàng thực sự vô chủ). **⚠️ BẢN VÁ TỰ ĐẺ RA MỘT ORACLE — đã bịt cùng lúc, và nó là THẬT chứ không phải lo hão:** sau vá, slug hợp lệ đi `withTenant` (BEGIN + set_config + INSERT + COMMIT = 4 round-trip) còn slug sai đi `db.insert` trần (1 round-trip), mà nhánh 429 **không** có `password.hash` burn để che. Đo N=200/nhánh khi TẮT sàn: hai phân phối **rời nhau hoàn toàn** (hợp lệ p50 **4.5ms** > sai p95 **3.7ms**; mean 4.6±0.0 vs 3.2±0.0, **Δ+1.4ms**) ⇒ ship trần là tặng kèm oracle "slug tenant có tồn tại" phân loại được ~100%. Vá bằng **sàn thời gian đồng nhất** cho cả nhánh (`BLOCKED_LOGIN_FLOOR_MS=250` + jitter, đặt trong `finally`, chạy SAU commit nên không giữ slot pool) — đo lại khi BẬT: 295.2±3.3 vs 299.4±3.2, **Δmean đổi dấu thành −4.2ms** (ngược chiều tín hiệu thật ⇒ nhiễu), `max` **trước** sàn = 6.5ms « 250ms nên sàn chưa từng bị xuyên thủng. Phát hiện bởi `plan-reviewer` **trước khi viết code** (v1 của plan bị BLOCK). **Một cache slug→id đã được đề xuất rồi BỎ:** nó khử đúng 1 index-probe nhưng mở lỗ ghi-chéo-tenant thật — `companies_slug_active_uq` (`0002:19`) cho **tái dùng slug sau soft-delete**, nên một mục dương-cũ sẽ ghi email/IP của người dùng tenant B dưới `company_id` của A, FK vẫn pass, im lặng. **⚠️ RANH GIỚI — đừng đọc là "tầm nhìn đã trở lại" trống trơn:** admin lấy lại được **"bị nện brute-force không · từ IP/UA nào · lúc nào · bao nhiêu lần"**, **KHÔNG** lấy lại được **tài khoản nào đang bị nhắm** — `userRef()` (`auth-logs-viewer.service.ts:88-95`) trả `null` khi thiếu `user_id`, và `LoginLogListItem` không có field `email` (§17 DTO tối giản). Đưa `email` lên DTO là quyết định lộ dữ liệu riêng, KHÔNG gộp vào WO này. *(Chỉ đúng cho `TooManyAttempts`: hàng `blocked/Inactive` — nhánh `result.kind === "blocked"` trong `login()` — **có** `user_id`, ghim bởi `auth-blocked-status.int-spec`.)* **Hệ quả chấp nhận có ghi nhận:** `login_logs` nằm trong `PROTECTED_TABLES` (`retention.service.ts:49`) ⇒ không bao giờ bị retention xoá, nên tenant bị nện sẽ **tích luỹ vô hạn** hàng hiển thị + `total`/paging của AUTH-API-401 tăng theo — đó chính là tầm nhìn đang đòi lại, nhưng là thay đổi khối lượng dữ liệu admin sẽ thấy đầu tiên. **Fail-soft KHÔNG câm:** resolve lỗi → `logger.warn` rồi ghi vô chủ, 429 **không** biến thành 500. **RED-first**: R1/R2/R6 ĐỎ trước vá (`expected null to be 'd45e456c-…'` · `expected undefined to be defined` · `expected "spy" to be called`), R3/R4/R5 xanh **cả hai phía** (chốt không-hồi-quy, không phải chốt vá). **Hồi quy**: 13 file · **118 test · 0 đỏ** trên DB lane dựng mới chain `0000→0533` (gồm `login-logs-rls` 8/8 · `auth-logs-viewer` 16/16 · `me-security-activity` 10/10 · `auth-blocked-status` 5/5 · `forgot-password-rate-limit` xanh ⇒ tổng quát hoá `applyUniformResponseFloor` bằng tham số CÓ MẶC ĐỊNH không đổi hành vi forgot). Sửa kèm 2 docstring đã thành sai (`recordLoginAttempt`, `me-security-activity.repository`). Đường lui: `git revert` 1 commit, không bước DB. **⚠️ HAI GIỚI HẠN CÒN LẠI, ghi để không ai đọc nhầm là đã kín:** (1) **sàn có điều kiện thủng, và điều kiện đó kẻ tấn công TẠO RA ĐƯỢC** — cơ chế là *lượng tử hoá* (`remaining = target - elapsed`), nên khi `elapsed > 250ms` thì không ngủ nữa và chênh lệch hình dạng lộ lại; nhánh 429 nay giữ một transaction 4 round-trip trong khi pool là `max: 20` (`db/index.ts:18`) và **repo không có throttler tầng HTTP nào**, nên một đợt bắn song song có thể đẩy `elapsed` vượt sàn bằng xếp hàng pool. Đo của WO này (`max` trước sàn 6.5ms) là đo **tuần tự trên DB rảnh** — đừng đọc nó thành "không bao giờ thủng". (2) sàn là **GIẢM THIỂU**, không phải constant-time. **FULL gate 2 reviewer, cả hai tự chạy lại RED-proof độc lập** và cùng chỉ ra rằng chốt chống-oracle KHÔNG có test — đã vá trong cùng PR: R1 (nhánh đắt) + R4 (nhánh rẻ) nay assert `elapsed ≥ 225ms` bằng **literal CỐ Ý** (import hằng số ⇒ hạ sàn về 0 vẫn xanh = tautology), RED-proof: gỡ `finally` ⇒ R1 đỏ ở **16ms**, R4 đỏ ở **3ms**. `rls-tenant-isolation-tester` **PASS** — verify trên DB SỐNG: policy `tenant_isolation` byte-for-byte 0532, `relrowsecurity/relforcerowsecurity = t/t`, grant `mediaos_app = SELECT,INSERT`, 201/201 migration khớp sha256; và chứng minh lưới có răng bằng **đột biến policy**: `USING true` ⇒ 8 ca đỏ (gồm R3), khôi phục đúng lỗ tiền-0532 ⇒ 6 ca đỏ. Ba ca yếu do gate chỉ ra đã siết: R3 thêm **đối chứng dương** (B đọc được hàng của CHÍNH B), R4/R7 thêm vế "không tenant nào đọc được", R5 tự sinh mẫu + assert denominator ≠ 0 (trước đó chạy cô lập là "1 passed" trên tập RỖNG) | S3 | Bảo mật (quan sát) | ✅ | ⚠️ cần deploy | **ĐÓNG** — `S6-SEC-LOGINLOG-2` |
| ~~**KI-049**~~ | **ĐÓNG 2026-07-30 — `S6-SEC-ORGTEAMSCOPE-1` (N-1c).** Route trả HAI lớp dữ liệu nên có HAI chủ quyền: `read:team` giữ vế quan hệ thành viên, còn `userFullName`/`userEmail` nay bound theo **đúng cặp danh bạ `view:user`** mà `/org/employees` + `/auth/users` đã dùng. **CỐ Ý không** định nghĩa ngữ nghĩa `Own`/`Team`/`Department` thứ hai cho `teams` — làm vậy là đẻ hành vi thứ hai cho cùng lớp dữ liệu, đúng điều N-1 đã tránh. Ngoài scope ⇒ **BỎ HẲN KHOÁ**, không trả `null`: contract `teamMemberSchema.userEmail` là `z.string().email().optional()` **không** `.nullable()` ⇒ `null` sẽ vỡ Zod ở FE dù HTTP 200; khử ở tầng SQL (`case when`) nên quên bước xoá khoá cũng chỉ ra `null` (hỏng ỒN ÀO) chứ không rò email im lặng. **RED-proof** (lane `mediaos_teamscope`): trước vá 2 ca ĐỎ — `view:user@Own`+`read:team@Company` nhận danh tính **4/4 hàng** (đúng phải 1) và `read:team@Company` **không có `view:user` nào** cũng nhận **4/4** (đúng phải 0); sau vá **4/4 ca xanh**, gồm 2 ca đối chứng (`Company` vẫn thấy đủ 4 email — chống siết quá tay; thiếu `read:team` vẫn **403** — vá không nới route). Hồi quy: `org.service.spec` 31 · `org.permissions.spec` 56 · `org.permission.spec` 40 · `org-directory-scope` 7 · `org-directory-permission` 12 · `route-guard-coverage` 9 ⇒ **226 ca xanh**. Nhánh fail-closed có `logger.warn` (đo được trong log lần chạy) — không lặp lỗi F1 của gate N-1. **Phơi nhiễm trước khi vá = 0** (`teams`=0 trên PROD) nhưng cấu hình sai có sẵn trong SEED, và siết **không ai mất quyền** (3 role giữ `read:team` đều `@Company`). Gốc rễ chung **vẫn còn** — `PermissionGuard` không đọc `data_scope` ⇒ mở `S6-SEC-IDENTITY-PROJ-1` (`S3`, không chặn RC) buộc tầng chiếu `users.email`/`fullName` phải nhận vị từ scope, thiếu thì vỡ typecheck | **S2** | Bảo mật (phân quyền) | ✅ | ✅ | **ĐÓNG** — `S6-SEC-ORGTEAMSCOPE-1` |
| **KI-048** | **Hàng `blocked` giờ HIỆN trong màn admin, và tốc độ sinh chúng do KẺ TẤN CÔNG điều khiển** — hệ quả phái sinh của `S6-SEC-LOGINLOG-2`, phát hiện bởi `security-reviewer` ở FULL gate. **Lượng ghi KHÔNG đổi** (những dòng đó vốn đã được ghi, chỉ là dưới `company_id NULL` nên không ai thấy) ⇒ **delta dung lượng = 0**; cái đổi là **khả năng thấy**. Một khi bucket `(slug,email,ip)` đã khoá, MỌI request kế tiếp trong `LOGIN_LOCKOUT_SEC` (900s) sinh một hàng **có chủ** với chi phí server gần bằng 0 (không argon2), trong khi trước đó muốn có hàng có-chủ thì phải qua rate-limiter, mỗi lần tốn một lượt băm. Cộng ba yếu tố: `login_logs` nằm trong `PROTECTED_TABLES` (`retention.service.ts:49`) ⇒ **không bao giờ được thu hồi**; `loginLogListQuerySchema` (`packages/contracts/src/auth.ts`) **không có filter `failure_reason`** ⇒ admin không lọc nhiễu ra được; `total`/paging của AUTH-API-401 phồng vô hạn. ⇒ Kẻ tấn công vô danh có thể **chôn tín hiệu thật dưới nhiễu ngay trong chính màn hình mà KI-044 vừa khôi phục**. Hướng vá đề xuất: gộp (coalesce) hàng `blocked` theo bucket theo cửa sổ khoá — vá luôn cả giới hạn "sàn thủng khi tải cao" ghi ở KI-044 | S3 | Bảo mật (quan sát) | ❌ | ❌ | WO mới (mở 2026-07-29) |
| **KI-047** | **Bốn đường 429 KHÁC không ghi một dòng `login_logs` nào** — phát hiện khi khoanh ranh giới KI-044. Trong `apps/api/src/auth/**` có 5 chỗ ném `TOO_MANY_REQUESTS` (tra bằng `grep -n TOO_MANY_REQUESTS`, **KHÔNG neo số dòng** — chúng trôi mỗi lần sửa file): trong `auth.service.ts` là nhánh rate-limit của `login()` (đường **DUY NHẤT** ghi `login_logs`), của `verifyTwoFactorLogin` (bước-2), của `disableTwoFactor`, của `changePassword`; cộng một chỗ trong `two-factor.service.ts`. Bốn chỗ sau **không** gọi `recordLoginAttempt`. Đáng kể nhất là **bước-2 2FA** (bucket rate-limit `rlKey` tiền tố `2fa`) — dò mã TOTP 6 số là brute-force thật, hiện chỉ có `securityAlerts.emit`, **không có dòng nào ở AUTH-API-401**, dù `claims.companyId` đang nằm sẵn trong tay (khác hẳn KI-044, ở đó lý do là chưa resolve kịp). ⇒ Sau khi KI-044 đóng, admin thấy được brute-force **mật khẩu** nhưng vẫn mù với brute-force **mã 2FA**. Cùng lớp "mất tầm nhìn của bên phòng thủ", KHÔNG phải rò rỉ | S3 | Bảo mật (quan sát) | ❌ | ❌ | WO mới (mở 2026-07-29) |
| ~~KI-037~~ | Bộ `tenant-isolation.int-spec` **chỉ SELECT** — không có một ca deny GHI chéo tenant nào. ⟲ số đúng: registry **155 bảng** (không phải 156); **465 ca** — con số KI ghi ban đầu là ĐÚNG (một bản sửa trung gian ghi 446, đã thu hồi). | S2 | Độ phủ test | ✅ | ✅ | **ĐÓNG 2026-07-29** — `S6-QA-TENANTWRITE-1`: lưới **465 → 1089 ca** (+4 ca ghi/bảng), `WITH CHECK` **đã chứng minh chạy trên 148/153 bảng** |
| **KI-050** | **Chưa từng có một bản backup nào trên máy PROD** — `scripts/ops-alert-check.mjs` trả `unknown` cho "tuổi bản backup" NGAY lần chạy đầu (2026-07-30): không có thư mục `backups/`, và `Get-ScheduledTask` không có task nào chạy `scripts/backup-db.sh`. **Phân biệt với KI-008 (đã đóng):** `S6-PERF-DB-1` chứng minh **restore drill** chạy được, nhưng drill đó tự `pg_dump` tại chỗ ⇒ nó KHÔNG chứng minh có **backup định kỳ**. Khôi phục được từ bản dump vừa tạo ≠ có bản dump để khôi phục khi máy hỏng. `RELEASE-01` §7.3 tick "Script backup ✅" — script CÓ tồn tại, nhưng **chưa từng chạy**; đúng bài học "script tồn tại ≠ script chạy được" (`DEVOPS-13` §3.1). **Workaround/vá:** chạy tay `bash scripts/backup-db.sh` trước go-live + đăng ký task hằng ngày 02:00 (`RELEASE-09` §4). ⟲ **CẬP NHẬT 2026-07-31 (`S6-GOLIVE-1`) — workaround đó KHÔNG CHẠY ĐƯỢC khi được ghi ra:** `scripts/backup-db.sh` chặn cứng ở `command -v pg_dump`, mà máy PROD-host (Windows, Postgres trong container) không có `pg_dump` trên PATH ⇒ `ERROR: pg_dump not found`, exit 1. Cùng LỚP lỗ đã vá cho `migrate-verify-ephemeral.sh` rồi `backup-restore-drill.sh` (`S6-PERF-DB-1`) — `backup-db.sh` lỡ cả hai đợt, tức một known-issue có workaround hỏng = **không có** workaround. Đã vá bằng fallback `docker exec` (`BACKUP_PG_DUMP`/`BACKUP_PG_CONTAINER`) + bỏ `--file` (qua `docker exec` nó ghi vào filesystem CỦA CONTAINER ⇒ báo DONE mà host rỗng) + chốt bằng **6 test** `node --test` trong `tooling-tests`. **ĐÃ CHẠY THẬT:** bản backup đầu tiên của hệ thống `mediaos-20260731-072306.dump` (3.861.533 byte, ~1s) · `backup-restore-drill.sh` **DRILL PASS** (restore + migration + RLS/FORCE + ledger + index + smoke) · ô "tuổi backup" của `ops-alert-check` chuyển `unknown` → **`ok`**. Cũng đã thêm `backups/` + `*.dump*` vào `.gitignore` — trước đó thư mục này KHÔNG bị ignore (repo PUBLIC, dump chứa PII 45 nhân viên). ⟲ **CẬP NHẬT 2026-08-04 (`G7` xong) — LỊCH TỰ ĐỘNG ĐÃ CÓ VÀ ĐÃ CHẠY THẬT.** `MediaOS-BackupDaily` (02:00 hằng ngày) + `MediaOS-OpsAlert` (mỗi 10 phút) đã đăng ký; `LastTaskResult = 0` cho backup và dump `mediaos-20260803-235232.dump` (4.339.263 byte) ghi lúc **06:52:33 khớp `LastRunTime`** ⇒ chính TASK đẻ ra nó, không phải lượt chạy tay. **Và lớp lỗ này suýt tái diễn LẦN THỨ BA:** lần đăng ký đầu theo runbook cũ dùng `(Get-Command bash).Source`, trên máy PROD trả `C:\WINDOWS\system32\bash.exe` = **shim WSL** mà WSL không có bash (`execvpe(/bin/bash) failed`) ⇒ task `State = Ready`, đăng ký thành công, **chỉ hỏng lúc 02:00**. Bắt được nhờ chạy thử ngay + đọc `LastTaskResult`, không đợi trigger. `RELEASE-11` §6.2 nay trỏ đích danh Git Bash + `Test-Path` fail-loud + bảng tra `LastTaskResult` (`267011` = **chưa chạy lần nào**, không phải "ổn"). **CÒN LẠI (vì sao vẫn chưa đóng):** dump **chưa mã hoá** (`BACKUP_GPG_RECIPIENT` trống) · **chưa đẩy offsite** (`BACKUP_B2_REMOTE` trống) ⇒ `RELEASE-14` `PGL-001`. Cả hai đều là "một bản sao duy nhất, nằm trên đúng cái máy có thể hỏng" | **S2** | Vận hành | ❌ | **✅** | Owner/DevOps (mở 2026-07-30, `S6-REL-1`; giảm 2026-07-31, `S6-GOLIVE-1`; giảm tiếp 2026-08-04, `G7`) |
| **KI-056** | **4/6 tài khoản vai `SA` (super-admin, 379/379 quyền) KHÔNG có lớp bảo vệ thứ hai** — đo trên DB PROD 2026-07-31: `roles.requires_two_factor = false` cho `SA`, `users.require_two_factor = false`, và **0 bản ghi `user_totp`** cho 4/6 tài khoản. Vai `SA` đọc được hồ sơ nhân sự **chưa mask** của cả 45 nhân viên ⇒ 4 tài khoản mức đó hiện chỉ được bảo vệ bằng **mật khẩu**. Trớ trêu: `company-admin` (1 tài khoản, 329 quyền — **kém quyền hơn**) lại `requires_two_factor = true` và đã enroll. **Không phải bug — là cờ cấu hình chưa bật**, và ý định đã ghi sẵn trong code: `apps/api/src/config/env.schema.ts:188` — *"2FA: role này requires_two_factor=false (tiện dùng); bật ở prod nếu cần"*. Chưa ai bật ⇒ đúng khuôn *comment mô tả ý định, không mô tả trạng thái*. **Workaround/vá (rẻ):** 4 người enroll TOTP ở `/me/security/2fa` (hoặc Console `/settings/security`), **sau đó** mới bật cờ trên vai `SA`. ⚠️ **Bật cờ TRƯỚC khi enroll ⇒ 4 tài khoản đó lập tức 403 `TWO_FACTOR_SETUP_REQUIRED` ở MỌI route** (đúng thiết kế, nhưng nhìn hệt như "hệ thống sập toàn bộ"). ⚠️ Mục này đưa `S2` mở từ 3 lên **4 — VƯỢT ngưỡng chặn RC** của `RELEASE-05` §5.3 (≤3) ⇒ là một trong các cổng chặn cắt RC, và là cổng **rẻ nhất** để mở | **S2** | Bảo mật (cấu hình) | ❌ | **✅** | Owner (mở 2026-07-31, `S6-GOLIVE-1`) — `RELEASE-10` §4 · `RELEASE-14` `PGL-003` |
| ~~**KI-046**~~ | **ĐÃ ĐÓNG 2026-07-31 — `S6-SEC-XTENANTFK-1` (mig `0535`).** Kiểm tra FK của Postgres **bỏ qua RLS theo thiết kế** ⇒ FK MỘT-CỘT nối hai bảng đều có `company_id` cho phép ngữ cảnh tenant A gắn hàng của mình trỏ sang bản ghi của **B**. ⟲ **số đúng là 457, không phải 458**: 460 FK một-cột · **3** (không phải 2) đang được composite che — `tasks_parent_same_company_fk` (0503) che `tasks_parent_task_id_fkey`, cộng 2 cặp của `0533`. Dòng dẫn xuất: 460 hở → sau `0503` 459 → sau `0533` **457**. **TRƯỚC/SAU (đo trên `mediaos` head 0534 rồi trên lane đã áp 0535):** hở **457 → 11** · lớp T (đích `company_id NOT NULL`) **446 → 0** · lớp G (catalog toàn cục: `roles` 13/17 hàng NULL · `dashboard_widgets` 17/17 · `notification_events` 59/59 · `notification_templates` 45/45 · `public_holidays` · `seed_batches`) **11, KHÔNG vá được** — composite FK sẽ phá tham chiếu hợp lệ ⇒ ký waiver từng cặp ở `fk-tenant-verdicts.ts`, phần dư mở **KI-055**. **Dữ liệu:** 0 hàng lệch tenant lớp T trên CẢ `mediaos` lẫn `mediaos_dev` (144/132 hàng "lệch" của bản quét thô đều là tham chiếu tới hàng catalog toàn cục — HỢP LỆ) ⇒ **không xoá/sửa hàng nào**, migration dùng tiền kiểm + `RAISE EXCEPTION` thay cho `DELETE` của `0533` (BẤT BIẾN #2). **Chốt chống mọc thêm:** `xtenant-fk-ratchet.int-spec.ts` (10 assert, chạy ở CI vì `hasDb` không gate theo `LANE_DB`) + ca **W4** data-driven trong `tenant-isolation.int-spec` (449 cặp thử · **267 chứng minh bằng chính composite FK** qua 23503 + khớp `err.constraint`; 182 cặp bị chặn bởi cơ chế khác được liệt kê tường minh là CHƯA chứng minh) | S3 | Bảo mật (toàn vẹn) | ✅ | ❌ | **ĐÓNG 2026-07-31** — `S6-SEC-XTENANTFK-1` |
| **KI-057** | **Nghỉ bù (`COMPENSATORY`) KHÔNG trừ quỹ ⇒ không có đối chiếu nào với giờ làm thêm** — `leave_types.deduct_balance = false` (đo PROD 2026-08-01 18:38). Hệ quả: nhân viên xin **bao nhiêu ngày nghỉ bù cũng qua** cửa số dư, hệ thống không kiểm được ngày bù đó có nguồn hay không. **Bối cảnh — đây là quyết định, không phải lỗi:** phương án ban đầu (**C-1**, chốt 2026-08-01) là GIỮ `deduct_balance = true` + HR cấp số dư tay khi có OT thật, đúng bản chất *chỉ nghỉ bù được cái đã làm thêm*. Trong lúc khôi phục hai loại nghỉ bị đặt nhầm `inactive`, `COMPENSATORY` được đặt luôn về `false`; **owner chốt GIỮ NGUYÊN 2026-08-02** ⇒ hiệu lực là phương án **C-2**. **Không có module OT trong hệ thống** (0 bảng overtime) nên kể cả C-1 cũng phải cấp tay — C-2 chỉ bỏ nốt lớp chặn cuối. **Lớp kiểm soát duy nhất còn lại: bước DUYỆT của quản lý/HR** (`approve:leave`) — đây là điều kiện bắt buộc của quyết định này, không phải gợi ý. **Cần nói rõ trong thông báo go-live** để quản lý biết mình là chốt chặn duy nhất. Gỡ về C-1 bất cứ lúc nào bằng 1 thao tác: `/leave/types` → `COMPENSATORY` → tick lại *Trừ số dư phép* | S3 | Sản phẩm (đã chấp nhận) | ❌ | ❌ | Owner (chốt 2026-08-02) |
| ~~KI-059~~ | **ĐÓNG 2026-08-03** — `S7-INT-OUTBOX-FIFO-1`. `claim()` nay bọc `UPDATE … RETURNING` vào **CTE thứ hai** rồi `SELECT … FROM updated ORDER BY available_at, created_at, id` ở **NGOÀI CÙNG** (chỗ duy nhất Postgres bảo đảm thứ tự); `FOR UPDATE SKIP LOCKED` giữ nguyên ⇒ claim vẫn atomic, không mở cửa double-claim. Tie-break `created_at, id` thêm ở **CẢ HAI** vế: vế trong để TẬP hàng được claim tất định khi `available_at` hoà, vế ngoài để thứ tự giao tất định. **RED trước khi vá** (`apps/api/test/integration/outbox-fifo.int-spec.ts`, lane `mediaos_outboxfifo`): gieo seq 0..11 `available_at` tăng dần nhưng **CHÈN NGƯỢC** (⇒ thứ tự vật lý heap = nghịch đảo thứ tự logic, đòn bẩy tất định thay vì cầu may planner) — consumer nhận `[0,8,10,7,6,11,5,2,1,4,3,9]`, tức xáo hoàn toàn chứ không chỉ đảo. **Sau vá:** 49/49 xanh gồm hồi quy `outbox.int-spec.ts` (retry/backoff/dead-letter/reaper không đổi hành vi); **ca 6b của `chat-noti-e2e.int-spec.ts` — ca từng `it.skip` gắn chính KI này — đã BỎ SKIP và xanh 3/3 lượt** chạy cùng spec khác, đây là nghiệm thu end-to-end. ⚠️ **PHẠM VI BẢO ĐẢM — nói chính xác, đừng đọc thành "outbox giờ FIFO tuyệt đối":** bản vá chỉ bảo đảm thứ tự **trong MỘT lô claim của MỘT worker**. Ba chỗ nó không với tới: (1) **cùng một transaction** — `available_at` và `created_at` đều mặc định `now()` = mốc BẮT ĐẦU TRANSACTION nên event enqueue cùng tx bằng nhau ở cả hai cột, tie-break rơi xuống `id` = UUID ngẫu nhiên ⇒ thứ tự trong-tx KHÔNG phải thứ tự enqueue; (2) **sau retry** — `finalizeStatus` đẩy `available_at = now() + backoff` nên event lỗi được giao SAU những event sinh sau nó (đánh đổi có chủ đích của backoff); (3) **đa-instance** — hai worker claim hai tập RỜI NHAU đồng thời, không có thứ tự chéo-worker nào. Muốn đúng tuyệt đối phải thêm cột đơn điệu `bigserial` = migration + đổi hợp đồng đọc ⇒ **WO RIÊNG, chưa mở** (ghi ở đây để không ai đọc mục này thành "outbox giờ FIFO tuyệt đối"). Mô tả gốc giữ lại làm hồ sơ: **`outbox_events` KHÔNG phải FIFO — worker dispatch sai thứ tự ngay trong CÙNG một lô claim.** `OutboxWorker.claim()` (`apps/api/src/events/outbox-worker.ts`) chạy `WITH claimed AS (SELECT id … ORDER BY available_at FOR UPDATE SKIP LOCKED LIMIT n) UPDATE … WHERE id IN (SELECT id FROM claimed) RETURNING …`. Vế `ORDER BY` chỉ quyết định **chọn hàng nào**, KHÔNG quyết định thứ tự hàng của `RETURNING` — thứ tự đó do planner sinh và Postgres không bảo đảm gì; `processEvent` rồi lặp đúng theo thứ tự đó. **Bằng chứng đo 2026-08-03** (lane `mediaos_chatbe6`, log tạm đặt ngay sau `claim()`): 3 event `chat.message.direct_sent` enqueue theo thứ tự 1→2→3 quay về `[2, 1, 3]`; ba lượt đo trước đó cho thứ tự **ĐẢO** (3→2→1), đối chứng độc lập bằng `updated_at` của bước finalize. Chạy **cô lập** thì bảng nhỏ và plan tình cờ ra đúng FIFO ⇒ lỗi chỉ lộ khi có spec/instance khác chạy song song, và lộ dưới dạng **hỏng-im-lặng**: không log, không exception, chỉ sai dữ liệu. **Hệ quả:** với consumer mà N event gộp thành 1 thông báo qua dedupe, payload của thông báo lấy từ event **được tiêu thụ trước**, KHÔNG phải event đầu theo thời gian. Quan sát được đầu tiên ở `CHAT_DIRECT_MESSAGE` (`S7-CHAT-BE-6`): `unread_count` nhận 1/2/3 tuỳ lượt chạy. 30 event-type còn lại (TASK · LEAVE · ATT · GOAL · HR-PCR · AUTH) hôm nay mỗi event sinh 1 thông báo độc lập nên chưa quan sát được — nhưng bất kỳ consumer nào phụ thuộc thứ tự sẽ sai âm thầm y hệt. **Hướng vá:** bọc `UPDATE` vào CTE thứ hai rồi `SELECT … ORDER BY available_at, created_at, id` ở ngoài cùng (chỉ `ORDER BY` của SELECT ngoài cùng mới có bảo đảm), kèm test hồi quy đo THỨ TỰ DISPATCH ở tầng events. **Giới hạn tồn dư kể cả sau khi vá:** event enqueue trong CÙNG transaction chia sẻ `now()` cho cả `available_at` lẫn `created_at` ⇒ hoà, chỉ còn phân định bằng uuid ngẫu nhiên; muốn đúng tuyệt đối phải thêm cột `bigserial` (= migration, tách riêng). Theo dõi ở WO **`S7-INT-OUTBOX-FIFO-1`** | S3 | Hạ tầng (event bus) | — | — | **ĐÓNG 2026-08-03** — `S7-INT-OUTBOX-FIFO-1` |
| **KI-060** | **Tệp đính kèm dùng ở NHIỀU nơi: mất `url` ở chỗ mình có quyền, vì một link khác mình không có quyền.** `FilePolicyService.decideForLinkedFile` là AND-khắt-khe-nhất trên MỌI link sống của tệp, tính RIÊNG cho từng user. Nên nếu cùng một `file_id` có hai link (ví dụ hai `chat_message` ở hai phòng), người ở phòng A **không thuộc** phòng B sẽ mất `url` **ngay tại phòng A** — thấy tên + kích thước, bấm tải không được. **Owner CHẤP NHẬN cho v1 (2026-08-03)**, ba lý do: (1) đường UI bình thường tải tệp lên tạo **file mới**, nên tình huống đa-link chỉ phát sinh qua `POST /foundation/files/:id/links` hoặc tính năng "chuyển tiếp tin nhắn" **chưa tồn tại ở v1** ⇒ phơi nhiễm thực tế gần 0; (2) **KHÔNG được vá bằng cách nới AND**: gate `S7-CHAT-BE-GATE-3` đã phân tích — dưới OR trong cùng nhóm `(module, entityType)`, kẻ tấn công chỉ cần link tệp của phòng nó KHÔNG thuộc vào tin nhắn của CHÍNH NÓ là được cấp quyền, tức mở lại đúng lỗ `S5-TASK-COVER-1` đã đóng (dưới AND, thêm link không bao giờ CẤP quyền, chỉ có thể lấy bớt); (3) khuyết tật THẬT là **sự im lặng** — đã vá: `decideForLinkedFile` trả `deniedByLink` (chẩn đoán, CẤM dùng để phân quyền) và CHAT log WARN khi tệp bị chặn bởi một entity KHÁC tin đang đọc. **Điều kiện mở lại:** khi build "chuyển tiếp tin nhắn" hoặc bất kỳ đường nào tạo link thứ hai từ UI ⇒ làm **copy-on-resend** (tạo bản sao tệp thay vì link thứ hai) CÙNG release đó | S3 | Sản phẩm (đã chấp nhận) | ❌ | ❌ | Owner — mở lại khi có forward-message |
| ~~**KI-061**~~ | **MỞ VÀ ĐÓNG CÙNG NGÀY 2026-08-11 — `S7-CALL-RT-FIX-1`.** **fail-OPEN `/ws-call`: token hết hạn ngay lúc bắt tay vẫn ĐƯỢC NHẬN, và socket đó nhận relay SDP/ICE VÔ THỜI HẠN.** Cơ chế — 4 mắt xích đọc thẳng trên nguồn `socket.io@4.8.3` (không phải suy đoán): `dist/socket.js:592-594` `disconnect(close) { if (!this.connected) return this; … }` · `socket.js:90` / `:406-408` `connected=false` lúc khởi tạo, chỉ `true` trong `_onconnect()` · `dist/namespace.js:221 → :241/:267` middleware `run()` chạy **TRƯỚC** `_doConnect`→`_onconnect` · gateway gọi `scheduleTokenExpiry` **TRONG** middleware handshake, trước `next()`. ⇒ `client.disconnect(true)` ở nhánh `ttlMs <= 0` là **no-op**; `handshake()` chạy tiếp `onAny` → `join` → `return undefined` = **CHẤP NHẬN** một socket có token đã hết hạn, `expiryTimer = null`, và **đã ở trong `callUserRoomName` của chính mình**. Chiều **GỬI** vẫn kín (`accept()` kiểm lại `tokenExpSec` mỗi khung) — nhưng `accept()` **chỉ chạy khi socket GỬI**, nên một socket im lặng tuyệt đối nhận mọi `sdp-offer`/`sdp-answer`/`ice-candidate` bắn tới người đó, cho mọi cuộc gọi tương lai, không có đường cắt nào. SDP mang **IP nội bộ/công khai** của bên kia + mốc thời gian từng cuộc gọi. **Docblock cũ ghi "fail-CLOSED nếu đồng hồ lệch" và làm ĐÚNG NGƯỢC LẠI** — `silent-failure` điển hình: không log, không lỗi, không test nào đỏ. **Cửa sổ chạm là THẬT, không phải lý thuyết:** `jwt.verify` đã chặn token hết hạn, nên nhánh này chỉ tới được khi token hết hạn **giữa** `verify` và cổng — mà giữa hai điểm đó có **2 round-trip I/O** (`cooldown.allow`→Valkey, `permissions.can`→Valkey/DB); cộng với việc `jwt.verify` so `exp` ở **độ phân giải GIÂY**, một token `exp = now+1s` qua được verify rồi chỉ còn ≤1000 ms khi tới cổng. FE `/ws-call` **được thiết kế để nối lại** ⇒ người cầm token sắp hết hạn trúng cửa sổ này một cách bình thường, không cần kỹ thuật gì. Đường thứ hai không cần đua: **đồng hồ máy chủ nhảy lùi** (NTP step, VM migrate). **Bản vá:** `scheduleTokenExpiry` đổi chữ ký `void` → `Error \| undefined`, nhánh `ttlMs <= 0` trả `new Error("unauthorized")` cho `next()` thay vì `disconnect()`; `handshake()` gọi nó làm **cổng CUỐI** (bắt buộc SAU cả hai round-trip I/O — dời lên sau `verify` "cho gọn" là đóng lại đúng cửa sổ đua ⇒ vá xong mà lỗ vẫn còn) và chỉ gán `client.data.state`/`.user` **SAU** cổng ⇒ bị từ chối thì không dựng phiên, không `join`. Chuỗi `"unauthorized"` **giữ nguyên**, không đẻ mã mới: `"token_expired"` riêng là oracle miễn phí, nó xác nhận cho người dò cửa rằng token **đúng chữ ký** và **chỉ vừa hết hạn** — nấc thứ 4 này đã được thêm vào ca `B` (3→4 nấc) để tính chất không-phân-biệt-được được **ghim**. **Phát hiện bởi `S7-CALL-QA-1`** (vòng nghiệm thu CALL, PR #374) và đóng bằng WO tách riêng thay vì vá kèm — QA-1 để lại **tripwire C2** (characterization test, **cố ý không dùng `it.fails`**: `it.fails` xanh khi thân bài ném vì bất kỳ lý do gì ⇒ tripwire không bao giờ nổ) và ca đó đã được **LẬT** sang hành vi đúng trong cùng PR của bản vá. **Số đo:** RED trước vá (C2b đỏ đúng lý do `expected undefined to be an instance of Error`, đối chứng C2c xanh) → GREEN sau vá (41/41 gồm ratchet cấu trúc) → **mutation check** (`ttlMs <= 0` → `ttlMs < -3_600_000` ⇒ C2+C2b đỏ, C2c vẫn xanh ⇒ ca không rỗng); `test:cov:call` **133/133** trên lane `mediaos_s7callrtfix1`, gateway branch 92.74 → **92.85**, lines **100**, cụm CALL 99.14/94.35 — ngưỡng per-file **không hạ một điểm nào**. **Bằng chứng:** `docs/QA/evidence/S7-CALL-RT-FIX-1.md`. ⚠️ **Ranh giới — đừng đọc thành "chiều nhận giờ đã kín":** bản vá làm cho trần "hạn access-token" **có hiệu lực thật** ở nhánh biên, nó **không rút ngắn** trần đó; chiều NHẬN vẫn không tái kiểm quyền sau khi đã nối (≤900 s), và **C6** (khoá tài khoản không chặn phiên `/ws-call` MỚI) là hành vi ĐƯỢC BIẾT mà owner đã phán quyết 11/08 là không mở WO riêng | S2 | Realtime (xác thực cổng vào) | ✅ | ❌ (CHAT `is_active=false`) | **ĐÓNG 2026-08-11** — `S7-CALL-RT-FIX-1` |
| ~~**KI-058**~~ | **ĐÓNG 2026-08-02 — `S6-LEAVE-CAPALLOW-1` (PR #325).** **4 màn QUẢN TRỊ LEAVE không vào được từ UI** dù quyền trong DB có đủ. Cơ chế: `getCapabilities()` lọc bỏ **toàn bộ** cặp `is_sensitive`; chỉ cặp trong `SENSITIVE_CAPABILITY_ALLOWLIST` mới được `getAllowlistedSensitiveCapabilities()` trả lại cho FE. 10 cặp gác LEAVE-SCREEN-010/011/012 + màn Giao dịch số dư (seed mig `0455`, grant @Company cho `hr`+`company-admin`) **chưa bao giờ được thêm** ⇒ `/auth/me` không trả ⇒ màn ẨN với đúng vai ĐƯỢC CẤP quyền. Im lặng: không lỗi, không log, không test nào đỏ. **Chặn go-live** vì LEAVE-SCREEN-011 là đường **DUY NHẤT** bật `accrual_method`, mà `ANNUAL` có `deduct_balance=true` + `leave_balances`=0 ⇒ mọi đơn phép năm trả **422 `BALANCE_NOT_ENOUGH`**. **Vì sao không ai thấy sớm:** chỉ `SA` dùng được, và chỉ nhờ **TAI NẠN** — `SA` có grant `*:*` (`is_sensitive=false`) nên lọt qua fallback wildcard của `useCan()`; màn dùng `useCanExact()` thì `SA` cũng trượt. **Lần lặp thứ 8+** của cùng lớp lỗi (CAP-2 → USEROPS-1 → EXPORT-1 → NOTI-BE-3 → DASH-3 → IDENTITY-READ-1 → IMPORT-FE-1) ⇒ vá kèm **test khoá** `SENSITIVE_SCREEN_GATE_PAIRS` ⊆ allowlist, RED-proof (gỡ đúng 1 cặp ⇒ đỏ đúng thông điệp) ⇒ lần sau quên allowlist thì **CI đỏ** thay vì ẩn màn trong im lặng. Enforcement **KHÔNG đổi** — allowlist chỉ là cờ hiển thị; `@RequirePermission` per-resource + data-scope + RLS vẫn là cổng thật; wildcard `*:*` vẫn không kế thừa cặp nhạy cảm | S2 | Phân quyền (hiển thị) | ✅ | ✅ đã deploy `30540ab0` | **ĐÓNG** — `S6-LEAVE-CAPALLOW-1` |
| **KI-055** | **Lỗ tồn dư lớp G sau `S6-SEC-XTENANTFK-1`**: 11 cặp FK trỏ tới bảng **catalog toàn cục** (`company_id` NULLABLE) KHÔNG vá được bằng composite FK — vá là chặn luôn tham chiếu hợp lệ tới hàng dùng chung (gán role hệ thống, cấu hình widget, template noti). Hệ quả còn lại: trong ngữ cảnh tenant A vẫn trỏ được tới hàng catalog **CỦA TENANT B** (nặng nhất: `user_roles.role_id → roles` — bảng phân quyền, crown-jewel). Phòng thủ hiện tại nằm ở RLS tầng đọc + kiểm tra tầng service, KHÔNG ở tầng DB. Hướng vá: trigger/CHECK "cha cùng tenant **HOẶC** là hàng toàn cục (`company_id IS NULL`)". **Tác hại ĐO ĐƯỢC** (rls-tenant-isolation-tester, FULL gate 2026-07-31): tenant A gán được role của B ⇒ sau đó **B xoá role của chính B thì hàng `user_roles` mang `company_id = A` biến mất** (CASCADE bắc cầu chéo tenant) — tức tenant B tự ý gỡ được quyền của người thuộc tenant A. Ngược lại cũng đã chứng minh composite FK KHÔNG dùng được ở đây: thêm thử `user_roles.role_id` ⇒ `Key (company_id, role_id)=(A, <role hệ thống>) is not present in table "roles"` ⇒ **phá luôn việc gán role hệ thống**. Đã ký waiver từng cặp kèm lý do ở `apps/api/test/foundation/fk-tenant-verdicts.ts`; ratchet ca (e) chặn việc ký waiver cho cặp lớp T | S3 | Bảo mật (toàn vẹn) | ✅ | ❌ | Mở 2026-07-31 (tách từ KI-046) |
| ~~KI-029~~ | **ĐÃ VÁ 2026-07-28** (owner duyệt đổi hành vi sau freeze) — khai `PERMISSION_GUARD_ENABLED` trong `env.schema.ts` (default `"true"`) + `.env.example`; **`NODE_ENV=production` + `"false"` ⇒ CHẶN BOOT** (superRefine), giá trị lạ (`False`/`0`/rỗng) nay ĐỎ thay vì im lặng coi là bật. Guard **vẫn đọc `process.env` mỗi request** có chủ đích: rollback khẩn không cần build lại config, và reviewer dùng chính cờ này để tái lập vế RED của gate quyền. RED-proof: 5 ca mới ĐỎ khi gỡ vá, 24/24 xanh khi có vá; 434 unit vùng permission/auth/config không hồi quy. ~~kill-switch fail-OPEN toàn hệ, ngoài `env.schema`~~ | S2 | Bảo mật (tiềm ẩn) | ✅ | ⚠️ cần deploy | **ĐÓNG** |
| ~~KI-030~~ | **3 route** `/org` không gate trả danh bạ + cơ cấu team toàn tenant cho mọi user đã đăng nhập (`employees` · `teams` · `teams/:id/members`) — lệch với `/hr/employees` vốn ép data_scope. ⟲ mở rộng 1 → 3 route bởi census runtime `S6-SEC-ROUTEMAP-1` | S2 | Bảo mật (phân quyền) | ✅ | ✅ | **ĐÓNG 2026-07-27** — `S6-SEC-ORG-1` |
| ~~KI-031~~ | **ĐÓNG 2026-08-13** — `S10-FND-ENVKEY-1`. Khai `INTERNAL_API_KEY` trong `env.schema.ts` (`z.string().min(32).optional()`) + `.env.example`. **Giữ OPTIONAL có chủ đích — đừng "siết cho chặt" thành required**: `InternalGuard` đã fail-CLOSED khi biến vắng (`internal.guard.ts:23` ⇒ 403 mọi `/internal/**`), nên ép required không mua thêm an toàn nào mà chỉ đổi "mất một tính năng" thành "**SẬP BOOT cả API**" trên mọi máy dev/CI/lane chưa đặt biến. `.min(32)` áp được vì đây là khoá **ta tự sinh** (khác `CLOUDFLARE_TURN_*` — khoá bên thứ ba, độ dài do họ quy định) và vì phép đo dưới đây chứng minh không deployment nào có thể vỡ boot vì sàn độ dài. **3 ca test đóng đinh CHIỀU đã chọn**, không mô tả lại schema: vắng ⇒ KHÔNG ném (fail-closed thuộc về guard, không thuộc schema) · <32 ký tự ⇒ ĐỎ ngay ở biên · ≥32 ⇒ nhận. 34/34 xanh, `typecheck` sạch. ⚠️ **Nửa khai báo đóng, nửa VẬN HÀNH chưa**: đo 13/08 — **không file `.env` nào trong repo** (`.env` · `apps/api/.env` · `.env.example`) đặt biến này, nghĩa là ba nhóm route sau `InternalGuard` đang 403: recalculate chấm công thủ công/retry · `POST /internal/v1/dashboard/cache/invalidate` · `POST /internal/v1/notifications/events`. **Chưa đo env cấp dịch vụ NSSM trên máy PROD** — nếu ở đó cũng vắng thì ba đường trên đang tắt thật, và đó đúng là "mất tính năng trong im lặng" mà KI này mô tả. Owner cần đặt giá trị nếu dùng các đường đó ~~ngoài `env.schema`/`.env.example`~~ | S3 | Vận hành | ❌ | ❌ | **ĐÓNG** — `S10-FND-ENVKEY-1` · ⚠️ owner đặt giá trị ở PROD |
| ~~KI-045~~ | **ĐÓNG 2026-07-29** — `S6-SEC-ROTATE-1` (chính WO gây ra, nay vá cùng nhánh). Sau rotate 28/7, đường chạy int-spec bằng `LANE_DB` không còn nối được DB: hai chỗ còn giữ credential TIỀN-rotate là `scripts/lane-db-setup.sh` (`DEV_PW` fallback hằng số) và `apps/api/test/db-target.ts` (dựng 3 URL lane từ hằng số) ⇒ `28P01`, db-fence fail-closed nên **toàn bộ suite api từ chối chạy** — hàng rào deny-path/IDOR/cross-tenant thành *không chạy được*. **Vá**: cả hai nay đọc credential từ `.env` qua helper chung `scripts/lib/db-secrets.sh` (`SUPERUSER_DB_PASSWORD` · `APP_DB_PASSWORD` · `WORKER_DB_PASSWORD`); thiếu ⇒ DỪNG kèm chỉ dẫn, KHÔNG đoán. `harness/check.sh --lane-db` tự nạp + export 3 biến đó và `unset` cả 3 `DATABASE_*_URL` trước khi chạy test (URL tường minh THẮNG `LANE_DB` — vector V2 của KI-028). **Về vế "hỏng im lặng"**: CỐ Ý giữ cảnh báo-rồi-chạy-tiếp thay vì hard-fail, vì header `check.sh` hứa không bắt buộc Docker và worktree lane thường không có `.env`; bù lại `lane-db-guard` escalate **ĐỎ** ở tier `--all`/`REQUIRE_LANE_DB` ⇒ không thể mở PR vùng đỏ với bằng chứng deny-path rỗng. **Bằng chứng**: `bash scripts/lane-db-setup.sh rot1` chạy được không cần export tay; rồi chỉ với `LANE_DB` (không URL tường minh) → `db-tenant` + `att-core-tenant-deny` + `admin-users-deny` = **46/46 ca CHẠY THẬT** (không skip), `db-target.unit-spec` 34/34 | **S2** | Độ phủ test / gate | ✅ | ✅ | **ĐÓNG** — `S6-SEC-ROTATE-1` |
| ~~KI-043~~ | **ĐÓNG 2026-07-28** — `S6-SEC-ROTATE-1`. Đã rotate **5 role** (`mediaos` SUPERUSER · `mediaos_owner` · `mediaos_app` · `mediaos_worker` · `pgbouncer_auth`) sang mật khẩu ngẫu nhiên 32 ký tự. **Bằng chứng hai chiều, đo TỪ HOST qua `localhost:5432`** (đường tấn công thật): 3 literal cũ đều `password authentication failed`, ca đối chứng mật khẩu-bậy cũng bị từ chối (chứng minh đang xác thực `scram-sha-256` chứ không phải `trust`), 5/5 mật khẩu mới nối được. ⚠️ Phép thử bằng `docker exec psql -h 127.0.0.1` **CHỨNG MINH SAI** — `pg_hba` của image có `host all all 127.0.0.1 trust`, mọi mật khẩu đều qua. **Nguồn tái nhiễm đã cắt**: `Invoke-Roles` (`mediaos.ps1`) không còn `ALTER ROLE … '<literal>'` mà uỷ quyền cho `scripts/setup-db-roles.mjs` (chỉ đọc env) — chạy lại `m roles` sau rotate rồi thử lại literal cũ: **vẫn bị từ chối**. **Bind**: 5 cổng `5432/6432/6379/9000/9001` từ `0.0.0.0`+`[::]` → **`127.0.0.1`** (firewall KHÔNG dùng làm bằng chứng: máy có 204 rule inbound allow-any-port). **Literal = 0** trên file tracked **và file mới chưa gitignore** (gồm cả docs — không có danh sách miễn trừ). **Chốt hồi quy**: `scripts/check-no-secret-literals.mjs` chạy trong `harness/check.sh` + job `secret-scan` của `security.yml` — bắt loại lỗ hổng gitleaks MÙ (chuỗi `changeme_*` không *trông* giống secret; mật khẩu nằm trong userinfo của connection string). Lưới hồi quy của chính cổng: `scripts/guardproof-secret-literals.sh` — **27 ca, PASS 27/0**, dựng repo git tạm rồi chạy cổng thật. FULL gate chạy **2 vòng, cả hai đều BLOCK**, và cả 6 HIGH đều nằm trong bộ an toàn chứ không phải ở phần rotate — đáng chú ý nhất: cổng ban đầu chỉ quét `git ls-files` nên **mù với chính 2 file mới của WO**, báo XANH tới tận sau khi commit. Script seed (`demo-seed-{base,full,dashboard}` · `seed-operator`) nay **fail-closed**: không khai DB đích ⇒ exit 1; đích là `mediaos`/`mediaos_dev` ⇒ exit 1 trừ khi khai đúng tên qua `SEED_ALLOW_PROTECTED_DB`. **KHÔNG history-rewrite** (quyết định có chủ đích: literal đã public từ lâu, giá trị phòng thủ sau rotate ≈ 0, chi phí thì thật). Dữ liệu sau rotate: `funtime` 46 user, `/health/db` 200, `check-prod-test-tenants` exit 0 | **S0** | Bảo mật | ✅ | ✅ | **ĐÓNG** — `S6-SEC-ROTATE-1` |

| ~~KI-051~~ | **MỞ VÀ ĐÓNG 2026-07-30** — `S6-SEC-IDENTITYBOUND-1` (N-1d). `GET /recycle-bin/employees` gate `read:employee` rồi trả `userFullName` + `userEmail` của **MỌI** hồ sơ xoá mềm — `RecycleBinService.listDeletedEmployees` **không resolve một scope nào**. Đo PROD 2026-07-30: role SEEDED `employee` giữ `read:employee@Own` với **45/46 user sống** và **không có `view:user` nào** ⇒ mỗi nhân viên đọc được danh bạ toàn bộ nhân sự đã nghỉ việc. **Cùng lớp lỗi KI-049 nhưng 45 người giữ cặp thay vì 0.** Phơi nhiễm lúc phát hiện = **0 hàng** (0 hồ sơ xoá mềm) — chặn bởi *thiếu dữ liệu*, không phải bởi lớp kiểm soát nào; off-boarding đầu tiên là nó thành sống. **Vá** (khuôn N-1c, KHÔNG migration): `resolveOrNull(view:user)` → `buildUserScopeCondition` → khử ở tầng SQL (`case when`) rồi bỏ hẳn khoá ở service; `scope=null` ⇒ `logger.warn` + 0 danh tính. **RED chứng minh trước** (`identity-bound-scope.int-spec.ts`): ca `read:employee@Own` không `view:user` trả **2/2 danh tính** trước vá → **0** sau vá; hai ca đối chứng (`Company` thấy đủ · thiếu cặp gate vẫn **403**) xanh ở CẢ HAI phía. FE: `deletedEmployeeSchema` phải `.optional()` — khoá vắng mà schema đòi bắt buộc ⇒ ZodError dù HTTP 200 ⇒ **vỡ trắng trang cho đúng role mà bản vá bảo vệ**; đã khoá bằng ca console, và ca đó **đã chứng minh đỏ** khi gỡ `.optional()` | **S2** | Bảo mật (phân quyền) | ✅ | ✅ | **ĐÓNG** — `S6-SEC-IDENTITYBOUND-1` |
| ~~KI-052~~ | **MỞ VÀ ĐÓNG 2026-07-30** — `S6-SEC-IDENTITYBOUND-1` (N-1e). `GET /org/teams` chiếu `leaderUserName` (họ tên trưởng nhóm) không bound, gate `read:team`. Đúng hình dạng N-1c **ở phương thức bên cạnh trong chính file `org.repository.ts` mà `S6-SEC-ORGTEAMSCOPE-1` vừa vá** — vá lẻ theo route không quét hết file. `S3`: một cái tên mỗi team, `teams` = 0, role duy nhất giữ `read:team` mà thiếu `view:user` là `hr-manager` (**0 user sống**). Vá cùng khuôn. ⚠️ Khác N-1c: contract `leaderUserName` là `.nullable()` hợp lệ (team chưa có trưởng nhóm) ⇒ `null` KHÔNG phân biệt được "chưa có" với "ngoài scope", nên **bắt buộc bỏ khoá**, không được dựa vào `null` mang tin | S3 | Bảo mật (phân quyền) | ❌ | ❌ | **ĐÓNG** — `S6-SEC-IDENTITYBOUND-1` |
| ~~**KI-053**~~ | `PermissionAdminRepository.listRoleMembersTx` (`role-admin.repository.ts:158-159`) chiếu `email` + `fullName` của thành viên một role, `where` chỉ có `roleId` + `companyId` + `notDeleted` — **không vị từ scope nào**. Gate `read:role`/`view:role`, hôm nay chỉ `SA`(6) + `company-admin`(1) giữ, cả hai `@Company` ⇒ **rủi ro sống thấp**, nhưng vẫn là điểm chiếu không bound: role bất kỳ đúc sau này với `read:role` hẹp vẫn nhận trọn email. **Workaround:** không cấp `read:role` ngoài admin. Xử lý cùng `S6-SEC-IDENTITY-PROJ-1` (cơ chế). **HOÃN 2026-07-31 (owner chốt)** — verify lại còn thật ở `role-admin.repository.ts:166-174` (`where` = `roleId`+`companyId`+`notDeleted`+chưa-hết-hạn, không vị từ scope), nhưng hoãn theo `done_when` #6 của chính WO: *"S3 KHÔNG chặn RC; đang trong cửa sổ RC thì hoãn"*. Cửa sổ RC ĐANG MỞ (`RELEASE-07` §2: RC-003 + RC-004 CHƯA ĐẠT, tag `v1.0.0-rc.1` chưa tạo) và `S2` = 3/3 **sát ngưỡng** ⇒ refactor 79 điểm/31 file/12 module sinh thêm 1 `S2` là mất quyền cắt RC. Workaround ở trên là lớp kiểm soát duy nhất đang hiệu lực — **không cấp `read:role` cho role mới nào** cho tới khi gỡ hoãn | S3 | Bảo mật (phân quyền) | ❌ | ❌ | `S6-SEC-IDENTITY-PROJ-1` — **HOÃN ngoài cửa sổ RC** (mở 2026-07-30, hoãn 2026-07-31) | — ⏫ **ĐÃ ĐÓNG 2026-08-19 (`S6-SEC-IDENTITY-PROJ-1`).** ⚠️ **Đính chính mô tả gốc:** dòng này ghi gate là `read:role`/`view:role`; đo lại trên cây 2026-08-19 thì route `GET /auth/roles/:id/members` gate **`view:user`** (`role-admin.controller.ts:52`) và service còn `assertCan(view,user)` nữa. Khuyết tật VẪN THẬT nhưng khác hình dạng: cặp gate ĐÚNG mà `data_scope` **không bao giờ được đọc** ⇒ vai giữ `view:user@Own` qua được cả hai cổng rồi nhận trọn email + họ tên MỌI thành viên. Vá: `resolveOrNull` + `buildUserScopeConditionOn` + `identityColumns` khử ở SQL, service BỎ HẲN KHOÁ (contract `.optional()`). Kèm theo: `ORDER BY users.email` đổi sang cột ĐÃ CHE — che giá trị mà vẫn sắp theo cột gốc thì **thứ tự hàng rò thứ tự alphabet của thứ vừa che**. Bằng chứng: `identity-projection-scope.int-spec.ts` ca A1/A2/A3, và A2 **đã chứng minh ĐỎ** khi vô hiệu hoá `fromScope`. ⚠️ **RANH GIỚI của bản vá — bound CỘT, KHÔNG bound HÀNG:** vai `view:user@Own` vẫn nhận trọn `userId` + `status` + `expiresAt` của mọi thành viên, chỉ mất email/tên. Vế bound-HÀNG mở thành **KI-070**, và khi `S10-SEC-AUDITLOGROW-1` đóng KI-070 (2026-08-21) nó chỉ đóng **nửa hai bảng nhật ký** ⇒ vế của route NÀY tách sang **KI-071**. |
| ~~**KI-054**~~ | `login-log.repository.ts:72-73` + `security-event.repository.ts:84-88` chiếu `userEmail`/`userFullName`/`actorEmail`/`actorFullName` không bound; `AuthLogsViewerService` docstring ghi "Company-scope" nhưng **không resolve `data_scope`** — Company là mô tả ý định, không phải thứ được ép. Gate `view:audit-log` (`isSensitive`), hôm nay chỉ `SA` + `company-admin` @Company. Khác KI-053 ở chỗ **có dữ liệu thật**: 316 `login_logs` + 28 `user_security_events`. **Workaround:** không cấp `view:audit-log` ngoài admin. Xử lý cùng `S6-SEC-IDENTITY-PROJ-1`. **HOÃN 2026-07-31 (owner chốt)** — verify lại còn thật: `buildWhere` (`login-log.repository.ts:39-46`) chỉ nhận `userId`/`status`/`dateFrom`/`dateTo` **từ query param của caller**, không nhận `actor`, không resolve `data_scope` ⇒ "Company-scope" vẫn chỉ là chữ trong docstring. Cùng căn cứ hoãn với KI-053 (`done_when` #6 + cửa sổ RC mở + `S2` 3/3). ⚠️ Mức phơi nhiễm cao hơn KI-053 vì **có dữ liệu thật** (316 `login_logs` + 28 `user_security_events`) ⇒ workaround **không cấp `view:audit-log` cho role mới nào** là điều kiện bắt buộc của quyết định hoãn này, không phải gợi ý | S3 | Bảo mật (phân quyền) | ❌ | ❌ | `S6-SEC-IDENTITY-PROJ-1` — **HOÃN ngoài cửa sổ RC** (mở 2026-07-30, hoãn 2026-07-31) | — ⏫ **ĐÃ ĐÓNG 2026-08-19 (`S6-SEC-IDENTITY-PROJ-1`).** Vá: `AuthLogsViewerService` nay resolve `data_scope` của cặp danh bạ `view:user` (cặp GATE là `view:audit-log` — HAI cặp khác nhau ⇒ `resolveOrNull`, không `resolveAndAssert`). ⚠️ **Điểm đắt nhất của bản vá, do plan-review bắt được TRƯỚC khi code:** `security-event.repository` join `users` **HAI LẦN** (chủ thể `user_id` + người gây ra `actor_user_id` qua alias `sec_event_actor`). Bản vá tự nhiên nhất — một `identityCond` dùng chung — vừa **đẻ lỗ MỚI** (hàng có chủ thể = tôi ⇒ lộ email người gây ra) vừa **hồi quy đường ALLOW** (hàng tôi là người gây ra ⇒ giấu email của chính tôi). Nay HAI grant độc lập dựng trên cột của từng vai. Đã chứng minh bằng cách tạm thay hai grant bằng một: ca C2 và C3 ĐỎ đúng hai chiều. Kèm theo: `userRef()` nay tách nhánh "ngoài scope" ra khỏi `null` (trả `{id, display_name:null}`, KHÔNG khoá `email`). ⚠️ **Đính chính do `security-reviewer` bắt được TRƯỚC khi PR mở:** bản đầu của bản vá khai BA nhánh phân biệt được (không-gắn-user / ngoài-scope / user-đã-xoá) — **nhánh thứ ba KHÔNG THỂ CHẠM TỚI**: `users.email` là NOT NULL nên join trúng thì luôn có email, còn join TRƯỢT thì mọi cột NULL ⇒ vị từ cho `NULL` ⇒ cờ về `false` ⇒ hàng rơi vào nhánh "ngoài scope". Tức "user đã xoá cứng" và "ngoài scope" **chia chung hình dạng** `{id, display_name:null}`. Đã bỏ nhánh chết + ghi thẳng ranh giới vào docblock, thay vì để một lời hứa mà test không kiểm được — đúng lỗi mà chính KI-054 tố cáo, lần này suýt tái phạm ở sổ KI. Nhánh CŨ (không-gắn-user / user-đã-xoá) — bản gốc trả `null` khi thiếu email, mà `null` đã mang nghĩa "user đã xoá" ⇒ che email sẽ làm `null` mang hai nghĩa, đúng bẫy KI-052. `AuthLogUserRef.email` thành `.optional()`. **Cùng ranh giới bound-CỘT như KI-053** ⇒ **KI-070**. |

> **Đánh số:** `S6-QA-FINAL-1` (PR #294) chiếm **KI-024…026**; `S6-SEC-1` (PR #295) tiếp
> **KI-027…042**. Hai PR merge vào cùng bảng này — đã **giữ cả hai khối, không đánh số lại**
> (tài liệu khác đã trỏ tới số hiệu).
>
> **`S6-SEC-IDENTITYBOUND-1` (2026-07-30) chiếm KI-051…054.** KI-051/052 mở **và** đóng trong cùng
> WO ⇒ số `S2` mở ròng **không đổi** (`RELEASE-07` §2 giữ nguyên 3: KI-021 · KI-025 · KI-050).
> KI-053/054 mở dưới dạng **nợ có số hiệu** — cố ý không để chúng nằm dạng văn xuôi, vì một phát
> hiện không có số hiệu thì vô hình với bước bug scrub trước RC (`RELEASE-05` §5.3), đúng lỗi đã
> mắc với chính KI-049.
>
> **HOÃN `S6-SEC-IDENTITY-PROJ-1` — owner chốt 2026-07-31.** Cả KI-053 và KI-054 đã **verify lại là
> còn thật** (file:dòng ở hai dòng trên, đọc code chứ không tin số cũ) nhưng WO cơ chế được hoãn ra
> **ngoài** cửa sổ RC theo `done_when` #6 của chính nó. Ba dữ kiện chống lại việc làm ngay:
> (1) `RELEASE-07` §2 ghi **CHƯA CẮT ĐƯỢC RC** — RC-003 (staging `:3200` không lắng nghe) + RC-004
> (`mediaos_dev` lệch 5 migration) chưa đạt, tag `v1.0.0-rc.1` chưa tạo; (2) `S2` đang **3/3 sát
> ngưỡng** `RELEASE-05` §5.3 — nhận thêm 1 `S2` là mất quyền cắt RC, trong khi cơ chế này đụng **79
> điểm chiếu / 31 file / 12 module** và phải nhận 4 dạng căn cứ khác nhau (scoped-predicate ·
> self-bound-by-actor · waiver đã ký · job không có actor HTTP); (3) rủi ro sống của cả hai KI là
> thấp — chỉ `SA`(6) + `company-admin`(1) giữ cặp gate, cả hai `@Company`.
> **Điều kiện gỡ hoãn:** đã cắt tag `v1.0.0-rc.1` và qua `S6-GOLIVE-1`, hoặc owner chốt lại.
> ~~**Ràng buộc trong thời gian hoãn:** hai workaround là lớp kiểm soát DUY NHẤT đang hiệu lực —
> không cấp `read:role` / `view:audit-log` cho bất kỳ role nào ngoài admin. Cấp là lỗ thành sống.~~
>
> ⏫ **GỠ HOÃN + GỠ RÀNG BUỘC 2026-08-19 (owner chốt lại).** Căn cứ hoãn đã hết: tag `v1.0.0-rc.1…rc.3`
> ĐÃ cắt, `RELEASE-10` G1 + G7 đạt. KI-053/054 nay ĐÓNG bằng cơ chế nên ràng buộc trên không còn cần —
> giữ nó lại là tiếp tục hứa một lớp kiểm soát không ai ép.
>
> ⚠️ **VÀ NÓ ĐÃ BỊ PHÁ TRONG THỜI GIAN HOÃN — ghi lại vì đây là bài học, không phải sự cố.** Đo PROD
> 2026-08-19: vai **`QUẢN LÝ CẤP CAO`** (3 user sống) giữ **cả `read:role`/`view:role` lẫn
> `view:audit-log`**. Vai này ra đời 04/08 khi owner gỡ vai `SA` khỏi 4 tài khoản để **đóng cổng
> go-live G1** (`RELEASE-10` §6b) — tức việc đóng một cổng ở tài liệu này đã âm thầm phá ràng buộc của
> một quyết định hoãn ghi ở tài liệu khác. Mức thật: **KHÔNG thành lỗ sống**, vì cả ba vai đều
> `@Company` mà KI-053/054 là lớp "chiếu VƯỢT scope" — ở Company không có gì để vượt.
> **Bài học đáng giữ:** *một workaround dạng "đừng cấp quyền X" không phải lớp kiểm soát — nó là một
> lời hứa.* Không có gì trong hệ thống ép nó; nó bị phá bởi một thao tác hoàn toàn hợp lệ ở nơi khác,
> im lặng, và chỉ lộ ra khi có người đo lại 19 ngày sau. Đây chính là lý do WO này phải kết thúc bằng
> **cơ chế** (ratchet ở `identity-projection-ratchet.unit-spec.ts`) chứ không bằng bản vá thứ tư.
>
> ⚠️ **Dấu hoãn phải là `blocked`, KHÔNG phải `reopened`.** WO này đã bị `start-on-touch` đóng dấu
> `in_progress` NHẦM **2 lần trong ngày 2026-07-31** (glob `apps/api/test/**` và
> `apps/api/src/**/*.repository.ts` trong `paths` của nó bắt phải file của WO khác đang thi công).
> Cả hai lần đều vá bằng `reopened` — nhưng `harness/lib/wo-state.mjs:76` cho thấy `start-on-touch`
> chỉ xét WO có status hiệu dụng **`todo`**, mà `reopened` trả WO về đúng `todo` ⇒ vá kiểu đó **tái
> phát chắc chắn**. Ledger nay đóng dấu `blocked` (`wo-state.mjs:19`) ⇒ WO rơi khỏi
> `readyTodoMatches` và không auto-start nữa; đã chứng minh bằng cách chạy lại `autoStartOnTouch`
> trên đúng 2 đường dẫn đã gây WIP ảo — cả hai trả `null`. Lưu ý `harness/activity.jsonl` **bị
> gitignore** (state local từng máy) nên quyết định hoãn phải sống ở tài liệu này mới chia sẻ được.

**Tổng (cập nhật 2026-07-27 sau re-gate vòng 2 của `S6-SEC-1`):**
`S0 = **0 mở**` (**KI-043 rời danh sách 2026-07-28** — đóng bởi `S6-SEC-ROTATE-1`: rotate 5 role + cắt nguồn tái nhiễm + bind loopback + chốt hồi quy, bằng chứng hai chiều đo TỪ HOST; KI-028 · KI-032 · KI-038 **đều đã đóng VÀ verify trực tiếp trên PROD**, riêng KI-028 phải đóng lại lần hai ngày 2026-07-28) · `S1 = **0 mở**` (**KI-027 rời danh sách 2026-07-28** — dòng của nó ghi ĐÃ ĐÓNG kèm verify 3 lớp trên PROD, `RELEASE-01` §5 cũng ghi đóng; khối tổng còn ghi "1 mở" tới 2026-07-29 là **lệch sổ**, đã sửa. Cả 8 dòng mức `S1` trong bảng nay đều gạch) — **KI-030 rời danh sách 2026-07-27**, đóng bởi `S6-SEC-ORG-1` (3→2); **KI-034 rời danh sách 2026-07-28**, đóng bởi `S6-SEC-NOTITX-1` (2→1); KI-033 **đã vá**; KI-035 **đã vá + hạ xuống `S3`** (hai claim của gate đều sai, xem dòng của nó). KI-027 nay chỉ còn chờ admin enroll 2FA rồi bật cờ, vì gốc rễ KI-036 đã vá ·
`S2 = **3 mở**` (KI-021 · **KI-025** · **KI-050**) — **cập nhật 2026-07-30 (`S6-REL-1`)**: đóng **KI-011** (cảnh báo tự động) + **KI-016** (dist dùng chung); đối chiếu lại thì **KI-008 đã đóng từ 2026-07-29** bởi `S6-PERF-DB-1` và **KI-029 đã đóng từ 2026-07-28** bởi `S6-SEC-1` (`env.schema.ts:86`) — cả hai còn bị ĐẾM NHẦM là mở ở bản trước của dòng này; đổi lại **mở KI-050** (chưa từng có backup nào). 6 → 3, vừa đúng ngưỡng `RELEASE-05` §5.3 (≤3) — **KI-049 mở và đóng trong cùng ngày 2026-07-29/30** bởi `S6-SEC-ORGTEAMSCOPE-1` (7→6) — **KI-037 rời danh sách 2026-07-29**, đóng bởi `S6-QA-TENANTWRITE-1` (9→8); **KI-045 rời danh sách 2026-07-29**, đóng bởi `S6-SEC-ROTATE-1` (8→7); **KI-041 rời danh sách 2026-07-29**, đóng bởi `S6-SEC-MV-1` (7→6) · `S3 = **19**` (thêm **KI-046** từ lưới GHI mới; **KI-044 đóng** bởi `S6-SEC-LOGINLOG-2`, đổi lại **KI-047** + **KI-048** mở — tất cả 2026-07-29). **Cập nhật 2026-07-31 (`S6-SEC-XTENANTFK-1`):** `S3` vẫn **19** — **KI-046 đóng** (457 cặp hở → 11; lớp T 446 → 0), đổi lại **KI-055 mở** cho phần dư lớp G không vá được bằng composite FK. Đóng-1-mở-1 là CÓ CHỦ ĐÍCH: nợ còn lại phải có SỐ HIỆU, nếu không nó vô hình với bug-scrub trước RC. `S2` không đổi (3).
**Cập nhật 2026-07-31 (`S6-GOLIVE-1`):** `S2 = **4 mở**` (KI-021 · KI-025 · KI-050 · **KI-056**) — **VƯỢT ngưỡng `RELEASE-05` §5.3 (≤3)** ⇒ thêm một cổng chặn cắt RC. **KI-056 mở** (4/6 tài khoản `SA` toàn quyền không có 2FA) — cổng **rẻ nhất** để mở lại ngưỡng: 4 người enroll TOTP là `S2` về 3. **KI-050 KHÔNG đóng nhưng giảm mạnh**: đã có bản backup thật + chứng minh khôi phục được + tín hiệu giám sát hết `unknown`; còn lại lịch tự động + mã hoá + offsite. Nhân đó phát hiện `scripts/backup-db.sh` **chưa từng chạy được** trên máy PROD (đã vá + 6 test) và `backups/` **chưa hề được gitignore** trên repo PUBLIC. `S0` · `S1` · `S3` không đổi.

**Cập nhật 2026-08-02:** `S3` **19 → 20** — thêm **KI-057** (nghỉ bù bỏ trừ quỹ, owner chấp nhận). `S2` vẫn **4** (KI-021 · KI-025 · KI-050 · KI-056) — chưa mục nào đóng. Ghi số hiệu cho KI-057 thay vì để nó nằm dạng văn xuôi: một quyết định nới lỏng kiểm soát mà không có số hiệu thì vô hình với bug-scrub trước RC — đúng bài học đã trả giá với `accrual_method` và `max_negative_days` (biết mà chỉ ghi comment).

**Cập nhật 2026-08-03 (`S7-CHAT-BE-6`):** `S3` **20 → 21** — thêm **KI-059** (`outbox_events` không FIFO). `S2` vẫn **4** (KI-021 · KI-025 · KI-050 · KI-056). Mục này mở ra từ một ca test đỏ ngắt quãng của CHAT nhưng gốc nằm ở **hạ tầng event bus dùng chung**, không ở CHAT ⇒ cấp số hiệu riêng + WO riêng thay vì vá kèm trong WO nghiệp vụ: một khiếm khuyết hạ tầng nấp trong commit của module sẽ không bao giờ được hồi quy ở đúng tầng của nó.

**Cập nhật 2026-08-03 (`S7-INT-OUTBOX-FIFO-1`):** `S3` **21 → 20** — **KI-059 đóng** ngay trong ngày mở, ở
đúng tầng hạ tầng đã cấp số hiệu cho nó (không vá kèm trong WO nghiệp vụ CHAT). `S2` vẫn **4** (KI-021 ·
KI-025 · KI-050 · KI-056). Hai điểm đáng giữ lại làm tiền lệ: (1) **hồi quy đặt ở tầng của lỗi, không ở tầng
quan sát được lỗi** — spec mới sống ở `test/integration/outbox-fifo.int-spec.ts` (tầng events, đo THỨ TỰ
DISPATCH trực tiếp), còn ca 6b của CHAT chỉ là nghiệm thu end-to-end; nếu chỉ vá và dựa vào ca CHAT thì lần
regression sau sẽ đỏ ở một module ngẫu nhiên và mất thêm một phiên để truy lại. (2) **đóng KÈM giới hạn tồn
dư, không đóng lửng** — thứ tự trong CÙNG một transaction vẫn không được bảo đảm và điều đó ghi thẳng ở cả
dòng KI, jsdoc `claim()`, lẫn chú thích ca 6b; ba chỗ này là nơi người sau thực sự đọc.

**Cập nhật 2026-08-03 (`S7-CHAT-BE-GATE-3`, owner chốt 3 mục):** `S3` **20 → 21** — **KI-060 mở** (tệp
đa-link mất `url`, owner CHẤP NHẬN cho v1). `S2` vẫn **4**. Gate 5 lane trên toàn bề mặt CHAT đã vá 1
CRITICAL (URL ký rò cho cả phòng qua WS — hai lane độc lập cùng tìm ra) + 5 HIGH; chi tiết ở commit
`03f9a924`. Ba WO sinh ra và ĐÃ seed vào `harness/backlog.mjs`: **`S7-QA-CATALOGFIXTURE-1`** (🔴) ·
**`S7-CHAT-DB-3`** (🔴 expand-contract least-privilege) · **`S7-CHAT-CLEAN-2`** (🟡 dọn nhẹ). Ghi số hiệu cho KI-060 thay vì
để nó nằm dạng văn xuôi — theo đúng luật đã áp với KI-057: **một quyết định chấp nhận rủi ro mà không có
số hiệu thì vô hình với bug-scrub trước RC**.

**ĐÍNH CHÍNH thứ hai cùng ngày — `users` KHÔNG còn `DELETE` cho app role.** Phát hiện của lane L3 đọc
`0002_companies_users.sql:70` (`GRANT … DELETE ON users`) mà bỏ qua
`0467_s2_fnddb1_companies_users_revoke_delete.sql` **đã thu hồi**. Đo bằng
`has_table_privilege('mediaos_app','users','DELETE')` trên 2 lane DB: **false** ⇒ **runtime không với tới
được**. Phần CÓ THẬT và vẫn nằm trong `S7-CHAT-DB-3`: FK `ON DELETE CASCADE` từ `chat_messages.sender_id`
— hard-delete `users` ở tầng **owner** (script dọn / migration / cleanup của test) vẫn xoá cứng bảng
append-only. Tức đây là rủi ro **quy trình + FK**, KHÔNG phải lỗ phân quyền. Hai vế còn lại của WO đo lại
vẫn ĐÚNG: `UPDATE(visible_from_seq)` và `UPDATE` cấp bảng `chat_rooms` đều đang mở cho `mediaos_app`.

**ĐÍNH CHÍNH cùng ngày (commit `4f52948c`) — KHÔNG có lỗ phân quyền `update:project`.** Bản trước của
dòng này (và WO `S7-AUTH-CAPSWEEP-1`, đã GỠ) khẳng định `update:project` là `is_sensitive` nhưng ngoài
`SENSITIVE_CAPABILITY_ALLOWLIST` ⇒ màn quản trị đang ẩn trên PROD. **Sai.** Catalog thật khai
`('update','project', false)` (`0005:224`); `0485` bước (b) chỉ nâng 8 cặp và không có cặp này. Giá trị
`TRUE` đo được là **rác do fixture `WRITER_PAIRS` của `chat-be5-derived-rooms.int-spec.ts`** đóng dấu vào
`permissions` — bảng TOÀN CỤC, không `company_id`, `cleanupTenants` không chạm. Đo 5 DB: chỉ đúng lane
từng chạy chat-be5 là `t`, bốn DB còn lại `f`. **Bài học phương pháp, đáng nhớ hơn cả sự cố:** phép thử
"`git stash` rồi chạy lại trên CÙNG lane" — vốn trông rất thuyết phục — **không phân biệt được lỗi loại
này**, vì hỏng nằm trong DB chứ không trong code; stash bao nhiêu lần thì hàng catalog vẫn `t`. Muốn quy
trách nhiệm cho code thì phải đổi **DB sạch**, không phải đổi code.
**KI-045 mở 2026-07-28** trong lúc thi công `S6-SEC-NOTITX-1` — rotate của `S6-SEC-ROTATE-1` làm gãy
đường `LANE_DB`, tức **hàng rào deny-path/IDOR không chạy được bằng lệnh chuẩn** (8 → 9). **Đóng
2026-07-29 trong chính nhánh gây ra nó** (credential đọc từ `.env` qua `scripts/lib/db-secrets.sh`,
46/46 ca deny-path chạy thật chỉ với `LANE_DB`) ⇒ 8 → 7.
**⚠️ Đụng số hiệu đã xử lý khi merge (2026-07-29):** `S6-SEC-NOTITX-1` (#301) và `S6-QA-TENANTWRITE-1`
(#303) **cùng lấy số KI-045** vì thi công song song. Giữ **KI-045 = LANE_DB gãy** (merge trước),
**đánh lại số của lưới GHI thành KI-046** (458 FK một-cột) ở cả RELEASE-02 · plan · backlog · migration `0533`.
**KI-014 rời danh sách 2026-07-27** — đóng bởi `S6-QA-CHUNK-1` (9 → 8).
**KI-042 rời danh sách 2026-07-28** — đóng bởi `S6-SEC-LOGINLOG-1` (mig `0532`), `S3` 17 → 16;
**KI-044 mở cùng ngày** từ FULL gate của chính WO đó (hai reviewer độc lập cùng chỉ ra) ⇒ `S3` 16 → **17**.
**KI-044 rời danh sách 2026-07-29** — đóng bởi `S6-SEC-LOGINLOG-2` (18 → 17); **KI-047 mở cùng ngày**
từ chính việc khoanh ranh giới của WO đó (4 đường 429 khác không ghi `login_logs`, nặng nhất là dò mã
2FA ở bước-2 `verifyTwoFactorLogin`) ⇒ `S3` 17 → **18**; **KI-048 mở cùng ngày** từ FULL gate của chính
WO đó (hàng `blocked` nay hiện trong màn admin với tốc độ sinh do kẻ tấn công điều khiển) ⇒ `S3` 18 → **19**.
⇒ `S3` **18 → 19**: đóng 1, mở 2. Phân loại cho đúng, đừng gộp: **KI-047 là lỗ CÓ SẴN** (4 đường 429 chưa
bao giờ ghi `login_logs`), chỉ lộ ra khi khoanh ranh giới. **KI-048 thì KHÁC — nó là hệ quả DO chính bản
vá này tạo ra**: hàng `blocked` chuyển từ vô hình sang hiện trong màn admin, nên nhiễu do kẻ tấn công sinh
ra cũng hiện theo. Không phải rò rỉ, delta dung lượng = 0 (những dòng đó vốn đã ghi), nhưng nói "không
phải hồi quy" thì sai — đúng hơn: **cái giá đã biết của việc lấy lại tầm nhìn**, chấp nhận có ghi nhận.

> ✅ **KHÔNG CÒN `S0` MỞ (2026-07-28, sau `S6-SEC-ROTATE-1`).** KI-043 mở và đóng trong cùng ngày:
> mật khẩu 5 role đã rotate, nguồn tái nhiễm (`m roles`) đã cắt, 5 cổng hạ tầng đã về `127.0.0.1`, và
> literal cũ được chứng minh **hết hiệu lực khi thử TỪ HOST** — kèm ca đối chứng mật khẩu-bậy để loại
> khả năng `trust`. Hết chặn go-live theo `RELEASE-05` §5.3.
>
> ⚠️ **Nợ còn lại (KHÔNG chặn go-live, chưa có KI riêng):** literal cũ **vẫn nằm trong git history** vì
> quyết định không history-rewrite. Sau rotate chúng vô hiệu, nhưng bất kỳ ai đọc lịch sử vẫn thấy
> *hình dạng* cấu hình cũ. Nếu về sau repo chuyển private hoặc có audit ngoài, cân nhắc lại.
>
> ~~✅ **KHÔNG CÒN `S0` MỞ (2026-07-27) — đã verify trực tiếp trên PROD.**~~
> Ba lỗ `S0` do FULL gate của `S6-SEC-1` tìm ra đều đóng:
>
> | | Đóng bằng | Verify trên PROD (read-only) |
> | --- | --- | --- |
> | KI-028 | ⟲ **đóng lại 2026-07-28** bằng `S6-SEC-DBFENCE-1` (hàng rào 3 lớp + `scripts/s6-dbfence-purge-test-tenants.sql`). Bản 27/7 (`s6sec1-contain-test-tenants.sql`) chỉ phủ 16/74 và **không bịt nguồn rò** | company khớp mẫu test = **0**/1 · user test active = **0** · grant `platform-admin` = **0** · `funtime` **46 (35/11)** · `check-prod-test-tenants.mjs` exit **0** · suite 449 file không `LANE_DB` ⇒ **0** company mới |
> | KI-032 | mig `0530` | policy `…no_delete_system` `cmd=d`/`permissive=f` · grant `roles` hết `DELETE` |
> | KI-038 | mig `0531` | 2 trigger `enforce_company_id_immutable` trên `notification_%`, `tgenabled='O'` (đang hoạt động, không phải chỉ tồn tại) |
>
> Chi tiết: `_review/S6-SEC-1-SECURITY-HARDENING-2026-07-26` §0.1 · §7d · §7e.

~~Không có defect sản phẩm mức S0/S1 nào đang mở.~~ — **câu này đúng tới trước FULL gate 2026-07-26,
nay KHÔNG còn đúng** (xem trên). KI-001/KI-002 **đã đóng**; KI-006 hạ xuống S3 (chỉ còn bước cấu hình
token + deploy). Giữ nguyên số hiệu KI để tài liệu khác trỏ tới không bị gãy.

> **Ngưỡng RC** (`RELEASE-05` §5.3) cho phép **≤3** mục S2 mở, mỗi mục có owner + workaround. Hiện
> **7** (KI-014 đã đóng 2026-07-27) ⇒ trước khi tạo RC vẫn phải đóng bớt hoặc owner ký waiver tường
> minh cho phần vượt. Hai mục còn nằm trong tầm đóng ở Sprint 6: **KI-008** (diễn tập restore —
> `S6-PERF-DB-1`) · **KI-016** (tách `dist` — cần mở `S6-OPS-DISTSPLIT-1`).
> **KI-030 đã đóng 2026-07-27** (`S6-SEC-ORG-1` — gate `read:user` + `read:team`); nó **không** nằm
> trong con số 7 nên ngưỡng RC giữ nguyên.
>
> ⚠️ **Lệch số có từ TRƯỚC WO này, không phải do nó gây ra:** bảng đếm ở trên ghi `S2 = 9 mở` trong
> khi khối ngưỡng RC ghi `8` (khối RC không tính **KI-028**, vốn đã đóng nhưng vẫn nằm trong danh
> sách "trong tầm đóng"). `S6-QA-CHUNK-1` chỉ trừ **KI-014** khỏi cả hai (9→8 và 8→7) và **giữ
> nguyên** chênh lệch cũ thay vì sửa lén cho khớp — việc rà lại thuộc `S6-REL-1` (bug scrub trước RC).
>
> **Và một mục `S1` mới: KI-027.** Không chặn RC theo chữ nghĩa của `RELEASE-05` §5.3, nhưng **nên
> đóng trước go-live** — thao tác ~10 phút của owner, không cần sửa code (thứ tự bắt buộc ở
> `_review/S6-SEC-1-SECURITY-HARDENING-2026-07-26` §6.1: **enroll 2FA TRƯỚC, bật cờ SAU** — làm ngược
> là tự khoá mình ra khỏi hệ thống).
---

## 2. Chi tiết

### KI-001 — Tài khoản UAT chưa gắn hồ sơ nhân viên · S2 · ✅ ĐÃ ĐÓNG 2026-07-26

> **Đã đóng:** tạo `UAT-EMP-01` (phòng Nội Dung, quản lý trực tiếp = `uat.manager`) · `UAT-MGR-01` ·
> `UAT-HR-01` (phòng Nhân Sự) trong `mediaos_dev`, set **cả** `direct_manager_id` **lẫn**
> `employee_manager_relations`. Bơm bằng SQL idempotent ⇒ **không có vết `audit_logs`** (đánh đổi đã
> ghi rõ ở `S5-UAT-1-UAT-CYCLE0-DRYRUN.md` §0).

**Kiểm chứng:** `SELECT u.email, e.employee_code FROM users u LEFT JOIN employee_profiles e ON e.user_id=u.id …`
→ cả 4 tài khoản `uat.*` trả `NULL`.
**Hệ quả:** `GET /attendance/today` trả rỗng kèm thông báo "chưa có hồ sơ"; `POST /attendance/check-in`
→ **403** (`attendance.service.ts:362-363`). Kéo theo chấm công · nghỉ phép · bảng công cá nhân · widget
Employee đều không chạy được.
**Workaround:** `/hr/employees` → tạo/chọn hồ sơ → **Liên kết tài khoản**; rồi `/hr/org-chart` đặt
`uat.manager` làm quản lý trực tiếp của `uat.employee`.

### KI-002 — Chưa có số dư phép · S2 · ✅ ĐÃ ĐÓNG 2026-07-26

> **Đã đóng:** số dư 2026 — `uat.employee` ANNUAL 12 + SICK 5 · `uat.manager` ANNUAL 12
> (`remaining_days` là cột GENERATED `total_days - used_days`, không ghi tay).

**Kiểm chứng:** `SELECT count(*) FROM leave_balances` → **0**. `leave_types` `ANNUAL`/`SICK`/`COMPENSATORY`
có `deduct_balance = true`, `allow_negative_balance` NULL.
**Hệ quả:** tạo đơn nghỉ loại trừ phép → **422** "Số dư phép không đủ" (`leave-request.service.ts:545-552`).
**Workaround:** `/leave/balances` → cấp số dư phép năm (ghi giao dịch append-only).

### KI-003 — Loại nghỉ phép trùng bản chữ thường · S3

**Kiểm chứng:** `leave_types` có cả `ANNUAL/SICK/UNPAID` (chuẩn) lẫn `annual/sick/unpaid` (`deduct_balance`
NULL) → 11 dòng.
**Hệ quả:** danh sách chọn loại nghỉ hiện lặp; chọn nhầm bản chữ thường thì **không trừ phép**.
**Workaround:** xoá mềm 3 bản chữ thường ở `/leave/types` sau khi xác nhận không đơn nào tham chiếu.

### KI-004 — Chưa nhập ngày lễ · S3

`SELECT count(*) FROM public_holidays` → **0**. Số ngày nghỉ tính không trừ ngày lễ.
**Workaround:** `/system/public-holidays` nhập lịch lễ trước khi tính công/phép cho kỳ thật.

### KI-005 — Widget "Thông báo" trễ trong TTL · S3

Widget `NOTIFICATIONS` **không tự vô hiệu cache** khi có thông báo mới ⇒ số liệu cũ trong TTL ~10s rồi
tự lành. Đã có test khoá hành vi này: `qa2-e2e-task-noti-dash.int-spec.ts` (ca E3 — "known-issue
QA2-HIGH-001"). Chuông thông báo (không qua widget) **không** bị ảnh hưởng.

### KI-006 — LMS→NOTI chưa hoạt động · S2 → S3 (một nửa đã đóng 2026-07-26)

> **Đã đóng phần migration:** `m migrate` (PROD `mediaos`) + `m dev-online-migrate` (UAT
> `mediaos_dev`) ⇒ **cả hai 197/197**, 4 mã `LMS_*` có mặt. PROD health 200 sau migrate — 0529 chỉ
> nới CHECK + INSERT catalog nên **không cần restart** service. **Còn lại:** đặt `LMS_NOTI_TOKEN`
> hai phía + deploy theo `docs/plans/S5-LMS-NOTI-2.md` §4.

**Kiểm chứng:** `mediaos_dev` **và** `mediaos` (PROD) đều áp **196/197** migration;
`SELECT event_code FROM notification_events WHERE event_code LIKE 'LMS%'` → **0 dòng** ở cả hai.
**Hệ quả:** 4 mã sự kiện `LMS_ENROLLMENT_APPROVED` · `LMS_COURSE_ASSIGNED` · `LMS_EXAM_GRADED` ·
`LMS_COURSE_DEADLINE_NEAR` chưa tồn tại ⇒ intake từ LMS sẽ **404 event không tồn tại**.
**Code đã xong cả hai phía** (`S5-LMS-NOTI-1` merged PR #291 · `S5-LMS-NOTI-2` + runbook deploy
`153e2101`); còn **thiếu bước vận hành**: (1) áp `0529`, (2) đặt `LMS_NOTI_TOKEN` vào **cả**
`.env.prod` lẫn `.env` phía MediaOS và `apps/lms/.env.production` phía LMS, (3) deploy đúng thứ tự
API → LMS.
**Workaround/cách đóng:** `m dev-online-db` (UAT) · `m prod-update` (PROD — đã ép migrate trước
restart) · làm theo `docs/plans/S5-LMS-NOTI-2.md` §4 (runbook).

### KI-007 — CI Dependency scan đỏ vì công cụ · S3

`Security` workflow: job gitleaks **xanh**, job `pnpm audit` **đỏ** với
`ERR_PNPM_AUDIT_BAD_RESPONSE` (endpoint advisory npm trả body gzip pnpm không parse được).
**Tái hiện y hệt khi chạy `pnpm audit --audit-level=high` ở local** ⇒ lỗi phía công cụ/registry, **chưa
chứng minh có lỗ hổng high/critical**. **Cảnh báo:** đừng dùng job này làm bằng chứng "sạch lỗ hổng" —
hiện nó không nói được gì cả.

### KI-008 — Chưa diễn tập khôi phục backup · S2 · ✅ ĐÃ ĐÓNG 2026-07-29 (`S6-PERF-DB-1`)

Mô tả gốc: có `scripts/backup-db.sh` + `scripts/backup-restore-drill.sh` nhưng không có biên bản drill nào.

**Đã đóng (#307, `DEVOPS-13` §3.1).** Truy ra gốc: drill **chưa từng chạy được** kể từ khi Postgres vào
container — script đòi `pg_dump`/`pg_restore`/`psql` trên PATH của host Windows (không có), fail ngay 3
dòng `command -v`. Vá bằng fallback `DRILL_PSQL`/`DRILL_PG_DUMP`/`DRILL_PG_RESTORE` qua `docker exec`,
rồi chạy thật: dump → restore DB tạm → verify chuỗi migration + schema/RLS/index → tự dọn = **PASS**.

⚠️ **Đóng KI này KHÔNG có nghĩa là "đã có backup".** Drill tự `pg_dump` tại chỗ; việc chưa hề có bản
backup định kỳ nào trên máy PROD là vấn đề RIÊNG — **KI-050** (mở 2026-07-30).

### KI-009 / KI-010 / KI-011 — 3 khuyến nghị treo từ S5-PERF-1

Nguyên văn `DEVOPS-10_Performance_Smoke_Observability_Baseline_Report.md` §4.2: R1 log JSON có cấu trúc ·
R2 phân trang thật cho `GET /employees` (hiện chặn bằng cap **2000 dòng**, có warn-log khi chạm cap —
không cắt câm) · R3 cảnh báo tự động. **KI-011 là điều kiện go-live**, hai cái kia không.

**KI-009 — ĐÓNG 2026-08-13 (`S10-FND-JSONLOG-1`).** `apps/api/src/common/logger/json-console-logger.ts`
thay `Logger` văn xuôi mặc định của Nest bằng `JsonConsoleLogger` (kế thừa `ConsoleLogger` built-in của
Nest 11, bật `json:true`) — đăng ký MỘT LẦN ở `main.ts` (`NestFactory.create(AppModule, { logger })`)
là đủ cho MỌI `new Logger(context)` rải khắp 100+ service/repository, vì Nest override
`Logger.staticInstanceRef` toàn cục, không cần sửa từng file gọi log. Mỗi dòng log là JSON phẳng:
`timestamp` (epoch ms) · `level` · `context` · `request_id` (gắn qua `AsyncLocalStorage` mở ở
`requestIdMiddleware`, `apps/api/src/common/logger/request-context.ts`) · `message`.

**Khớp nối ẩn đã xử lý cùng lúc (đúng lý do WO tồn tại):** `scripts/lib/ops-log-window.mjs` đọc file
log để nuôi `ERROR_SPIKE` (`ops-alert-rules.mjs`) — đổi format mà không sửa bộ đếm sẽ làm rule đếm 0
mãi mãi. Đã vá `parseJsonLogLine` đọc `{timestamp,level}` JSON, **giữ song song** nhánh Nest văn xuôi
cũ (`parseLogTimestamp`/`ERROR_MARK_RE`) để tail log lẫn cả hai định dạng ngay sau lúc restart/deploy
vẫn đếm đúng — không có cửa sổ mù nào giữa lúc đổi format. **Bằng chứng BẺ HỎNG** (không chỉ nhìn hệ
đang khoẻ): bơm 19/20/200 dòng lỗi JSON giả qua trọn pipeline `countErrorLinesInWindow → evaluate() →
exitCodeFor()` thật của `ops-alert-rules.mjs`, đo severity/exit code đổi đúng ngưỡng (`ok`/0 ·
`warn`/1 · `crit`/2) — `scripts/lib/ops-log-window.test.mjs`, 34/34 test (`node --test`).

**BẤT BIẾN #3:** `log-redaction.ts` che secret theo HAI lớp — tên field nhạy cảm
(`password`/`token`/`x-internal-key`/`dsn`/…) bị thay `[REDACTED]` bất kể giá trị, VÀ mẫu trong chuỗi
tự do (connection-string `scheme://user:pass@host`, `Authorization: Bearer <token>`, JWT, `key=value`
nhạy cảm nằm rời trong message) bị quét-thay. An toàn với object vòng (circular). 26 test đơn vị
(`apps/api/src/common/logger/{log-redaction,json-console-logger,request-context}.spec.ts`), gồm ca
redact secret trong `message` VÀ trong `error.stack`.

### KI-012 / KI-013 — 2 quyết định bảo mật cần đóng sổ

- **D3 (KI-012):** widget `hr-overview` count-only, đã mask PII, gate bằng **quyền widget** chứ không
  theo data-scope ⇒ HR được cấp scope Department vẫn thấy **con số** headcount toàn công ty. Không lộ
  PII cá nhân. **Cần owner ký chấp nhận cho MVP** (`RELEASE-04` §3).
- **D1 (KI-013):** `refresh` không throttle nhưng có reuse-detection + `FOR UPDATE`; `resetPassword`
  không throttle nhưng token entropy cao, lưu hash, dùng-một-lần, hết hạn ngắn. Kết luận: giữ nguyên,
  không thêm throttle suy đoán vào `auth.service.ts` (crown).

### KI-014 — Suite API crash khi chạy 1 tiến trình · S2 (hạ tầng test) — ✔ ĐÃ ĐÓNG 2026-07-27

> **ĐÓNG bởi `S6-QA-CHUNK-1`.** Phần mô tả bên dưới giữ nguyên làm lịch sử; **hai câu quy kết
> "bất ổn native của máy" và "chia chunk là workaround duy nhất" nay đã bị số đo bác bỏ** — xem
> khối *Kết quả truy gốc* ngay sau đó.

Chạy cả `@mediaos/api` một lần → `Unhandled Rejection: Channel closed` / `ERR_IPC_CHANNEL_CLOSED`,
**0 ca test đỏ**, suite chết giữa chừng. `--no-file-parallelism` **không** cứu được (chết ở file thứ 61).
**Workaround duy nhất đang có: chia chunk** (6 lệnh vitest × ~75 file → 445 file / 7.113 test, 0 fail).
**Vì sao là S2:** nó làm `check.sh` in ĐỎ khi thực chất xanh ⇒ dễ dẫn tới bỏ qua đỏ THẬT.

**Cập nhật 2026-07-26 (`S6-STAB-1` — 2 đính chính, chi tiết `RELEASE-06` §4.4):**

1. **Không riêng API.** `@mediaos/app` cũng chết y hệt (`ERR_IPC_CHANNEL_CLOSED`; qua pnpm còn thấy
   exit `3221225477` = `0xC0000005` ACCESS_VIOLATION). Chia nhỏ → **199/199 file spec xanh**. Crash phụ
   thuộc **kích thước chunk**, không gắn với file nào: gộp `routes/{tasks,hr,goals}` (64 file) chết,
   tách từng cái thì xanh.
2. **CI KHÔNG dính — đây là chuyện máy local Windows.** CI chạy `ubuntu-latest`: `ci.yml:140` gọi
   `pnpm test` toàn workspace **một lần**, `apps-frontend.yml:95` chạy từng app; cả `CI` · `API — CI` ·
   `Apps — Frontend CI` đều **success** trên `dcf85eb0`. `api.yml` cũng đã set `LANE_DB: mediaos` ở
   bước Test (từ 2026-07-10) ⇒ deny-path/IDOR **có chạy thật** trong CI.

⇒ **Hạ "chặn go-live" từ ⚠️ xuống ❌**: không chặn release (CI vẫn là cổng thật). Cái nó chặn là **cổng
verify local** — `harness/check.sh` mọi tier không thể xanh trên máy Windows này.

#### Kết quả truy gốc 2026-07-27 (`S6-QA-CHUNK-1`) — ĐÓNG

Số đo đầy đủ (ma trận pool · maxForks · isolate · tầng gọi · Node 22 vs 24, mỗi ô 3 lần chạy):
**`docs/QA/evidence/S6-QA-CHUNK-1-KI-014-ROOT-CAUSE.md`**.

**Gốc:** `tinypool@1.1.1` — `ProcessWorker.send()` chỉ chặn `if (!this.isTerminating)`, **không** kiểm
tra kênh IPC đã đóng. Worker fork thoát ngoài dự kiến ⇒ message birpc còn trong hàng đợi MessagePort
vẫn bị đẩy vào `process.send()` của tiến trình chết ⇒ `ERR_IPC_CHANNEL_CLOSED` nổ ở **tiến trình
chính** ⇒ vitest tính Unhandled Rejection ⇒ cả run ĐỎ dù 0 test sai.

**Ba đính chính so với mô tả ở trên:**

1. **KHÔNG phải "bất ổn native của máy" (nghi RAM/XMP).** `pnpm test` đỏ **5/5 lần** — tái hiện 100%.
2. **KHÔNG phải kích thước chunk hay file thủ phạm.** Package nạn nhân **đổi ngẫu nhiên mỗi lần**:
   `console` (23 file) · `api` · `app` · `web-core` (39 file). Suite nhỏ cũng chết.
3. **KHÔNG phải lệch runtime Node 24-local vs Node 22-CI.** Chạy lại bằng đúng Node 22.23.1 của CI:
   **vẫn crash**. CI xanh vì runner ubuntu chỉ 2–4 nhân ⇒ vitest sinh 1–3 worker; máy dev 32 nhân sinh
   **31 worker/package** ⇒ trúng đua liên tục.

**Cũng bác bỏ "chia chunk là workaround duy nhất":** hạ trần `maxForks` cứu được `@mediaos/app`
(3/3 xanh ở 16) nhưng **không** cứu `@mediaos/api` ở bất kỳ trần nào; `--pool=threads` **tệ hơn**
(SIGSEGV 139); `--no-isolate` sinh test đỏ thật.

**Vá:** `harness/chunk-test.mjs` — chia chunk (≤40 file/tiến trình) + hạ trần worker (8) + **chạy lại
chỉ chunk chết vì hạ tầng**. Luật chạy-lại an toàn vì đo được **27/27 lần crash đều có 0 test đỏ**;
có test đỏ ⇒ cấm chạy lại. Runner đối chiếu số file với `vitest list` (thiếu file ⇒ ĐỎ) và **công bố**
6 file `exclude` của `apps/api/vitest.config.ts`. `check.sh` dùng runner **chỉ trên Windows**; CI
ubuntu giữ nguyên `pnpm test` một lần.

**Verify (điều kiện đóng WO):** `LANE_DB=mediaos_qachunk bash harness/check.sh --all` → **XANH**
(lint ✅ typecheck ✅ test ✅ build ✅, 4m32s) — lần đầu `check.sh` xanh thật trên máy Windows này.
Phủ **761/761 file spec** toàn workspace (api 448 · app 199 · console 23 · web-core 39 · contracts 32 ·
ui 16 · auth 4). `lane-db-guard` vẫn bắt được thiếu `LANE_DB` qua runner mới (184 file skip → `red` ở
tier `--all`); `harness/lane-db-guard.test.mjs` 14/14.

### KI-015 — Nhiễu log outbox bridge trong test · S3 — ✔ ĐÃ ĐÓNG 2026-08-13

> **ĐÓNG bởi `S10-QA-LOGNOISE-1`.** Phần mô tả gốc bên dưới giữ nguyên làm lịch sử; giả thuyết root-cause
> của nó **ĐÚNG tại thời điểm viết** nhưng **không còn tái lập được hôm nay** — xem khối *Kết quả truy
> gốc* ngay sau đó.

`OutboxNotificationBridge … intake THẤT BẠI` (6 lần trên lane sạch). Truy tới gốc: nhánh `no_recipient`
→ `recordSkip` → INSERT `audit_logs` vỡ **FK `audit_logs_actor_user_id_fkey`** vì outbox drain chạy sau
khi spec đã dọn user của mình. **Production không dính** (user là xoá mềm — BẤT BIẾN #2).
**Việc:** đợi outbox drain xong trước teardown, hoặc bỏ `actorUserId` khỏi audit skip.

**Kết quả truy gốc (`S10-QA-LOGNOISE-1`, 2026-08-13, đo thật KHÔNG đoán):**

1. **Đo lại bằng thực nghiệm.** Chạy 29 file khớp `*noti*` (task/leave/att/auth-hr/chat-noti-e2e +
   qa2-e2e-task-noti-dash — 488 test) trên `LANE_DB` cô lập, `TURBO_FORCE=1` (chống cache xanh-giả):
   **đúng 1 nguồn** phát dòng `intake THẤT BẠI` — `chat-noti-e2e.int-spec.ts` ca 14 (`S7-CHAT-BE-6`),
   phát ra **5** dòng (không phải 6 như số đo cũ — lệch vì môi trường khác nhau, không lệch về bản chất).
2. **Ca 14 CỐ Ý gieo lỗi.** Test tự comment rõ: *"payload THIẾU trường bắt buộc ⇒ dead-letter LOUD,
   KHÔNG 'done' im lặng"* — gieo thẳng `chat.message.direct_sent` thiếu `recipientUserId` vào outbox để
   khoá đúng chỗ dễ trôi: nếu bridge lỡ nuốt lỗi này, một đổi tên khoá tương lai (`roomId`→`room_id`) sẽ
   tắt TOÀN BỘ thông báo CHAT mà CI vẫn xanh, log vẫn sạch. Test ĐÃ tự `expect()` trên
   `dead_letter_events` (1 dòng) + `outbox_events.status != 'done'` — tức đã tự "biến nhiễu thành bằng
   chứng" từ trước, đúng tinh thần WO này.
3. **5 dòng = 1 lỗi, KHÔNG PHẢI 5 lỗi khác nhau.** `OutboxWorker.MAX_ATTEMPTS = 5`; mỗi lần retry, bridge
   log ĐÚNG MỘT LẦN trước khi re-throw cho worker. Cả 5 lần dồn vào < 1 giây vì
   `test/helpers/outbox-drain.ts` (`drainOutboxUntilSettled`) chủ động kéo `available_at` về `now()` để
   khỏi đợi backoff 30s thật giữa các lần retry (mục đích: test nhanh) — production cùng một lỗi cũng ra
   đúng 5 dòng log, chỉ trải trên ~150 giây thay vì <1 giây.
4. **Giả thuyết FK gốc ĐÚNG-tại-thời-điểm, do MỘT NGUYÊN NHÂN KHÁC, đã đóng.** Khi KI-015 được viết
   (2026-07-26), `outbox_events` là bảng CHUNG và `OutboxWorker.claim()` không lọc tenant; 11 int-spec
   cùng lái worker trên 1 lane DB có thể khiến worker của spec A claim+xử lý event của spec B SAU KHI B
   đã teardown (dọn user) — đúng hình dạng "outbox drain chạy sau khi spec đã dọn user của mình" mà ghi
   chú gốc mô tả (KI-059). Mutex toàn cục `test/helpers/outbox-worker-lock.ts`
   (`S7-QA-OUTBOXPROBE-1`, 2026-08-03) đã khoá đường chéo-spec đó — mọi spec lái worker giờ xếp hàng.
   Xác minh lại hôm nay: `outbox-worker-lock.unit-spec.ts` (điểm danh MỌI spec gọi
   `processBatch`/`drainOutboxUntilSettled`, bắt phải giữ khoá) **2/2 PASS** ⇒ không còn spec nào bỏ sót
   khoá, đường FK-vỡ-chéo-spec không còn tái lập được.
5. **Kết luận:** hành vi ĐÚNG-nhưng-ồn (không phải lỗi) — KHÔNG hạ log level / bọc `catch {}`.
   `apps/api/src/notifications/outbox-notification-bridge.service.ts` được bổ sung docblock ghi lại
   nguyên văn kết quả này; `outbox-notification-bridge.service.spec.ts` (mới, 7 test, unit — không cần
   DB) khoá chiều NGƯỢC LẠI: `intake()`/`resolveRecipients()` ném lỗi THẬT (đường production) → bridge
   VẪN log + re-throw NGUYÊN error — chống hồi quy "vá nốt nhiễu" bằng cách nuốt lỗi.
6. **Vòng 1 bị Đội 3 bác — nhiễu VẪN in ra.** Bản đóng đầu (khối 1–5 ở trên) chỉ ghi bằng chứng vào
   docblock của bridge, KHÔNG chạm nơi PHÁT (`chat-noti-e2e.int-spec.ts` ca 14) — done_when #3 ("test
   phải KHẲNG ĐỊNH nó thay vì để nó in ra") và #5 ("suite không còn dòng nhiễu") CHƯA đạt. Đo lại độc
   lập trên DB cô lập mới vẫn thấy đúng 5 dòng bridge + 1 dòng DEAD-LETTER — repo `paths` hẹp của WO gốc
   không phải lý do hợp lệ để hoãn: `done_when` có hiệu lực cao hơn danh sách `paths` khai lúc seed
   (CLAUDE.md §9 — guard-scope chỉ CẢNH BÁO khi sửa ngoài `paths`, không chặn).
7. **Vòng 2 (`S10-QA-LOGNOISE-1-FIX-A`) — vá TẠI ĐÚNG NƠI PHÁT.** Thêm
   `apps/api/test/helpers/expect-logged-errors.ts` (`withExpectedLoggerErrors`): spy
   `Logger.prototype.error` PHẠM VI HẸP quanh đúng 1 lệnh gọi (`patch`/`un-patch` quanh `drain()`), chỉ
   NUỐT dòng khớp mẫu đã khai kèm đếm `[min..max]` bắt buộc (lệch — kể cả 0 lần — làm spec ĐỎ), dòng
   KHÔNG khớp FORWARD nguyên vẹn ra logger thật (lỗi thật khác trong cùng cửa sổ vẫn kêu to). Gắn vào ca
   14, khớp đúng `OutboxWorker.MAX_ATTEMPTS` (5) dòng bridge + 1 dòng DEAD-LETTER, cả hai neo theo
   `recipientUserId` (payload cố ý gieo lỗi của đúng ca này — không nuốt nhầm lỗi khác).
8. **Vòng 3 (`S10-QA-LOGNOISE-1-FIX-B`, 2026-08-13) — ĐO LẠI ĐỘC LẬP, đóng sổ theo bằng chứng mới.**
   Tạo LANE_DB mới hoàn toàn (`mediaos_s10qalogfixb`, tách khỏi mọi lần đo trước), `TURBO_FORCE=1`:
   `chat-noti-e2e.int-spec.ts` riêng lẻ **22/22 test PASS, 0 dòng** `intake THẤT BẠI`/`DEAD-LETTER`; cả
   **20 file khớp `*noti*int-spec.ts` (381 test) chạy chung — 20/20 file PASS, grep toàn bộ output ra 0
   dòng nhiễu đó** (2 dòng ERROR còn lại là `AllExceptionsFilter` của ca 11 — lỗi 500 CỐ Ý gieo cho kịch
   bản rollback-transaction khác, ngoài phạm vi KI-015, không đổi). done_when #3 và #5 nay ĐẠT bằng đo
   thật của chính lần chạy này — không còn việc "còn nợ cosmetic" nào bị đẩy sang WO khác.

### KI-016 — PROD dùng chung `dist` với dev-online · S2

Service PROD `MediaOS-API` chạy thẳng `apps/api/dist/main` của repo dev. Cả `m dev-online` lẫn
`m dev-online-fast` đều biên dịch lại thư mục đó ⇒ bật môi trường UAT có thể làm PROD nạp binary mới
trong khi DB PROD chưa áp migration tương ứng (đã từng gây PROD login 500 ngày 2026-07-08).
**Việc (go-live blocker):** cấp thư mục build riêng cho PROD.

### ~~KI-017~~ — Refresh MV dashboard qua workerDb hỏng từ G14 · S3 · **ĐÃ ĐÓNG 2026-08-13 (2 nửa, 2 WO)**

`dashboard-refresh.service.ts:19-22` ghi rõ: REFRESH đòi role **owner** của materialized view (=`mediaos`),
nhưng `refreshDb` ưu tiên `workerDb` (`mediaos_worker`) ⇒ đường refresh runtime fail "must be owner" ở
mọi môi trường có `DATABASE_WORKER_URL`. Trước khi đóng, **chưa consumer nào gọi tới** nên không lộ ra
người dùng. **Cấm sửa nhanh bằng `ALTER OWNER` cho worker** — worker không BYPASSRLS + `tasks` FORCE RLS
⇒ MV sẽ **rỗng lặng lẽ**, tệ hơn lỗi hiện tại (giữ nguyên, chưa ai làm vậy).

**Nửa 1 — privilege, ĐÓNG `S6-SEC-MV-1` (mig 0534, 29/07/2026):** hàm `refresh_dashboard_mvs()`
SECURITY DEFINER (owner `mediaos`, BYPASSRLS) — worker chỉ cần EXECUTE, không còn cần là owner MV. Xem
docblock `mig 0534` + `dashboard-refresh.service.ts:19-35`.

**Nửa 2 — lịch chạy, ĐÓNG `S10-DASH-MVREFRESH-1` (2026-08-13):** trước WO này KHÔNG có gì tự gọi
`DashboardRefreshService.refresh()` định kỳ — đường DUY NHẤT là bấm tay `POST /dashboard/refresh`
(vẫn GIỮ NGUYÊN, không thay thế). Nay có `DashboardMvRefreshJobHandler` (`@SystemJobHandler()`, khai
trong `providers` của `DashboardModule`, `SchedulerModule` tự gom qua `DiscoveryService`) chạy theo nhịp
`system-jobs` (mặc định 60s), tự throttle nội bộ theo `DASHBOARD_MV_REFRESH_INTERVAL_MS` (mặc định 5
phút, hằng số có tên + cấu hình qua env, clamp [30s, 1h]) để không refresh trùng nhiều lần trong CÙNG
một tick khi có nhiều tenant. Lỗi refresh KHÔNG bị nuốt (không `.catch` — mirror bài học KI-034): propagate
cho `JobRunner` finalize run-row `system_job_runs` = `Failed` + log ERROR. Chứng minh job THẬT SỰ làm mới
dữ liệu (không chỉ "chạy không lỗi") bằng đo hàng trước/sau qua HTTP thật:
`apps/api/src/dashboard/dashboard-mv-refresh.int.spec.ts` (Postgres thật, DB cô lập).

### KI-018 / KI-019 / KI-020 — 3 khoảng trống dữ liệu demo · S3

Trạng thái đơn nghỉ lẫn hoa/thường (`Pending` 1 · `pending` 2 · `approved` 1 · `Draft` 1) · chỉ 1 ca +
1 quy tắc chấm công + 0 phân ca (có fallback nên không chặn) · `goals` = 0.

### KI-021 — 3 sự kiện NOTI của ATT không có producer · S2 · ✅ ĐÓNG 2026-08-15 (`S10-ATT-NOTIPROD-1`)

`ATT_MISSING_CHECKOUT` · `ATT_LATE_DETECTED` · `ATT_ABSENT_DETECTED` được seed `isEnabled: true` trong
`notification-event-catalog.const.ts:82-84`, nhưng **không có nơi nào phát chúng** — toàn hệ chỉ đăng ký
**3** `@SystemJobHandler` (dọn file tạm · dọn theo chính sách lưu trữ · dọn `system_job_runs`), **không
có job ATT cuối ngày**. Chính code cũng ghi nhận: `dashboard-cache-invalidation.const.ts:43` — *"KHÔNG
có producer nào"*.

**Hệ quả (khi mở):** người dùng bật/tắt được 3 loại thông báo không bao giờ tới; admin thấy chúng trong
danh mục sự kiện. **KHÔNG sai dữ liệu** — cờ `is_missing_check_out` đặt **đồng bộ** ngay lúc check-in/
check-out (`attendance.builders.ts:63,104`), không chờ job. **Workaround (khi mở):** đơn điều chỉnh công
(`MISSING_CHECK_OUT`) đã chạy được.

**ĐÓNG `S10-ATT-NOTIPROD-1` (2026-08-15):** producer THẬT — `AttendanceAlertNotiJobHandler`
(`apps/api/src/attendance/attendance-alert-noti.job-handler.ts`, `jobCode='ATT_ALERT_DETECT'`, đăng ký
qua `@SystemJobHandler()` trong `providers` của `AttendanceModule`) quét `attendance_records` (missing
check-out/đi muộn) + `employee_profiles` (vắng mặt, anti-join có trần) TRONG CỬA SỔ NGÀY-ĐÃ-ĐÓNG theo
CA CỦA CHÍNH NHÂN VIÊN (đọc cột `shifts.cross_day`, `shifts.work_days`), rồi phát qua
`NotificationEngineService.intake()` in-process — **KHÔNG migration mới** (catalog/template/deep-link đã
seed sẵn ở mig `0481`/`0497`). Logic thuần: `attendance-alert-noti.logic.ts` (+ spec 23 ca). Repository
chỉ-đọc, tenant-scoped: `attendance-alert-noti.repository.ts` (+ int-spec 9 ca ALLOW→DENY thật trên
Postgres cô lập: missing-checkout, late, absent, khoá sổ (`locked_at`), soft-delete fail-closed, nghỉ
phép chữ thường, ngày lễ GLOBAL, bán kính-có-trần 30 ngày, cô lập tenant). Idempotent theo KỲ đo được:
chạy lại cùng ngày không tạo trùng; phát → soft-delete → chạy lại KHÔNG hồi sinh (dedupe khớp đúng khoá
`NotificationDedupeService.computeKey`, APPEND 3 dòng `notification-dedupe.const.ts`). Unit-spec riêng
(`attendance-alert-noti.job-handler.spec.ts`, 6 ca) ghim: materialize ĐÓNG tx trước khi gọi `intake()`
(chống tx lồng), throttle khoá THEO `companyId` (Map, không field cấp-instance), KHÔNG gán `actorUserId`
(3 mã `isSystemEvent=false` — gán sẽ khiến chính người bị nhắc bị lọc khỏi recipient), lỗi 1 ứng viên
KHÔNG chặn ứng viên còn lại. Kill-switch = `notification_events.is_enabled` (đã có sẵn, engine tự tôn
trọng — KHÔNG cần env mới).

**Nợ có địa chỉ (ghi rõ, KHÔNG hạ KI-021 xuống "đóng một phần"):**
1. Template `ATT_ABSENT_DETECTED` (`migration 0481:161-164`) viết theo giọng gửi HR/quản lý ("cần được
   kiểm tra") trong khi v1 gửi cho **CHÍNH nhân viên** (recipient thật = self, fan-out Manager/HR chưa có
   bề mặt cấu hình) — câu chữ lệch đối tượng nhận; sửa cần **migration** nên ngoài phạm vi WO này.
2. Fan-out Manager/HR cho `ATT_LATE_DETECTED`/`ATT_ABSENT_DETECTED` ("nếu cấu hình", SPEC-04 §2067-2069)
   **chưa có bề mặt cấu hình nào** trong hệ — HOÃN tới khi có WO cấu hình notification theo role.
3. `ATT_LATE_DETECTED` phát **SAU biên ngày-đã-đóng** (job theo lô cuối ngày, không realtime lúc
   check-in) — **CỐ Ý**, không phải lỗi; QA đối chiếu SPEC-04 test case đi-muộn cần biết trước.
4. **Bán kính PROD chưa đo trước khi bật**: PROD funtime có ~45 nhân viên đã import — nếu phần lớn không
   check-in thực tế thì lượt quét đầu tiên có thể bắn `ATT_ABSENT_DETECTED` cho gần hết nhân sự. Trước khi
   bật job này ở PROD: chạy đo khô số recipient của 1 ngày đã đóng trên PROD-clone; kill-switch sẵn có =
   `notification_events.is_enabled=false` cho 3 mã.
5. Worker chết đúng lúc biên ngày đóng (in-memory throttle reset khi restart) có thể làm MẤT vĩnh viễn
   thông báo của ngày đó — gợi ý WO sau: quét N-ngày-gần-nhất có trần thay vì chỉ [hôm qua, hôm nay].
6. Người nghỉ NỬA NGÀY đã duyệt mà không check-in nửa còn lại VẪN nhận `ATT_ABSENT_DETECTED` (đúng hành
   vi hiện hành của `findApprovedFullDayLeaveTx`, dễ bị hiểu nhầm là báo sai).
7. `ATT_ALERT_DETECT_INTERVAL_MS` (throttle nhịp quét) chưa khai vào `config/env.schema.ts` (ngoài paths
   lane này) — vẫn parse-an-toàn + clamp mức NGÀY nếu ai đó set tay.
8. `ATT_AUTO_ATTENDANCE_CREATED` (auto-checkout/auto-attendance job) và wiring widget
   `ATTENDANCE_ALERTS` ở `dashboard-cache-invalidation.const.ts:43-48` VẪN chưa có — ngoài phạm vi WO.

### KI-022 / KI-023 — 2 nguồn ĐỎ-GIẢ trong suite · S1 · ✅ ĐÃ ĐÓNG 2026-07-26 (`S6-STAB-1`)

Cả hai đều **không phải lỗi sản phẩm**, nhưng làm suite đỏ **ngẫu nhiên** rồi xanh lại khi chạy đơn lẻ —
dạng nguy hiểm nhất vì dẫn tới thói quen "chạy lại cho xanh".

- **KI-022:** `outboxOf` trong `goal-be2-link.int-spec` truy vấn `outbox_events` **không lọc
  `company_id`** ⇒ đếm cả sự kiện của spec chạy song song. Đây là chỗ **duy nhất** sót; mọi spec outbox
  khác đã lọc.
- **KI-023:** `cleanupTenants` quét lại `audit_logs` trước `DELETE users` nhưng **không** trước
  `DELETE companies` ⇒ outbox worker còn sống ghi thêm audit trong cửa sổ đó làm vỡ FK
  `audit_logs_company_id_fkey`.

Verify: chạy lại **nguyên chunk `f–l`** (tái tạo đúng điều kiện tranh chấp) → **44/44 file ·
1.022/1.022 test xanh**. Chi tiết: `RELEASE-06` §4.2/§4.3.

### KI-024 — `foundation-audit.e2e-spec` đỏ-giả **vĩnh viễn** · S1 · ✅ ĐÃ ĐÓNG 2026-07-26 (`S6-QA-FINAL-1`)

Cùng họ với KI-022/023 nhưng **nặng hơn**: nó **không** tự khỏi khi chạy lại. `ACTION_A`/`ACTION_B` là
hằng cố định (`BE3SecretLeakA/B`) trong khi case `3f` đọc ở **System scope** (chéo tenant, RLS không
khoanh) và assert `length === 1`. `audit_logs` **append-only** ⇒ chỉ cần một lần chạy bị ngắt (Ctrl-C
hoặc crash worker KI-014) là hàng của lần đó nằm lại DB lane **vĩnh viễn**, mọi lần sau đếm ra 2 → đỏ.

Fix: gắn `RUN_TAG = randomUUID().slice(0,8)` vào `action`, đúng idiom sẵn có
(`audit-permission-deny.int-spec.ts:66`). Verify: chạy file đó **2 lần liên tiếp không dọn gì ở giữa** →
8/8 xanh cả hai lần, `count(*) … LIKE 'BE3SecretLeak%'` = 0. Chi tiết: `S6-QA-FINAL-1-FINAL-QA-PASS` §8.1.

### KI-025 — 98/346 đường dẫn API không có test HTTP nào chạm · S2 · phát hiện 2026-07-26 (`S6-QA-FINAL-1`)

**Đo, không phải ước lượng:** 452 route thật (decorator NestJS) / 346 đường dẫn phân biệt, đối chiếu với
mọi URL literal trong 446 file spec ⇒ **72% đường dẫn có test chạm, 28% không**.

**Rủi ro thật là gì:** guard · `ZodValidationPipe` · response envelope của các route đó **chưa từng chạy
trong test**. Hai bề mặt nghiệp vụ thật nằm trong nhóm này — `user-invites` (`/users/invite`,
`/users/pending`, `/users/:id/approve|reject|suspend|reactivate`) và `POST/GET /hr/profile-change-requests`
— đều được test **rất kỹ ở tầng service** (`new UserInvitesService(...)`, `profile-change-request.int-spec`)
nên nhìn bảng coverage sẽ tưởng đã phủ.

**Rủi ro KHÔNG phải là gì:** không phải "route bỏ ngỏ quyền". Trong 134 route chưa-test chỉ **9** route
vừa thiếu `@RequirePermission` vừa thiếu `@Public()`, và đều thuộc nhóm self-scoped có chủ đích
(`/auth/2fa/*`, `/auth/sessions/*`, `/me/*`) hoặc module CONTENT đã park — nhóm sau đã bị
`route-guard-coverage.e2e-spec.ts` chặn hồi quy.

**Workaround:** sweep tĩnh `route-guard-coverage.e2e-spec.ts` bắt được route MỚI quên gate.
**Chủ:** Sau MVP (thêm test = việc mới, `RELEASE-05` §4.2 chặn sau freeze).
**Bàn giao:** phán quyết từng dòng trong 35 route không-`@RequirePermission` thuộc `S6-SEC-1` (WS4 §13.2).

**Cập nhật 2026-08-14 (`S10-QA-ROUTEHTTP-1`):** số 98/346 (28%) ĐÃ CŨ — census route runtime hiện có
**499** route (không phải 346). Dựng lại phép đo LẶP LẠI ĐƯỢC (`apps/api/test/foundation/route-http-coverage.e2e-spec.ts`,
chạy `pnpm --filter @mediaos/api exec vitest run test/foundation/route-http-coverage.e2e-spec.ts`, KHÔNG
cần Postgres): scan tĩnh có kiểm soát trên mọi file `*-spec.ts`/`*.spec.ts` có `from "supertest"`, gom
verb + path-literal CẤP FILE rồi khớp segment-by-segment với route thật (`:id` ↔ bất kỳ) — giới hạn/false-positive
ghi rõ trong docblock đầu file. Baseline lúc dựng phép đo: **366/499 (73,3%)**; số đo lại cuối ngày 14/08 sau
khi các lane test land: **370/499 (74,1%) có bằng chứng phủ, 129 (25,9%) chưa** — KHÔNG so trực tiếp được với
số 28% cũ (cách đo khác nhau).

⚠️ **73,3% / 74,1% là CẬN TRÊN, KHÔNG phải số sự thật.** Phép đo khớp **verb-set × path-set ở cấp FILE**, không
ở cấp câu lệnh: một file chỉ cần có `.post(` ở đâu đó và một chuỗi path khớp ở chỗ KHÁC trong cùng file là route
bị tính "covered"; và "covered" cũng không chứng minh có ca ALLOW hay chỉ có ca DENY. Sai số vì vậy dồn hết về
phía **false-positive "đã phủ"** ⇒ độ phủ THẬT ≤ số này, và **129 route chưa phủ là cận DƯỚI của khoảng trống
thật**. Cấm dùng `covered === true` để kết luận "route X đã kiểm đủ" — phải mở `evidenceFiles` đọc thật.

Xếp hạng rủi ro (route ghi + nhạy cảm auth/permission/secret/audit lên trước route đọc) rồi phủ HTTP thật cho
nhóm đầu bảng. **Đính chính con số của vòng trước — câu "phủ 5/18 route risk≥5" SAI hai lần:** (a) 2 trong 5
route đó là **risk=3** (`GET /settings/security-policy`, `GET /settings/mail-config`), không phải risk≥5;
(b) `PATCH /settings/security-policy` (risk 5) **không được tính là đã phủ** — route chết (**KI-065**), nó chỉ
có ca ghim 403, không có và chưa thể có ca ALLOW 2xx nào. — ⏫ **CẬP NHẬT 19/08/2026:** KI-065 ĐÃ ĐÓNG
(`S10-QA-SECPOLICY-GATE-1`), route có ALLOW 2xx thật ⇒ **nay tính là đã phủ**; đoạn trên giữ nguyên làm bản
ghi trạng thái ngày 14/08.

Công thức ĐÚNG của đợt 14/08 — **5 route risk≥5 (đều có ca ALLOW 2xx thật) + 2 route risk=3**:

| Route | risk | Spec | ALLOW được chứng minh bằng |
| --- | --- | --- | --- |
| `POST /api/v1/auth/reset-password` | 7 | `auth-toprisk-http.int-spec.ts` | mật khẩu MỚI đăng nhập được, mật khẩu CŨ 401 |
| `POST /api/v1/users/activation/accept` | 7 | `auth-toprisk-http.int-spec.ts` | DB có `accepted_at` + `password_hash` (không plaintext) |
| `POST /api/v1/auth/2fa/disable` | 6 | `auth-toprisk-http.int-spec.ts` | login hết đòi bước 2 + `2fa/status.enabled=false` |
| `PUT /api/v1/settings/mail-config` | 5 | `security-mailconfig-http.int-spec.ts` | 2xx + envelope KHÔNG lộ password, `hasPassword=true` |
| `POST /api/v1/settings/mail-config/test` | 5 | `security-mailconfig-http.int-spec.ts` | 2xx `{ ok:false }` khi host chết, không lộ credential |
| `GET /api/v1/settings/security-policy` | **3** | `security-mailconfig-http.int-spec.ts` | 200 + envelope default — route ĐỌC, không thuộc nhóm risk≥5 |
| `GET /api/v1/settings/mail-config` | **3** | `security-mailconfig-http.int-spec.ts` | 200, danh sách không lộ password — route ĐỌC |
| `PATCH /api/v1/settings/security-policy` | 5 | `security-mailconfig-http.int-spec.ts` | ~~KHÔNG có ALLOW (14/08)~~ → **19/08: 2xx + đọc lại bằng GET thấy giá trị mới**; kèm DENY `deny-sensitive` · cross-tenant · audit (**KI-065** đóng) |

Sổ khớp: baseline 14/08 có **18 route risk≥5 CHƯA phủ** (18 = số chưa phủ ở baseline, **không** phải tổng số
route risk≥5 của census) ⇒ nay **5 phủ thật + 1 ghim-403 không tính (KI-065) + 12 còn nợ = 18**.
⏫ **19/08/2026:** cả 18 đã đóng — 12 route bởi `S10-QA-ROUTEHTTP-2` (18/08) và route ghim-403 cuối cùng bởi
`S10-QA-SECPOLICY-GATE-1` (KI-065). Số phủ tổng (383/499 đo 18/08) **không đổi**: phép đo `route-http-coverage`
quét ở cấp FILE nên đã tính route này là "covered" từ trước — cái thay đổi là nó nay có **ca ALLOW 2xx thật**,
tức số đo và thực tế hết lệch nhau ở đúng chỗ này.

✅ **Bug thật phát hiện khi viết test đã TÁCH RA thành `KI-065`** (có mức · chủ · hàng riêng trong bảng §1 —
cố ý KHÔNG để nằm trong văn xuôi của KI-025): `PATCH /settings/security-policy` không thể gọi thành công qua
HTTP với bất kỳ actor nào. **ĐÃ ĐÓNG 19/08/2026** (`S10-QA-SECPOLICY-GATE-1` · ADR `DECISIONS-09`): luật LẬT
ca ghim đã được thi hành ĐÚNG — ca 403 bị **xoá và thay bằng ALLOW 2xx thật**, không nới assert. Ở phạm vi
KI-025 hệ quả nay là: route đó **tính vào số route đã phủ**, và đây là bằng chứng thực nghiệm rằng một "ca
ghim bug" đặt đúng cách sẽ được người vá lật lên chứ không bị xoá cho xanh.

**CÒN NỢ (ghi số, không cắt lặng lẽ) — đã seed thành WO `S10-QA-ROUTEHTTP-2`, không để trôi ở văn xuôi:**
129 route chưa có bằng chứng HTTP, trong đó **12 route risk≥5** — `POST /users/invite` · `POST /api-keys` ·
`POST /api-keys/:id/revoke` · `POST /auth/users/:id/password/reset` · `POST /auth/users/:id/restore` ·
`DELETE /auth/users/:id` · `POST /permissions/users/:userId/roles` ·
`DELETE /permissions/users/:userId/roles/:roleId` · `PUT /permissions/object` · `DELETE /permissions/object` ·
`DELETE /auth/roles/:id` · `DELETE /auth/roles/:id/permissions` — và ~8 route risk=3 (`api-keys/scopes` ·
`users/pending` · `users/me` PATCH · `leave/admin/balances/:id/transactions` · 4 route `workflow`
approval/checklist). Danh sách đầy đủ + risk score in ra khi chạy lại script đo (top-30 mặc định).

**Phép đo nay là CỔNG, không còn là báo cáo:** `route-http-coverage.e2e-spec.ts` có ratchet
`MAX_UNCOVERED_HIGH_RISK` + sàn `MIN_COVERED_COUNT` ⇒ thêm route risk≥5 mà không có test HTTP, hoặc xoá
test làm tụt độ phủ, đều làm CI **ĐỎ**. Siết hằng số xuống sau mỗi đợt phủ thêm; nới lên phải có WO + lý do.

#### Cập nhật 2026-08-18 (`S10-QA-ROUTEHTTP-2`) — nhóm risk≥5 đóng hết

Đo lại sau khi lane land: **383/499 (76,8%) có bằng chứng phủ, 116 chưa** (mốc 14/08: 370/499, 129 chưa).
**Route risk≥5 chưa phủ: 12 → 0.** Ratchet siết theo số đo: `MAX_UNCOVERED_HIGH_RISK` **12 → 0**,
`MIN_COVERED_COUNT` **370 → 383**. Từ nay thêm bất kỳ route risk≥5 nào không có test HTTP là ĐỎ ngay tại PR đó.

12 route được phủ trong đợt này, mỗi route có ca ALLOW 2xx chứng minh bằng **hệ quả quan sát được** (không
chỉ status code) đặt TRƯỚC ca DENY, cộng DTO-400 ở biên và cross-tenant 404 cho route có `:id` — 49 ca, chạy
thật ở `LANE_DB=mediaos_routehttp2`:

| File spec (mới) | Route |
| --- | --- |
| `invite-apikeys-http.int-spec.ts` (14 ca) | `POST /users/invite` · `POST /api-keys` · `POST /api-keys/:id/revoke` |
| `authusers-admin-http.int-spec.ts` (15 ca) | `DELETE /auth/users/:id` · `POST /auth/users/:id/restore` · `POST /auth/users/:id/password/reset` |
| `permadmin-roles-http.int-spec.ts` (20 ca) | `POST`/`DELETE /permissions/users/:userId/roles[/:roleId]` · `PUT`/`DELETE /permissions/object` · `DELETE /auth/roles/:id` · `DELETE /auth/roles/:id/permissions` |

Ba điều đo được, đáng giữ làm tiền lệ (đều nằm trong docblock các file trên):

1. **KHÔNG route nào trong 12 route dính bẫy KI-065.** `permission.decide.ts` tính
   `needsObjectGrant = objectGrantRequired ?? (isSensitive && requiresReauth)`; cả 12 route chỉ khai
   `isSensitive` (không `requiresReauth`) ⇒ ALLOW đạt được bằng grant company-level. Không có route chết thứ hai.
2. **Hiệu lực đổi quyền KHÔNG đo được bằng "cùng một user, trước rồi sau" trong int-spec.** Cache quyền
   (TTL 300s) chỉ bị xoá khi `permission.changed` được GIAO qua outbox, mà `worker-scheduler.service.ts:37`
   TẮT mọi interval khi `NODE_ENV='test'` ⇒ mục cache đọc trước khi đổi quyền sống tới hết TTL. Ghim
   "403 sau khi được cấp quyền" sẽ là ghim **hiện vật môi trường test**, không phải bug. Cách đo đúng đã dùng:
   **cặp đối chứng A/B cache-lạnh** (`keep` giữ quyền = 200 ‖ `changed` bị thu quyền = 403, mỗi user đọc đúng
   một lần sau khi mọi mutation xong).
3. **Object-grant không lật được quyết định của route đọc thường.** `permission.guard.ts` chỉ chuyển
   `resourceId` xuống engine cho lớp reveal-secret (`isSensitive && requiresReauth`); route khác chạy
   type-level ⇒ tầng object bị bỏ qua. Hệ quả của `PUT`/`DELETE /permissions/object` do đó đo bằng hàng
   `object_permissions` + `audit_logs` (append-only) + DELETE lần hai trả 404, KHÔNG bằng "403 vì object DENY".

🔴 **Bug thật đào ra trong đợt này đã TÁCH thành `KI-068`** (hàng riêng, có mức + ghim test):
`POST /api-keys` trả **500 ZodError** thay vì 400 khi body sai — validate không chạy ở biên vì `@Body()` nhận
TYPE thay vì class `createZodDto`. Không tự vá trong lane QA (đúng luật của WO), không nới assert cho xanh.

### KI-026 — Nhãn `[BLOCKED]` trên test ĐANG XANH · S3 · ✅ ĐÃ ĐÓNG 2026-07-26 (`S6-QA-FINAL-1`)

`attendance-adjustment.int.spec.ts` mang 9 dòng chú thích "KNOWN BROKEN" + tên test
`… → 200 [BLOCKED — see comment above, service.ts bug]`, mô tả `detailInScope()` hard-code
`orgUnitId/directManagerUserId = null`. **Bug đã sửa trong CHÍNH commit đưa test vào** (`80a1bcd5`,
PR #81, 2026-07-02 — `detailInScope()` nạp employee thật qua `resolveRequestEmployee()`); chú thích
không được gỡ. Test XANH suốt từ đó.

Không phải defect, nhưng đủ để làm người đọc kết luận sai là ATT còn lỗi mở — đúng lớp rủi ro mà
`RELEASE-06` §1 cảnh báo, chỉ theo chiều ngược lại: **"code đọc có vẻ hỏng" cũng không phải bằng chứng**.
Fix: thay bằng ghi chú lịch sử + bỏ nhãn.

### KI-027 — 2FA không được ép ở PROD cho company-admin · **S1** · phát hiện 2026-07-26 (`S6-SEC-1`)

**Kiểm chứng (truy vấn read-only trên PROD `mediaos`):** `roles` có `requires_two_factor = true` cho
**`company-admin`** và **`platform-admin`**. Nhưng **cả ba lớp ép đều tắt**: (1) `.env` **và**
`.env.prod` đặt `TWO_FACTOR_ENFORCEMENT_ENABLED=false` (schema default là `"true"`);
(2) `company_security_policies.two_factor_enforced = NULL` cho `funtime`; (3) user
`admin@funtimemediacorp.com` có `require_two_factor = false`.

Guard tính `effective2FA = globalEnv || policy.two_factor_enforced` ⇒ global OFF thì **chỉ** ép khi
công ty tự bật; công ty không bật ⇒ **không ép ai**.

**Hệ quả:** tài khoản quản trị công ty **duy nhất** của production (quản lý user · vai trò · quyền ·
nhật ký audit) vào được **chỉ bằng mật khẩu**.
**KHÔNG phải:** không phải bypass đăng nhập — ai **đã** enroll TOTP vẫn bị challenge. Vấn đề là
**không ai bị bắt buộc enroll**.
**Cách đóng (thứ tự BẮT BUỘC):** admin enroll 2FA ở `/me/security` → đặt cờ `=true` ở **cả** `.env`
lẫn `.env.prod` (nhớ `m prod-env` ghi đè `.env.prod`) → restart API → smoke login. **Đảo thứ tự = admin
ăn 403 `TWO_FACTOR_SETUP_REQUIRED` trên mọi route.**

### KI-028 — tenant TEST + user còn sống trong DB PROD · **ĐÓNG 2026-07-28** · S1 · (`S6-SEC-1` → `S6-SEC-DBFENCE-1`)

> **ĐO LẠI 2026-07-28 (read-only trên PROD `mediaos`) — con số của lần đóng đã sai.**
>
> | Số | 2026-07-26 (lúc phát hiện) | 2026-07-27 (lúc tuyên bố đóng) | **2026-07-28 (đo lại)** | **2026-07-28 SAU purge** |
> | --- | --- | --- | --- | --- |
> | company khớp mẫu test | 16 | 0 còn phải xử lý | **74** (16 tạo 24/7 + **58 tạo 26/7**), 0 soft-delete | **0** |
> | user test `active` | 25 | **0** | **226** | **0** |
> | trong đó hash argon2/bcrypt THẬT (đăng nhập được) | — | — | **55** | **0** |
> | giữ role TOÀN CỤC | 3 `platform-admin` | **0** | **33** (23 `company-admin` · 5 `platform-admin` · 5 `employee`) | **0** |
> | **giao: đăng nhập được VÀ role toàn cục** | — | — | **18** (13 `company-admin` + **5 `platform-admin`**) | **0** |
> | `funtime` (không được chạm) | 46 | 46 | 46 (35 active + 11 locked) | **46 (35 + 11)** |
>
> **Đóng bằng gì (2026-07-28, `S6-SEC-DBFENCE-1`).** Khác lần trước ở chỗ **bịt nguồn rò TRƯỚC, purge
> SAU, và để lại một chốt hồi quy** — xem dòng KI-028 ở bảng đầu tài liệu cho toàn bộ số đo. Ba điểm
> đáng nhớ nhất:
>
> 1. **`LANE_DB` chưa bao giờ là thuộc tính an toàn.** Truy nguyên 72/74 company về đúng spec sinh ra
>    chúng cho thấy **14 company đến từ spec ĐÃ gate `LANE_DB`** — connection vẫn về `mediaos` do
>    `DATABASE_URL` tường minh thắng precedence (hoặc `LANE_DB=mediaos` chép từ CI). Chỉ **TÊN DB
>    ĐÍCH** mới là thuộc tính an toàn ⇒ hàng rào chốt ở đó, không chốt ở "có LANE_DB hay không".
> 2. **Vá ở resolver, không vá 56 file spec.** 63/266 file gate thiếu `LANE_DB` (56 file có tạo
>    company). Vá từng file là mời file thứ 57; hàng rào đặt ở `test/db-target.ts` +
>    `test/global-setup.ts` phủ cả 266 file tại MỘT chỗ.
> 3. **Vector thứ ba chỉ lộ ra sau khi bịt hai vector đầu:** `src/db/check.ts` chạy `main()` ở
>    top-level, `check.spec.ts` import nó ⇒ **mỗi lần chạy unit test là một lần `migrate()` trên DB
>    PROD**. Không ai thấy suốt thời gian dài vì `DATABASE_DIRECT_URL` luôn được điền ngầm.
>
> **Vì sao lệch:** containment `scripts/s6sec1-contain-test-tenants.sql` chạy đúng trên **tập đã đo**
> (16 company của 24/7). 58 company + 201 user tạo ngày **26/7** chưa từng vào phép đo nên script
> không chạm tới — cả hai câu verify ("user test còn active = 0", "operator-grant ngoài funtime = 0")
> đều đúng **trên tập được hỏi**, và sai trên thực tế. Đây là lớp lỗi "số đo tay trong WO có thể
> thiếu", không phải script chạy hỏng.
>
> **Nguồn rò CHƯA bịt (mới truy được):** `apps/api/vitest.config.ts:11` — `const db = process.env.LANE_DB ?? "mediaos"`.
> Thiếu `LANE_DB`, integration spec trỏ thẳng **DB PROD**. Phần lớn int-spec gate `hasDb && LANE_DB`
> nên tự skip, nhưng spec chỉ gate `hasDb` (vd `test/integration/tenant-isolation.int-spec.ts:12`
> `describe.skipIf(!hasDb)`) VẪN chạy và seed company/user thật. Run chết giữa chừng (KI-014, từng
> 100% trên Windows) bỏ luôn `afterAll` → `cleanupTenants` không chạy ⇒ rác tích lại mỗi lần chạy.
>
> **Giảm nhẹ (đo được, không phải suy đoán):** email seed mang hậu tố ngẫu nhiên mỗi lần chạy
> (`au-admin-5688f84d@…`) — **không** có trong repo, nên không đoán được từ bên ngoài dù mật khẩu là
> literal công khai. `funtime` nguyên vẹn: 46 user (35 `active` + 11 `locked`), không dấu hiệu chạm
> chéo tenant. RLS vẫn giữ ranh giới đọc.
>
> **Thứ tự bắt buộc khi đóng:** bịt nguồn rò TRƯỚC, purge SAU. Purge trước = rác mọc lại ở lần chạy
> test kế tiếp — đúng cái đã xảy ra giữa 24/7 và 26/7.

**Kiểm chứng (bản gốc 2026-07-26):** `select count(*) from companies` → **17**; khớp mẫu tenant test
`slug ~ '-[0-9a-f]{8}$'` → **16**; công ty thật duy nhất **`funtime`**. User thuộc 16 tenant đó: **25**.
**Hệ quả:** tài khoản **đăng nhập được** trong DB production với mật khẩu seed test.
**Giới hạn thiệt hại:** RLS giữ — phiên đó bị khoá trong tenant test của nó, **không** thấy dữ liệu
`funtime`; leo thang chéo tenant đã bị chặn (`rbac-operator-escalation.int-spec:92`).
**Lưu ý:** tái diễn lớp sự cố đã dọn 2026-07-22 (122 công ty test lọt PROD) ⇒ **nguồn rò chưa bịt**.
**Workaround/cách đóng:** xoá 16 tenant test + chặn test trỏ DB `mediaos`. Gợi ý gộp vào `S6-PERF-DB-1`.

### KI-029 — `PERMISSION_GUARD_ENABLED`: kill-switch fail-OPEN không validate · S2 · ✅ ĐÃ ĐÓNG 2026-07-28 (`S6-SEC-1`)

`permission.guard.ts:57-68` đọc thẳng `process.env['PERMISSION_GUARD_ENABLED']`; `=== 'false'` ⇒
`return true` cho **mọi** route đã gate, chỉ để lại một dòng `logger.warn`. Biến **không** có trong
`env.schema.ts` lẫn `.env.example` ⇒ zod không validate, không ai biết nó tồn tại.
**Đã kiểm:** `.env` và `.env.prod` **không** chứa biến này ⇒ guard đang BẬT ở PROD.
**ĐÃ VÁ** (owner duyệt đổi hành vi sau freeze): `env.schema.ts:86` khai
`PERMISSION_GUARD_ENABLED: z.enum(["true","false"]).default("true")` + fail-loud lúc boot khi
`NODE_ENV=production` mà cờ `false`; chốt hồi quy ở `env.schema.spec.ts:168-203`.
*(Mục này từng bị bỏ quên ở lần cập nhật trước — bảng §1 đã ghi ĐÓNG trong khi đoạn văn này vẫn để
nguyên chữ "đề xuất", và §3 vẫn đếm KI-029 là mở. Sửa cả ba nơi 2026-07-30, `S6-REL-1`.)*

### KI-030 — `GET /org/employees` trả danh bạ toàn tenant · S2 · ✅ ĐÃ ĐÓNG 2026-07-27 (`S6-SEC-ORG-1`)

> **Đã đóng.** Cả 3 route nay mang `@UseGuards(PermissionGuard)` + `@RequirePermission`:
> `read:user` cho `/org/employees`; `read:team` cho `/org/teams` + `/org/teams/:id/members`.
> Cặp quyền lấy từ seed CÓ THẬT (`0005_permissions.sql:200,205`) — **0 migration, 0 grant mới**.
>
> | Bằng chứng | Chi tiết |
> | --- | --- |
> | RED trước | `test/integration/org-directory-permission.int-spec.ts` chạy trên code CHƯA vá: **3 failed \| 4 passed** — `expected [200,200,200] to equal [403,403,403]` |
> | GREEN sau | cùng file, **7/7 passed** (deny 3 ca · allow 2 ca · chống-siết-quá-tay 1 ca · cô lập tenant 1 ca) |
> | Lưới census | `route-guard-coverage.e2e-spec.ts` **9/9**; artifact `_review/S6-SEC-ROUTEMAP-1-route-census.json` regen: `GAP 3 → 0`, ungated `43 → 40`, `FROZEN_GAPS = []` |
> | FE | `apps/console` **23/23**; tab Đơn vị bỏ được truy vấn `/org/employees` chết (chỉ đổ vào `<span hidden>`) |
>
> **Ai mất quyền đọc (đo trên PROD `funtime`, 46 user, 2026-07-27):** `46 → 6`. Sáu người còn lại
> giữ role `SA`/`company-admin` (`data_scope = Company`). **40 user chỉ có role `employee` mất quyền
> đọc 3 route này** — đúng chủ đích, và cả 3 chỉ có caller ở `apps/console` (màn quản trị).
> **KHÔNG backfill grant nào** — thêm `read:user` cho `employee` là mở lại chính lỗ vừa vá.
>
> **FULL gate (2026-07-27) — 4 reviewer, tất cả PASS, 0 CRITICAL, 0 HIGH.** Chạy: `security-reviewer`
> · `rls-tenant-isolation-tester` (**thay** `database-reviewer`, agent này không có trong môi trường)
> · `general-purpose` mang brief `silent-failure-hunter` (**thay** agent cùng tên, không có)
> · `completion-evaluator` (97/100). Ghi rõ việc thay thế theo tiền lệ `S6-SEC-1` §7c.
> Bằng chứng đáng kể: reviewer **tự tái lập vế RED** (tắt `PERMISSION_GUARD_ENABLED`) ra log trùng
> từng chữ; normalize-diff chứng minh churn prettier không giấu logic; probe 2-tenant ở tầng SQL
> (`SET LOCAL ROLE mediaos_app`, ROLLBACK) cho **0 rò** kể cả khi gỡ vị từ `company_id` của repo.
> **Đã vá ngay trong WO theo yêu cầu gate:** ô chọn người rỗng không lời giải thích · lỗi tải hiện
> cùng "chưa có nhóm nào" · 4 khẳng định test lỏng · ghim `data_scope` · sửa chữ ký `TENANT_READ`.
>
> ⚠️ **Việc kế tiếp (chưa có WO)** — đầy đủ ở `docs/plans/S6-SEC-ORG-1.md` §7 (N-1…N-8). Hai mục đáng
> chú ý nhất:
>
> - **Lệch cặp quyền ở BA role**, không chỉ một: `hr-manager` (…009) thiếu `read:user`; `hr` (…011)
>   có `view:user` nhưng thiếu cả `read:user` lẫn `read:team`; `manager` (…010) thiếu cả ba. Gốc rễ
>   là **tách từ vựng** `read:user` (legacy) vs `view:user` (canonical §13, mig `0444`) — WO sau phải
>   chốt MỘT động từ. Cả ba hiện **0 user** ở PROD ⇒ không ảnh hưởng sống. Sửa cần migration, nằm
>   ngoài `paths` của `S6-SEC-ORG-1`.
> - 🔴 **MỞ 2026-07-28 — N-1c: cùng lỗ, cửa bên cạnh.** FULL gate của `S6-SEC-ORGSCOPE-1` phát hiện
>   độc lập bởi 2/3 reviewer: `GET /org/teams/:id/members` trả `userEmail` + `userFullName`, gate
>   **chỉ** cặp `read:team`, **không** resolve `data_scope`. Gốc rễ chung: `PermissionGuard` **không
>   đọc `data_scope` một lần nào** (grep `dataScope` trong `permission.guard.ts` = 0 hit), còn ceiling
>   của role-admin chỉ chặn `System`. **Ca tái lập:** role `read:user@Own` + `read:team@Company` ⇒
>   `/org/employees` trả đúng 1 hàng (N-1 đã khoá), rồi `/org/teams` → `/org/teams/:id/members`
>   **lấy lại trọn danh bạ email**. ⇒ **Đừng đọc bảng CHỐT `/org` như "đã chốt toàn bộ"**: vế `teams`
>   chưa có scope. WO: `S6-SEC-ORGTEAMSCOPE-1` (đã seed vào `harness/backlog.mjs`, zone đỏ).
>   Mức: rls-tenant-isolation-tester chấm **HIGH**, security-reviewer chấm **MEDIUM** (không BLOCK
>   PR của N-1 vì không do nó gây ra và nằm ngoài `paths` đã khai).
> - ~~**`listEmployees` không ép `data_scope`**~~ → **ĐÓNG 2026-07-28 bởi `S6-SEC-ORGSCOPE-1`.**
>   Role tenant tự đúc với scope `Own`/`Team`/`Department` từng qua guard rồi nhận trọn danh bạ.
>   Vá bằng `DataScopeService.buildUserScopeCondition` (vị từ hình-`users`, **không** join
>   `employee_profiles` — join sẽ làm tài khoản chưa có hồ sơ rụng khỏi màn RBAC console).
>   RED→GREEN: `test/integration/org-directory-scope.int-spec.ts` **5 failed | 2 passed → 7/7**
>   (2 ca xanh từ vòng RED là chốt *chống siết quá tay*, cố ý phải xanh ở cả hai vòng).
>   `Team`/`Department` fail-closed 0 hàng — giống hệt `GET /auth/users`; chi tiết + hệ quả
>   phi-đơn-điệu ở `docs/plans/S6-SEC-ORGSCOPE-1.md` §2.1.

**Mô tả gốc** (giữ nguyên cho tài liệu khác trỏ tới không gãy):

`org.controller.ts:173` không `@RequirePermission`; `org.repository.ts:322` trả `id · email ·
fullName · status` + team membership của **mọi** user chưa xoá trong tenant, cho **mọi** user đã đăng
nhập. Lệch với `/hr/employees` vốn ép data_scope (Employee Own chỉ thấy hồ sơ mình).
**Vì sao lọt lưới:** `route-guard-coverage.e2e-spec.ts:148` lọc `httpMethod !== "GET"` ⇒ sweep tĩnh
chỉ soi mutation. ⟲ **Lưới đã vá 2026-07-27** (`S6-SEC-ROUTEMAP-1`): bộ lọc GET bị gỡ, thay bằng census
runtime + sổ phán quyết có chữ ký — route đọc mới không gate nay làm ĐỎ test thay vì đi qua im lặng.

⟲ **PHẠM VI MỞ RỘNG 1 → 3 ROUTE (census runtime 2026-07-27).** Cùng lỗ, cùng controller, cùng hạng:

| Route | Lộ gì |
| --- | --- |
| `GET /org/employees` | danh bạ tài khoản toàn tenant (id·email·fullName·status + team) |
| `GET /org/teams` | toàn bộ cơ cấu team của tenant |
| `GET /org/teams/:id/members` | **thành viên từng team** — route này chưa từng xuất hiện trong bản census tĩnh nào (bị bẫy cửa sổ decorator nuốt) |

`GET /org/units/tree` được xét cùng đợt và **KHÔNG** vào KI-030: giữ `TENANT_READ` có chữ ký vì
`apps/app` dùng ở `OrgChartPage.tsx` + `TaskSidebarTree.tsx` ⇒ siết sẽ gãy UI của mọi nhân viên.
Mức **giữ `S2`** (danh bạ/cơ cấu, không có PII hồ sơ HR). Phán quyết đầy đủ: `S6-SEC-1` §7 Phụ lục A.
**Vì sao không cao hơn:** danh bạ tài khoản, **không** phải hồ sơ HR (không lương/CCCD/công/phép);
`withTenant` + RLS giữ, không rò chéo tenant; FE chỉ gọi từ `apps/console`.
**Đường sửa đã khảo sát:** gate `read:user` — PROD đã cấp cho `company-admin`/`SA`/`project-manager`;
caller FE chỉ có 2 màn console của company-admin ⇒ siết không gãy UI.

### KI-031 — `INTERNAL_API_KEY` ngoài `env.schema`/`.env.example` · S3 · (`S6-SEC-1`)

`internal.guard.ts:23` đọc thẳng `process.env`. Guard **fail-CLOSED** (thiếu biến ⇒ 403 mọi route
`/internal/**`), nên hậu quả là **mất tính năng** (recalculate thủ công, invalidate cache), không phải
mất kiểm soát. **Đề xuất:** ghi vào `.env.example` + schema optional để lỗi hiện ra lúc boot.

### KI-050 — chưa từng có một bản backup nào trên máy PROD · **S2** · mở 2026-07-30 (`S6-REL-1`)

Phát hiện bởi chính công cụ vừa dựng trong WO này: `node scripts/ops-alert-check.mjs` trả **`unknown`**
cho luật "tuổi bản backup mới nhất" **ngay lần chạy đầu tiên** trên PROD.

**Đo được:**

- không có thư mục `backups/` ở gốc repo (`BACKUP_DIR` mặc định của `scripts/backup-db.sh`);
- `Get-ScheduledTask` không có task nào chạy `scripts/backup-db.sh` — các task tên `*Backup*` trên máy
  đều thuộc Windows/phần mềm khác.

**Đừng gộp với KI-008.** `S6-PERF-DB-1` đã chứng minh **restore drill** chạy được — nhưng drill đó tự
`pg_dump` tại chỗ rồi restore vào DB tạm. Nó trả lời câu *"khôi phục có hoạt động không"*, KHÔNG trả lời
câu *"có bản nào để khôi phục khi máy này hỏng không"*. Hai câu khác nhau; hôm nay câu thứ hai là KHÔNG.

`RELEASE-01` §7.3 tick "Script backup ✅" — đúng theo nghĩa script tồn tại, nhưng nó **chưa từng chạy**.
Lại đúng bài học `DEVOPS-13` §3.1 vừa ghi cho drill: *script tồn tại ≠ script chạy được*. Lần này bẫy
nằm ở tầng cao hơn một bậc: script đã chạy được rồi, nhưng **không ai gọi nó**.

**Chặn go-live: CÓ.** Đưa hệ thống mang dữ liệu nhân sự thật của 45 người vào vận hành mà không có bản
sao lưu nào là rủi ro mất dữ liệu không chấp nhận được.

**Vá (owner, trước go-live):**

1. Chạy tay một bản ngay: `BACKUP_DIR=./backups bash scripts/backup-db.sh`
2. Đăng ký task hằng ngày 02:00 — lệnh sẵn ở `RELEASE-09` §4
3. Verify: `node scripts/ops-alert-check.mjs` phải chuyển luật "tuổi bản backup" từ `unknown` sang `ok`

---

### KI-067 — 4 môi trường chung một Valkey db0, 16 họ khoá không mang danh tính môi trường · **S1** · ✅ MỞ VÀ ĐÓNG CÙNG PR 2026-08-18 (`S10-FND-VALKEYSCOPE-1`)

**Phạm vi đã chuyển (16 họ khoá).** `rl:ip` · `rl:acct` · `rl:forgot:ip` · `rl:forgot:acct` · `2fa|` ·
`2fa-enable|` · `2fa-disable|` · `change-pw|` · `replay:*` · `perm:cap` · `perm:obj` · `idem:*` ·
`chat:typing` · `chat:cooldown` · `chat:ice-turn-reject` · `me:training`. Bốn khoá dạng ống trước đây
nằm ở **namespace GỐC** của Valkey (không cả tiền tố `rl:`) — nay gom về họ `rl:`. `chat:presence` và
kênh `socket.io` đã đúng từ S8-CHAT-UX-RT-1, giữ nguyên.

Hình dạng mới: `{namespace}:{envScope}:{subtype}:{phần còn lại}`, với `envScope = {NODE_ENV}:{db}`
(`LANE_DB` thắng khi có). PROD = `production:mediaos` · dev-online = `development:mediaos_dev` ·
dev local = `development:mediaos` · lane test = `test:mediaos_<lane>`.

**⚠️ Cưỡng chế nằm ở test/CI, KHÔNG ở production.** Cổng runtime trong `ValkeyService` chỉ ném khi
`NODE_ENV === 'test'`. Lý do: hợp đồng của lớp đó là *never throws* và có ít nhất 6 call site gọi
KHÔNG bọc `try` (`login-rate-limiter` · `permission.cache.invalidateUser` · `replay-guard`), nên bật
cổng ở dev-online — môi trường **có người dùng thật** — sẽ biến một khoá sót thành **login 500** thay vì
fail-soft. Đừng đọc mục này thành "PROD đang được cổng bảo vệ": ở PROD không có cơ chế nào chặn một khoá
sót; thứ chặn là `valkey-key-census.spec.ts` (census tĩnh) + cổng test, cả hai chạy trước khi merge.

#### Điều gì xảy ra lúc DEPLOY

| Họ khoá | TTL | Sau deploy |
| --- | --- | --- |
| `perm:cap` · `perm:obj` | 300s | Mồ côi. **KHÔNG tự lành hoàn toàn:** `invalidateUser` DEL **kèm hình dạng cũ** đúng một chu kỳ, nếu không thì thu hồi quyền trong cửa sổ 300s không chạm khoá cũ ⇒ rollback dựng lại grant trước-thu-hồi. **Vế legacy đã GỠ 19/08/2026** — xem *Chu kỳ chuyển tiếp* bên dưới |
| `idem:*` | 900s | Mồ côi. **Không phải "tự lành"**: client retry vắt qua mốc deploy sẽ **CHẠY THẬT lần hai** (đẻ bản ghi trùng), không phải phát lại |
| `replay:*` | 600s | Mồ côi ⇒ marker single-use của 2FA sống lại. Vì thế `ReplayGuard` **đọc kép + ghi kép** đúng một chu kỳ. **Đã GỠ 19/08/2026** — xem *Chu kỳ chuyển tiếp* bên dưới |
| `rl:*:lock` | `LOGIN_LOCKOUT_SEC` | Mồ côi và **không hàm nào xoá được** ⇒ **mọi lockout đang có bị VÔ HIỆU ngay lúc deploy**. Nới lỏng an ninh trong một cửa sổ ngắn, CÓ CHỦ Ý |
| `me:training:*` | 60s | Tự lành |

#### Chu kỳ chuyển tiếp — **ĐÃ KẾT THÚC 2026-08-19** (`S10-FND-VALKEYSCOPE-2`)

Ba workaround land cùng `S10-FND-VALKEYSCOPE-1` chỉ có nghĩa quanh mốc deploy 18/08; nay đã gỡ hết:
`ReplayGuard.claim` ghi kép `replay:*`, `invalidateUser` DEL kèm `perm:cap:*` cũ, và miễn trừ legacy
của cổng runtime. **Số đo mở cổng** (19/08/2026 07:35Z, Valkey của máy PROD, sau khi bản mang
`S10-FND-VALKEYSCOPE-1` đã chạy trọn một chu kỳ deploy — API PROD build `209a3954` lúc 06:57Z):

```text
--scan --pattern 'replay:2fa-jti:*'  => 0 dòng     (hình dạng CŨ, không envScope)
--scan --pattern 'perm:cap:*'        => 0 dòng     (hình dạng CŨ, không envScope)
INFO keyspace                        => db0: keys=1   ← chỉ còn 1 khoá `rl:forgot:…:cnt` rác của test
```

⚠️ **Đọc số đo cho đúng:** db0 gần như RỖNG lúc đo, nên "0 dòng legacy" chứng minh *không còn khoá cũ
nào đang sống*, KHÔNG chứng minh "lưu lượng đã chuyển hết sang khoá scoped". Với `replay:` (TTL 600s)
và `perm:cap:` (TTL 300s) thì hai điều đó tương đương — mọi khoá cũ đã hết hạn từ lâu.

**Hệ quả cho ROLLBACK kể từ 19/08:** lùi về bản **≥ 18/08** vẫn an toàn (bản đó đọc khoá scoped trước).
Lùi về bản **trước 18/08** thì không còn vế ghi-kép che nữa: marker 2FA tiêu thụ sau 19/08 sẽ **sống
lại** ở bản cũ. Nếu buộc phải lùi xa như vậy, coi mọi challenge token đang lưu hành là **đã hở** và
hạ `LOGIN_LOCKOUT_SEC`/thu hồi phiên theo thủ tục sự cố.

Từ đây khoá `replay:`/`perm:` **chưa scoped bị NÉM** ở cổng runtime như mọi họ khác — không còn cửa
hẹp nào (ca test: `apps/api/src/common/valkey/valkey-key.spec.ts` › *cổng runtime: cửa hẹp legacy đã ĐÓNG*).

#### Lệnh vận hành (chạy sau deploy — đừng để người deploy tự nghĩ ra)

```bash
# ĐẾM TRƯỚC, XOÁ SAU. Pattern NEO SLUG nên chỉ khớp hình dạng CŨ (hình dạng mới có 'production:mediaos'
# ngay sau namespace). Thay 'funtime' bằng slug thật nếu có công ty khác.
for P in 'rl:ip:funtime|*' 'rl:acct:funtime|*' 'rl:forgot:ip:funtime|*' 'rl:forgot:acct:funtime|*' \
         '2fa|*' '2fa-enable|*' '2fa-disable|*' 'change-pw|*'; do
  echo -n "$P => "; docker exec mediaos-valkey valkey-cli --scan --pattern "$P" | wc -l
done
# rồi mới xoá từng pattern đã đếm được > 0:
docker exec mediaos-valkey valkey-cli --scan --pattern 'rl:ip:funtime|*' \
  | xargs -r docker exec -i mediaos-valkey valkey-cli DEL

# NGHIỆM THU: không còn dòng nào THIẾU chuỗi 'production:mediaos'
docker exec mediaos-valkey valkey-cli --scan --pattern 'rl:*' | grep -v 'production:mediaos' || echo SACH
```

> ⛔ **CẤM `FLUSHDB`** — nó giết luôn `chat:presence` và trạng thái adapter socket.io đang chạy.
> ⛔ **`DEL` trả `0` KHÔNG có nghĩa "đã sạch"** — nó cũng là hình dạng của "pattern SAI". Luôn `--scan`
> đếm trước; đây đúng là cách một thủ tục mở khoá khẩn cấp chết im lặng.

#### Rollback

Lùi về bản cũ an toàn về DỮ LIỆU nhưng: (a) khoá **mới** thành mồ côi và lockout bị reset **LẦN HAI**;
(b) marker 2FA vẫn an toàn nhờ **ghi kép** (bản cũ đọc được khoá cũ đã ghi) — **chỉ đúng cho bản lùi
≥ 18/08; từ 19/08 vế ghi kép đã gỡ**, xem *Chu kỳ chuyển tiếp* ở trên. Dọn chiều ngược bằng đúng
các lệnh trên với pattern `'rl:production:mediaos:*'`.

#### Thủ tục MỞ KHOÁ KHẨN CẤP (thay bản cũ trong notes `S10-AUTH-IPTRUST-1`)

```bash
docker exec mediaos-valkey valkey-cli --scan --pattern 'rl:production:mediaos:*{email}*'   # ĐẾM TRƯỚC
docker exec mediaos-valkey valkey-cli DEL \
  'rl:production:mediaos:ip:{slug}|{email}|{ip}:lock' \
  'rl:production:mediaos:acct:{slug}|{email}:cnt'
```

---

### KI-066 — `TRUST_PROXY` không đặt sau proxy ⇒ mọi `req.ip` = `::1` · **S1** · ✅ MỞ VÀ ĐÓNG CÙNG PR 2026-08-18 (`S10-AUTH-IPTRUST-1`)

> **Đã đóng bằng hành vi, không bằng "đã restart".** Bằng chứng là HAI hàng `login_logs` cách nhau
> 3 phút trên cùng một PROD, cùng một loại request (đăng nhập sai có chủ đích qua
> `https://api.funtimemediacorp.com`, tenant bịa nên không chạm tài khoản/bucket của ai):
>
> ```text
> 05:09:19Z  ip=::1                    ← sau khi đặt biến vào .env.prod + restart  (KHÔNG ăn)
> 05:12:31Z  ip=<IP-CÔNG-CỘNG-THẬT>    ← sau khi đặt biến vào .env       + restart  (ăn)
> ```

#### Vì sao đáng ghi lại dù bản vá chỉ là MỘT DÒNG env

**1. Chỉ dẫn vận hành trong chính Work Order đã sai file — và sai một cách hoàn toàn im lặng.**
WO ghi "đặt `TRUST_PROXY` trong `.env.prod` + restart API PROD". Làm đúng y vậy thì: service
restart thành công, PID mới, `/health` 200, log sạch — **và `req.ip` vẫn là `::1`**. Lý do:
`ENV_FILE_PATHS = [".env", "../../.env"]` (`apps/api/src/config/env.schema.ts:8`), còn dịch vụ
`MediaOS-API` chạy với `AppDirectory = C:dev 2MediaOS` ⇒ nó nạp `<repo>/.env`. **Không script
nào copy `.env.prod` → `.env`** (đã grep). `.env.prod` chỉ được vài script ops đọc để lấy thông tin
DB. Nếu nghiệm thu bằng "đã restart, service Running" thay vì bằng hành vi thì WO này đã được đóng
với **đúng nguyên trạng lỗi**, cộng thêm một dòng cấu hình khiến người sau tin rằng nó đã được vá.
Đây là biến thể của bài học `prod-restart-does-not-rebuild-dist`, nhưng nguy hiểm hơn: ở đó thứ cũ
là *code*, ở đây thứ cũ là *cấu hình*, và không có dấu hiệu nào để nhìn thấy.
→ Đã vá bằng chú thích cảnh báo ngay đầu khối trong `.env.prod` (nói thẳng file đó KHÔNG phải file
runtime), và giữ giá trị ở cả hai file theo quy ước sẵn có của `scripts/rotate-db-roles.mjs`.

**2. `true` là bẫy: nó biến "IP mù" thành "IP GIẢ MẠO ĐƯỢC" — leo thang chứ không phải sửa.**
Với `trust proxy = true`, Express tin MỌI `X-Forwarded-For`, kể cả header do client tự gửi ⇒ kẻ tấn
công **tự chọn** `req.ip` ⇒ vượt IP-allowlist và né rate-limit bằng cách xoay IP bịa. Vì vậy WO đặt
điều kiện chặn: phải có **ca test giả mạo** trước khi được đổi giá trị. Ca đó nằm ở
`apps/api/src/config/trust-proxy.spec.ts` — dựng Nest app tối giản, set `trust proxy` bằng ĐÚNG dòng
của `main.ts`, rồi bắn header bịa vào và đọc `req.ip` ra. Kiểm chứng ca test **không xanh-rỗng** bằng
đột biến thật: đổi `loopback` → `true` làm **3 ca ĐỎ**, trong đó có ca chặn.

**3. Giá trị được chọn từ SỐ ĐO, không từ tài liệu nhà cung cấp.** Tính an toàn của `loopback` treo
trên đúng một tính chất: proxy **nối** IP thật vào **cuối** `X-Forwarded-For` do client gửi. Nếu nó
**chèn trước**, `loopback` sẽ trả về IP kẻ tấn công tự chọn — tức cùng lỗ hổng như `true`, nhưng
trông như đã vá. Vòng đo 1 (`scripts/windows/10-trust-proxy-probe.ps1`) chỉ đo request "sạch" nên
KHÔNG trả lời được câu này. Vòng đo 2 (`scripts/windows/11-trust-proxy-spoof-probe.ps1`) đo đúng ca
kẻ tấn công:

| client gửi | origin nhận | kết luận |
| --- | --- | --- |
| `X-Forwarded-For: 203.0.113.9` | `"203.0.113.9,<ip thật>"` | **nối vào CUỐI** ⇒ `loopback` an toàn |
| (không gửi gì) | `"<ip thật>"` | khớp vòng đo 1 |
| `CF-Connecting-IP: 203.0.113.9` | — | **403 ngay ở edge**, không tới origin |

Bằng chứng thô: `docs/DEVOPS/evidence/S10-AUTH-IPTRUST-1-xff-order-*.txt` (IP thật đã thay bằng
placeholder tự động trước khi ghi — repo PUBLIC — nhưng **thứ tự giữ nguyên**, vì thứ tự mới là thứ
cần đọc).

**4. Probe vòng 2 rẻ hơn vòng 1 hai bậc, và đó là cách nên đo lần sau.** Vòng 1 phải sửa
`C:ProgramDatacloudflaredconfig.yml` (file phục vụ CẢ 8 hostname, gồm `api.` và `dangfb.` PROD)
rồi `Restart-Service cloudflared` hai lần. Vòng 2 **không sửa config, không restart gì**: hostname dev
`cian-dev-console` đã trỏ sẵn tới `localhost:5278` và cổng đó đang trống, nên chỉ cần dựng echo
server đúng lên cổng ấy. Script tự từ chối nếu cổng đang bận hoặc hostname không khớp cổng trong
`config.yml` ⇒ không bao giờ cướp cổng của tiến trình khác.

#### Vế còn lại đã đóng cùng PR

- `parseTrustProxy` tách khỏi `main.ts` sang `apps/api/src/config/trust-proxy.ts`. Trước đó nó
  module-private trong `main.ts` nên **không ca test nào chạm tới được** — mà đây là hàm quyết định
  `req.ip`.
- `.env.example`: dòng `TRUST_PROXY=` nay nêu **hệ quả** khi để `false` sau proxy (mù forensics +
  thoái hoá rate-limit + vỡ IP-allowlist) và cảnh báo `true` tệ hơn `false`, thay vì chỉ tả cú pháp.
- `login-rate-limiter.spec.ts`: 4 ca đóng đinh **tách vai hai bucket** — với IP thật thì 5 lần sai từ
  một nguồn chỉ khoá nguồn đó (nguồn khác vẫn vào được) và bucket per-account 20 mới thực sự bắt
  credential-stuffing phân tán; với `::1` thì 5 nguồn khác nhau vẫn khoá ở lần thứ 5. Chênh lệch giữa
  hai ca chính là thiệt hại của `::1`.

#### Điều kiện an toàn — đổi topology thì phải đo lại

`loopback` an toàn nhờ hai tính chất **đã đo**, không nhờ bản thân preset: (a) proxy nối IP thật vào
**cuối** XFF; (b) proxy nối tới origin qua **loopback** (cùng máy). Tách `cloudflared` sang máy khác
⇒ peer không còn loopback ⇒ `req.ip` tụt về IP máy proxy (mù trở lại, không phải giả mạo) ⇒ phải
đổi sang CIDR của máy proxy và **đo lại**. Ghi rõ trong docblock `config/trust-proxy.ts`.

---

## 3. Cái KHÔNG được defer

| Không được defer | Lý do |
| --- | --- |
| Bug lộ dữ liệu ngoài phạm vi quyền | Vi phạm BẤT BIẾN #1 |
| Hard-delete dữ liệu nghiệp vụ / ghi đè bảng append-only | Vi phạm BẤT BIẾN #2 |
| Secret dạng plaintext trong code/log/DTO | Vi phạm BẤT BIẾN #3 |
| Migration chưa áp ở PROD khi code đã yêu cầu | Chính là KI-006 — gây 500 hàng loạt |
| Bug chặn login / phiên / phân quyền | Không dùng được hệ thống |

---

## 4. Defer list — chuyển sang sau MVP

| Hạng mục | Chuyển tới | Lý do defer |
| --- | --- | --- |
| Throttle `refresh`/`resetPassword` | Phase sau (nếu nâng threat-model) | Đã có mitigation tương đương (KI-013) |
| Count theo Department cho widget `hr-overview` | Phase sau | Count-only, không lộ PII (KI-012) |
| Log JSON có cấu trúc (R1) | Sprint 6 `DEVOPS-MON-002` | Blast radius rộng, không phải rủi ro release |
| Phân trang thật `GET /employees` (R2) | WO `HR-PAGINATE-LEGACY` | Đã có cap 2000 chặn rủi ro |
| Realtime WebSocket đầy đủ | Post-MVP | MVP dùng polling/refresh thủ công |
| Load test quy mô lớn | Release phase | MVP chỉ smoke/baseline |
| Đa công ty (SaaS) | Post-MVP | Đang chạy N=1; hạ tầng RLS giữ nguyên để mở sau |
| Module Payroll · Recruit · Asset · Room · Chat · Social · Mobile | Phase 2–5 | Ngoài phạm vi MVP theo SPEC-01 §7 |

**Cập nhật 2026-08-11 (`S7-CALL-QA-1` → `S7-CALL-RT-FIX-1`):** `S2` vẫn **4** (KI-021 · KI-025 · KI-050 ·
KI-056) — **KI-061 mở và đóng trong cùng ngày**, cùng khuôn KI-049/KI-059. Vẫn cấp số hiệu dù vòng đời chỉ
vài giờ, vì lỗ **có mặt thật trên master** trong khoảng giữa hai PR (#374 land trước, bản vá sau) và vì đây
là mức `S2` — một lỗ xác thực ở cổng vào realtime mà bug-scrub trước RC phải thấy được, không phải một dòng
changelog. Ba điểm đáng giữ làm tiền lệ: (1) **tripwire là characterization test, KHÔNG phải `it.fails`** —
`it.fails` xanh khi thân bài ném vì bất kỳ lý do gì (typo, refactor harness đẻ `TypeError`), tức nó vẫn xanh
**sau khi bản vá land** ⇒ tripwire không bao giờ nổ; ca C2 khẳng định hành vi SAI bằng assert dương nên nó ĐỎ
đúng lúc cần. (2) **`severed === false` trong ca đã lật là YÊU CẦU, không phải tác dụng phụ** — nó là thứ duy
nhất chặn một bản "sửa cho gọn" quay lại dùng `client.disconnect(true)`, vì cách đó vẫn no-op ở giai đoạn
middleware trong khi mọi assert còn lại vẫn xanh. (3) **vị trí cổng là một phần của bản vá** — ca C2b assert
`permissions.can` ĐÃ được gọi, nếu không thì một bản "kiểm `exp` sớm cho gọn" sẽ xanh trong khi đóng lại đúng
cửa sổ đua 2 round-trip I/O mà lỗ này sống trong đó.

**Cập nhật 2026-08-12 (giám sát mặt PROD ngoài API):** `S2` vẫn **4** (KI-021 · KI-025 · KI-050 ·
KI-056) — **KI-062 mở và đóng trong cùng ngày**, cùng khuôn KI-049/KI-059/KI-061. Cấp số hiệu dù đã vá
xong, vì khuyết tật **có mặt thật trên PROD suốt vòng đời `ops-alert-check`** (30/07 → 12/08) và nó đã
thu học phí: một app live chết 500 suốt ~15 tiếng mà không ai biết. Ba điểm đáng giữ làm tiền lệ:
(1) **"không đo" và "đo thấy tốt" phải phân biệt được ở tầng KẾT LUẬN, không chỉ ở tầng từng luật** —
`ops-alert-rules.mjs` đã ép `unknown > ok` từ 30/07, nhưng luật đó chỉ phủ những gì có trong danh sách
đo; một dịch vụ nằm ngoài danh sách không sinh ra `unknown` nào cả, nó **hoàn toàn vô hình**. Vì vậy
danh sách trang dò RỖNG nay tự nó là `unknown`. (2) **Đo HIỆN TƯỢNG và đo NGUYÊN NHÂN là hai rule khác
nhau, cần cả hai** — #9/#10 bắt "trang chết" (đúng nhưng muộn và không chỉ được thủ phạm), #11 bắt
"bundle dev đang được phục vụ" (sớm hơn, và chỉ thẳng việc phải làm). (3) **Nghiệm thu giám sát phải
BẺ HỎNG**: một hệ cảnh báo chỉ được chứng minh bằng việc dựng lại chế độ hỏng rồi xem nó có kêu không —
nhìn nó xanh trên hệ đang khoẻ chính là cách sự cố 11–12/08 lọt qua.

**Cập nhật 2026-08-15 (`S10-ATT-NOTIPROD-1`):** `S2` **→ 4** — KI-021 ĐÓNG (producer thật cho 3 sự kiện
NOTI ATT, xem §KI-021 chi tiết bên trên), còn lại KI-025 · KI-050 · KI-056 · KI-065.

**Cập nhật 2026-08-14 (`S10-QA-ROUTEHTTP-1`, vòng sửa sau nghiệm thu):** `S2` **4 → 5** (KI-021 · KI-025 ·
KI-050 · KI-056 · **KI-065 mở**). KI-065 là bug thật **do việc viết test HTTP đào ra**, không phải khuyết tật
của test — đúng lý do KI-025 tồn tại: route chưa từng đi đường HTTP thật thì guard của nó chưa từng chạy, nên
một route cấu hình bảo mật **chết hoàn toàn** vẫn nằm im trong xanh. Ba điểm đáng giữ làm tiền lệ: (1) **bug
đào được phải có số hiệu riêng, không chôn trong văn xuôi của KI khác** — chôn thì nó không có mức, không có
chủ, và biến mất khỏi mọi bảng đếm; (2) **route chỉ có ca DENY không được tính là "đã phủ"** — khi actor đủ
quyền và actor thiếu quyền cùng nhận 403 thì ca DENY là **xanh-RỖNG**, nó không chứng minh gì về guard (bài
học `deny-cases-vacuous-without-allow-case`); vì vậy con số nghiệm thu của vòng trước bị **thổi lên** và đã
đính chính tại chỗ (`5 risk≥5 + 2 risk=3`, không phải `5/18 risk≥5`); (3) **phần trăm độ phủ đo bằng scan tĩnh
là CẬN TRÊN** — sai số dồn về phía "đã phủ", tức GIẤU khoảng trống, nên phải phát biểu kèm chiều sai số thay vì
đọc như số sự thật.

**Cập nhật 2026-08-19 (`S6-SEC-IDENTITY-PROJ-1`):** `S3` **→ giữ nguyên số** — đóng **KI-053** +
**KI-054**, mở **KI-070**; **KI-069** mở và đóng trong cùng PR. `S2` không đổi. Ba điểm đáng giữ làm
tiền lệ:

**(1) Bản vá của một WO an ninh có thể ĐẺ RA lỗ mới, và cách viết tự nhiên nhất chính là cách sai.**
`security-event.repository` join `users` **hai lần** cho hai vai (chủ thể sự kiện / người gây ra).
`buildUserScopeCondition` hard-code bảng `users`, nên tái dùng MỘT vị từ cho cả hai vai là điều gần
như chắc chắn sẽ được viết ra — và nó vừa lộ email người gây ra ở hàng có chủ thể = tôi, vừa giấu
email của chính tôi ở hàng tôi là người gây ra. Lỗ này được `plan-reviewer` bắt **trước khi có dòng
code nào**, và sau đó được chứng minh bằng cách tạm thay hai grant bằng một: ca C2/C3 đỏ đúng hai
chiều. Nếu vòng plan-review bị bỏ qua thì bản vá đã ship kèm một lỗ mới mà mọi test khác vẫn xanh.

**(2) Che một cột mà vẫn `ORDER BY` chính cột đó = biến bản vá thành oracle.** Hai chỗ mắc đúng lỗi
này (`role-admin` `orderBy(users.email)`, `leave-admin` `orderBy(asc(users.fullName))`): giá trị bị
`null` hoá nhưng **thứ tự hàng vẫn tiết lộ thứ tự alphabet** của thứ vừa che. Oracle kiểu này khó
thấy hơn cột bị rò vì nó không nằm trong body response. Nay cả hai sắp theo cột ĐÃ CHE + khoá phá hoà.

**(3) Ca DENY phải được chứng minh là CẮN, không phải chỉ chạy xanh.** Ca `D2` của
`identity-projection-scope.int-spec.ts` ban đầu **xanh cả khi bản vá bị vô hiệu hoàn toàn** — vì chưa
seed số dư phép nào, "0 hàng mang khoá danh tính" đúng một cách rỗng. Chỉ phát hiện được bằng cách
CHẠY LẠI suite sau khi cố ý neutralise `fromScope`. Bốn ca kia đỏ, một ca xanh — và cái xanh đó là
cái nguy hiểm. Quy trình đáng giữ: sau khi ca DENY xanh, **vô hiệu hoá bản vá rồi chạy lại**; ca nào
không đỏ thì nó chưa khẳng định gì.
