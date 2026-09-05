# DECISIONS-13 — `/auth/me.capabilities` phản chiếu quyết định của `can()` ở tầng công ty

> **Trạng thái:** ĐÃ CHỐT (owner, 2026-09-05) · **ĐẢO** quyết định `S2-AUTH-BE-5` (FIX-1-CAP-EXPOSE).
> **Thi công:** WO `S14-SEC-CAPWILDCARD-1` — `docs/plans/S14-SEC-CAPWILDCARD-1.md` (v3).
> **Liên quan:** `DECISIONS-12` (cờ sensitive là thuộc tính của CẶP ĐÍCH) · `DECISIONS-09` (reauth +
> object grant) · `docs/permission-matrix-spec.md`.
>
> ⚠️ ADR này **chưa được thi công**. Cho tới khi WO trên merge, code vẫn theo `S2-AUTH-BE-5`.

---

## 1. Quyết định đang bị đảo — phát biểu cho ĐÚNG trước khi bác

`S2-AUTH-BE-5` chốt, và ghi ở `apps/api/src/permission/permission.service.ts:21-27`:

> _"`getCapabilities()` **CỐ Ý** lọc bỏ MỌI grant sensitive (**FE không được suy quyền nhạy cảm từ map
> gợi ý**) ⇒ FE `useCan()` trên cặp nhạy cảm luôn false. Allowlist này **TÁI MỞ có kiểm soát** ĐÚNG các
> cặp **view-only ĐỌC** — KHÔNG nới enforcement."_

Đây **không** phải một hàng rào tuỳ tiện. Nó có:

| Thành phần        | Ở đâu                                                                                        |
| ----------------- | -------------------------------------------------------------------------------------------- |
| Tiêu chí gốc      | "cặp view-only ĐỌC được phép hiện làm gợi ý UI" (`permission.service.ts:21-27`)              |
| Danh sách         | `SENSITIVE_CAPABILITY_ALLOWLIST` — **69 chuỗi literal, APPEND-only** (`:43-240`)             |
| Tiêu chí vận hành | `SENSITIVE_SCREEN_GATE_PAIRS` = "cặp đang được dùng làm **cổng MÀN HÌNH** ở FE" (`:250-300`) |
| Cổng máy          | `sensitive-screen-gate-allowlist.spec.ts:20-31` ép `SENSITIVE_SCREEN_GATE_PAIRS ⊆ ALLOWLIST` |

Bất kỳ ai định bác quyết định này phải bác **cả bốn**, không chỉ cái danh sách.

---

## 2. Vì sao đảo — bằng chứng, không phải sở thích

### 2.1 Cổng máy chỉ một chiều, và chiều còn lại đã hụt 8+ lần

`sensitive-screen-gate-allowlist.spec.ts` chỉ bắt được cặp mà **ai đó đã nhớ** khai vào
`SENSITIVE_SCREEN_GATE_PAIRS`. Quên khai ⇒ cổng im. Docblock của chính spec đó thú nhận:

> _"một lớp lỗi **đã lặp 8+ lần** trong repo … màn quản trị gác bằng cặp nhạy cảm mà quên allowlist sẽ
> **biến mất với đúng vai được cấp quyền** — không lỗi, không log, không test nào đỏ. Lần gần nhất
> (2026-08-02) nó giấu luôn màn Chính sách nghỉ, tức đường DUY NHẤT bật engine cộng dồn phép ⇒
> **chặn go-live**."_

Một tiêu chí phải duy trì bằng tay, hụt 8+ lần, và một lần chặn go-live — đó là **hỏng theo thiết kế**,
không phải hỏng do thi công ẩu.

### 2.2 Tiêu chí gốc đã TRÔI, và không ai đo được độ trôi

Tiêu chí là "cặp **view-only ĐỌC**". Trong 69 mục hôm nay có `delete:user` · `restore:user` ·
`reset-password:user` · `adjust:leave-balance` · `approve:payroll-period` · `publish:payroll-period` ·
`reopen:payroll-period` · `convert:candidate` · `upload:candidate-file` — **động từ GHI**. Danh sách đã
trôi khỏi tiêu chí sinh ra nó, và không cổng nào phát hiện được vì tiêu chí sống trong văn xuôi.

### 2.3 Bản thân giá trị bảo vệ đã không còn nguyên

Mục tiêu tuyên bố là "FE không được suy quyền nhạy cảm từ map gợi ý". Nhưng map hôm nay **đã** phơi
69 cặp nhạy cảm, **và** phơi `*:*` cho actor giữ wildcard — mà `use-can.ts:16-22` đọc `*:*` là "mọi
thứ". Tức với actor giữ wildcard, map hôm nay phơi **NHIỀU hơn** mọi phương án ở §3. Hàng rào đang rò
ở đúng chỗ nó cần kín nhất.

