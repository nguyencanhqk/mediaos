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

### 2.1 Phía MediaOS API — **`.env` ở GỐC REPO**, không phải `apps/api/.env`

> ⚠️ **Đặt nhầm file là bug câm.** `ENV_FILE_PATHS = [".env", "../../.env"]` (`apps/api/src/config/env.schema.ts`) tính theo **CWD**, mà NSSM chạy API với `AppDirectory` = **gốc repo** ⇒ file được đọc là `<repo>\.env`. `apps/api/.env` **không bao giờ** được đọc ở PROD (nó chỉ có tác dụng khi chạy dev với cwd = `apps/api`).
>
> Đã cắn thật 06/08/2026: 3 biến `SOCIAL_*` đặt vào `apps/api/.env`, API restart bình thường, `m prod-status` báo "cầu SSO OK" — nhưng người dùng bấm ô "Đăng bài" nhận **503**. Đối chiếu để khỏi nhầm: `LMS_*` (6 biến) vốn nằm ở `.env` gốc.
>
> `m prod-status` nay kiểm thẳng sự hiện diện của 3 biến trong `.env` gốc, vì phép thử HTTP không phát hiện được ca này (xem §2.1b).

| Biến | Bắt buộc | Ý nghĩa |
| --- | --- | --- |
| `SOCIAL_SSO_SECRET` | có | Shared secret HMAC ≥32 ký tự. **Phải khớp** `MEDIAOS_SSO_SECRET` phía fbpost. Tách biệt khỏi `LMS_SSO_SECRET` — lộ một cái không kéo theo cái kia. |
| `SOCIAL_BASE_URL` | có | Gốc public của fbpost — hiện là `https://dangfb.funtimemediacorp.com` (owner chốt 06/08/2026). Đây là đích mà cầu SSO đưa người dùng tới, nên sai giá trị = ô "Đăng bài" dẫn vào hư không. |
| `SOCIAL_COMPANY_ID` | có | UUID công ty DUY NHẤT được dùng. Thiếu ⇒ endpoint trả **503**, KHÔNG phải "cho mọi công ty". |

Thiếu cả ba thì API vẫn boot bình thường; chỉ endpoint `GET /api/v1/integrations/social/sso-link` trả 503.

### 2.1b Vì sao không thể phát hiện thiếu env bằng phép thử HTTP

Gọi `sso-link` **không xác thực** luôn trả **401** — guard xác thực chạy **trước** service, nên một cầu thiếu env trả 401 y hệt một cầu hoàn hảo. Nói cách khác: `401` chỉ chứng minh **route tồn tại**, không chứng minh **cầu dùng được**.

Vì vậy `m prod-status` dùng **hai phép đo khác loại**:

| Phép đo | Nói được gì | Mù chỗ nào |
| --- | --- | --- |
| HTTP `sso-link` | `404` = API chạy dist cũ · `401` = route có | không thấy thiếu env |
| Đọc `.env` gốc | thiếu biến nào, tên cụ thể | không thấy dist cũ |

Một phép đo là không đủ — đúng bài học chung của DEVOPS-14.

### 2.2 Phía fbpost (`apps/fbpost/.env.production`)

| Biến | Bắt buộc | Ý nghĩa |
| --- | --- | --- |
| `MEDIAOS_SSO_SECRET` | có | Khớp `SOCIAL_SSO_SECRET` phía API. Lệch ⇒ mọi lần vào đều bị đá về `/login`. |
| `SOCIAL_SESSION_SECRET` | có | Ký cookie phiên, ≥32 ký tự. **Không có giá trị mặc định** — thiếu thì không ai đăng nhập được (cố ý: một giá trị dự phòng sẽ âm thầm biến hệ thành mở toang). |
| `SOCIAL_BASE_URL` | có (khi chạy sau tunnel) | **Cùng giá trị** với `SOCIAL_BASE_URL` ở `.env` gốc. Đây là gốc công khai dùng để dựng `redirect_uri` gửi cho Facebook. Thiếu ⇒ code lùi về origin của request, mà sau cloudflared origin đó là `https://localhost:3500` ⇒ đăng nhập Facebook xong người dùng nhận `ERR_SSL_PROTOCOL_ERROR` (xem §2.3). |
| `SOCIAL_KEK_PATH` | không | Mặc định `.secrets/fbpost-kek.bin`. |
| `SOCIAL_DATA_DIR` | **có trên PROD** | Mặc định `<cwd>/data`, tức ổ **C:** — không dùng được cho video nặng. PROD đặt `D:/MediaOS-Social/data` (18/08/2026, S10-SOCIAL-OPS-1). Viết bằng **gạch xuôi**: `\` trong `.env` đã từng bị nuốt một cái và âm thầm trỏ về ổ C: mà không ai thấy. |
| `NEXT_PUBLIC_MEDIAOS_URL` | không | Hiện nút "Mở MediaOS" trên trang `/login`. |

### 2.3 Đăng nhập Facebook sau tunnel — hai loại chuyển hướng, hai luật khác nhau

Sau cloudflared, Next thấy `Host: localhost:3500`, nên `request.nextUrl.origin` = `https://localhost:3500`. **Không bao giờ** dựng URL người-dùng-nhìn-thấy từ giá trị đó. Hai loại chuyển hướng phải xử lý khác nhau:

