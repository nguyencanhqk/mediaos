```yaml
wo: S2-FND-SYSSET-1
zone: red
generated_by: auto-loop
reconciled_at: "96c81a1"
lanes: []
acceptanceChecks: ["Đội 3 grep xác nhận 0 tham chiếu cặp view:system-settings / manage:system-settings trong apps/ + packages/ + migrations/ (không dựng pair-drift); cặp canonical = system-manage:foundation-setting (seed 0435:343, is_sensitive=TRUE).","GET /foundation/system-settings + GET /:key trả 200, sensitive/encrypted/SecretRef → value='***' masked=true, secret_ref TUYỆT ĐỐI không xuất hiện trong JSON response (assert not.toMatch /secret_ref/i) — đã phủ bởi system-settings.int-spec P1/P2b.","PATCH /foundation/system-settings/:key: sai value_type → 400 · vi phạm validation_schema → 422 · hợp lệ → 200 ghi system_settings (KHÔNG chạm company_settings) + đúng 1 audit row action='SYSTEM_SETTING_UPDATED' object_type='system_setting' data_scope='System' company_id=actor.companyId (ghi CÙNG withTenant tx) — system-settings.int-spec P4-P7.","Deny CHẶT: employee (không grant) → 403 GET/PATCH + 0 audit mới; wildcard '*:*'/super-admin KHÔNG kế thừa cặp sensitive → 403; update:foundation-setting KHÔNG mở cổng system-manage → 403 — system-settings-permission-deny.int-spec D1-D6; mọi deny append-only (count audit_logs không đổi).","SettingsModule wired vào FoundationModule (imports+exports SettingService) ⇒ 3 route system-settings live sau global prefix api/v1; contracts patchSystemSettingSchema + systemSettingsQuerySchema build dual ESM/CJS xanh.","docs/plans/S2-FND-SYSSET-1.md ghi rõ: WO superseded bởi S2-FND-BE-8, giữ pair canonical, defer read-first cho FE13-OQ-003 (owner Product/BE).","FULL gate (security-reviewer + database-reviewer) trên diff BE-8 đã PASS (crown: permission sensitive + audit append-only); WO này KHÔNG thêm diff mới ⇒ không phát sinh gate mới."]
testTasks: ["KHÔNG viết test mới — tái dùng 2 int-spec đã có của BE-8: apps/api/test/foundation/system-settings.int-spec.ts (happy P1-P7: mask, PATCH validate 400/422, audit-in-tx company_id, insert-path) + apps/api/test/foundation/system-settings-permission-deny.int-spec.ts (deny-path RED D1-D6: employee 403+0audit, wildcard/super-admin sensitive-gate 403, update-only không mở system-manage).","Chạy verification trên DB cô lập: bash scripts/lane-db-setup.sh sysset → export LANE_DB=mediaos_sysset → pnpm --filter @mediaos/api test (gate hasDb && LANE_DB — chống xanh-giả trên DB dev chung; xác nhận 2 spec thực sự xuất hiện trong run summary, không skip).","NẾU (và chỉ nếu) owner chốt read-first FE13-OQ-003 ở WO tương lai: khi đó mới viết RED deny-path cho cặp mới (view read vs manage write) + int-spec company-admin READ-được nhưng UPDATE 403 — KHÔNG thuộc phạm vi WO này."]
steps: ["1) VERIFY-CLOSE (KHÔNG build): xác nhận endpoints live — GET /foundation/system-settings, GET /:key, PATCH /:key trong settings.controller.ts gate system-manage:foundation-setting (is_sensitive:true); SettingsModule đã trong FoundationModule imports/exports.","2) Chạy lại 2 int-spec BE-8 trên LANE_DB cô lập để chứng minh còn xanh: system-settings.int-spec.ts (P1-P7) + system-settings-permission-deny.int-spec.ts (D1-D6). bash scripts/lane-db-setup.sh sysset → export LANE_DB=mediaos_sysset → pnpm --filter @mediaos/api test (gate hasDb && LANE_DB).","3) PIN quyết định reconcile vào docs/plans/S2-FND-SYSSET-1.md (persist reconcileNotes): giữ cặp canonical system-manage:foundation-setting (= FOUNDATION.SETTING.SYSTEM_MANAGE); KHÔNG tạo cặp view/manage:system-settings; đóng WO là superseded S2-FND-BE-8.","4) ROUTE câu hỏi mở FE13-OQ-003 (read-first vs read-only, có tách view/manage không) cho owner Product/BE chốt. NẾU owner chốt read-first ⇒ mở WO MỚI tường minh (migration seed cặp mới + đổi gate GET sang view + cập nhật API-09/FRONTEND-13 + web-core PERMISSION_CODE_TO_PAIR) — KHÔNG làm ngầm ở WO này.","5) Xác nhận S2-FE-FND-8 (FE screen, depends_on WO này) có đủ enabler BE: GET/PATCH + FOUNDATION.SETTING.SYSTEM_MANAGE đã seed ⇒ unblock FE; web-core client getSystemSettings/updateSystemSetting thuộc paths của S2-FE-FND-8, KHÔNG thuộc WO này."]
```

