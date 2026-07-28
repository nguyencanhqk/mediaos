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
# 5) VERIFY — literal CŨ phải THẤT BẠI:
docker exec mediaos-postgres psql "postgres://mediaos:changeme_dev_only@localhost:5432/mediaos" -c "select 1"   # PHẢI đỏ
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3100/api/v1/health/db                                  # PHẢI 200
node scripts/check-prod-test-tenants.mjs                                                                          # PHẢI exit 0
```

⚠️ **Cạm bẫy đã biết:** `mediaos.ps1 roles` (`Invoke-Roles`) sẽ **ĐẶT LẠI mật khẩu về literal dev** —
phải sửa hàm đó **trước** khi rotate, nếu không lần chạy tiếp theo âm thầm khôi phục lỗ hổng. Đây đúng
là kiểu "gốc rễ tái diễn" của KI-036.

## 4. Done when

- [ ] 5 role dùng mật khẩu sinh ngẫu nhiên; literal cũ **nối THẤT BẠI** (có log chứng minh).
- [ ] `git grep changeme_` trên file tracked = **0** ở đường chạy thật (test fixture nếu giữ thì phải
      lấy từ env, theo luật fixture-giống-secret của CLAUDE.md §5).
- [ ] `mediaos.ps1` không còn đặt mật khẩu literal; đọc từ env/secret store.
- [ ] Postgres bind `127.0.0.1` (hoặc có bằng chứng firewall chặn 5432 từ ngoài).
- [ ] Chốt hồi quy: CI ĐỎ nếu literal `changeme_*` quay lại file tracked.
- [ ] Script seed (`demo-seed-*`, `seed-operator`) fail-closed khi không khai DB đích.
- [ ] PROD `/health/db` 200 · funtime 46 user · `check-prod-test-tenants.mjs` exit 0 sau rotate.
- [ ] KI-043 đóng kèm số đo; `RELEASE-01` chấm lại `CRITICAL/HIGH`.
