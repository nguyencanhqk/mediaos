# DECISIONS-08 — App vệ tinh `SOCIAL` (đăng bài Facebook Page): nới **giai đoạn**, không nới bất biến

| | |
| --- | --- |
| **Trạng thái** | ✅ **Owner đã ký** — xem §7. |
| **Ngày** | 2026-08-06 |
| **Bối cảnh** | Owner có sẵn repo `C:\fbpost` (đã chạy được) và yêu cầu nhập vào hệ thành ứng dụng mới. Owner chọn **hướng A — app vệ tinh sao khuôn `apps/lms`**. |
| **Vùng** | 🔴 ĐỎ — chạm token bên thứ ba + tạo đường vào hệ thống mới (cầu SSO) |
| **Thay thế** | Không huỷ quyết định nào. **Nới giai đoạn** của module `SOCIAL` (Phase 4 → làm ngay), có hàng rào. |
| **Kéo theo** | `harness/backlog.mjs` thêm mã module `SOCIAL` · `pnpm-workspace.yaml` thêm `!apps/fbpost` · SPEC-01 §7/§25 ghi chú giai đoạn thực tế của `SOCIAL` |

---

## 1. Vấn đề

Repo `C:\fbpost` là một ứng dụng hoàn chỉnh, đang chạy: soạn bài, hẹn giờ, rải lên nhiều Facebook Page
thuộc nhiều tài khoản, nhập hàng loạt từ CSV/Excel. **65 file, 21 route API, 7 bảng, worker hẹn giờ 60s.**
Nó giải quyết một nhu cầu có thật và đã tốn công xây.

Nhưng nó được viết cho **máy cá nhân một người dùng**, còn MediaOS là **hệ nội bộ nhiều người, có phân
quyền, có audit**. Ba khoảng cách không thể bỏ qua:

| # | Khoảng cách | Bằng chứng (đo 06/08/2026) |
| --- | --- | --- |
| 1 | Token Facebook lưu **chữ thô** | `src/lib/db.ts:26-49` — `accounts.app_secret`, `accounts.user_token`, `pages.access_token` đều `TEXT` |
| 2 | **Không có cổng phiên** | `src/app/api/accounts/route.ts`, `pages/route.ts`… không kiểm phiên; chỉ nhánh `auth/facebook/*` có OAuth |
| 3 | Không có `company_id`, hard-delete cả 7 bảng | 0 cột tenant; `DELETE FROM` ở cả 7 repository |

Vì vậy: hoặc **viết lại thành module NestJS** (hướng B — bỏ gần hết 65 file), hoặc **nhập làm app vệ tinh
và vá đúng ba khoảng cách trên** (hướng A). Owner chọn A.

## 2. Vì sao đây KHÔNG phải "thứ vừa bị cắt"

Đợt de-media-fy (20/06/2026) loại **media/kênh/video/content + tài chính-theo-kênh**. `fbpost` không nằm
trong nhóm đó: nó là module **`SOCIAL`, Phase 4** của lộ trình (CLAUDE.md §1 · SPEC-01 §7/§25) — cùng
nhóm với `CHAT` đang thi công ở S7/S8.

Nói cho chính xác: đây **không phải vấn đề phạm vi, mà là vấn đề thứ tự**. Hệ đang ở S6 go-live (còn
G1·G7·G8·G10 chưa đạt) và wave S8-CHAT-UX. Nới giai đoạn mà không có hàng rào thì wave mới sẽ ăn mất
nguồn lực của vùng đỏ đang dở — nên §4 tồn tại.

---

## 3. Sáu quyết định

### `SOCIAL-DEC-001` — Kéo `SOCIAL` từ Phase 4 lên làm app vệ tinh ngay

**Chốt: ĐỒNG Ý**, ràng buộc bởi 4 hàng rào §4.

Code đã có sẵn và chạy được; chi phí nhập ≪ chi phí viết lại. Mô hình vệ tinh đã được chứng minh bằng
`apps/lms` chạy PROD từ S5.

