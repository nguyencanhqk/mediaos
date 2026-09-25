import fs from "node:fs";
import path from "node:path";
import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import ts from "typescript";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import {
  ATTACH_GATE_ROUTE_TARGET,
  SOCIAL_FILE_TARGET_PAIRS,
  SOCIAL_MODERATION_FIELD_PAIRS,
  SOCIAL_POST_TYPE_PAIRS,
  SOCIAL_ROUTE_PAIRS,
  type SocialRouteKey,
} from "../../src/social/social-route-pairs.const";
import { collectRoutes, type RouteInfo } from "./route-census";

/**
 * S16-SOCIAL-BE-1 — CENSUS 2 TẦNG cho SOCIAL (khuôn `recruit-two-layer-guard-census.unit-spec.ts`).
 *
 * CẢ HAI tầng so với CÙNG MỘT nguồn sự thật `SOCIAL_ROUTE_PAIRS` — KHÔNG so tầng-với-tầng (hai tầng
 * cùng sai vẫn "khớp nhau"):
 *   • Tầng 1 (decorator): metadata `@RequirePermission` đọc từ APP ĐÃ BOOT qua `collectRoutes`.
 *   • Tầng 2 (service): quét TS AST tìm `resolveActor(<expr>, "<key>")`, pin `Class#method` ↔ key.
 *
 * VÀ — phần riêng của SOCIAL — đẳng thức `tier1IsFloor` (plan §2 D17): tập route có cờ đó phải BẰNG
 * ĐÚNG tập route có bảng cặp-theo-payload. Đo bằng một nguồn ĐỘC LẬP với chính cờ, nên nó không phải
 * tautology.
 *
 * KHÔNG cần Postgres — boot + metadata + đọc file.
 */

const SRC_SOCIAL = path.join(__dirname, "..", "..", "src", "social");

const SOCIAL_CONTROLLERS = new Set([
  "SocialPostsController",
  "SocialReactionsController",
  "SocialCommentsController",
  // S16-SOCIAL-BE-1B — 3 controller Nhóm B (`social-b.controllers.ts`).
  "SocialNewsController",
  "SocialDiscoveryController",
  "SocialReportsController",
  // 🔴 S16-SOCIAL-BE-2A — `Set` này là DANH SÁCH TRẮNG: controller không có tên ở đây thì 10 route
  // của nó VÔ HÌNH với census, và cả bốn assert dưới vẫn XANH (fail-open IM LẶNG). Thêm controller
  // SOCIAL mới ⇒ thêm MỘT dòng ở đây, cùng commit.
  "SocialGroupsController",
  // S16-SOCIAL-BE-2B-1 — 5 route binh chon (040..044).
  "SocialPollsController",
  // S16-SOCIAL-BE-2B-2 — 2 route sang kien (045..046) + 2 route vinh danh (047..048), cung file
  // `social-b2b2.controllers.ts`. HAI ten rieng: gop lai thi mot luot "cho gon" sau nay xoa duoc 4
  // route khoi phep do ma khong assert nao do.
  "SocialIdeasController",
  "SocialKudosController",
  // S16-SOCIAL-BE-1C — 2 route cua dang ky tep (054..055), `social-files.controller.ts`.
  "SocialFilesController",
]);

