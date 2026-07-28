# S6-SEC-ROTATE-1 — Rotate mật khẩu Postgres PROD + gỡ literal khỏi repo PUBLIC (KI-043)

> Zone: **red / crown-jewel** · Gate: **FULL** · Mở 2026-07-28 từ FULL gate của `S6-SEC-DBFENCE-1`.
> **Chặn go-live** (`RELEASE-05` §5.3: không được có `S0` mở khi tạo RC).

## 1. Sự việc

| Đo (2026-07-28) | Giá trị |
| --- | --- |
| Repo `nguyencanhqk/mediaos` | **PUBLIC** (`gh repo view`) |
| Role đăng nhập được trong cụm PROD | 5 — `mediaos` (**SUPERUSER**) · `mediaos_owner` · `mediaos_app` · `mediaos_worker` · `pgbouncer_auth` |
| File tracked chứa literal mật khẩu `mediaos` | **17** |
| … `mediaos_app` / `mediaos_worker` | **7** / **6** |
| `mediaos.ps1:242-245` | **chủ động** `ALTER ROLE … WITH LOGIN PASSWORD '<literal>'` cho cả 3 role |
| `docker-compose.yml:29` | `"${POSTGRES_PORT:-5432}:5432"` ⇒ bind **0.0.0.0** |
| Chứng minh thực nghiệm (FULL gate) | nối **superuser** vào PROD `mediaos` bằng đúng literal trong repo → **THÀNH CÔNG** |
| ⟲ Trạng thái sau WO (2026-07-28) | **ĐÃ ĐÓNG** — xem §3b: rotate 5 role · cắt nguồn tái nhiễm · bind loopback · chốt hồi quy |

`.env` và `.env.prod` cùng dùng ba literal đó cho cả ba đường kết nối. Nghĩa là: **bất kỳ ai đọc repo
đều có mật khẩu superuser của cụm PROD**; phơi nhiễm thực tế chỉ còn phụ thuộc firewall/NAT của máy chủ
— tức là đang dựa vào một lớp phòng thủ *không được thiết kế để* làm lớp duy nhất.

> Đây cũng là **lý do bán kính KI-028 lớn đến vậy**: mọi giá trị mặc định trong repo đều là chìa khoá
> thật, nên rác test cũng mang theo quyền thật.

## 2. Phạm vi

1. **Rotate** 5 role trên cụm PROD sang mật khẩu sinh ngẫu nhiên.
2. **Gỡ literal khỏi mã nguồn**: `mediaos.ps1` (nguồn tái nhiễm — nó *set lại* mật khẩu dev mỗi lần
   chạy `Invoke-Roles`) + `.env*.example` + script seed.
3. **Thu hẹp bề mặt**: bind `127.0.0.1:5432` (và `6432`/`6379`/`9000` nếu không cần từ ngoài).
4. **Chốt chống tái diễn**: `.env` không được commit (đã gitignore — verify lại); thêm chốt CI/`check.sh`
   bắt literal `changeme_*` trong file tracked ⇒ ĐỎ.
5. `apps/api/demo-seed-{base,full,dashboard}.mjs` + `seed-operator.mjs` mặc định trỏ `mediaos` (PROD) —
   nằm **ngoài** hàng rào vitest của KI-028 ⇒ bắt phải khai DB đích tường minh, fail-closed.

**Ngoài phạm vi:** history-rewrite để xoá literal khỏi commit cũ. Literal đã public từ lâu ⇒ giá trị
phòng thủ của việc viết lại lịch sử ≈ 0 sau khi đã rotate; chi phí (mọi clone/PR gãy) thì thật. Ghi rõ
quyết định này thay vì im lặng bỏ qua.

## 3. Runbook (có downtime ngắn — cần cửa sổ)

Thứ tự bắt buộc: **sinh secret → cập nhật file env → đổi trong DB → restart → verify**. Đổi trong DB
trước khi cập nhật env sẽ làm PROD API 500 ngay lập tức.