### `SOCIAL-DEC-002` — fbpost giữ SQLite, KHÔNG có `company_id`

**Chốt: ĐỒNG Ý** — khoá cứng một công ty bằng biến môi trường `SOCIAL_COMPANY_ID`, y hệt `LMS_COMPANY_ID`.

BẤT BIẾN #1 nói "`company_id` ở mọi query dữ liệu nghiệp vụ" và ép bằng RLS ở Postgres. fbpost không dùng
Postgres và không phải kho dữ liệu nghiệp vụ của hệ — nó là **công cụ vận hành một chiều đi ra**
(MediaOS → Facebook), không chứa hồ sơ nhân sự, chấm công hay lương.

Cách giữ bất biến ở đây là **chặn ở cầu nối** chứ không ở bảng: `SocialSsoService` chỉ mint token khi
`companyId === SOCIAL_COMPANY_ID`. Công ty khác không có đường vào — không phải vì SQLite lọc đúng, mà
vì họ không bao giờ nhận được phiên. Đây đúng mô hình LMS đang chạy.

**Hệ quả phải chấp nhận:** nếu sau này hệ chạy N>1 công ty, fbpost **không** dùng chung được — phải tách
instance mỗi công ty hoặc port sang hướng B. Ghi nhận, không né.

### `SOCIAL-DEC-003` — Token Facebook lưu mã hoá bằng KEK

**Chốt: ĐỒNG Ý — bắt buộc, chặn triển khai.**

BẤT BIẾN #3 không có ngoại lệ cho "app nhỏ". Một Page Access Token cho phép đăng bài nhân danh công ty
lên trang công khai; mất nó là mất quyền phát ngôn, không phải mất một bản ghi. CLAUDE.md §2 đã dự liệu
đúng ca này: _"Envelope-encryption/KMS chỉ áp dụng lại nếu Phase sau cần lưu credential bên thứ ba."_
Phase sau đã đến.

### `SOCIAL-DEC-004` — Không ép soft-delete cho 7 bảng SQLite

**Chốt: ĐỒNG Ý**, kèm một ngoại lệ.

BẤT BIẾN #2 nói "dữ liệu **quan trọng**". Nội dung nháp, media đã upload, kế hoạch rải bài — xoá đi thì
mất một bản nháp, không mất bằng chứng gì. Ép `deleted_at` lên cả 7 bảng là nghi lễ, không phải an toàn.

**Ngoại lệ:** gỡ một **tài khoản Facebook** hoặc một **Page** là hành động quan trọng (thu hồi quyền phát
ngôn của công ty trên một kênh). Hai hành động đó phải ghi audit **sang MediaOS**, không phải chỉ xoá
im lặng ở SQLite.

### `SOCIAL-DEC-005` — Code fbpost vào git monorepo MediaOS

**Chốt: ĐỒNG Ý** — khác `apps/lms` ở đúng điểm này.

`apps/lms` có repo git riêng vì nó là sản phẩm nhập từ ngoài, có lịch sử riêng. `fbpost` **chưa từng
`git init`** — không có lịch sử nào để giữ, và 65 file thì không đáng lập repo riêng. Vào monorepo thì
CI path-filter, review gate và `harness/check.sh` dùng được ngay.

Vẫn **loại khỏi pnpm workspace** (hàng rào R3) — đó là chuyện quản lý dependency, độc lập với chuyện git.

### `SOCIAL-DEC-006` — Ai được dùng

**Chốt: ĐỒNG Ý** — 3 cặp quyền mới, cấp có chọn lọc:

| Quyền (cặp engine) | Cho phép | Cấp cho |
| --- | --- | --- |
| `('view','social-post')` | Xem bài đã đăng/đang hẹn giờ | quản trị + marketing |
| `('create','social-post')` | Soạn, hẹn giờ, đăng | quản trị + marketing |
| `('manage','social-account')` | Kết nối/gỡ tài khoản Facebook, quản lý Page | **chỉ quản trị** |

