import {
  applyRules,
  POST_EDITABLE_FIELDS,
  usableRules,
  type BulkEditField,
  type BulkEditRequest,
  type BulkEditResult,
  type ContentChange,
  type FieldChange,
  type ReplaceRule,
} from "./bulk-edit";
import { contentLabel, getManyContents, updateContent } from "./repo/content-repo";
import { LOCAL_EDITABLE_STATUSES, listPosts, updatePendingPostText } from "./repo/post-repo";
import type { Content, ContentInput, Post } from "./types";

/**
 * Sua hang loat: doi cung mot doan van ban trong nhieu noi dung mot luc.
 *
 * Duong XEM TRUOC va duong AP DUNG di qua cung mot ham dung ke hoach (`buildPlan`), nen thu
 * nguoi dung duyet o buoc xem truoc dung la thu duoc ghi xuong - khong co duong thu hai.
 *
 * Vi sao dong den ca bang `posts`: mot noi dung khi len lich se duoc CHEP sang tung luot dang.
 * Sua moi thu vien thi cac bai da xep lich van mang van ban cu va van len Facebook nhu vay - dung
 * kieu hong im lang. Nen sua hang loat co the cham ca cac bai CHUA gui di (`draft`/`queued`).
 * Bai da nam tren Facebook hoac dang duoc gui thi khong dong vao, chi bao lai bang canh bao.
 */

/** Van ban moi cho tung o. `null` = xoa trang o do. */
type TextPatch = Partial<Record<BulkEditField, string | null>>;

interface PostPatch {
  postId: number;
  patch: { message?: string; title?: string | null; link?: string | null };
}

interface ContentPlan {
  content: Content;
  change: ContentChange;
  contentPatch: Partial<ContentInput>;
  postPatches: PostPatch[];
}

interface Plan {
  scannedContents: number;
  items: ContentPlan[];
  warnings: string[];
  totalHits: number;
  postCount: number;
}

const LABEL_MAX = 120;

/** Nhan ngan de nhac trong canh bao, khong lam tran man hinh. */
function shortLabel(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > 40 ? `${trimmed.slice(0, 40)}…` : trimmed;
}

function readField(record: Content | Post, field: BulkEditField): string {
  if (field === "message") return record.message;
  if (field === "title") return record.title ?? "";
  if (field === "link") return record.link ?? "";
  return "label" in record ? (record.label ?? "") : "";
}

/**
 * Link sau khi thay phai con la mot dia chi hop le - dung chuan ma API noi dung dang dung.
 * Thay hong mot link thi ca bai se gay khi gui len Facebook, nen tha bo qua o do con hon.
 */
function isUsableLink(value: string): boolean {
  if (value === "") return true;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function toContentPatch(patch: TextPatch): Partial<ContentInput> {
  return {
    ...(patch.message !== undefined ? { message: patch.message ?? "" } : {}),
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.link !== undefined ? { link: patch.link } : {}),
    ...(patch.label !== undefined ? { label: patch.label } : {}),
  };
}

function toPostPatch(patch: TextPatch): PostPatch["patch"] {
  return {
    ...(patch.message !== undefined ? { message: patch.message ?? "" } : {}),
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.link !== undefined ? { link: patch.link } : {}),
  };
}

interface PlannedFields {
  changes: FieldChange[];
  patch: TextPatch;
  warnings: string[];
}

function planFields(
  record: Content | Post,
  fields: BulkEditField[],
  rules: ReplaceRule[],
  caseSensitive: boolean,
): PlannedFields {
  const changes: FieldChange[] = [];
  const patch: TextPatch = {};
  const warnings: string[] = [];

  for (const field of fields) {
    const before = readField(record, field);
    if (before === "") continue;

    const { text: after, hits } = applyRules(before, rules, caseSensitive);
    if (hits === 0 || after === before) continue;

    if (field === "link" && !isUsableLink(after)) {
      warnings.push(
        `Bỏ qua link của "${shortLabel(before)}": sau khi thay không còn là link hợp lệ.`,
      );
      continue;
    }
    if (field === "label" && after.length > LABEL_MAX) {
      warnings.push(
        `Bỏ qua nhãn của "${shortLabel(before)}": sau khi thay dài quá ${LABEL_MAX} ký tự.`,
      );
      continue;
    }

    changes.push({ field, before, after, hits });
    // `message` luon la chuoi; cac o con lai de trong thi luu null.
    patch[field] = field === "message" ? after : after || null;
  }

  return { changes, patch, warnings };
}