/** Bảng route HTTP → key — fixture census, phủ ĐỦ 50 route (19 A + 10 B + 10 NHÓM + 5 BÌNH CHỌN + 4 SÁNG KIẾN/VINH DANH + 2 CỬA TỆP, API-19 §5.1). */
const ROUTE_TO_KEY: ReadonlyArray<{ method: string; path: string; key: SocialRouteKey }> = [
  { method: "GET", path: "/api/v1/social/saved", key: "savedList" },
  { method: "GET", path: "/api/v1/social/feed", key: "feedList" },
  { method: "POST", path: "/api/v1/social/posts", key: "postCreate" },
  { method: "GET", path: "/api/v1/social/posts/:post_id", key: "postDetail" },
  { method: "PATCH", path: "/api/v1/social/posts/:post_id", key: "postUpdate" },
  { method: "DELETE", path: "/api/v1/social/posts/:post_id", key: "postDelete" },
  { method: "PATCH", path: "/api/v1/social/posts/:post_id/moderation", key: "postModerate" },
  { method: "POST", path: "/api/v1/social/posts/:post_id/view", key: "postView" },
  { method: "POST", path: "/api/v1/social/posts/:post_id/save", key: "postSave" },
  { method: "DELETE", path: "/api/v1/social/posts/:post_id/save", key: "postUnsave" },
  { method: "PUT", path: "/api/v1/social/posts/:post_id/reaction", key: "postReactionPut" },
  { method: "DELETE", path: "/api/v1/social/posts/:post_id/reaction", key: "postReactionDelete" },
  { method: "GET", path: "/api/v1/social/posts/:post_id/reactions", key: "postReactionList" },
  { method: "GET", path: "/api/v1/social/posts/:post_id/comments", key: "commentList" },
  { method: "POST", path: "/api/v1/social/posts/:post_id/comments", key: "commentCreate" },
  { method: "PATCH", path: "/api/v1/social/comments/:comment_id", key: "commentUpdate" },
  { method: "DELETE", path: "/api/v1/social/comments/:comment_id", key: "commentDelete" },
  {
    method: "PUT",
    path: "/api/v1/social/comments/:comment_id/reaction",
    key: "commentReactionPut",
  },
  {
    method: "DELETE",
    path: "/api/v1/social/comments/:comment_id/reaction",
    key: "commentReactionDelete",
  },
  // ── S16-SOCIAL-BE-1B — Nhóm B (`SOCIAL-API-020..029`) ──
  { method: "GET", path: "/api/v1/social/news", key: "newsList" },
  { method: "POST", path: "/api/v1/social/posts/:post_id/ack", key: "postAck" },
  { method: "GET", path: "/api/v1/social/posts/:post_id/acks", key: "postAcksList" },
  { method: "GET", path: "/api/v1/social/search", key: "search" },
  { method: "GET", path: "/api/v1/social/tags", key: "tagsList" },
  { method: "GET", path: "/api/v1/social/birthdays", key: "birthdays" },
  { method: "GET", path: "/api/v1/social/profiles/:employee_id/posts", key: "profilePosts" },
  { method: "POST", path: "/api/v1/social/reports", key: "reportCreate" },
  { method: "GET", path: "/api/v1/social/reports", key: "reportsList" },
  { method: "PATCH", path: "/api/v1/social/reports/:report_id", key: "reportResolve" },
  // ── S16-SOCIAL-BE-2A — NHÓM (`SOCIAL-API-030..039`) ──
  { method: "GET", path: "/api/v1/social/groups", key: "groupsList" },
  { method: "POST", path: "/api/v1/social/groups", key: "groupCreate" },
  { method: "GET", path: "/api/v1/social/groups/:group_id", key: "groupGet" },
  { method: "PATCH", path: "/api/v1/social/groups/:group_id", key: "groupUpdate" },
  { method: "DELETE", path: "/api/v1/social/groups/:group_id", key: "groupDelete" },
  { method: "POST", path: "/api/v1/social/groups/:group_id/join", key: "groupJoin" },
  { method: "POST", path: "/api/v1/social/groups/:group_id/leave", key: "groupLeave" },
  { method: "GET", path: "/api/v1/social/groups/:group_id/members", key: "groupMembersList" },
  {
    method: "PATCH",
    path: "/api/v1/social/groups/:group_id/members/:user_id",
    key: "groupMemberDecide",
  },
  {
    method: "DELETE",
    path: "/api/v1/social/groups/:group_id/members/:user_id",
    key: "groupMemberRemove",
  },
  // ── S16-SOCIAL-BE-2B-1 — BINH CHON 040..044 ──
  { method: "GET", path: "/api/v1/social/polls", key: "pollList" },
  { method: "PUT", path: "/api/v1/social/posts/:post_id/poll/vote", key: "pollVote" },
  { method: "DELETE", path: "/api/v1/social/posts/:post_id/poll/vote", key: "pollVoteWithdraw" },
  { method: "GET", path: "/api/v1/social/posts/:post_id/poll/results", key: "pollResults" },
  { method: "POST", path: "/api/v1/social/posts/:post_id/poll/close", key: "pollClose" },
  // ── S16-SOCIAL-BE-2B-2 — SANG KIEN 045..046 · VINH DANH 047..048 ──
  { method: "GET", path: "/api/v1/social/ideas", key: "ideaList" },
  { method: "PATCH", path: "/api/v1/social/posts/:post_id/idea/review", key: "ideaReview" },
  { method: "GET", path: "/api/v1/social/kudos", key: "kudosList" },
  { method: "GET", path: "/api/v1/social/kudos-badges", key: "kudosBadgeList" },
  // ── S16-SOCIAL-BE-1C — CUA DANG KY TEP 054..055 ──
  { method: "POST", path: "/api/v1/social/files/upload-url", key: "fileUploadUrl" },
  { method: "POST", path: "/api/v1/social/files/:id/confirm", key: "fileConfirm" },
];

/**
 * Sổ pin `Class#method` ↔ key — đổi handler/key là ĐỎ, phải sửa CÓ CHỦ ĐÍCH qua FULL gate.
 *
 * "Key xuất hiện ít nhất một lần" là chưa đủ: một handler assert nhầm key của route KHÁC cùng cặp
 * vẫn xanh. Map này pin ĐÚNG HANDLER dùng ĐÚNG KEY.
 */