```bash
# 0) BACKUP
docker exec mediaos-postgres pg_dump -U mediaos -Fc mediaos > /c/tmp/mediaos-pre-rotate.dump

# 1) Sinh mật khẩu (KHÔNG commit, KHÔNG log)
node -e "for(const r of ['SUPER','OWNER','APP','WORKER','PGB'])console.log(r+'='+require('crypto').randomBytes(24).toString('base64url'))"

# 2) Cập nhật .env, .env.prod, .env.dev, .env.dev-online (KHÔNG tracked) + PgBouncer userlist
#    pnpm db:setup-roles sinh lại .secrets/pgbouncer/userlist.txt từ PGBOUNCER_AUTH_PASSWORD

# 3) Đổi trong DB (superuser)
docker exec -i mediaos-postgres psql -U mediaos -d postgres -v ON_ERROR_STOP=1 \
  -c "ALTER ROLE mediaos        WITH LOGIN PASSWORD '<SUPER>'"  \
  -c "ALTER ROLE mediaos_owner  WITH LOGIN PASSWORD '<OWNER>'"  \
  -c "ALTER ROLE mediaos_app    WITH LOGIN PASSWORD '<APP>'"    \
  -c "ALTER ROLE mediaos_worker WITH LOGIN PASSWORD '<WORKER>'" \
  -c "ALTER ROLE pgbouncer_auth WITH LOGIN PASSWORD '<PGB>'"

# 4) Restart theo thứ tự: pgbouncer → API PROD (NSSM :3100) → dev-online (:3200) → worker
# 5) VERIFY — literal CŨ phải THẤT BẠI (đọc literal từ git history, KHÔNG viết lại vào file tracked):
OLD_PW="$(git show <commit-truoc-rotate>:.env.example | sed -n 's/^POSTGRES_PASSWORD=//p')"
docker exec -e PGPASSWORD="$OLD_PW" mediaos-postgres psql -h 127.0.0.1 -U mediaos -d mediaos -c "select 1"  # PHẢI đỏ
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3100/api/v1/health/db                             # PHẢI 200
node scripts/check-prod-test-tenants.mjs                                                                     # PHẢI exit 0
node scripts/check-no-secret-literals.mjs                                                                    # PHẢI exit 0
```

⚠️ **Cạm bẫy đã biết:** `mediaos.ps1 roles` (`Invoke-Roles`) sẽ **ĐẶT LẠI mật khẩu về literal dev** —
phải sửa hàm đó **trước** khi rotate, nếu không lần chạy tiếp theo âm thầm khôi phục lỗ hổng. Đây đúng
là kiểu "gốc rễ tái diễn" của KI-036.

## 3b. ĐÃ THỰC HIỆN — 2026-07-28 (kết quả thật, kèm 4 cái bẫy runbook §3 không lường)

Thứ tự chạy thật: sửa `mediaos.ps1` + gỡ literal → `pg_dump` → sinh secret + ghi env → `ALTER ROLE` →
`docker compose up -d` → restart API → verify.

### Bẫy 1 — công cụ đổi mật khẩu lại CẦN chính mật khẩu nó sắp đổi

Runbook §3 giả định `pnpm db:setup-roles` chạy được ở bước 2. Không: `setup-db-roles.mjs` nối **qua TCP**
bằng `DATABASE_DIRECT_URL`, mà `.env` lúc đó đã mang mật khẩu MỚI còn role vẫn mật khẩu CŨ ⇒

```text
[setup-db-roles] thất bại: password authentication failed for user "mediaos"
```

Gỡ bằng `scripts/rotate-db-roles.mjs` (MỚI): bootstrap qua **local socket trong container** (không cần
mật khẩu) trong MỘT transaction cho cả 5 role, rồi mới gọi `setup-db-roles.mjs` để sinh lại
`userlist.txt`. Lần rotate sau chỉ còn 1 lệnh.

### Bẫy 2 — cách verify hiển nhiên nhất lại CHỨNG MINH SAI

Kiểm chứng "mật khẩu cũ đã chết" bằng `docker exec … psql -h 127.0.0.1` cho kết quả **ĐĂNG NHẬP ĐƯỢC**
với đúng literal cũ — làm tưởng rotate thất bại. Nguyên nhân: `pg_hba.conf` của image có

```text
host  all  all  127.0.0.1  trust      ← từ TRONG container, MỌI mật khẩu đều qua
host  all  all  all        scram-sha-256
```

⇒ mọi phép thử chạy **bên trong** container đều vô nghĩa với câu hỏi xác thực. Đường tấn công thật là
từ **host** qua cổng publish, và đường đó dùng `scram-sha-256`. Phải verify từ host (client `pg` của
Node), kèm một ca **mật khẩu bậy** để chứng minh đang thật sự xác thực chứ không phải `trust`.

Log PgBouncer xác nhận đúng cơ chế đó — kết nối **từ host** vào container mang địa chỉ gateway Docker,
KHÔNG phải `127.0.0.1`, nên rơi vào dòng `scram-sha-256`:

```text
C-0x…: mediaos/mediaos_app@172.18.0.1:54504 login attempt   ← từ HOST (gateway 172.18.0.1)
C-0x…: mediaos/mediaos@127.0.0.1:35796      login attempt   ← healthcheck TRONG container (trust)
```