| Loại | Cách đúng | Vì sao |
| --- | --- | --- |
| **Nội bộ** (`/settings`, `/login`, `/`) | `Location` **tương đối** — `lib/http/relative-redirect.ts` | Trình duyệt giải theo URL yêu cầu (URL công khai) ⇒ đúng ở mọi cách triển khai, không cần cấu hình, không phải tin `X-Forwarded-Host`. |
| **`redirect_uri` gửi cho Facebook** | **Tuyệt đối**, lấy từ `SOCIAL_BASE_URL` — `resolvePublicOrigin()` trong `lib/fb/oauth.ts` | OAuth bắt buộc tuyệt đối và Facebook đối chiếu **từng ký tự** với "URI chuyển hướng OAuth hợp lệ". Không thể suy từ request. |

> **Bẫy đã cắn thật 06/08/2026 (lần 2, sau bug route SSO).** `redirect_uri` dựng từ origin của request ⇒ `https://localhost:3500/api/auth/facebook/callback`. Facebook **không chặn** — app đang ở chế độ Development nên localhost được miễn khỏi danh sách hợp lệ, kể cả khi "Chế độ sử dụng nghiêm ngặt" đang bật. Lỗi chỉ lộ ra trên màn hình người dùng: đồng ý xong, trình duyệt đi tới `https://localhost:3500/...` — cổng đó không có TLS ⇒ **`ERR_SSL_PROTOCOL_ERROR`**, token không bao giờ được đổi.
>
> Khi đổi domain: phải sửa **ba** chỗ cùng lúc — `SOCIAL_BASE_URL` ở `.env` gốc, `SOCIAL_BASE_URL` ở `apps/fbpost/.env.production`, và "URI chuyển hướng OAuth hợp lệ" trong app Facebook (`<domain>/api/auth/facebook/callback`). Lệch một chỗ thì Facebook báo *URL Blocked* — đỏ tường minh, không phải hỏng câm.

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

**Trạng thái trước 18/08/2026: KHÔNG CÓ.** `MediaOS-BackupDaily` (02:00) chỉ chạy `scripts/backup-db.sh`
cho Postgres. CSDL SQLite, 2.8GB media và KEK của fbpost đều là bản **duy nhất**, không nằm trong bất
kỳ đường sao lưu nào — suốt 12 ngày kể từ khi app lên PROD.

Từ 18/08/2026 (S10-SOCIAL-OPS-1): tác vụ **`MediaOS-SocialBackupDaily`** 02:30 chạy
`scripts/windows/12-social-backup.ps1` (lệch 30 phút với backup Postgres để hai việc không tranh I/O).

