import { DatabaseService } from "../../src/db/db.service";
import { AuditService } from "../../src/events/audit.service";
import { SecurityPolicyRepository } from "../../src/security-policy/security-policy.repository";
import { SecurityPolicyService } from "../../src/security-policy/security-policy.service";
import { SecurityPolicyEvaluator } from "../../src/security-policy/security-policy-evaluator";

/**
 * CS-9 — dựng SecurityPolicyService THẬT cho integration test auth (login/refresh enforce). Khi công ty
 * CHƯA cấu hình policy ⇒ service trả allow (KHÔNG enforce) → các auth test cũ giữ nguyên hành vi.
 */
export function makeSecurityPolicyService(dbsvc: DatabaseService): SecurityPolicyService {
  return new SecurityPolicyService(
    dbsvc,
    new SecurityPolicyRepository(dbsvc),
    new SecurityPolicyEvaluator(),
    new AuditService(),
  );
}
