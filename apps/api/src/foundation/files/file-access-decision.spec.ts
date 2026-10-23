/**
 * S19-SEC-FILELINKGATE-1 — bảng trạng thái của hàm quyết định xem/tải từng tệp (plan
 * `docs/plans/S19-SEC-FILELINKGATE-1.md` §3 D-1 · §5).
 *
 * Một vị từ cho `GET /foundation/files/:id`, đường tải FOUNDATION, hàng danh sách và biên gắn tệp:
 *   ≥ 1 liên kết sống            ⇒ AND mọi liên kết (resolver từng liên kết);
 *   0 sống + chưa từng gắn       ⇒ chủ tệp ⇒ ALLOW, còn lại ⇒ fallback FOUNDATION.FILE.*;
 *   0 sống + đã từng gắn         ⇒ từ chối mọi người, kể cả chủ.
 *
 * `FilePolicyService` THẬT + checker/resolver giả (không DB).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FileLink } from "../../db/schema/files";
import type { PermissionDecision } from "../../permission/permission.types";
import { decideFileAccess } from "./file-access-decision";
import { FilePolicyService, type FilePermissionChecker } from "./file-policy.service";
import { FilePolicyAction, type FilePermissionInput } from "./file-policy.types";
import type { FileOwnerPermissionResolver } from "./resolvers/file-owner-permission-resolver";

const COMPANY = "c0000000-0000-4000-8000-000000000001";
const ACTOR_ID = "a0000000-0000-4000-8000-000000000001";
const OTHER_ID = "b0000000-0000-4000-8000-000000000002";
const FILE_ID = "f0000000-0000-4000-8000-000000000003";
const ACTOR = { id: ACTOR_ID, companyId: COMPANY };

const allowPerm: PermissionDecision = { allow: true, reason: "allow", auditRequired: false };
const denyPerm: PermissionDecision = { allow: false, reason: "deny-default", auditRequired: false };

function makeChecker(decision: PermissionDecision): FilePermissionChecker & {
  can: ReturnType<typeof vi.fn>;
} {
  return { can: vi.fn(async () => decision) };
}

function makeResolver(
  moduleCode: string,
  entityTypes: string[],
  verdict: boolean,
): FileOwnerPermissionResolver {
  const decide = vi.fn(async (_i: FilePermissionInput) => verdict);
  return {
    moduleCode,
    entityTypes,
    canViewFile: decide,
    canDownloadFile: decide,
    canLinkFile: decide,
    canDeleteFile: decide,
  };
}

/** Hàng `file_links` tối thiểu mà quyết định đọc (khoá điều phối + thực thể). */
function liveLink(moduleCode: string, entityType: string): FileLink {
  return {
    id: "l0000000-0000-4000-8000-000000000009",
    companyId: COMPANY,
    fileId: FILE_ID,
    moduleCode,
    entityType,
    entityId: "e0000000-0000-4000-8000-000000000004",
  } as FileLink;
}

const NEVER = { live: [] as FileLink[], everLinked: false };
const REVOKED = { live: [] as FileLink[], everLinked: true };