| Thứ | Nguồn | Đích | Cách + vì sao |
| --- | --- | --- | --- |
| CSDL | `<SOCIAL_DATA_DIR>/fbpost.db` | `D:\backup-social\data\fbpost-<stamp>.db` — giữ **7 bản**, xoay vòng | `VACUUM INTO`, **không** copy file. SQLite ở chế độ WAL không an toàn khi copy nóng: bản chép ra thiếu phần đang nằm trong `-wal` vẫn **mở được**, chỉ thiếu dữ liệu mới nhất — hỏng lặng lẽ. `VACUUM INTO` cho bản nhất quán mà **không cần dừng dịch vụ**. |
| Media | `<SOCIAL_DATA_DIR>/uploads/` | `D:\backup-social\data\uploads\` — mirror **cộng dồn** | Không nén (video đã nén sẵn; zip lại mỗi ngày chỉ tốn giờ và chỗ). Không dùng `/MIR`: xoá nhầm ở nguồn sẽ lan sang bản sao lưu — đúng thứ mà sao lưu phải chặn. |
| **KEK** | `apps/fbpost/.secrets/fbpost-kek.bin` | `D:\backup-social\kek\fbpost-kek-<stamp>.bin` — **đánh phiên bản, KHÔNG BAO GIỜ ghi đè** | Ghi đè KEK = mọi token Facebook đã mã hoá thành rác **vĩnh viễn**, không có đường khôi phục. Script từ chối ghi khi trùng tên, và bỏ qua khi nội dung trùng bản mới nhất (KEK gần như không đổi — không việc gì đẻ 365 bản giống hệt nhau mỗi năm). Retention của `data` **không** đụng tới `kek`: hai vòng đời khác hẳn nhau. |

**Kiểm được thì mới là sao lưu.** Snapshot vừa tạo bị `PRAGMA integrity_check` + đếm hàng
`media`/`contents`/`posts` ngay tại chỗ; không qua thì script thoát khác 0 và **giữ nguyên** các bản cũ.

> `exit 0` tường minh ở cuối script là bắt buộc, không phải thừa: `robocopy` trả mã **1** khi "đã chép
> file" (tức thành công), và PowerShell lấy `$LASTEXITCODE` của lệnh native cuối cùng làm mã thoát của
> cả script ⇒ thiếu dòng đó thì Task Scheduler ghi `LastTaskResult=1` **mỗi ngày**. Báo động giả hằng
> ngày là cách nhanh nhất để người vận hành học cách phớt lờ báo động thật.

⚠️ **Cả ba đích đều nằm trên CÙNG một máy.** Hỏng ổ D: là mất cả ba. Định kỳ mang **một** bản KEK +
**một** snapshot CSDL ra ngoài máy (USB/OneDrive) — việc TAY, chưa tự động hoá.

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

- [x] Đường sao lưu riêng cho `data/` + `.secrets/` — **tách nhau**. Xong 18/08/2026, xem §6.
- [ ] Cảnh báo token Facebook sắp hết hạn (`accounts.token_expires_at` có sẵn, chưa ai đọc) — ngoài phạm vi wave S9.

### 7.3 ⚠️ Cửa sổ "tile chết" — biết trước để không đi tìm bug

FE tự deploy lên Cloudflare Pages khi merge master (`DEPLOY_FE_ENABLED=true`), và `0544` đã cấp `view:social-post` cho `company-admin` **trên PROD**. Nghĩa là ô **"Đăng bài" hiện ra ngay**, trong khi API PROD vẫn chạy dist CŨ (chưa có `/integrations/social/sso-link`) và dịch vụ 3500 chưa tồn tại.

⇒ Từ lúc FE lên Pages đến khi xong §7.2, **company-admin bấm ô "Đăng bài" sẽ thấy thông báo lỗi** ("Không lấy được liên kết mở ứng dụng Đăng bài"). Không sập, không rò gì — chỉ là cửa chưa thông.

**CỐ Ý không thu hồi grant để bịt tạm.** Làm vậy tạo lệch giữa "migration đã áp" và "hiện trạng DB" — đúng bẫy `grant-in-old-migration-is-not-current-state`: người đọc `0544` sau này sẽ tin có grant mà thực tế không có. Thà một cửa sổ lỗi đọc được, còn hơn một cái bẫy im lặng.

---

## 8. Video nặng: đường nạp, các trần, và tài khoản chạy dịch vụ

_Thêm 18/08/2026 — S10-SOCIAL-OPS-1._

### 8.1 Kho dữ liệu nằm ở ổ D:

`SOCIAL_DATA_DIR = D:/MediaOS-Social/data`. Trước 18/08 biến này chưa từng được đặt ⇒ `paths.ts`
rơi về `process.cwd()/data`, mà `AppDirectory` của NSSM là `C:\dev 2\MediaOS\apps\fbpost` ⇒ toàn bộ
video nằm trên ổ **C:**, chung ổ với Postgres và API PROD. Đo 18/08: kho đã ăn **2.78 GB / 17 file**
(ổ C: còn 370 GB, giảm 40 GB trong 12 ngày; ổ D: còn 1.29 TB).

Dời bằng `scripts/windows/09-social-media-library.ps1`. Script **copy → đối chiếu số file + tổng
byte → mới đổi tên nguồn** thành `data.moved-<stamp>`; không dùng `robocopy /MOVE`, vì `/MOVE` xoá
nguồn ngay khi chép xong từng file — chép sai là không còn gì để lùi về, mà 2.8GB media này là bản
duy nhất.

**Nghiệm thu không đọc log.** Script khẳng định hai điều quan sát được:

| Bằng chứng | Ý nghĩa |
| --- | --- |
| `fbpost.db-shm` dưới kho MỚI có mtime **sau** mốc khởi động | tiến trình đang mở CSDL ở ổ D: |
| `apps\fbpost\data` **không mọc lại** sau khi khởi động | `getDb()` → `ensureDataDirs()` → `mkdirSync(UPLOADS_DIR)` đã chạy mà không tạo lại thư mục cũ ⇒ `SOCIAL_DATA_DIR` thật sự tới được tiến trình. `media-service.ts` dùng chung đúng hằng `UPLOADS_DIR` đó, nên đường ghi media cũng ở D:. |

Thiếu vế thứ hai là dấu hiệu env chưa vào — và kho cũ sẽ **âm thầm** mọc lại ở ổ C: chứ không báo lỗi.

### 8.2 Ba cái trần, chỉ một cái sửa được bằng code

| Trần | Ở đâu | Sửa được? |
| --- | --- | --- |
| 10 MB | mặc định `middlewareClientMaxBodySize` của Next 15.5; middleware app này gác **toàn bộ** đường dẫn kể cả `/api` | có — đã đặt `96mb` trong `apps/fbpost/next.config.ts` |
| **100 MB** | proxy **Cloudflare** trước `dangfb.funtimemediacorp.com` (gói Free/Pro) | **không** — chặn cứng, không nới được bằng code |
| — | — | `96mb` cố tình đặt **sát dưới** 100MB để lỗi hiện ra bằng thông báo tiếng Việt của app thay vì trang `413` trần trụi của Cloudflare |

⇒ **Video nặng KHÔNG đi đường HTTP.** Chúng đi qua kho video đọc từ thư mục
(`/api/library` + `/api/import/commit`, S10-SOCIAL-LIB-1/2) — đọc thẳng từ đĩa hoặc ổ chia sẻ LAN,
không qua proxy, không có trần nào. Người dùng chọn file trong `LibraryPicker` nhúng ngay trong ô
chọn media, không phải tải lên.

### 8.3 Vì sao dịch vụ VẪN chạy bằng `LocalSystem`

WO S10-SOCIAL-OPS-1 ban đầu yêu cầu đổi `MediaOS-Social` từ `LocalSystem` sang một tài khoản Windows,
vì `LocalSystem` không mang danh tính ra mạng nên không đọc nổi `\\MAY\share`. **Owner chốt 18/08:
KHÔNG đổi** — lý do gốc đã bị code thay thế trong lúc WO nằm chờ:

- `apps/fbpost/src/lib/library/net-connect.ts` (ship ở S10-SOCIAL-LIB-2) gọi thẳng
  `WNetAddConnection2` với tài khoản người dùng nhập ở giao diện ⇒ tiến trình **tự dựng một phiên
  SMB có danh tính**, độc lập với danh tính của tài khoản chạy dịch vụ.
- Đo trên CSDL PROD 18/08 (`settings.mediaLibraryRoots`): đang có **một** gốc kho LAN dùng thật —
  `\\MINGSEO3\...\output_short`, có `username`, mật khẩu đã seal bằng KEK.

Đổi `ObjectName` lúc này chỉ **thêm** rủi ro mà không giải quyết thêm vấn đề nào: mật khẩu nằm trong
registry NSSM · phải cấp "Log on as a service" · phải cấp lại ACL cho `data/` · `.secrets/` · `.next/`
(thiếu một cái thì dịch vụ vẫn chạy nhưng không ghi nổi CSDL, và lỗi hiện ra tận màn đăng bài dưới
dạng "không lưu được") · hỏng khi mật khẩu tài khoản đổi.

Nhánh `-ServiceAccount` của `09-*.ps1` giữ lại cho tương lai, nhưng **không còn là đường khuyến nghị**.

### 8.4 Bẫy đã đo được ở chính hai script này

`09-*.ps1` viết 06/08/2026 và **nằm im 12 ngày không ai bấm**. Khi chạy lần đầu 18/08 nó lộ ngay một
lỗi mà `Parser::ParseFile` không thấy được:

```powershell
} catch [System.Net.WebException] {                              # khớp đúng ở PS 5.1
} catch [Microsoft.PowerShell.Commands.HttpResponseException] {  # kiểu này chỉ có từ PS 7
```

Máy PROD chạy **Windows PowerShell 5.1**. Khi PS 5.1 khớp các mệnh đề `catch`, nó không phân giải nổi
kiểu thứ hai và ném `Unable to find type` — **làm nổ cả khối `try/catch`** dù mệnh đề đầu vốn khớp
đúng. Hậu quả: bước tự-kiểm của script **không thể chạy được** trên chính cái máy nó phải kiểm, mà
parse-check tĩnh vẫn báo xanh. Bản vá đọc thẳng mã trạng thái, không bắt theo kiểu ngoại lệ.

Bài học lặp lại: **một script chưa từng chạy thì chưa phải là một quy trình** — nó mới chỉ là ý định.