### Bẫy 3 — chính bản vá suýt tái sinh vector V2 của KI-028 (hàng rào bắt được)

`scripts/lib/db-secrets.sh` (helper MỚI, thay cho các fallback literal) ban đầu nạp **cả**
`DATABASE_DIRECT_URL` từ `.env` để suy ra mật khẩu superuser. Hệ quả không lường: mọi script `source`
nó — gồm `harness/check.sh` — nhận một **URL tường minh trỏ PROD**, mà URL tường minh **THẮNG**
`LANE_DB`. Toàn bộ suite lẽ ra chạy trên lane DB đã chĩa sang `mediaos`.

Suite ĐỎ ngay ở bước `vitest list`:

```text
DỪNG: test đang trỏ vào DATABASE ĐƯỢC BẢO VỆ (PROD / dev-online).
  DATABASE_DIRECT_URL → mediaos
```

Đây là hàng rào của `S6-SEC-DBFENCE-1` làm đúng việc của nó — bắt một vector V2 **mới sinh ra từ chính
bản vá bảo mật**. Hai điều rút ra:

1. Helper chỉ được cấp **MẬT KHẨU**; **ĐÍCH** (database nào) phải do người gọi quyết định. Một tiện ích
   "nạp hộ cho đủ biến" là đường ngắn nhất để `.env` PROD lén quyết định hộ.
2. Sửa: đọc `DATABASE_DIRECT_URL` vào biến **cục bộ** để lấy mật khẩu rồi bỏ, không export; và
   `check.sh` `unset` cả 3 `DATABASE_*_URL` trước khi chạy test (đúng điều thông báo lỗi của hàng rào
   vẫn dặn — nay làm tự động thay vì trông chờ người dùng nhớ).

### Bẫy 4 — chính CHỐT HỒI QUY có lỗ, chỉ lộ ra khi RED-proof

Luật `compose-port-wide-bind` phát hiện bind rộng bằng cách đếm dấu hai chấm (`"host:container"` = 2
phần ⇒ thiếu địa chỉ bind). RED-proof bằng cách cố tình gỡ bind của Valkey cho ra **PASS oan**:

```text
"${VALKEY_PORT:-6379}:6379"   → split(":") = ["${VALKEY_PORT", "-6379}", "6379"] = 3 phần ⇒ LỌT
```

Cú pháp `${VAR:-default}` **tự nó chứa một dấu hai chấm**. Sửa: khử `${…}` về một ký tự rồi mới đếm.
Sau khi sửa, cả 3 dạng đều bị bắt: `"${PORT}:5432"` · `"${VALKEY_PORT:-6379}:6379"` · `"9000:9000"`.

> Bài học lặp lại của WO này: **một cái chốt chưa từng ĐỎ thì chưa phải là chốt.** Nếu chỉ chạy chốt
> trên cây sạch và thấy xanh, cả ba luật đều "hoạt động" — mà một trong ba mù hoàn toàn.

### Bằng chứng hai chiều (từ HOST, `localhost:5432`)

| Ca | Kết quả |
| --- | --- |
| `mediaos` + literal cũ (superuser) | ✅ TỪ CHỐI — `password authentication failed` |
| `mediaos_app` + literal cũ | ✅ TỪ CHỐI |
| `mediaos_worker` + literal cũ | ✅ TỪ CHỐI |
| `mediaos` + mật khẩu bậy (ca đối chứng) | ✅ TỪ CHỐI — chứng minh KHÔNG phải `trust` |
| 5 role + mật khẩu MỚI | ✅ nối được cả 5 (`mediaos` · `mediaos_owner` · `mediaos_app` · `mediaos_worker` · `pgbouncer_auth`) |

### Bind cổng — trước / sau

`0.0.0.0:{5432,6432,6379,9000,9001}` + `[::]:…` ⇒ **`127.0.0.1:…` cho cả 5 cổng** (`netstat` xác nhận,
không còn dòng `0.0.0.0`/`[::]`). Firewall KHÔNG được dùng làm bằng chứng: máy có 204 rule inbound
"allow any port" — tức đang không có lớp chặn nào đáng tin ở đó.

### Ngoài dự kiến — PROD tự restart

`docker compose up -d` recreate container Postgres ⇒ API mất kết nối và **NSSM tự khởi động lại** tiến
trình node (PID mới, 15:18:29). Nó đọc `.env` mới nên `/health/db` xanh trở lại mà không cần ai can
thiệp — nhưng boot đó **đua với Postgres chưa sẵn sàng**: `ensure_default_company` và
`MasterDataSeedRunner` cùng `ECONNREFUSED` rồi bị bỏ qua (đúng thiết kế "không sập boot"). Vì vậy vẫn
phải `Restart-Service MediaOS-API` một lần SẠCH sau khi cụm khoẻ. Ghi lại vì đây là hành vi sẽ lặp ở
mọi lần recreate container.

