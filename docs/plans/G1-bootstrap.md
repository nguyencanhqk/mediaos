# PLAN — G1 Bootstrap repo & hạ tầng

> Tạo theo AUTOMATION-PLAYBOOK §11 (PLAN-FIRST). Phase setup, vùng chủ đạo 🟢 — rủi ro thấp,
> nhưng đặt nền cho mọi phase sau nên phải đúng tech-stack đã chốt (CLAUDE.md §4).

## Meta

- **Mã:** G1 · **Phase:** G1 · **Mốc:** M1 (Lõi sống)
- **Vùng rủi ro chủ đạo:** 🟢 xanh (G1-3 chạm DB-connection → 🟡 nhẹ; chưa chạm permission/secret/payroll)
- **Model chính:** Sonnet (scaffold), Haiku cho boilerplate
- **Ước lượng:** L

## 1. Mục tiêu

Sau G1: `pnpm dev` chạy được api + web; API có `/health` + `/health/db`; web mở màn **login mock**;
có hạ tầng Docker (Postgres+Valkey+MinIO+PgBouncer), Drizzle migration chạy được, CI xanh,
guardrail hooks đầy đủ, có script backup. Nền để G2 (RLS/tenant) cắm vào.

## 2. Scope

**Trong:** G1-2 docker-compose · G1-3 Drizzle config + db client (PgBouncer tx-mode) + migration baseline (extensions)
· G1-4 NestJS skeleton (config zod-env, health, response-envelope interceptor, exception filter, ZodValidationPipe)
· G1-5 Vite+React19 skeleton (TanStack Router/Query, Zustand, shadcn/Tailwind v4, login mock, api client)
· G1-6 CI (lint+typecheck+test trên Postgres ephemeral) · G1-7 hooks bổ sung (anti-bandaid, format-on-write, typecheck-changed)
· G1-8 backup script `pg_dump`→offsite.

**Ngoài (không làm lần này):** business tables (companies/users → G2-3), `withTenant` thật (G2-2), RLS policy (G2),
PermissionService (G3), auth thật (G2-6), KMS provisioning (G6-2), Caddy/deploy thật (G4-8).

**Acceptance (TASKS.md G1 "Done khi"):** `pnpm dev` chạy; API health-check OK; web mở màn login mock; CI xanh.
→ cập nhật CLAUDE.md §7 lệnh dự án.

## 3. Phụ thuộc

- Cần TRƯỚC: chỉ G1-1 (monorepo) — đã xong.
- Đụng lõi chung nào? `packages/contracts` (mở rộng schema env/health). db client là **tiền đề** của `withTenant` G2-2
  → thiết kế client để G2 chỉ thêm `set_config('app.current_company_id',...)`, không phải viết lại.
- Thứ tự nội bộ: G1-2 (compose) → G1-3 (drizzle, cần Postgres) → G1-4 (api dùng db) ‖ G1-5 (web độc lập) → G1-6 (CI) → G1-7/8.

## 4. Phân rã micro-step

| # | Bước nhỏ | Vùng | Model | Gate | Test | DoD bước |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `.gitattributes` + plan này | 🟢 | — | — | — | EOL chuẩn, plan PASS |
| 2 | G1-2 docker-compose + `.env.example` | 🟢 | Sonnet | LIGHT | `docker compose config` valid (khi có docker) | 4 service khai báo đúng port/healthcheck |
| 3 | G1-3 Drizzle config + `db` client + migration baseline (extensions pgcrypto/citext) | 🟡 | Sonnet | LIGHT+ | typecheck; client cô lập tx | `drizzle.config.ts` + `db/index.ts` typecheck sạch |
| 4 | G1-4 NestJS skeleton | 🟢 | Sonnet | LIGHT | health trả envelope; `pnpm --filter api typecheck` | `GET /health` 200 envelope; build sạch |
| 5 | G1-5 Vite+React skeleton + login mock | 🟢 | Sonnet | LIGHT | `pnpm --filter web build`; typecheck | web build; login mock render; gọi `/health` |
| 6 | G1-6 CI workflow | 🟢 | Haiku | LIGHT | workflow lint (act/yaml) | `.github/workflows/ci.yml` lint+type+test+pg service |
| 7 | G1-7 hooks bổ sung + wire settings | 🟢 | Sonnet | LIGHT | hook unit-smoke (echo JSON vào) | anti-bandaid block, format/typecheck PostToolUse |
| 8 | G1-8 backup script | 🟢 | Haiku | LIGHT | shellcheck/dry-run | `scripts/backup-db.sh` dump+gpg+rclone (idempotent) |
| 9 | Cập nhật CLAUDE.md §7 + TASKS.md G1 + completion-eval | 🟢 | — | — | — | docs khớp lệnh thật |

