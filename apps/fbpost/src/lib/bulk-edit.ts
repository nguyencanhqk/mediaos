/**
 * Bo may thay chuoi hang loat.
 *
 * Thuan tuy (khong dung CSDL, khong dung Node API) nen ca server lan trinh duyet deu nap duoc,
 * va duong XEM TRUOC voi duong AP DUNG THAT chay CUNG mot ham - hai buoc khong the lech nhau.
 *
 * Ba quyet dinh dang chu y:
 *
 * 1. Tim theo VAN BAN THUAN, khong phai regex. Nguoi dung go "(0909) 123" hay "$" thi do la ky tu
 *    that, khong phai cu phap. Dung `split`/`join` hay bieu thuc chinh quy deu de dinh bay: chuoi
 *    thay the cua `String.replace` coi `$&`, `$1`... la lenh chen lai.
 *
 * 2. QUET MOT LUOT, khong xep tang. Thay lan luot tung cap se lam ket qua cua cap truoc thanh
 *    nguyen lieu cho cap sau: doi A→B roi B→C se bien A thanh C, va doi cho A↔B thi ca hai thanh
 *    mot. Quet mot luot: doan da thay xong duoc bo qua ngay, khong bi cham lai.
 *
 * 3. Trung vi tri thi CHUOI TIM DAI HON THANG. Nguoi dung khai "Hà Nội" va "Hà" cung luc thi cai
 *    cu the hon phai duoc uu tien, bat ke thu tu go vao.
 */

/** Mot cap thay the: tim `find`, thay bang `replace`. */
export interface ReplaceRule {
  find: string;
  replace: string;
}

/** Cac o van ban co the sua hang loat. */
export const BULK_EDIT_FIELDS = ["message", "title", "link", "label"] as const;

export type BulkEditField = (typeof BULK_EDIT_FIELDS)[number];

export const BULK_EDIT_FIELD_LABELS: Record<BulkEditField, string> = {
  message: "Nội dung / chú thích",
  title: "Tiêu đề video",
  link: "Link đính kèm",
  label: "Nhãn nội dung",
};

/** Cac o co mat ca trong thu vien noi dung lan trong bai da xep lich. */
export const POST_EDITABLE_FIELDS: BulkEditField[] = ["message", "title", "link"];

export interface ReplaceOutcome {
  text: string;
  /** So lan thuc su thay duoc. 0 nghia la o van ban nay khong doi. */
  hits: number;
}

/** Bo cac cap rong - chuoi tim rong se khop o moi vi tri, khong co y nghia gi. */
export function usableRules(rules: ReplaceRule[]): ReplaceRule[] {
  return rules.filter((rule) => rule.find !== "");
}

/**
 * Thay moi cap trong `rules` tren `text` bang mot luot quet duy nhat.
 * Tra ve van ban moi kem so lan da thay.
 */
export function applyRules(
  text: string,
  rules: ReplaceRule[],
  caseSensitive: boolean,
): ReplaceOutcome {
  const active = usableRules(rules);
  if (active.length === 0 || text === "") return { text, hits: 0 };

  // So sanh tren ban thuong hoa nhung CAT tu ban goc, nho vay phan khong bi thay giu nguyen
  // chu hoa chu thuong. `toLowerCase` co the doi do dai chuoi o vai ngon ngu (vi du "İ" cua
  // tieng Tho), the la vi tri hai ban lech nhau - nen chi dung khi do dai con khop. O van ban
  // hiem hoi do se duoc so khop PHAN BIET hoa/thuong: thay it hon chu khong bao gio thay nham,
  // va nguoi dung van nhin thay ket qua that o buoc xem truoc.
  const foldable = !caseSensitive && text.toLowerCase().length === text.length;
  const fold = (value: string) => (foldable ? value.toLowerCase() : value);

  const haystack = fold(text);
  const needles = active.map((rule) => fold(rule.find));

  let out = "";
  let cursor = 0;
  let hits = 0;

  while (cursor < text.length) {
    let best = -1;
    for (let i = 0; i < needles.length; i += 1) {
      if (needles[i].length === 0) continue;
      if (!haystack.startsWith(needles[i], cursor)) continue;
      if (best === -1 || needles[i].length > needles[best].length) best = i;
    }

    if (best === -1) {
      out += text[cursor];
      cursor += 1;
      continue;
    }

    out += active[best].replace;
    cursor += needles[best].length;
    hits += 1;
  }

  return { text: out, hits };
}

/** Dem so lan cac cap se khop, khong doi gi. */
export function countHits(text: string, rules: ReplaceRule[], caseSensitive: boolean): number {
  return applyRules(text, rules, caseSensitive).hits;
}

/* --- Hop dong giua giao dien va API. Nam o day vi day la module THUAN, ca hai ben deu nap duoc. */

/** Tran an toan: doi ca nghin bai trong mot cu bam thi khong ai kiem lai noi. */
export const MAX_BULK_CONTENTS = 500;
export const MAX_BULK_RULES = 20;

export interface BulkEditRequest {
  contentIds: number[];
  rules: ReplaceRule[];
  fields: BulkEditField[];
  caseSensitive: boolean;
  /** Sua ca cac bai da xep lich nhung chua gui di, sinh ra tu cac noi dung nay. */
  includePendingPosts: boolean;
}

export interface FieldChange {
  field: BulkEditField;
  before: string;
  after: string;
  hits: number;
}

export interface ContentChange {
  contentId: number;
  label: string;
  hits: number;
  changes: FieldChange[];
  /** So bai da xep lich (chua gui) se doi theo noi dung nay. */
  pendingPosts: number;
}

export interface BulkEditResult {
  /** false = moi chi xem truoc, CSDL chua doi gi. */
  applied: boolean;
  scannedContents: number;
  changedContents: ContentChange[];
  totalHits: number;
  /** So bai da xep lich se doi (xem truoc) hoac da doi that (ap dung). */
  changedPosts: number;
  warnings: string[];
}
