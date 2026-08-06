# DEVOPS-14 — Triển khai app vệ tinh SOCIAL (`apps/fbpost`)

> **Phạm vi:** cách chạy, cấu hình, build lại và sao lưu ứng dụng Đăng bài Facebook Page.
> **Quyết định nền:** [DECISIONS-08](../DECISIONS/DECISIONS-08_Social_Satellite_App.md) · kế hoạch wave: [S9-SOCIAL-WAVE](../plans/S9-SOCIAL-WAVE.md)
> **Trạng thái:** 🟢 **ĐÃ LIVE 06/08/2026** — dịch vụ NSSM `MediaOS-Social` chạy cổng 3500, domain `https://dangfb.funtimemediacorp.com`. Chi tiết + bằng chứng đo: §7.

---

## 1. Bản đồ cổng

| Dịch vụ | Cổng | Cách chạy |
| --- | --- | --- |
| MediaOS API (PROD) | 3100 | NSSM |
| MediaOS API (dev-online) | 3200 | NSSM |
| LMS (`apps/lms`) | 3400 | NSSM `MediaOS-LMS` |
| **fbpost (`apps/fbpost`)** | **3500** | NSSM `MediaOS-Social` — tunnel `dangfb.<domain>` |

3500 chọn vì trống và cách xa dải đang dùng. Đổi thì phải đổi đồng thời `SOCIAL_BASE_URL` phía API.

## 2. Biến môi trường

### 2.1 Phía MediaOS API (`apps/api/.env.production`)

| Biến | Bắt buộc | Ý nghĩa |
| --- | --- | --- |
| `SOCIAL_SSO_SECRET` | có | Shared secret HMAC ≥32 ký tự. **Phải khớp** `MEDIAOS_SSO_SECRET` phía fbpost. Tách biệt khỏi `LMS_SSO_SECRET` — lộ một cái không kéo theo cái kia. |
| `SOCIAL_BASE_URL` | có | Gốc public của fbpost — hiện là `https://dangfb.funtimemediacorp.com` (owner chốt 06/08/2026). Đây là đích mà cầu SSO đưa người dùng tới, nên sai giá trị = ô "Đăng bài" dẫn vào hư không. |
| `SOCIAL_COMPANY_ID` | có | UUID công ty DUY NHẤT được dùng. Thiếu ⇒ endpoint trả **503**, KHÔNG phải "cho mọi công ty". |

Thiếu cả ba thì API vẫn boot bình thường; chỉ endpoint `GET /api/v1/integrations/social/sso-link` trả 503.

### 2.2 Phía fbpost (`apps/fbpost/.env.production`)

| Biến | Bắt buộc | Ý nghĩa |
| --- | --- | --- |
| `MEDIAOS_SSO_SECRET` | có | Khớp `SOCIAL_SSO_SECRET` phía API. Lệch ⇒ mọi lần vào đều bị đá về `/login`. |
| `SOCIAL_SESSION_SECRET` | có | Ký cookie phiên, ≥32 ký tự. **Không có giá trị mặc định** — thiếu thì không ai đăng nhập được (cố ý: một giá trị dự phòng sẽ âm thầm biến hệ thành mở toang). |
| `SOCIAL_KEK_PATH` | không | Mặc định `.secrets/fbpost-kek.bin`. |
| `SOCIAL_DATA_DIR` | không | Mặc định `<cwd>/data`. Đặt tường minh khi chạy dưới NSSM — thư mục làm việc của dịch vụ không nhất thiết là thư mục mã nguồn. |
| `NEXT_PUBLIC_MEDIAOS_URL` | không | Hiện nút "Mở MediaOS" trên trang `/login`. |

## 3. Cài lần đầu

```bash
cd "apps/fbpost"
npm ci
node scripts/gen-kek.mjs          # tạo .secrets/fbpost-kek.bin — CHỈ MỘT LẦN
npm run build
npm start                          # PORT=3500 npm start
```

`gen-kek.mjs` **từ chối ghi đè** file đã có. Ghi đè KEK = mọi token Facebook đã mã hoá thành rác vĩnh viễn, phải kết nối lại từng tài khoản.

Lần khởi động đầu trên CSDL cũ sẽ tự mã hoá tại chỗ mọi token đang nằm thô (`sealPlaintextSecrets` trong `src/lib/db.ts`). Chạy được nhiều lần, không mã hoá chồng.