Token Page là tài sản công ty, không phải công cụ cá nhân. Không cấp đại trà.

---

## 4. Bốn hàng rào (điều kiện của `SOCIAL-DEC-001`)

| Mã | Hàng rào | Vì sao |
| --- | --- | --- |
| **R1** | Wave S9-SOCIAL **không tự khởi động**. Vùng đỏ đang READY của S7-CALL / S8-CHAT-UX giữ ưu tiên cao hơn; owner chỉ định rõ thứ tự. | Chống việc mới ăn mất nguồn lực của việc dở |
| **R2** | Chỉ đụng `apps/api` ở **đúng 2 điểm**: `src/integrations/social/` + 1 migration seed quyền. Mọi thứ khác nằm trong `apps/fbpost/**`. | Giữ bán kính vụ nổ nhỏ; monolith không phình vì một app vệ tinh |
| **R3** | Thêm `!apps/fbpost` vào `pnpm-workspace.yaml`. Root `pnpm install`/`turbo` **không** được đụng tới. | fbpost dùng npm + `package-lock.json` + Tailwind v4 riêng; trộn vào là xung đột deps |
| **R4** | `next build` của fbpost **không** ghi vào bất kỳ thư mục build nào PROD/dev-online đang phục vụ. | Đã xảy ra thật: build LMS từng ghi đè `dist` PROD làm login 500 |

---

## 5. Cái KHÔNG được nới

Nới giai đoạn **không** kéo theo nới bất biến. Ba điều sau giữ nguyên hiệu lực:

1. **BẤT BIẾN #3 giữ nguyên** — `SOCIAL-DEC-003` là *áp dụng* nó, không phải miễn trừ.
2. **Cầu SSO fail-closed** — audit ghi **trước** khi trả URL; audit vỡ thì request 500 và token không rò
   ra ngoài. Đây là khuôn `LmsSsoService` đã trả nợ ở S5-LMS-BE-2, không được làm nhẹ đi.
3. **Không có `@SubscribeMessage` mới, không đường vòng qua WS.** fbpost nói chuyện với MediaOS bằng
   HTTP + token HMAC một-lần. Không nối vào cụm Socket.IO.

---

## 6. Cái phải trả giá (ghi nhận, không né)

- fbpost **không nhân bản được** cho công ty thứ hai (hệ quả `SOCIAL-DEC-002`).
- Dữ liệu fbpost **không nằm trong backup Postgres** của hệ — cần đường sao lưu riêng cho
  `data/fbpost.db`, nếu không mất máy là mất toàn bộ lịch sử đăng bài.
- Worker hẹn giờ **in-process**, không phải BullMQ — dịch vụ chết thì bài đến giờ không đăng, và không có
  hàng đợi nào giữ lại. Chấp nhận ở quy mô hiện tại; nếu số bài lớn lên thì đây là chỗ vỡ đầu tiên.
- Token Facebook **hết hạn im lặng** — bảng `accounts` có `token_expires_at` nhưng chưa ai đọc. Wave này
  chỉ làm cho nó *quan sát được*, chưa cảnh báo tự động.

---

## 7. Chữ ký

| | |
| --- | --- |
| **Owner** | ✅ Đã ký — 2026-08-06 ("xử lý nhanh luôn", chốt cả 6 quyết định §3 theo đề xuất + 4 hàng rào §4) |
| **Hiệu lực** | Từ 2026-08-06. `S9-SOCIAL-DOC-1` đóng; các WO còn lại của wave mở khoá theo DAG trong `docs/plans/S9-SOCIAL-WAVE.md` §4. |

> Nếu một hàng rào §4 bị vi phạm trong lúc thi công, dừng lại và sửa **hàng rào hoặc thiết kế** — không
> sửa ADR cho khớp việc đã làm.