function buildPlan(request: BulkEditRequest): Plan {
  const rules = usableRules(request.rules);
  const contents = getManyContents(request.contentIds);
  const warnings: string[] = [];
  const items: ContentPlan[] = [];

  if (contents.length < request.contentIds.length) {
    warnings.push("Một số nội dung đã chọn không còn trong thư viện và bị bỏ qua.");
  }
  if (rules.length === 0) {
    return { scannedContents: contents.length, items: [], warnings, totalHits: 0, postCount: 0 };
  }

  const postFields = request.fields.filter((field) => POST_EDITABLE_FIELDS.includes(field));
  let lockedPosts = 0;
  let untouchedPendingPosts = 0;
  let totalHits = 0;
  let postCount = 0;

  for (const content of contents) {
    const planned = planFields(content, request.fields, rules, request.caseSensitive);
    warnings.push(...planned.warnings);

    const postPatches: PostPatch[] = [];
    if (postFields.length > 0) {
      for (const post of listPosts({ contentId: content.id })) {
        const plannedPost = planFields(post, postFields, rules, request.caseSensitive);
        if (plannedPost.changes.length === 0) continue;

        // `fbPostId !== null` la dau hieu Facebook DA nhan bai — ke ca khi trang thai con noi
        // khac (bai bao `failed` sau khi Facebook da tao xong bai). Sua ban trong CSDL luc do chi
        // lam giao dien noi mot dang con Facebook dang mot neo.
        if (!LOCAL_EDITABLE_STATUSES.includes(post.status) || post.fbPostId !== null) {
          lockedPosts += 1;
          continue;
        }
        if (!request.includePendingPosts) {
          untouchedPendingPosts += 1;
          continue;
        }

        postPatches.push({ postId: post.id, patch: toPostPatch(plannedPost.patch) });
      }
    }

    if (planned.changes.length === 0 && postPatches.length === 0) continue;

    const hits = planned.changes.reduce((sum, change) => sum + change.hits, 0);
    totalHits += hits;
    postCount += postPatches.length;

    items.push({
      content,
      change: {
        contentId: content.id,
        label: contentLabel(content),
        hits,
        changes: planned.changes,
        pendingPosts: postPatches.length,
      },
      contentPatch: toContentPatch(planned.patch),
      postPatches,
    });
  }

  if (untouchedPendingPosts > 0) {
    warnings.push(
      `${untouchedPendingPosts} bài đã xếp lịch nhưng chưa gửi đi cũng chứa đoạn cần thay. ` +
        'Bật "Sửa cả bài đã xếp lịch chưa gửi" nếu muốn đổi luôn cả chúng.',
    );
  }
  if (lockedPosts > 0) {
    warnings.push(
      `${lockedPosts} bài đã được Facebook nhận (đã đăng hoặc đang nằm trong lịch của Facebook) ` +
        "nên không sửa được từ đây — muốn đổi thì phải xoá bài rồi xếp lịch lại.",
    );
  }

  return { scannedContents: contents.length, items, warnings, totalHits, postCount };
}

function toResult(plan: Plan, applied: boolean, changedPosts: number): BulkEditResult {
  return {
    applied,
    scannedContents: plan.scannedContents,
    changedContents: plan.items.map((item) => item.change),
    totalHits: plan.totalHits,
    changedPosts,
    warnings: plan.warnings,
  };
}

/** Xem truoc: khong ghi gi xuong CSDL. */
export function previewBulkEdit(request: BulkEditRequest): BulkEditResult {
  const plan = buildPlan(request);
  return toResult(plan, false, plan.postCount);
}

/** Ap dung that. Tra ve dung nhung gi da ghi duoc. */
export function applyBulkEdit(request: BulkEditRequest): BulkEditResult {
  const plan = buildPlan(request);
  let changedPosts = 0;

  for (const item of plan.items) {
    if (Object.keys(item.contentPatch).length > 0) {
      updateContent(item.content.id, item.contentPatch);
    }
    for (const { postId, patch } of item.postPatches) {
      // Bai co the vua duoc worker gianh lay giua luc dung ke hoach va luc ghi: cau UPDATE tu
      // kiem tra trang thai va tra ve false. Dem theo so ghi THAT SU thanh cong.
      if (updatePendingPostText(postId, patch)) changedPosts += 1;
    }
  }

  const missed = plan.postCount - changedPosts;
  if (missed > 0) {
    plan.warnings.push(
      `${missed} bài vừa được gửi đi trong lúc đang sửa nên giữ nguyên nội dung cũ.`,
    );
  }

  return toResult(plan, true, changedPosts);
}