## 4. Build lại + khởi động lại

> ⚠️ **Hàng rào R4 của DECISIONS-08.** `next build` của fbpost ghi vào `apps/fbpost/.next` — **không** dùng chung với `dist` của API PROD. Đây chính là chỗ đã cắn thật hai lần: build LMS từng ghi đè `dist` PROD làm login 500 (xem `docs/plans/S5-LMS-*`). Trước khi build lần đầu trên máy PROD, **đo mtime** của thư mục build API rồi đo lại sau — phải không đổi.

```bash
cd "apps/fbpost"
npm run build
nssm restart MediaOS-Social
```

**Verify bằng NỘI DUNG, không bằng PID.** PID mới + log mới **không** chứng minh code mới đang chạy — dịch vụ có thể khởi động lại từ bản build cũ. Kiểm bằng một chuỗi chỉ có trong bản mới:

```bash
grep -r "<chuỗi mới>" apps/fbpost/.next/server | head -3
curl -s -o /dev/null -w "%{http_code}" http://localhost:3500/login   # 200
curl -s -o /dev/null -w "%{http_code}" http://localhost:3500/api/pages  # 401 — cổng phiên đang gác
```

Dòng thứ ba là phép thử quan trọng: **401 nghĩa là cổng phiên sống.** Nếu nó trả 200 thì middleware không chạy — dừng lại, đừng mở ra ngoài.

## 5. Worker hẹn giờ

fbpost chạy worker **in-process**, `setInterval` 60s, khởi động từ route handler đầu tiên được nạp (`src/lib/worker-boot.ts`). Có chốt `globalThis` + chặn `NEXT_PHASE=phase-production-build`.

**Phải verify sau khi cài NSSM:** đếm log tick trong 3 phút — đúng 3 lần, không phải 6. Hai worker cùng chạy sẽ đăng đôi mỗi bài.

Hệ quả phải chấp nhận (đã ghi ở DECISIONS-08 §6): dịch vụ chết thì bài đến giờ **không đăng và không có hàng đợi nào giữ lại**. Đây là chỗ vỡ đầu tiên nếu số bài lớn lên.

## 6. Sao lưu

| Thứ | Ở đâu | Ghi chú |
| --- | --- | --- |
| CSDL | `apps/fbpost/data/fbpost.db` (+ `-wal`, `-shm`) | **Không** nằm trong backup Postgres của hệ. Cần đường sao lưu riêng. |
| Media đã upload | `apps/fbpost/data/uploads/` | Cùng chỗ, cùng vấn đề. |
| **KEK** | `apps/fbpost/.secrets/fbpost-kek.bin` | **Sao lưu TÁCH KHỎI `data/`.** Để chung một chỗ thì mã hoá vô nghĩa (khoá đi kèm ổ khoá); mất riêng KEK thì mất toàn bộ token đã mã hoá. |

Dừng dịch vụ trước khi copy `fbpost.db`, hoặc dùng `sqlite3 .backup` — SQLite ở chế độ WAL không an toàn khi copy nóng bằng `cp`.

## 7. Trạng thái triển khai (cập nhật 06/08/2026)

### 7.1 ĐÃ XONG — có bằng chứng đo được

- [x] **PR #354 merge vào master** (`98516e01`), CI 12/12 xanh.
- [x] **Migration lên DB PROD**: `mediaos` từ **210 → 213**. Áp `0543` (wave CHAT — owner đồng ý áp kèm, vì migrator đơn điệu nên không tách được) + `0544` + `0545`.
      Sao lưu trước khi áp: `pg_dump -Fc` 4,58 MB, **333 mục ACL** (giữ quyền — tránh bẫy 28P01 lúc restore).
      Đo lại schema sau khi áp (KHÔNG tin dòng log "applied"): `pinned_at`=1 · `avatar_file_id`=1 · bảng `chat_message_reactions` có RLS **và** FORCE · 3 cặp quyền + 3 grant `social` · CHECK `object_type` 106 giá trị, có `social_sso`+`social_account`, **canary `defect` và `notification` còn nguyên**.
      PROD API + LMS vẫn `200` sau khi áp.