## 5. Rủi ro & giảm thiểu

| Rủi ro | Khả năng | Tác động | Giảm thiểu |
| --- | --- | --- | --- |
| db client thiết kế sai → G2 phải viết lại `withTenant` | TB | 🟡 | client expose `transaction(fn)` + chỗ cắm `set_config` sẵn; comment chỉ rõ G2-2 |
| PgBouncer × RLS sai (set_config không sống trong tx) | Thấp (chưa bật RLS) | 🟡 | dùng `pg` Pool transaction-scoped (`SET LOCAL`/`set_config(...,true)`); để lại test-hook cho GX-4 |
| Hard-code secret trong compose/.env | TB | 🔴 | chỉ `.env.example` với placeholder; `.env` đã gitignore; guard-secrets canh |
| Skeleton kéo dep nặng/license bẫy (MUI X, AG Grid) | Thấp | 🟡 | bám CLAUDE.md §4: shadcn + TanStack Table headless |
| Không có Docker trong môi trường tạo file → không verify runtime DB | Cao | 🟢 | verify tĩnh (typecheck/build); đánh dấu "cần chạy docker để verify" trong TASKS |

## 6. Test plan

- G1 chủ yếu 🟢 → không bắt buộc deny-path RED. Test mức smoke: api health e2e (supertest), contracts unit (zod parse), web build.
- Coverage: chưa ép 80% ở skeleton; bật ngưỡng từ G2 (vùng đỏ).
- Regression: chưa có suite tenant (G2-5). Sau G1 mọi `pnpm test` phải xanh.

## 7. Commit & merge

- Nhánh: `feat/g1-bootstrap`. Micro-commit mỗi bước §4. Conventional `feat(G1-x): …` / `chore(G1-x): …`.
- Merge: cụm xanh + LIGHT gate đạt + completion-evaluator PASS → người (bạn) bấm merge vào master.

## 8. Rollback

- Mọi bước là file mới/độc lập → `git revert <commit>` từng bước.
- Migration baseline chỉ tạo extensions (reversible: `DROP EXTENSION`). Chưa có dữ liệu nghiệp vụ.
- Hooks: revert settings.json về 3 guard cũ.

---

## ✅ Kết quả rà soát plan (`plan-reviewer`)

Self-review (vùng 🟢, low-risk, không chạm 3 bất biến trực tiếp ngoài secret-in-config đã chặn bằng `.env.example`):
**PASS** với điều kiện bắt buộc:
1. db client (G1-3) PHẢI để sẵn chỗ cắm `set_config('app.current_company_id',$1,true)` trong transaction-scope — không thiết kế kiểu pool-global khiến G2 phải viết lại.
2. Tuyệt đối không secret literal trong compose/.env (chỉ `.env.example`).
3. Health-check DB phải fail-soft (api vẫn start khi DB chưa lên) để `pnpm dev` chạy không cần docker.

## 🏁 Kết quả đánh giá hoàn thành (`completion-evaluator`)

**Self-eval 2026-06-05 (nhánh `feat/g1-bootstrap`) — PASS-with-follow-up.**

| Chiều | Điểm | Ghi chú |
| --- | --- | --- |
| Correctness (25%) | 24/25 | typecheck/build/test/lint xanh 4/4 (16 test); API runtime smoke OK (envelope, fail-soft DB, 404 filter). Web build 1741 modules OK. |
| Bất biến & bảo mật (30%) | 28/30 | secret chỉ ở `.env.example` (placeholder); exception filter không lộ 5xx; db client để seam `withTenant` cho G2. RLS/tenant chưa bật (đúng phạm vi — G2). |
| Test (25%) | 22/25 | smoke/unit/e2e xanh; chưa ép coverage 80% (skeleton — bật từ G2 vùng đỏ). Migration verify qua CI, chưa chạy local (thiếu Docker). |
| Sạch sẽ (10%) | 10/10 | không dead-code mới; không vá triệu chứng; file < 800 dòng; bỏ `eslint-disable` thừa ở migrate.ts. |
| Docs/Audit (10%) | 9/10 | CLAUDE.md §7 + TASKS.md cập nhật; chưa có audit (đúng — audit là G2-4). |

**Tổng ~93/100 → PASS.** Điều kiện đóng G1 hoàn toàn:
1. **G1-7**: wire `anti-bandaid-guard` + `format-on-write` (+ tuỳ chọn `typecheck-changed`) vào `.claude/settings.json` — cần xác nhận người (self-modification).
2. **CI lần đầu xanh** trên GitHub (xác nhận compose/migration end-to-end với Postgres ephemeral).
3. (Khi có Docker) chạy `pnpm db:up && pnpm db:migrate` xác nhận extensions áp đúng.