SUPERSEDED — S2-FND-SYSSET-1 bị S2-FND-BE-8 (ship 2026-07-04, PR đã merge) phủ trọn vẹn; không còn build lane hợp-spec.

GAP-ANALYSIS (đối chiếu code 2026-07-08, head mig 0474):
- ENDPOINTS: settings.controller.ts đã có @Get('system-settings'), @Get('system-settings/:key'), @Patch('system-settings/:key') — cả 3 gate @RequirePermission('system-manage','foundation-setting',{isSensitive:true}). ĐÚNG canonical spec.
- SERVICE: setting.service.ts getSystemSettings/getSystemSetting (mask qua setting-mask.toSafeView → sensitive/encrypted/SecretRef→'***', secret_ref drop tận gốc; 404 khi key lạ, không 500) + updateSystemSetting (validate value_type→400 / validation_schema→422 ĐỌC TỪ hàng system_settings, sticky-secret guard, upsert insertSystemTx/updateSystemTx, audit SYSTEM_SETTING_UPDATED object_type='system_setting' data_scope='System' permission_code='FOUNDATION.SETTING.SYSTEM_MANAGE' CÙNG withTenant(actor.companyId) tx).
- REPO: insertSystemTx/updateSystemTx GHI system_settings GLOBAL (no-RLS, không company_id/deleted_at), RIÊNG khỏi company_settings.
- SEED: 0435:343 ('system-manage','foundation-setting',TRUE) — is_sensitive=TRUE. 0435 chỉ bulk-grant company-admin các cặp foundation-* is_sensitive=FALSE ⇒ company-admin KHÔNG có cặp này (đọc/ghi system-setting đều bị chặn). Cần grant EXACT non-wildcard.
- TESTS: system-settings.int-spec.ts P1-P7 (happy) + system-settings-permission-deny.int-spec.ts D1-D6 (deny RED). object_type 'system_setting' ∈ CHECK 0439.
- WIRING: FoundationModule imports+exports SettingsModule ⇒ route live.