- [x] **KEK production**: `apps/fbpost/.secrets/fbpost-kek.bin` (32 byte). `gen-kek.mjs` đã kiểm: chạy lần 2 từ chối ghi đè, exit 1.
- [x] **Secret + env**: `apps/fbpost/.env.production` + `apps/fbpost/.env.production.api-block` (khối dán cho `apps/api/.env`). Cả ba file **đã xác minh bị `.gitignore` loại** (`.env.*` dòng 29, `.secrets/` dòng 32).
- [x] **`SOCIAL_COMPANY_ID`** = `257e5de2-d1e6-4b81-87d9-944b2d9d006c` (Funtime Media Corp).
- [x] **Chạy thử ĐÚNG lệnh NSSM sẽ dùng, với CHÍNH cấu hình production**: smoke đầu-cuối **8/8** — 401 khi không phiên · SSO cấp cookie HttpOnly+Lax · phát lại bị từ chối · sai chữ ký bị từ chối.

Bổ sung đã làm thêm (vẫn không cần Administrator): 3 biến `SOCIAL_*` đã nạp vào `apps/api/.env` (backup ở scratchpad `api.env.bak`), hai secret đã đối chiếu **khớp nhau**; `contracts` + `api` đã build (dist có `integrations/social/*.js`) và **đã đóng gói release** `20260806-065135__1.0.0-rc.1__8faaa68c` — nhưng **chưa activate**, `current` vẫn trỏ bản cũ (an toàn: service đang chạy không bị đụng).

### 7.1b ĐÃ LIVE — chạy 06/08/2026, đo được

| Kiểm | Kết quả |
| --- | --- |
| Dịch vụ `MediaOS-Social` | `Running`, `StartType=Automatic`, cổng **3500** mở |
| API PROD `/api/v1/health` `.data.build` | `1.0.0-rc.1` · commit **`8faaa68c`** · head **`0545_s9socialdb1_audit_social`** |
| `/api/v1/integrations/social/sso-link` | **401** (trước khi deploy là 404) ⇒ route đã sống |
| fbpost `/login` · `/compose` · `/api/pages` | `200` · `307→/login` · **`401`** |
| Smoke đầu-cuối trên cổng 3500 thật | **8/8** — SSO cấp cookie HttpOnly+Lax, phát lại bị từ chối, sai chữ ký bị từ chối, response không có `accessToken` |
| LMS (3400) sau khi restart API | `200` — không ảnh hưởng |

⇒ **Cửa sổ "tile chết" ở §7.3 đã đóng.** Company-admin bấm ô "Đăng bài" giờ vào được thật.

> ⚠️ **Lỗi script lần chạy đầu (đã vá).** Bước 4 dùng `& $nssm restart $svc 2>$null`. Trong PowerShell 5.1, chuyển hướng stderr của native exe bọc mỗi dòng thành `ErrorRecord`; với `$ErrorActionPreference='Stop'` là **ném lỗi ngay** — dù `nssm` chỉ in `"STOP: The service has not been started."` (thông báo bình thường khi dịch vụ đang dừng) và nhánh `start` **đã khởi động xong, cổng 3500 đã mở**. Nhìn màn hình tưởng hỏng, thực tế đã thành công; script chỉ bỏ qua 2 bước verify. Bản hiện tại hỏi `Get-Service` rồi chọn `Start-Service`/`Restart-Service`, **không đọc exit-code của nssm**.

### 7.2 CÒN LẠI — gom về ĐÚNG MỘT lệnh cần Administrator

```powershell
powershell -ExecutionPolicy Bypass -File "C:\Users\fmcai\install-social.ps1"
```

Chạy từ **PowerShell bất kỳ** (không cần mở sẵn cửa sổ admin) — script **tự xin quyền**, hiện hộp thoại UAC, bấm *Yes*. Nhật ký đầy đủ ghi ra `C:\Users\fmcai\install-social.log`.

Script làm 5 bước, dừng ngay khi có bước hỏng: kiểm điều kiện → `activate --latest` + `verify` rồi restart API PROD (**bắt buộc `sso-link` khác 404 — vẫn 404 nghĩa là đang chạy dist cũ ⇒ dừng**) → cài/cập nhật NSSM `MediaOS-Social` cổng 3500 → khởi động, chờ `/login` = 200 → **kiểm `GET /api/pages` phải 401** và DỪNG nếu không (cổng phiên hỏng thì tuyệt đối không mở ra Internet).