### Dữ liệu sau rotate

`funtime` = **46 user** (khớp trước rotate) · `check-prod-test-tenants.mjs` → `0 tenant test / 1 company`,
exit 0 · `/health/db` 200. Backup trước rotate: `c:/tmp/mediaos-pre-rotate-20260728.dump` (3.8 MB).

### Không history-rewrite — giữ nguyên quyết định

Literal đã public từ lâu; sau rotate giá trị phòng thủ của việc viết lại lịch sử ≈ 0, còn chi phí (mọi
clone/PR gãy) là thật. Bù lại bằng chốt hồi quy để literal không quay lại **tương lai**.

## 4. Done when

- [x] 5 role dùng mật khẩu sinh ngẫu nhiên (32 ký tự base64url); literal cũ **nối THẤT BẠI** — đo TỪ
      HOST, kèm ca đối chứng mật khẩu-bậy (bảng §3b).
- [x] `git grep changeme_<chữ>` trên file tracked = **0**, KHÔNG danh sách miễn trừ (gồm cả docs lịch sử;
      fixture S3 chuyển sang hằng số có tên `FALLBACK_S3_SECRET` ghép chuỗi — CLAUDE.md §5).
- [x] `mediaos.ps1` không còn đặt mật khẩu literal; `Invoke-Roles` uỷ quyền `scripts/setup-db-roles.mjs`
      (chỉ đọc env). **Đã dogfood**: chạy `m roles` SAU rotate rồi thử lại literal cũ ⇒ vẫn bị từ chối.
- [x] 5 cổng hạ tầng bind `127.0.0.1` (`netstat` xác nhận). Firewall KHÔNG dùng làm bằng chứng — máy có
      204 rule inbound allow-any-port.
- [x] Chốt hồi quy `scripts/check-no-secret-literals.mjs`: chạy theo lệnh · step `secret-literals` trong
      `harness/check.sh` · step trong job `secret-scan` của `.github/workflows/security.yml`.
      **RED-proof cả 3 luật** — và chính lần RED-proof đó phát hiện luật bind-cổng bị mù (Bẫy 4).
- [x] Script seed fail-closed: không khai đích ⇒ exit 1 · đích `mediaos`/`mediaos_dev` ⇒ exit 1 trừ khi
      khai đúng tên qua `SEED_ALLOW_PROTECTED_DB` · URL thiếu tên DB ⇒ exit 1 (bẫy libpq).
- [x] PROD `/health/db` 200 · `funtime` 46 user · `check-prod-test-tenants.mjs` exit 0 sau rotate.
      PgBouncer :6432 nối được bằng mật khẩu mới, `current_user=mediaos_app` (pass-through ⇒ RLS còn ép).
- [x] `bash harness/check.sh --all --lane-db` **XANH** (secret-literals · lint · typecheck · test trên
      lane DB cô lập · build · prod-tenant-check). 12/12 chunk xanh; 4 chunk phải chạy lại do crash hạ
      tầng tinypool (KI-014 — runner tự retry).
- [x] KI-043 đóng kèm số đo (`RELEASE-02`); `RELEASE-01` §5 chấm lại `CRITICAL/HIGH` = **0 / 3**,
      `S0` về **0 mở**.
- [ ] `Restart-Service MediaOS-API` một lần SẠCH (cần quyền admin) — xem "Ngoài dự kiến" ở §3b.
- [ ] FULL gate `security-reviewer` PASS.

## 4b. FULL gate — vòng 1 BLOCK, đã sửa hết (2026-07-28)

`security-reviewer` trả **BLOCK: 0 CRITICAL · 3 HIGH**. Đáng chú ý: **cả ba đều nằm trong chính bộ an
toàn mà WO này dựng ra**, không phải ở phần rotate. Lõi rotate được gate xác nhận độc lập (0 literal
tracked; 5 mật khẩu mới không xuất hiện ở bất kỳ file tracked nào — đo bằng `git grep -F` từng giá trị).