const SERVICE_SITE_TO_KEYS: Readonly<Record<string, readonly string[]>> = {
  "SocialPostsService#list": ["feedList"],
  "SocialPostsService#listSaved": ["savedList"],
  "SocialPostsService#get": ["postDetail"],
  "SocialPostsService#create": ["postCreate"],
  "SocialPostsService#update": ["postUpdate"],
  "SocialPostsService#remove": ["postDelete"],
  "SocialPostsService#recordView": ["postView"],
  "SocialPostsService#save": ["postSave"],
  "SocialPostsService#unsave": ["postUnsave"],
  "SocialPostsModerationService#moderate": ["postModerate"],
  "SocialCommentsService#list": ["commentList"],
  "SocialCommentsService#create": ["commentCreate"],
  "SocialCommentsService#update": ["commentUpdate"],
  "SocialCommentsService#remove": ["commentDelete"],
  // Bốn method mỏng, MỖI cái một key literal — thân dùng chung nằm ở putWith/removeWith (không gọi
  // resolveActor). Ternary chọn key sẽ làm census MÙ với đúng bốn route này.
  "SocialReactionsService#putOnPost": ["postReactionPut"],
  "SocialReactionsService#putOnComment": ["commentReactionPut"],
  "SocialReactionsService#removeOnPost": ["postReactionDelete"],
  "SocialReactionsService#removeOnComment": ["commentReactionDelete"],
  "SocialReactionsService#listReactors": ["postReactionList"],
  // ── S16-SOCIAL-BE-1B — 10 handler Nhóm B, mỗi handler MỘT key literal ──
  "SocialNewsService#list": ["newsList"],
  "SocialNewsService#ack": ["postAck"],
  "SocialNewsService#listAcks": ["postAcksList"],
  "SocialDiscoveryService#search": ["search"],
  "SocialDiscoveryService#listTags": ["tagsList"],
  "SocialDiscoveryService#profilePosts": ["profilePosts"],
  "SocialDiscoveryService#birthdays": ["birthdays"],
  "SocialReportsService#create": ["reportCreate"],
  "SocialReportsService#list": ["reportsList"],
  "SocialReportsService#resolve": ["reportResolve"],
  // ── S16-SOCIAL-BE-2A — 10 handler NHÓM, mỗi handler MỘT key literal ──
  "SocialGroupsService#list": ["groupsList"],
  "SocialGroupsService#create": ["groupCreate"],
  "SocialGroupsService#get": ["groupGet"],
  "SocialGroupsService#update": ["groupUpdate"],
  "SocialGroupsService#remove": ["groupDelete"],
  "SocialGroupsService#join": ["groupJoin"],
  "SocialGroupsService#leave": ["groupLeave"],
  "SocialGroupsService#listMembers": ["groupMembersList"],
  "SocialGroupsService#decideMember": ["groupMemberDecide"],
  "SocialGroupsService#removeMember": ["groupMemberRemove"],
  "SocialPollsService#list": ["pollList"],
  "SocialPollsService#vote": ["pollVote"],
  "SocialPollsService#withdrawVote": ["pollVoteWithdraw"],
  "SocialPollsService#results": ["pollResults"],
  "SocialPollsService#close": ["pollClose"],
  // S16-SOCIAL-BE-2B-2 — 4 site moi. `SocialIdeasService#review` la site DUY NHAT cua module dung
  // mot cap `approve:*`.
  "SocialIdeasService#list": ["ideaList"],
  "SocialIdeasService#review": ["ideaReview"],
  "SocialKudosService#list": ["kudosList"],
  "SocialKudosService#listBadges": ["kudosBadgeList"],
  // S16-SOCIAL-BE-1C — 2 site moi. Moi site MOT key literal: ternary chon key (vi du
  // `target === "comment" ? … : …`) se lam census MU voi dung hai route nay.
  "SocialFilesService#createUploadUrl": ["fileUploadUrl"],
  "SocialFilesService#confirmOwnUpload": ["fileConfirm"],
};

/** Mọi literal `resolveActor(<expr>, "<key>")` trong `social/**.ts`, kèm `Class#method` bao quanh. */
function serviceResolveActorCalls(): Array<{ site: string; key: string }> {
  const calls: Array<{ site: string; key: string }> = [];
  for (const file of fs.readdirSync(SRC_SOCIAL)) {
    if (!file.endsWith(".ts") || file.endsWith(".spec.ts")) continue;
    const text = fs.readFileSync(path.join(SRC_SOCIAL, file), "utf8");
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true);
    const visit = (node: ts.Node, cls: string, method: string): void => {
      let nextCls = cls;
      let nextMethod = method;
      if (ts.isClassDeclaration(node) && node.name) nextCls = node.name.text;
      if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) nextMethod = node.name.text;
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "resolveActor" &&
        node.arguments.length === 2 &&
        ts.isStringLiteral(node.arguments[1])
      ) {
        calls.push({ site: `${nextCls}#${nextMethod}`, key: node.arguments[1].text });
      }
      ts.forEachChild(node, (c) => visit(c, nextCls, nextMethod));
    };
    visit(sf, "?", "?");
  }
  return calls;
}

/**
 * S16-SOCIAL-ATTGATE-1 · **S-1** — ĐỐI SỐ THỨ 7 (`gate`) của MỌI lời gọi `syncLinksTx`, theo
 * `Class#method`, phân loại theo HÌNH DẠNG cú pháp.
 *
 * ┌─ VÌ SAO CẦN CA NÀY KHI ĐÃ CÓ 3 LƯỚI KHÁC (FULL gate 24/09/2026, `silent-failure-hunter` HIGH) ─┐
 * │ Ba lưới không-cần-DB kia khoá nhau ở chỗ *hằng/lời gọi XUẤT HIỆN ở đâu*, KHÔNG ở chỗ *giá trị  │
 * │ nào TỚI ĐƯỢC tham số `gate`*. Thay `attach.gate` bằng `{ allow: true }` ngay tại call-site mà  │
 * │ vẫn giữ lời gọi `resolveAttachNewGate` ở trên ⇒ structure-spec (e) XANH (số đếm hằng không     │
 * │ đổi) · census D17 XANH (call-site vẫn `SocialPostsService#update`) · unit-spec XANH (nó không  │
 * │ gọi `update()`). Chỉ G5/G11 bắt được — mà chúng SKIP khi chạy không có `LANE_DB`.              │
 * │ ⇒ Ca này là lưới KHÔNG-CẦN-DB duy nhất đo được cổng có thật sự được NỐI vào đường ghi.         │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
 */
function syncLinksGateArgShapes(): Array<{
  site: string;
  shape: string;
  text: string;
  argCount: number;
}> {
  const out: Array<{ site: string; shape: string; text: string; argCount: number }> = [];
  for (const file of fs.readdirSync(SRC_SOCIAL)) {
    if (!file.endsWith(".ts") || file.endsWith(".spec.ts")) continue;
    const text = fs.readFileSync(path.join(SRC_SOCIAL, file), "utf8");
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true);
    const visit = (node: ts.Node, cls: string, method: string): void => {
      let nextCls = cls;
      let nextMethod = method;
      if (ts.isClassDeclaration(node) && node.name) nextCls = node.name.text;
      if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) nextMethod = node.name.text;
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "syncLinksTx"
      ) {
        const arg = node.arguments[6];
        const shape =
          arg === undefined
            ? "MISSING"
            : ts.isPropertyAccessExpression(arg)
              ? "property-access"
              : ts.isIdentifier(arg)
                ? "identifier"
                : ts.isObjectLiteralExpression(arg)
                  ? "object-literal"
                  : "other";
        out.push({
          site: `${nextCls}#${nextMethod}`,
          shape,
          text: arg?.getText(sf) ?? "",
          argCount: node.arguments.length,
        });
      }
      ts.forEachChild(node, (c) => visit(c, nextCls, nextMethod));
    };
    visit(sf, "?", "?");
  }
  return out;
}

