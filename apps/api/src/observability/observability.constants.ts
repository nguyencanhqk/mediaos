/**
 * AC-8 — sentinel target cho step-up cross-tenant đọc-quan-sát (audit/queue all-tenant).
 *
 * Đọc audit/queue CHÉO TENANT là all-tenant (không 1 target). OperatorReauthGuard + OperatorReauthService
 * key cửa sổ step-up theo (operatorId, targetTenantId). Dùng UUID sentinel cố định (all-zero) làm "target"
 * cho phạm vi platform-audit ⇒ cửa sổ step-up cho 1 tenant THẬT (A) KHÔNG authorize đọc all-tenant (key
 * khác). Operator step-up qua POST /admin/platform/companies/:id/step-up với :id = sentinel này.
 *
 * NHÌN THẤY ĐƯỢC: là UUID hợp lệ để qua ParseUUIDPipe ở step-up controller, nhưng KHÔNG trùng company thật
 * (companies.id do gen_random_uuid sinh — xác suất đụng all-zero = 0).
 */
export const PLATFORM_AUDIT_SCOPE = "00000000-0000-0000-0000-000000000000" as const;