### 2.4 Nó là nguồn sự thật THỨ HAI, đang trôi khỏi engine

`DECISIONS-12` §2 vừa hội tụ **ba** bản cài đặt của luật sensitive về một luật. `getCapabilities` +
allowlist là bản thứ tư, và nó không dùng luật ấy: nó đọc cờ của **HÀNG GRANT**, rồi bù bằng một danh
sách tay. Giữ nó là giữ đúng thứ ADR-12 vừa dẹp.

---

## 3. Ba hướng đã cân nhắc

|       | Hướng                                                    | Kết                                                                                                                                                                                                                                                                                       |
| ----- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A** | Giữ nguyên cơ chế, APPEND cặp còn thiếu vào allowlist    | **LOẠI.** Vá lần thứ 9 cho một cơ chế đã hụt 8 lần; không đổi lý do gốc.                                                                                                                                                                                                                  |
| **B** | Bỏ `*:*` khỏi caps, GIỮ luật lọc sensitive               | **LOẠI.** Đo được (WO §2): trên PROD, role `SA` (~10 user) giữ grant EXACT cho **128/128** cặp sensitive; hôm nay FE của họ thấy màn **chỉ nhờ** `caps["*:*"]`. Bỏ `*:*` mà giữ luật lọc ⇒ **~59–71 cặp biến mất khỏi giao diện của người vẫn dùng được** ⇒ tự gây ra chính lớp lỗi §2.1. |
| **C** | `capabilities` = tập cặp mà `can()` ALLOW ở tầng công ty | **CHỌN.**                                                                                                                                                                                                                                                                                 |

---

## 4. Hợp đồng mới — phát biểu chính xác (KHÔNG phải "⟺")

> Với `k = "action:resourceType"`:
>
> `capabilities[k] === true` **⟺** `k ∉ EXCLUDED` **∧** `can()` sẽ ALLOW `k` ở **tầng CÔNG TY** cho một
> call-site **không khai** `requiresReauth` / `objectGrantRequired`.
>
> Và bất biến hình dạng: **`k` KHÔNG BAO GIỜ chứa `*`**.

### 4.1 Vì sao phải có `EXCLUDED` — lớp reveal/step-up

`decideCan` (`apps/api/src/permission/permission.decide.ts:98-101`) chặn **TRƯỚC** khi xét company-tier:

```ts
const needsObjectGrant = objectGrantRequired ?? (isSensitive && requiresReauth);
if (needsObjectGrant) return { allow: false, reason: "deny-object-required", auditRequired: true };
// comment :96-97 — "Company-level ALLOW — even super-admin *:* — is NOT sufficient. Fail-closed DENY."
```