/**
 * S16-SOCIAL-ATTGATE-1 — call-site của `resolveAttachNewGate` ở mức **`Class#method`**.
 *
 * 🔴 **KHÔNG dùng `classesReferencingManageNews()` cho việc này** (plan F-5): khuôn đó có độ phân
 * giải LỚP, mà `SocialPostsService` phục vụ CẢ `postCreate` lẫn `postUpdate` ⇒ "lớp có gọi cổng"
 * không phân biệt được route nào, và ai dời lời gọi từ `update()` sang `create()` thì census **vẫn
 * XANH** trong khi cổng đã biến mất khỏi `004`. Khuôn đúng là `serviceResolveActorCalls()` ngay
 * trên — nó đã trích `Class#method`.
 */
function attachGateCallSites(): string[] {
  const sites: string[] = [];
  for (const file of fs.readdirSync(SRC_SOCIAL)) {
    if (!file.endsWith(".ts") || file.endsWith(".spec.ts")) continue;
    const text = fs.readFileSync(path.join(SRC_SOCIAL, file), "utf8");
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true);
    const visit = (node: ts.Node, cls: string, method: string): void => {
      let nextCls = cls;
      let nextMethod = method;
      if (ts.isClassDeclaration(node) && node.name) nextCls = node.name.text;
      if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) nextMethod = node.name.text;
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "resolveAttachNewGate"
      ) {
        sites.push(`${nextCls}#${nextMethod}`);
      }
      ts.forEachChild(node, (c) => visit(c, nextCls, nextMethod));
    };
    visit(sf, "?", "?");
  }
  return sites;
}

/**
 * Ánh xạ call-site cổng → route key. Một site KHÔNG có trong bảng này = cổng vừa mọc ở chỗ census
 * chưa biết ⇒ ca D17 phải ĐỎ TO, không im lặng bỏ qua (đó là cả lý do bảng này tồn tại).
 * `SocialAccessService#resolveAttachNewGate` là nơi ĐỊNH NGHĨA hàm, không phải nơi tiêu thụ.
 */
const ATTACH_GATE_SITE_TO_KEY: Record<string, string> = {
  "SocialPostsService#update": "postUpdate",
  "SocialCommentsService#update": "commentUpdate",
};
/**
 * S16-SOCIAL-ATTDEBT-1 (C-5) — call-site của `reportAttachGateDeny` ở mức `Class#method`, kèm HAI
 * thuộc tính mà một lưới "tập bằng tập" thuần KHÔNG thấy được.
 *
 * 🔴 Vì sao không chỉ đếm tên method (bài học wave trước, plan §7 HIGH-1): một lưới chỉ so
 * «method nào gọi reporter» vẫn XANH khi (a) khối `catch` gọi reporter rồi **quên `throw`** —
 * biến một 403 thành **200**; (b) reporter nhận `new Error('x')` thay vì binding của `catch`;
 * (c) lời gọi bị dời vào TRONG callback `this.db.withTenant` ⇒ `emit()` mở `withTenant` lồng
 * `withTenant` ⇒ **TREO IM LẶNG**. (c) là bất biến R2, và đây là lưới TĨNH duy nhất mã hoá được nó.
 */
function attachGateReportSites(): {
  site: string;
  argIsCatchBinding: boolean;
  rethrowsSameBinding: boolean;
  insideWithTenant: boolean;
}[] {
  const out: {
    site: string;
    argIsCatchBinding: boolean;
    rethrowsSameBinding: boolean;
    insideWithTenant: boolean;
  }[] = [];
  for (const file of fs.readdirSync(SRC_SOCIAL)) {
    if (!file.endsWith(".ts") || file.endsWith(".spec.ts")) continue;
    const text = fs.readFileSync(path.join(SRC_SOCIAL, file), "utf8");
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true);

    const visit = (
      node: ts.Node,
      cls: string,
      method: string,
      inTenant: boolean,
    ): void => {
      let nextCls = cls;
      let nextMethod = method;
      const nextInTenant = inTenant;
      if (ts.isClassDeclaration(node) && node.name) nextCls = node.name.text;
      if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name))
        nextMethod = node.name.text;
      // Vào thân callback của `this.db.withTenant(...)` ⇒ đánh dấu, và cờ ĐI XUỐNG mọi node con.
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "withTenant"
      ) {
        for (const a of node.arguments) {
          if (ts.isArrowFunction(a) || ts.isFunctionExpression(a)) {
            ts.forEachChild(a, (c) => visit(c, nextCls, nextMethod, true));
          }
        }
      }
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "reportAttachGateDeny"
      ) {
        const arg0 = node.arguments[0];
        // Tìm khối `catch` bao quanh để đọc TÊN binding của nó.
        let anc: ts.Node | undefined = node.parent;
        let clause: ts.CatchClause | undefined;
        while (anc) {
          if (ts.isCatchClause(anc)) {
            clause = anc;
            break;
          }
          anc = anc.parent;
        }
        const bindName =
          clause?.variableDeclaration &&
          ts.isIdentifier(clause.variableDeclaration.name)
            ? clause.variableDeclaration.name.text
            : undefined;

        let rethrows = false;
        if (clause && bindName) {
          const scan = (n: ts.Node): void => {
            if (
              ts.isThrowStatement(n) &&
              n.expression &&
              ts.isIdentifier(n.expression) &&
              n.expression.text === bindName
            ) {
              rethrows = true;
            }
            ts.forEachChild(n, scan);
          };
          scan(clause.block);
        }

        out.push({
          site: `${nextCls}#${nextMethod}`,
          argIsCatchBinding:
            arg0 !== undefined &&
            ts.isIdentifier(arg0) &&
            bindName !== undefined &&
            arg0.text === bindName,
          rethrowsSameBinding: rethrows,
          insideWithTenant: nextInTenant,
        });
      }
      ts.forEachChild(node, (c) => visit(c, nextCls, nextMethod, nextInTenant));
    };
    visit(sf, "?", "?", false);
  }
  return out;
}

