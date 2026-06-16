# B1 — Own-payslip (nhân viên xem phiếu của mình) · Gate record

Lane `feat/b1-own-payslip` off master `0ecd684`. Commit impl `f1fd18c`.

## Nội dung
`view-payslip` chỉ admin/HR → nhân viên thật 403 → trang `/payroll/payslips` self-service degrade.
B1 thêm đường own-payslip cho nhân viên:
- `listOwn` LIST **money-FREE** — strip mọi cột tiền tại SQL projection (`PAYSLIP_SUMMARY_COLUMNS`), ownership ép ở repo (`WHERE company_id=$1 AND user_id=self`).
- `getOwn` full tiền **CHỈ sau re-auth** (`PayslipReauthGuard`/`PayslipReauthService`, key `reauth:payslip:{u}:{p}`), ownership re-check `row.userId===self` độc lập với cửa sổ re-auth.
- Seed permission `view-own-payslip` (is_sensitive=true → không kế thừa `*:*`) + grant role employee — migration `0180` band 0180s, idx 85, when 1717500210000, `ON CONFLICT DO NOTHING`, KHÔNG đụng `view-payslip` cũ, KHÔNG đụng audit CHECK (payslip đã có).
- GOTCHA G12-4 `objectGrantRequired:false` set tường minh ở `getOwn` (nếu không employee company-grant bị deny-object-required 403).

## Verify (DB cô lập `mediaos_b1`, chain 0000→0180 sạch)
- Full api: **1779 pass / 0 fail / 5 skip** (127 file).
- `own-payslip-permission.int-spec` 3/3 · `own-payslip-reauth.int-spec` 6/6 (own list money-free · getOne thiếu/hết-hạn re-auth→403 · payslip người khác kể cả có cửa sổ→403 · cross-tenant→403/0-row · HR company-grant regression vẫn xem được).
- typecheck/lint/prettier/build: sạch (11 lint error tồn dư `demo-seed-dashboard.mjs` pre-existing out-of-diff).

## Gate FULL (independent, opus) — TẤT CẢ OK / blocking=false
- **security-reviewer**: OK. Money-free tại SQL boundary không bypass; ownership/IDOR fail-closed; objectGrantRequired:false đúng, KHÔNG nới deny-path admin/HR; re-auth 403 không lộ số; seed sensitive không kế thừa wildcard. LOW: reauthOwn mint cửa sổ cho id bất kỳ = inert (getOwn re-check ownership).
- **database-reviewer**: OK. Migration idempotent additive monotonic; withTenant+RLS+company_id mọi query; append-only giữ. LOW: listOwn unbounded nhưng tập 1 nhân viên nhỏ; index `(company_id,user_id)` pre-existing.
- **silent-failure-hunter**: OK. Ownership/re-auth/permission.can đều fail-closed; money-strip ở repo không fallback; mapError re-throw HttpException; không catch rỗng nuốt quyền.

## Residual (non-blocking, người chốt)
- **FE wiring**: trang `/payroll/payslips` hiện vẫn gọi endpoint admin (`listSummary`/reauth-không-options) → employee vẫn 403 degrade ở UI. BE own-path đã đủ + gated; method FE own (`listOwn`/`reauthOwn`/`getOwn`) đã sẵn nhưng CHƯA nối page. Quyết: nối FE trong B1 (gỡ degrade end-to-end) hay tách lane FE riêng.

**Verdict: SAFE-TO-LAND (BE). DỪNG trước merge — chờ user chốt.**