ĐIỂM LỆCH done_when WO ↔ SPEC/CODE (spec thắng):
1) WO đề xuất cặp view:system-settings + manage:system-settings (tách read/write). Grep toàn repo = 0 tham chiếu ⇒ đây là NHÃN net-new. Canonical spec DÙNG 1 quyền FOUNDATION.SETTING.SYSTEM_MANAGE cho CẢ GET và PATCH: API-09 §1042 (GET → SYSTEM_MANAGE) + §1082 (PATCH → SYSTEM_MANAGE); FRONTEND-13 §224 (UI-SYSTEM-SCREEN-004 → FOUNDATION.SETTING.SYSTEM_MANAGE, System scope) + §1010 ('chỉ hiện update button nếu có SYSTEM_MANAGE' — KHÔNG có view riêng); chốt DOC-1 2026-07-02 (API-09:330) PIN tuple engine = system-manage:foundation-setting. ⇒ Dựng cặp mới = pair-drift (memory s1-fnd-module-metadata-seed-drift) + scope-creep + phá spec. GIỮ system-manage:foundation-setting.
2) WO 'mặc định READ, UPDATE gated sau manage; company-admin read theo scope' = read-first. Phụ thuộc câu hỏi mở FE13-OQ-003 (FRONTEND-13 §1782: 'System Settings cho update trong MVP hay chỉ read-only?', owner Product/BE, priority Cao) — CHƯA chốt. Posture hiện tại (BE-8): read+write CÙNG gate sensitive ⇒ company-admin KHÔNG đọc được. Đổi sang read-first là quyết định SẢN PHẨM, KHÔNG để Đội 1 tự chốt bằng cách build cặp trái spec.
3) WO 'grant super-admin' — dưới sensitive-gate (permission.service L157-181) wildcard '*:*'/super-admin KHÔNG kế thừa quyền is_sensitive=TRUE; cần grant EXACT. BE-8 deny-test D4/D5 chứng minh super-admin wildcard vẫn 403. Model WO ('grant super-admin' + company-admin read) mâu thuẫn chính sách sensitive hiện hành.

INVARIANTS (CLAUDE §2) — BE-8 đã thoả: #1 mọi read/write company_settings + audit qua withTenant(companyId); system_settings write bọc trong withTenant để audit_logs.company_id=actor.companyId. #2 audit append-only, ghi SYSTEM_SETTING_UPDATED in-tx, không UPDATE/DELETE; deny KHÔNG ghi audit. #3 không secret plaintext — mask sensitive khi đọc, drop secret_ref tận gốc, snapshot audit qua toAuditSnapshot (không secret_ref). §3 dependency: PermissionService + AuditService sẵn.

VERIFY (Đội 3): re-run 2 int-spec trên LANE_DB cô lập (hasDb && LANE_DB); grep 0 cặp view/manage:system-settings; xác nhận route live + gate sensitive strict (super-admin wildcard 403).

GATE: zone red / crown (permission sensitive + audit append-only). WO này KHÔNG thêm diff ⇒ chỉ VERIFY-CLOSE; FULL gate BE-8 đã PASS. Nếu owner mở read-first ⇒ WO MỚI (migration seed cặp + đổi gate GET + cập nhật API-09/FRONTEND-13 + web-core map) qua FULL gate riêng.

OUT-OF-SCOPE (KHÔNG làm ở WO này): tạo cặp view:system-settings/manage:system-settings (trái spec, chờ owner chốt FE13-OQ-003); đổi gate GET system-settings sang view (read-first — cần chốt); web-core client getSystemSettings/updateSystemSetting + FE screen (thuộc S2-FE-FND-8, paths riêng); đụng packages/contracts barrel; tạo bảng mới. KHÓA ĐỀ XUẤT: đóng WO là superseded S2-FND-BE-8, unblock S2-FE-FND-8 (BE enabler đã đủ), route FE13-OQ-003 cho owner.

---

## VERIFY-CLOSE RESULT (Đội 2 — 2026-07-08, head mig 0474)

Đây là WO VERIFY-CLOSE — **KHÔNG thêm diff code**; chỉ xác minh trạng thái runtime của BE-8 và pin quyết định reconcile. Kết quả:

**1) Endpoints live + gate ĐÚNG canonical** — `apps/api/src/foundation/settings/settings.controller.ts`:
- `GET /foundation/system-settings` · `GET /foundation/system-settings/:key` · `PATCH /foundation/system-settings/:key`
- Cả 3 gate `@UseGuards(PermissionGuard) @RequirePermission("system-manage","foundation-setting",{ isSensitive:true })`.
- `SettingsModule` nằm trong `FoundationModule` imports + exports ⇒ 3 route phục vụ sau prefix `api/v1`.