/** Tên lớp có tham chiếu tới cờ cặp-KHÁC `canManageNews` — tín hiệu AST của một nhánh tầng-2. */
function classesReferencingManageNews(): Set<string> {
  const out = new Set<string>();
  for (const file of fs.readdirSync(SRC_SOCIAL)) {
    if (!file.endsWith(".ts") || file.endsWith(".spec.ts")) continue;
    const text = fs.readFileSync(path.join(SRC_SOCIAL, file), "utf8");
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true);
    const visit = (node: ts.Node, cls: string): void => {
      const nextCls = ts.isClassDeclaration(node) && node.name ? node.name.text : cls;
      if (
        ts.isPropertyAccessExpression(node) &&
        node.name.text === "canManageNews" &&
        nextCls !== "?"
      ) {
        out.add(nextCls);
      }
      ts.forEachChild(node, (c) => visit(c, nextCls));
    };
    visit(sf, "?");
  }
  return out;
}

describe("SOCIAL census 2 tầng — decorator + service so với SOCIAL_ROUTE_PAIRS", () => {
  let app: INestApplication;
  let socialRoutes: RouteInfo[];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    await app.init();
    socialRoutes = collectRoutes(app).filter((r) => SOCIAL_CONTROLLERS.has(r.controller));
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  it("bảng fixture phủ ĐÚNG tập route SOCIAL đã boot — không thiếu, không thừa", () => {
    // Chốt chặn xanh-RỖNG: scanner/boot hỏng ⇒ 0 route ⇒ mọi assert dưới vô nghĩa.
    expect(
      socialRoutes.length,
      "app boot phải thấy 50 route SOCIAL (19 Nhóm A + 10 Nhóm B + 10 NHÓM + 5 BÌNH CHỌN + 4 SÁNG KIẾN/VINH DANH + 2 CỬA TỆP)",
    ).toBe(50);
    const seen = new Set(socialRoutes.map((r) => `${r.httpMethod} ${r.path}`));
    const expected = new Set(ROUTE_TO_KEY.map((r) => `${r.method} ${r.path}`));
    expect(
      [...seen].filter((k) => !expected.has(k)),
      "route SOCIAL mọc ngoài bảng census",
    ).toEqual([]);
    expect(
      [...expected].filter((k) => !seen.has(k)),
      "bảng census khai route mà app không có",
    ).toEqual([]);
  });

  it("TẦNG 1 — mỗi route mang ĐÚNG cặp của SOCIAL_ROUTE_PAIRS[key]", () => {
    const mismatches: string[] = [];
    for (const { method, path: p, key } of ROUTE_TO_KEY) {
      const route = socialRoutes.find((r) => r.httpMethod === method && r.path === p);
      if (!route) {
        mismatches.push(`${method} ${p}: KHÔNG thấy route`);
        continue;
      }
      const pair = SOCIAL_ROUTE_PAIRS[key];
      // `RouteInfo.permission` là CHUỖI "action:resourceType" (route-census.ts:61), không phải object.
      const got = route.permission;
      const want = `${pair.action}:${pair.resourceType}`;
      if (got !== want) mismatches.push(`${method} ${p}: decorator=${got} ≠ bảng=${want}`);
    }
    expect(mismatches).toEqual([]);
  });

  it("TẦNG 1 — MỌI route SOCIAL đều CÓ decorator (guard fail-closed, không route trần)", () => {
    const naked = socialRoutes
      .filter((r) => !r.hasPermission)
      .map((r) => `${r.httpMethod} ${r.path}`);
    expect(naked).toEqual([]);
  });

  it("TẦNG 2 — mỗi handler service assert ĐÚNG key của nó (sổ pin site↔key)", () => {
    const calls = serviceResolveActorCalls();
    // Neo chống-xanh-rỗng: AST hỏng / đổi tên method ⇒ 0 call ⇒ mọi assert dưới vô nghĩa.
    expect(calls.length, "phải tìm thấy lời gọi resolveActor trong social/**").toBeGreaterThan(0);

    const bySite = new Map<string, string[]>();
    for (const c of calls) bySite.set(c.site, [...(bySite.get(c.site) ?? []), c.key]);

    const problems: string[] = [];
    for (const [site, keys] of Object.entries(SERVICE_SITE_TO_KEYS)) {
      const got = (bySite.get(site) ?? []).sort();
      const want = [...keys].sort();
      if (JSON.stringify(got) !== JSON.stringify(want)) {
        problems.push(`${site}: gọi [${got}] ≠ pin [${want}]`);
      }
    }
    for (const site of bySite.keys()) {
      if (!(site in SERVICE_SITE_TO_KEYS)) {
        problems.push(`${site}: gọi resolveActor nhưng KHÔNG có trong sổ pin`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("TẦNG 2 — mọi key của bảng hằng được assert ở tầng service ít nhất một lần", () => {
    const used = new Set(serviceResolveActorCalls().map((c) => c.key));
    const missing = Object.keys(SOCIAL_ROUTE_PAIRS).filter((k) => !used.has(k));
    expect(missing, "key có trong bảng nhưng KHÔNG route nào assert ở service").toEqual([]);
  });

  /**
   * ĐẲNG THỨC `tier1IsFloor` (plan §2 D17) — đo bằng nguồn ĐỘC LẬP với chính cờ.
   *
   * `toEqual` chứ KHÔNG `toContain`: thiếu một route là bỏ sót gap thật; thừa một route là gắn nhãn
   * "gate lỏng" cho route vốn đủ chặt, và lần review sau sẽ đi tìm một lỗ không tồn tại.
   */
  it("D17 — tập tier1IsFloor BẰNG ĐÚNG tập route có bảng cặp-theo-payload", () => {
    const flagged = Object.entries(SOCIAL_ROUTE_PAIRS)
      .filter(([, p]) => p.tier1IsFloor)
      .map(([k]) => k)
      .sort();

    // Nguồn độc lập: route nào có một bảng ánh xạ "nội dung request → cặp quyền".
    const payloadDependent: string[] = [];
    if (Object.values(SOCIAL_POST_TYPE_PAIRS).some((v) => v !== null)) {
      payloadDependent.push("postCreate");
    }
    if (
      Object.values(SOCIAL_MODERATION_FIELD_PAIRS).some(
        (v) => v.resourceType !== SOCIAL_ROUTE_PAIRS.postModerate.resourceType,
      )
    ) {
      payloadDependent.push("postModerate");
    }
    // S16-SOCIAL-BE-1C — nguon DOC LAP cho hai route cua tep: bang `SOCIAL_FILE_TARGET_PAIRS` anh xa
    // `target` cua request → cap quyen. Dieu kien hoi "co cap nao KHAC cap san cua route khong" —
    // cung hinh dang voi hai nhanh tren, nen mot lan "don dep" lam bang tro thanh toan `view:feed`
    // se keo dang thuc do, chu khong am tham tha hai route.
    if (
      Object.values(SOCIAL_FILE_TARGET_PAIRS).some(
        (v) => v.resourceType !== SOCIAL_ROUTE_PAIRS.fileUploadUrl.resourceType,
      )
    ) {
      payloadDependent.push("fileUploadUrl", "fileConfirm");
    }
    // S16-SOCIAL-ATTGATE-1 — nguồn ĐỘC LẬP cho `004`/`016`: call-site AST của `resolveAttachNewGate`
    // ở mức `Class#method`. Không có bảng hằng nào để đọc ở đây (cổng là một QUYẾT ĐỊNH resolve
    // ngoài tx, không phải một ánh xạ trường→cặp), nên chính vị trí lời gọi là bằng chứng.
    const gateSites = attachGateCallSites().filter((s) => !s.startsWith("SocialAccessService#"));
    // `new Set`: hai lời gọi cổng trong CÙNG một method ⇒ key trùng ⇒ `toEqual` đỏ với thông điệp
    // lạc đề (không phải vì bất biến bị phá). `flagged` vốn là tập duy nhất.
    for (const site of new Set(gateSites)) {
      const key = ATTACH_GATE_SITE_TO_KEY[site];
      // Dời cổng sang một method khác ⇒ site lạ ⇒ ĐỎ ở đây, không phải xanh im lặng.
      expect(
        key,
        `call-site cổng đính kèm lạ: ${site} — cập nhật ATTACH_GATE_SITE_TO_KEY`,
      ).toBeTruthy();
      payloadDependent.push(key);
    }
    expect(
      gateSites.length,
      "phải có call-site cổng đính kèm thật (AST không hỏng)",
    ).toBeGreaterThan(0);
    payloadDependent.sort();

    // Neo chống-xanh-rỗng ở CẢ HAI vế (plan §7 mục 3b): hai tập rỗng cũng `toEqual` nhau.
    expect(flagged.length, "phải có route tier1IsFloor thật").toBeGreaterThan(0);
    expect(payloadDependent.length, "phải có route cặp-theo-payload thật").toBeGreaterThan(0);
    expect(flagged).toEqual(payloadDependent);
  });

  /**
   * S16-SOCIAL-ATTGATE-1 · S-1 — cổng phải được NỐI, không chỉ được KHAI.
   *
   * Đường SỬA phải truyền một giá trị ĐỌC TỪ BIẾN (`attach.gate` — thứ do `resolveAttachNewGate`
   * dựng ra), KHÔNG phải một object literal hay một hằng: cả hai cái sau đều là «cổng mở cứng» mà
   * ba lưới tĩnh còn lại đọc y hệt mã đúng.
   */
  it("S-1 — đối số `gate` của `syncLinksTx`: TẠO dùng hằng, SỬA dùng giá trị đã resolve", () => {
    const shapes = syncLinksGateArgShapes();

    // Neo chống-xanh-rỗng: AST hỏng / đổi tên hàm ⇒ mảng rỗng ⇒ mọi assert dưới thành vacuous.
    expect(shapes.length, "phải thấy ĐỦ 4 call-site `syncLinksTx`").toBe(4);
    expect(shapes.every((x) => x.shape !== "MISSING"), "call-site thiếu đối số `gate`").toBe(true);
    // S16-SOCIAL-ATTDEBT-1 (plan §7 B5) — ĐO ĐƯỢC, không phải lời khai: ca này đọc `arguments[6]`,
    // nên một đối số thứ 8 ở index 7 KHÔNG bị bắt bởi bất kỳ vế nào ở trên. Dòng dưới đóng lỗ đó.
    // (Plan gốc định ghi vào docblock `syncLinksTx` rằng «thêm tham số làm vỡ ca S-1» — câu đó SAI.)
    expect(
      shapes.every((x) => x.argCount === 7),
      "`syncLinksTx` phải nhận ĐÚNG 7 đối số — ngữ cảnh DENY đi bằng ngoại lệ, KHÔNG bằng tham số thứ 8",
    ).toBe(true);

    const bySite = new Map(shapes.map((x) => [x.site, x]));
    for (const site of ["SocialPostsService#create", "SocialCommentsService#create"]) {
      expect(bySite.get(site)?.shape, `${site} phải truyền HẰNG đường TẠO`).toBe("identifier");
      expect(bySite.get(site)?.text).toBe("ATTACH_GATE_ENFORCED_BY_TIER1");
    }
    for (const site of ["SocialPostsService#update", "SocialCommentsService#update"]) {
      // 🔴 `object-literal` ở đây = cổng bị vô hiệu hoá tại chỗ. Đó là mutant mà ca này sinh ra để bắt.
      expect(
        bySite.get(site)?.shape,
        `${site} phải truyền giá trị ĐÃ RESOLVE (attach.gate), không phải literal/hằng`,
      ).toBe("property-access");
      expect(bySite.get(site)?.text).toBe("attach.gate");
    }
  });

  /**
   * S16-SOCIAL-ATTDEBT-1 (F1) — **G-TABLE**: «route nào được PRE-RESOLVE cổng gắn tệp» phải BẰNG
   * «method nào TIÊU THỤ cổng». Hai nguồn độc lập: bảng hằng `ATTACH_GATE_ROUTE_TARGET` (mã sản
   * phẩm) và call-site AST của `resolveAttachNewGate`.
   *
   * 🔴 Lệch một chiều nào cũng là lỗ THẬT: thiếu trong bảng ⇒ ảnh chụp `resolved:false` ⇒ cổng DENY
   * cả vai ĐỦ quyền (403 oan, route chết); thừa trong bảng ⇒ `resolveActor` hỏi thêm một cặp quyền
   * cho một route không dùng tới (chi phí trên đường nóng + một cặp quyền không ai gác).
   */
  it("G-TABLE — tập route pre-resolve cổng đính kèm == tập route có call-site cổng", () => {
    const fromTable = Object.keys(ATTACH_GATE_ROUTE_TARGET).sort();
    const fromSites = [
      ...new Set(
        attachGateCallSites()
          .filter((x) => !x.startsWith("SocialAccessService#"))
          .map((x) => ATTACH_GATE_SITE_TO_KEY[x]),
      ),
    ]
      .filter((x): x is string => Boolean(x))
      .sort();

    // Neo chống-xanh-rỗng ở CẢ HAI vế — hai tập rỗng cũng `toEqual` nhau.
    expect(fromTable.length, "bảng ATTACH_GATE_ROUTE_TARGET không được rỗng").toBeGreaterThan(0);
    expect(fromSites.length, "phải có call-site cổng đính kèm thật").toBeGreaterThan(0);
    expect(fromSites).toEqual(fromTable);
  });

  /**
   * S16-SOCIAL-ATTDEBT-1 (C-5) — **G-ALERT**: mọi method tiêu thụ cổng phải BÁO alert cho lượt DENY,
   * và phải báo ĐÚNG CÁCH.
   *
   * 🔴 Ba vế dưới đây tồn tại vì một lưới «tập method == tập method» thuần vẫn XANH khi: quên
   * `throw` (403 hoá 200), truyền một lỗi bịa thay vì binding của `catch`, hoặc dời lời gọi vào
   * TRONG callback `withTenant` (⇒ `emit()` mở tx lồng tx ⇒ TREO IM LẶNG). Vế (iii) là lưới TĨNH
   * duy nhất mã hoá được bất biến đó.
   */
  it("G-ALERT — method có cổng đính kèm phải báo alert: đúng binding, có rethrow, NGOÀI withTenant", () => {
    const gateSites = [
      ...new Set(attachGateCallSites().filter((x) => !x.startsWith("SocialAccessService#"))),
    ].sort();
    const reports = attachGateReportSites();
    const reportSites = [...new Set(reports.map((r) => r.site))].sort();

    expect(gateSites.length, "phải có call-site cổng đính kèm thật").toBeGreaterThan(0);
    expect(reports.length, "phải có call-site reporter thật (AST không hỏng)").toBeGreaterThan(0);
    expect(reportSites, "method có cổng đính kèm nhưng KHÔNG báo alert").toEqual(gateSites);

    for (const r of reports) {
      expect(r.argIsCatchBinding, `${r.site}: đối số 1 phải là CHÍNH binding của catch`).toBe(true);
      expect(
        r.rethrowsSameBinding,
        `${r.site}: khối catch phải ném LẠI đúng binding đó — thiếu ⇒ 403 hoá 200`,
      ).toBe(true);
      expect(
        r.insideWithTenant,
        `${r.site}: lời gọi reporter KHÔNG được nằm trong callback withTenant (tx lồng tx = treo im lặng)`,
      ).toBe(false);
    }
  });

  it("D17 — chỉ hai service của route floor mới đụng cờ cặp-KHÁC `canManageNews`", () => {
    const classes = [...classesReferencingManageNews()].sort();
    // `SocialAccessService` dựng cờ (resolveActor) nên đương nhiên có mặt; hai service kia TIÊU THỤ
    // nó, và chúng phải là ĐÚNG hai service phục vụ `002`/`006`.
    // `SocialAccessService` KHÔNG có mặt và đó là ĐÚNG: nó DỰNG cờ (gán trong object literal của
    // `resolveActor`), không ĐỌC nó qua `x.canManageNews`. Tập dưới đây vì vậy là tập người TIÊU THỤ
    // cờ.
    //
    // 🔴 **S16-SOCIAL-BE-2B-1 — tập này rút từ HAI xuống MỘT, có chủ đích.** `SocialPostsService`
    // không còn đọc cờ nữa: cổng theo-loại-bài của `002` chuyển sang
    // `SocialAccessService.assertCreatablePostType`, hàm ĐỌC `SOCIAL_POST_TYPE_PAIRS` thay vì một
    // chuỗi `if` hard-code. Lý do đổi nằm ở docblock hàm đó, tóm tắt: trước WO này bảng cặp-theo-
    // loại **không có call-site runtime nào** — chỉ ca `D17` ngay trên đọc nó — nên bảng và lưới là
    // hai thứ rời nhau, và thêm một loại bài mà quên nhánh `if` thì loại đó tạo được KHÔNG QUA CẶP
    // NÀO trong khi census vẫn XANH.
    //
    // `006` (`SocialPostsModerationService`) vẫn tiêu thụ cờ: nó gác theo TRƯỜNG được sửa
    // (`SOCIAL_MODERATION_FIELD_PAIRS`), không theo loại bài — bảng khác, cơ chế khác.
    expect(classes).toEqual(["SocialPostsModerationService"]);
  });

  it("cả 14 cặp feed-* đều is_sensitive=false trong bảng hằng (mirror catalog 0578)", () => {
    // Hàng rào chống "vá" wildcard `*:*` bằng cách bật cờ ở TypeScript: cờ ở đây phải mirror catalog
    // DB, và đổi catalog là ĐỔI SPEC (phá SOC-DEC-004) — việc của một WO có chữ ký owner.
    const sensitive = Object.entries(SOCIAL_ROUTE_PAIRS)
      .filter(([, p]) => p.isSensitive)
      .map(([k]) => k);
    expect(sensitive).toEqual([]);
  });

  /**
   * ⟲ **S16-SOCIAL-BE-1B đổi khẳng định này** (trước: tập `false` RỖNG cho 19 route Nhóm A).
   *
   * Seed `0578` cấp mọi cặp `feed-*` ở scope Company cho 4 vai canonical, TRỪ ĐÚNG MỘT dòng:
   * `['manager','view','feed-report','Department']` — cặp của route `028`. BE-1B mở đúng route đó,
   * nên tập `companyFloor:false` nay có ĐÚNG MỘT phần tử.
   *
   * `toEqual` một danh sách ĐÓNG chứ không `toBeLessThanOrEqual(1)`: tắt sàn Company là thao tác
   * nguy hiểm nhất của bảng hằng này (nó mở cho MỌI scope resolve được, kể cả `Own`/`Team`), nên mỗi
   * lần thêm một route như vậy phải là một sửa đổi CÓ CHỦ ĐÍCH đi qua FULL gate.
   */
  it("companyFloor tắt ở ĐÚNG MỘT route — `reportsList` (028), không hơn", () => {
    const notFloored = Object.entries(SOCIAL_ROUTE_PAIRS)
      .filter(([, p]) => !p.companyFloor)
      .map(([k]) => k)
      .sort();
    expect(notFloored).toEqual(["reportsList"]);
  });

  /**
   * C2-c (plan §5.1) — **mọi route tắt sàn Company PHẢI khai `dataScope`**.
   *
   * Đây là vế máy-kiểm-được của lời hứa "route này có ép phạm vi hẹp TRONG SQL". Không có nó, tắt
   * `companyFloor` là một thao tác im lặng: decorator vẫn trông y hệt, census vẫn xanh, và cái duy
   * nhất còn gác phạm vi là một `if` nào đó trong repository mà không cổng nào nhìn thấy.
   *
   * Vế NGƯỢC LẠI cũng assert: route CÓ sàn Company thì `dataScope` phải `undefined` — khai một phạm
   * vi hẹp bên cạnh một sàn rộng là hai câu trả lời cho cùng một câu hỏi, và người đọc sau sẽ tin
   * câu sai.
   */
  it("C2-c — companyFloor:false ⇒ dataScope xác định; companyFloor:true ⇒ dataScope undefined", () => {
    const missing: string[] = [];
    const spurious: string[] = [];
    for (const [key, p] of Object.entries(SOCIAL_ROUTE_PAIRS)) {
      if (!p.companyFloor && p.dataScope === undefined) missing.push(key);
      if (p.companyFloor && p.dataScope !== undefined) spurious.push(key);
    }
    expect(missing, "route tắt sàn Company mà KHÔNG khai dataScope").toEqual([]);
    expect(spurious, "route có sàn Company mà vẫn khai dataScope").toEqual([]);
    // Neo chống-xanh-rỗng: phải tồn tại ÍT NHẤT một route tắt sàn, nếu không hai assert trên là
    // hai vòng lặp chạy trên tập rỗng.
    expect(Object.values(SOCIAL_ROUTE_PAIRS).filter((p) => !p.companyFloor).length).toBeGreaterThan(
      0,
    );
    expect(SOCIAL_ROUTE_PAIRS.reportsList.dataScope).toBe("Department");
  });

  /**
   * C2-b (plan §5.1) — KHÔNG route nào của Nhóm B đặt `tier1IsFloor`.
   *
   * API-19 §5.1 không có route nào của `020..029` rẽ cặp quyền theo NỘI DUNG request (khác `002`
   * theo `type` và `006` theo TRƯỜNG). Assert tập RỖNG chứ không bỏ qua: nếu một ngày ai đó đặt cờ
   * đó ở đây mà không kèm bảng cặp-theo-payload, đẳng thức D17 ở trên sẽ đỏ — ca này chỉ nói ĐỎ ở
   * đâu.
   */
  it("C2-b — 10 route Nhóm B không route nào tier1IsFloor", () => {
    const groupB = [
      "newsList",
      "postAck",
      "postAcksList",
      "search",
      "tagsList",
      "profilePosts",
      "birthdays",
      "reportCreate",
      "reportsList",
      "reportResolve",
    ] as const;
    expect(groupB.length, "danh sách Nhóm B phải đủ 10 route").toBe(10);
    const flagged = groupB.filter((k) => SOCIAL_ROUTE_PAIRS[k].tier1IsFloor);
    expect(flagged).toEqual([]);
  });
});