Hai vế `objectGrantRequired` / `requiresReauth` là **opts của CALL-SITE (route)**, không phải thuộc tính
của cặp trong DB ⇒ `getCapabilities` — vốn không biết route — **không suy ra được**. Nếu không loại trừ
tường minh, một grant exact trên `('reveal-secret','platform-account')` (`is_sensitive=true`,
`migrations/0005_permissions.sql:281`) sẽ bật `caps[...] = true` trong khi `can()` **không bao giờ**
ALLOW ở tầng công ty ⇒ hợp đồng sai **đúng ở cặp nguy hiểm nhất hệ** (mật khẩu kênh — BẤT BIẾN #3), và
sai đúng chiều "thấy-rồi-403" mà cả ADR-12 lẫn WO này sinh ra để đóng.

**Quyết:** `EXCLUDED` là **MỘT** nguồn, đặt cạnh `REVEAL_CLASS_PAIRS`
(`apps/api/src/auth/step-up/reveal-class-pairs.ts`), khởi tạo với `reveal-secret:platform-account`.
**KHÔNG** viết danh sách literal thứ hai ở `permission.service.ts` — đó đúng là thứ ADR này vừa dẹp.
Kèm ratchet: mọi cặp catalog có `action` bắt đầu bằng `reveal-secret` phải thuộc `EXCLUDED`.

### 4.2 Ba điều hợp đồng KHÔNG hứa

1. **Không** phải cổng enforcement — `PermissionGuard`/`can()` per-resource vẫn là cổng thật.
2. **Không** phủ tầng OBJECT. Cặp có object-grant/reauth bị loại hẳn ở §4.1; các cặp còn lại vẫn có thể
   403 vì lý do per-resource. Giới hạn này **đã tồn tại** cho 69 cặp hôm nay.
3. **Không** khẳng định tên cặp là bí mật. Phát `view-salary:employee = true` cho người **đã** giữ grant
   đó không cấp khả năng nào mới — họ gọi được endpoint từ trước.

---

## 5. Đánh đổi — ghi tường minh cái MẤT

| Mất                                                                                 | Đánh giá                                                                                                                               |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Thuộc tính "map gợi ý không nói gì về quyền nhạy cảm"                               | **Mất thật.** Nhưng nó đã thủng cho 69 cặp + thủng toàn bộ cho actor wildcard (§2.3) ⇒ đang bảo vệ một biên không tồn tại.             |
| `SENSITIVE_CAPABILITY_ALLOWLIST` + `getAllowlistedSensitiveCapabilities` thành thừa | Có chủ đích. **KHÔNG xoá trong WO thi công** (không đổi hai thứ trong một PR vùng đỏ) → WO dọn riêng `S18-AUTH-CAPALLOWLIST-RETIRE-1`. |
| `sensitive-screen-gate-allowlist.spec.ts` mất lý do tồn tại                         | Giữ tới khi WO dọn chạy; nó vẫn xanh (allowlist không đổi).                                                                            |
| Payload `/auth/me` to hơn                                                           | Actor giữ toàn catalog: ~389 khoá (~12KB). Không có cache caps ⇒ không đụng trần nào.                                                  |

---

## 6. Hệ quả có chủ ý — KHÔNG phải hồi quy

1. **Màn/nút gác bằng cặp sensitive ngoài allowlist sẽ HIỆN RA** với đúng vai được cấp quyền. Đây là
   mục đích. Danh sách cụ thể = câu **Q4** của `docs/plans/S14-SEC-CAPWILDCARD-1.census.sql`.
2. **Actor giữ wildcard mất khoá `*:*`, được ~249 khoá literal non-sensitive.** Bốn cổng
   route/sidebar dùng `createPermissionChecker` (`packages/web-core/src/lib/registry.ts:255-271`, khớp
   khoá **LITERAL**, không có nhánh `*`) hôm nay **ĐÓNG** với họ ⇒ sau ADR này **MỞ**. Chiều NỚI, và
   là thứ BE vốn đã ALLOW.
3. **`useCan` trên cặp sensitive trở nên TRUNG THỰC** ⇒ `useCanExact` không còn là "lối đúng duy nhất"
   cho cặp nhạy cảm. Memory `sensitive-pair-widget-needs-usecanexact` **hết hiệu lực** khi WO merge.
   Cả hai hook giữ nguyên (không đổi 345 + 128 call-site).

---

## 7. Điều kiện — ADR này CHỈ có hiệu lực khi thi công kèm đủ ba thứ

1. **Vế loại trừ §4.1** + ca RED (_grant exact `reveal-secret:platform-account` ⇒ khoá VẮNG_) + đột
   biến giết ca đó.
2. **Cổng sensitive đọc cờ CẶP ĐÍCH** (`DECISIONS-12`), thoả bằng **ALLOW EXACT** — kèm **cả hai** ca
   đối chứng: sensitive + exact ⇒ CÓ; sensitive + chỉ wildcard ⇒ VẮNG.
3. **Bất biến hình dạng** "`k` không chứa `*`" có ratchet riêng.

Thiếu bất kỳ điều nào ⇒ ADR này biến từ "hợp nhất nguồn sự thật" thành "nới quyền hiển thị không kiểm
soát". Người review FULL gate đọc §7 này trước.

---

## 8. Cổng NGƯỜI trước deploy PROD

Owner chạy `docs/plans/S14-SEC-CAPWILDCARD-1.census.sql` (chỉ-đọc, vai bỏ qua RLS —
`classifier-blocks-prod-db-from-agent`). Các câu **phải đọc trước khi chốt thiết kế**, không phải lúc
mở PR:

- **Q4** — cặp sensitive ngoài allowlist có actor giữ grant exact = **danh sách màn sẽ hiện thêm**.
  Nếu trong đó có cặp thuộc lớp reveal/step-up, hoặc cặp owner **không muốn** phơi ⇒ đổi thiết kế.
- **Q5/Q6** — hàng catalog dạng wildcard kèm cờ `is_sensitive`, và grant `DENY` trỏ vào chúng.
  Q6 > 0 trên một hàng wildcard **sensitive** ⇒ **DỪNG** (xem plan §8: đó là phản ví dụ của mệnh đề
  "không actor nào mất khoá").