| # | Phát hiện | Sửa |
| --- | --- | --- |
| HIGH-1 | `turbo.json` thiếu `SUPERUSER_DB_PASSWORD` trong `globalPassThroughEnv` ⇒ turbo strict **nuốt** biến ⇒ `pnpm test` chết ở bước load config, **0 test chạy**. Máy này che mất vì chunk-runner (KI-014) gọi vitest thẳng, bỏ qua turbo; Linux/CI thì đỏ 100% | Thêm `SUPERUSER_DB_PASSWORD` + `OWNER_DB_PASSWORD`; verify bằng `turbo run test --dry=json` |
| HIGH-2 | Chốt hồi quy **mù với đúng hình dạng đã rò**: mật khẩu nằm trong userinfo của connection string ở `.env*.example`. gitleaks cũng bỏ qua dạng này (chỉ bắt `KEY=value`) ⇒ đặt lại mật khẩu vào đúng chỗ đã gây KI-043 thì **không cổng nào đỏ** | Thêm luật `env-example-secret-in-url` |
| HIGH-3 | Luật bind-cổng lách được bằng YAML bình thường: không nháy · nháy đơn · long-syntax `published:` · file trong thư mục con · và cả `"0.0.0.0:5433:5432"` (đủ 3 phần nên "hợp lệ") | Đảo từ **danh sách đen** sang **danh sách trắng** + scanner hiểu long-syntax. 6/6 ca lách nay ĐỎ, 3 dạng hợp lệ vẫn xanh |

**MEDIUM đã sửa** (đều là thứ WO này tự làm hỏng):

- `m roles` **mất khả năng tự chữa** — nó uỷ quyền `setup-db-roles.mjs`, mà script đó nối TCP bằng chính
  `DATABASE_DIRECT_URL`. Đúng tình huống lệnh sinh ra để chữa ("login báo sai mật khẩu" = đang lệch) thì
  nó chết vì `password authentication failed`. → trỏ sang `rotate-db-roles.mjs` (bootstrap local socket).
- `m seed` · `m reset` · `dev.sh seed|reset` **gãy im lặng** sau khi seed script thành fail-closed
  (`m reset` xoá volume RỒI MỚI chết ở bước seed). → caller khai đích tường minh; `-AllowProtected` chỉ
  dành cho `reset` (đã xoá volume + người dùng đã gõ "RESET").
- `check.sh --lane-db` **hard-fail** khi thiếu `.env`, phá đúng hợp đồng ghi ở header file. → cảnh báo và
  chạy tiếp; `lane-db-guard` vẫn escalate ĐỎ ở tier `--all` nên không thể merge với deny-path rỗng.
- **Hai parser `.env` ngược nhau về khoá TRÙNG** (`load-env.ts`/`db-secrets.sh` = first-wins ·
  `Import-DotEnv` = last-wins). Rotate bằng cách *append* dòng mới ⇒ cụm nhận giá trị MỚI còn API đọc giá
  trị CŨ ⇒ PROD 500. → `rotate-db-roles.mjs` first-wins + **từ chối chạy** khi thấy khoá trùng.
- `_db_secrets_pw_from_url` không percent-decode (`p%40ss` ≠ `p@ss` mà client `pg` gửi) → đã decode + bóc nháy.

**LOW đã sửa:** luật literal nay case-insensitive (biến thể VIẾT HOA của họ literal cũ từng lọt) · `seed-admin.mjs` ghi rõ
**vì sao CỐ Ý** không fail-closed như nhóm demo (nó là bootstrap PROD chính thức) · `demo-seed-dashboard`
cho phép đổi `SEED_API_BASE` (trước đây seed sang lane nhưng vẫn đăng nhập vào API PROD) · gỡ doc drift ở
`dev/README.md` + comment `turbo.json`.

> Điều đáng giữ lại từ vòng gate này: phần **rotate** thì đúng ngay từ đầu, còn phần **hàng rào** thì
> không — và hàng rào mới là thứ quyết định lỗ hổng có quay lại hay không. Một cổng chưa từng bị tấn công
> thử thì chưa biết nó chặn được gì.

## 5. Việc còn lại / nợ ghi nhận

| Việc | Vì sao chưa làm |
| --- | --- |
| Restart sạch API PROD | Cần quyền admin trên máy; tiến trình hiện tại là bản NSSM tự khởi động lại nên đã chạy mật khẩu mới, chỉ thiếu vòng bootstrap đầy đủ |
| Literal cũ còn trong git history | Quyết định CÓ CHỦ ĐÍCH (§2) — sau rotate chúng vô hiệu |
| `pg_hba` còn `host all all 127.0.0.1 trust` | Mặc định của image; chỉ áp cho kết nối TỪ TRONG container. Không mở thêm bề mặt sau khi đã bind loopback, nhưng là thứ cần nhớ mỗi lần verify xác thực (Bẫy 2) |
| `.env.dev-online` / dev-online stack | Đã cập nhật mật khẩu nhưng stack KHÔNG chạy lúc rotate — lần bật tiếp theo cần verify lại |