> ⚠️ Bản script đầu (ở scratchpad) **không chạy được** vì có dòng `#requires -RunAsAdministrator`: PowerShell từ chối nạp file ngay từ đầu khi cửa sổ chưa elevated, kèm lỗi *"cannot be run because it contains a #requires statement"*. Bản hiện tại bỏ dòng đó và tự `Start-Process -Verb RunAs`. Đã xoá bản cũ để không chạy nhầm.

### 7.2b Domain `dangfb.funtimemediacorp.com` (owner chốt 06/08/2026)

Đã làm **không cần admin**: DNS CNAME `dangfb` → tunnel `95d2e685` (`cloudflared tunnel route dns mediaos-api dangfb.funtimemediacorp.com`); `SOCIAL_BASE_URL` trong `apps/api/.env` đổi sang `https://dangfb.funtimemediacorp.com`.

Đo lúc đó: `https://dangfb.…/login` → **404**, `https://train.…` → 307. 404 ở đây có nghĩa rất cụ thể — **DNS + tunnel đã tới nơi, chỉ thiếu ingress rule** (rơi vào quy tắc bắt-tất-cả `http_status:404`), khác hẳn "không phản hồi" (DNS/tunnel chết). `m prod-status` nay phân biệt đúng hai ca này.

Phần **cần Administrator** gói trong một lệnh:

```powershell
powershell -ExecutionPolicy Bypass -File "C:\Users\fmcai\social-domain.ps1"
```

Thêm ingress rule vào `C:\ProgramData\cloudflared\config.yml` → `cloudflared tunnel ingress validate` → `tunnel ingress rule` (khẳng định hostname map đúng cổng 3500, vì `validate` chỉ kiểm cú pháp) → restart `cloudflared` + `MediaOS-API` → kiểm qua domain thật.

> ⚠️ `config.yml` đó phục vụ **cả 8 hostname** (`api`, `train`, `cian-dev*`, `tasklive`, `danews`). Sai file là sập hết. Vì vậy script **backup trước, validate sau, và khôi phục backup ngay nếu validate đỏ** — không bao giờ restart với file chưa validate. Rule mới chèn **trước** quy tắc `http_status:404`; đặt sau nó thì không bao giờ được đọc tới.
>
> Phép thử quan trọng nhất ở cuối: `https://dangfb.…/api/pages` phải trả **401**. Đây là lần đầu cổng phiên bị kiểm **trên đường công khai** — khác hẳn kiểm qua `localhost`. Khác 401 ⇒ script dừng và bảo gỡ ingress rule ra ngay: fbpost sẽ đang lộ ra Internet mà không có cổng nào chắn.

### 7.2c Còn lại sau khi có domain

- [ ] Đường sao lưu riêng cho `data/` + `.secrets/` — **tách nhau**.
- [ ] Cảnh báo token Facebook sắp hết hạn (`accounts.token_expires_at` có sẵn, chưa ai đọc) — ngoài phạm vi wave S9.

### 7.3 ⚠️ Cửa sổ "tile chết" — biết trước để không đi tìm bug

FE tự deploy lên Cloudflare Pages khi merge master (`DEPLOY_FE_ENABLED=true`), và `0544` đã cấp `view:social-post` cho `company-admin` **trên PROD**. Nghĩa là ô **"Đăng bài" hiện ra ngay**, trong khi API PROD vẫn chạy dist CŨ (chưa có `/integrations/social/sso-link`) và dịch vụ 3500 chưa tồn tại.

⇒ Từ lúc FE lên Pages đến khi xong §7.2, **company-admin bấm ô "Đăng bài" sẽ thấy thông báo lỗi** ("Không lấy được liên kết mở ứng dụng Đăng bài"). Không sập, không rò gì — chỉ là cửa chưa thông.

**CỐ Ý không thu hồi grant để bịt tạm.** Làm vậy tạo lệch giữa "migration đã áp" và "hiện trạng DB" — đúng bẫy `grant-in-old-migration-is-not-current-state`: người đọc `0544` sau này sẽ tin có grant mà thực tế không có. Thà một cửa sổ lỗi đọc được, còn hơn một cái bẫy im lặng.