describe("decideFileAccess — một vị từ xem/tải từng tệp", () => {
  let checker: ReturnType<typeof makeChecker>;
  let policy: FilePolicyService;

  function withChecker(decision: PermissionDecision): void {
    checker = makeChecker(decision);
    policy = new FilePolicyService(checker);
    policy.registerResolver(makeResolver("TASK", ["task"], false));
  }

  beforeEach(() => withChecker(denyPerm));

  for (const action of [FilePolicyAction.View, FilePolicyAction.Download] as const) {
    describe(`action ${action}`, () => {
      it("chủ tệp · 0 liên kết · chưa từng gắn ⇒ allow-owner, KHÔNG hỏi checker", async () => {
        const d = await decideFileAccess(
          policy,
          ACTOR,
          { id: FILE_ID, ownerUserId: ACTOR_ID },
          NEVER,
          action,
        );
        expect(d).toEqual({ allow: true, reason: "allow-owner" });
        expect(checker.can, "vế chủ không đi qua fallback quyền").not.toHaveBeenCalled();
      });

      it("không phải chủ · 0 liên kết · chưa từng gắn ⇒ fallback (checker từ chối ⇒ deny-foundation)", async () => {
        const d = await decideFileAccess(
          policy,
          ACTOR,
          { id: FILE_ID, ownerUserId: OTHER_ID },
          NEVER,
          action,
        );
        expect(d.allow).toBe(false);
        expect(d.reason).toBe("deny-foundation");
        expect(checker.can).toHaveBeenCalledTimes(1);
      });

      it("không phải chủ · 0 liên kết · chưa từng gắn ⇒ fallback (checker cho ⇒ allow-foundation)", async () => {
        withChecker(allowPerm);
        const d = await decideFileAccess(
          policy,
          ACTOR,
          { id: FILE_ID, ownerUserId: OTHER_ID },
          NEVER,
          action,
        );
        expect(d).toMatchObject({ allow: true, reason: "allow-foundation" });
      });

      it("ownerUserId null KHÔNG được coi là chủ ⇒ fallback", async () => {
        const d = await decideFileAccess(
          policy,
          ACTOR,
          { id: FILE_ID, ownerUserId: null },
          NEVER,
          action,
        );
        expect(d.allow).toBe(false);
        expect(d.reason).toBe("deny-foundation");
        expect(checker.can).toHaveBeenCalledTimes(1);
      });

      it("chủ tệp · 0 liên kết sống · ĐÃ từng gắn ⇒ deny-links-revoked", async () => {
        withChecker(allowPerm);
        const d = await decideFileAccess(
          policy,
          ACTOR,
          { id: FILE_ID, ownerUserId: ACTOR_ID },
          REVOKED,
          action,
        );
        expect(d).toMatchObject({ allow: false, reason: "deny-links-revoked" });
      });

      it("không phải chủ · ĐÃ từng gắn · checker cho ⇒ vẫn deny-links-revoked", async () => {
        withChecker(allowPerm);
        const d = await decideFileAccess(
          policy,
          ACTOR,
          { id: FILE_ID, ownerUserId: OTHER_ID },
          REVOKED,
          action,
        );
        expect(d).toMatchObject({ allow: false, reason: "deny-links-revoked" });
      });

      it("chủ tệp · 1 liên kết sống bị resolver từ chối ⇒ deny-resolver (vế chủ không vượt AND)", async () => {
        withChecker(allowPerm);
        const d = await decideFileAccess(
          policy,
          ACTOR,
          { id: FILE_ID, ownerUserId: ACTOR_ID },
          { live: [liveLink("TASK", "task")], everLinked: true },
          action,
        );
        expect(d).toMatchObject({ allow: false, reason: "deny-resolver" });
      });

      it("3 liên kết sống, chỉ liên kết GIỮA bị resolver từ chối ⇒ deny-resolver (AND đủ mọi liên kết)", async () => {
        policy.registerResolver(makeResolver("HR", ["contract"], true));
        policy.registerResolver(makeResolver("SOCIAL", ["feed_post"], true));
        const d = await decideFileAccess(
          policy,
          ACTOR,
          { id: FILE_ID, ownerUserId: OTHER_ID },
          {
            live: [
              liveLink("HR", "contract"),
              liveLink("TASK", "task"),
              liveLink("SOCIAL", "feed_post"),
            ],
            everLinked: true,
          },
          action,
        );
        expect(d).toMatchObject({ allow: false, reason: "deny-resolver" });
      });

      it("neo: 2 liên kết sống, cả hai resolver cho ⇒ allow", async () => {
        policy.registerResolver(makeResolver("HR", ["contract"], true));
        policy.registerResolver(makeResolver("SOCIAL", ["feed_post"], true));
        const d = await decideFileAccess(
          policy,
          ACTOR,
          { id: FILE_ID, ownerUserId: OTHER_ID },
          { live: [liveLink("HR", "contract"), liveLink("SOCIAL", "feed_post")], everLinked: true },
          action,
        );
        expect(d.allow).toBe(true);
      });

      it("chủ tệp · liên kết tới cặp không có resolver ⇒ deny-no-resolver", async () => {
        withChecker(allowPerm);
        const d = await decideFileAccess(
          policy,
          ACTOR,
          { id: FILE_ID, ownerUserId: ACTOR_ID },
          { live: [liveLink("LEAVE", "leave_request")], everLinked: true },
          action,
        );
        expect(d).toMatchObject({ allow: false, reason: "deny-no-resolver" });
      });

      it("thiếu tenant · chủ tệp ⇒ deny-tenant", async () => {
        withChecker(allowPerm);
        const d = await decideFileAccess(
          policy,
          { id: ACTOR_ID, companyId: "" },
          { id: FILE_ID, ownerUserId: ACTOR_ID },
          NEVER,
          action,
        );
        expect(d).toMatchObject({ allow: false, reason: "deny-tenant" });
      });
    });
  }
});