**2) Tests XANH trên DB cô lập** — `bash scripts/lane-db-setup.sh sysset` (chain 0000→latest áp sạch) → `export LANE_DB=mediaos_sysset` → `pnpm exec vitest run` 2 spec (gate `hasDb && LANE_DB`, KHÔNG skip):
- `apps/api/test/foundation/system-settings.int-spec.ts` — **8 tests PASS** (P1, P2, P2b, P3, P4, P5, P6, P7): mask sensitive→`***`, `secret_ref` không ra JSON, PATCH sai type→400 / sai schema→422, PATCH hợp lệ→200 ghi `system_settings` (KHÔNG chạm `company_settings`) + đúng 1 audit `SYSTEM_SETTING_UPDATED`/`system_setting`/`data_scope=System`/`company_id=actor` in-tx, insert-path.
- `apps/api/test/foundation/system-settings-permission-deny.int-spec.ts` — **6 tests PASS** (D1-D6): employee 403+0 audit, wildcard `*:*`/super-admin KHÔNG kế thừa sensitive→403, `update:foundation-setting` KHÔNG mở cổng system-manage→403; mọi deny append-only.
- Tổng: **14 passed / 0 skip**. (Full-suite từng crash ở tinypool teardown `ERR_IPC_CHANNEL_CLOSED` — không liên quan 2 spec này; chạy riêng 2 file thì sạch.)

**3) 0 pair-drift** — grep `apps/` + `packages/` + `migrations/`: KHÔNG có tham chiếu cặp `view:system-settings` / `manage:system-settings` trong code. Chỉ match: (a) `harness/backlog.mjs` = literal mô tả WO đề xuất (harness meta, không phải code), (b) route path string `@Get("system-settings")` (URL segment, không phải permission tuple). Cặp canonical = `system-manage:foundation-setting` (seed `0435:343`, `is_sensitive=TRUE`).

**RECONCILE DECISION (pinned):**
- **GIỮ** cặp canonical `system-manage:foundation-setting` (= `FOUNDATION.SETTING.SYSTEM_MANAGE`) cho CẢ GET và PATCH (API-09 §1042/§1082 · FRONTEND-13 §224/§1010 · chốt DOC-1 API-09:330).
- **KHÔNG** tạo cặp `view:system-settings` / `manage:system-settings` (net-new, trái spec = pair-drift + scope-creep).
- WO này **superseded** bởi **S2-FND-BE-8** (ship 2026-07-04, PR merged) — không còn build lane hợp-spec.

**4) FE13-OQ-003 → ROUTE cho owner Product/BE (CHƯA chốt):** "System Settings cho update trong MVP hay chỉ read-only? Có tách `view`(read) khỏi `manage`(write) không?" (FRONTEND-13 §1782, priority Cao). Posture hiện hành BE-8 = read+write CÙNG gate sensitive ⇒ company-admin KHÔNG đọc được (cặp cấp per-user tường minh). **NẾU** owner chốt read-first ⇒ mở **WO MỚI** tường minh (migration seed cặp read + đổi gate GET sang view + cập nhật API-09/FRONTEND-13 + web-core `PERMISSION_CODE_TO_PAIR`) qua FULL gate riêng — **KHÔNG** làm ngầm ở WO này.

**5) S2-FE-FND-8 enabler BE = ĐỦ → unblock FE:** GET/PATCH live + cặp `FOUNDATION.SETTING.SYSTEM_MANAGE` seeded (`0435:343`) + service mask/validate/audit đã chứng minh xanh. Hai việc FE còn thiếu thuộc **S2-FE-FND-8** (KHÔNG thuộc WO này, ngoài paths lane): (a) web-core client `getSystemSettings`/`updateSystemSetting`; (b) map `"FOUNDATION.SETTING.SYSTEM_MANAGE": "system-manage:foundation-setting"` vào `packages/web-core/src/lib/registry.ts` `PERMISSION_CODE_TO_PAIR` — **LƯU Ý** comment hiện tại ở registry.ts (§171-176) nói "SETTING.SYSTEM_MANAGE chưa seed" đã **STALE** (0435 đã seed) ⇒ S2-FE-FND-8 cần cập nhật comment + thêm mapping.

**GATE:** zone red / crown (permission sensitive + audit append-only). WO này KHÔNG thêm diff code ⇒ không phát sinh FULL gate mới; FULL gate của BE-8 (security-reviewer + database-reviewer) đã PASS.

