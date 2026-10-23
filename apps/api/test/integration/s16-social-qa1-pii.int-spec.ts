/**
 * S16-SOCIAL-QA-1 (L7) — DỮ LIỆU CÁ NHÂN: sinh nhật (026) + danh tính cử tri của bình chọn
 * (plan `docs/plans/S16-SOCIAL-QA-1.md` §4-L7, D9, Bảng 3 các dòng QA1-P).
 *
 *   P-B0  tự-kiểm: hàm ngày + bộ dò rò rỉ            P-V0  tự-kiểm bộ dò danh tính / tập khoá
 *   P-B1  `week` · `month`: đúng 5 khoá, không năm   P-V1  poll ẩn danh — mọi bề mặt người khác đọc
 *   P-B2  cửa sổ `week`: +3 có mặt, +8 vắng          P-V2  poll KHÔNG ẩn danh, người đọc là quản trị
 *   P-B3  cờ ẩn: chưa có hàng / `true` / `false`     P-V3  041 · 042 · 044 không phát sự kiện, không
 *   P-B4  `terminated` ⇒ vắng                              ghi vết kiểm toán mang danh tính cử tri
 *   P-B5  tài khoản bị khoá — ghim hiện trạng
 *
 * Luật đo: chuỗi hoá TOÀN thân response rồi mới dò. Trước khi dò NĂM phải bỏ UUID và mốc ISO (đoạn
 * `-1991-` của một UUID và `meta.timestamp` khớp nhầm); nhưng năm sinh của fixture được dò thêm một
 * lượt trên thân CHỈ bỏ UUID — để một ngày sinh lọt ra dưới dạng mốc ISO không bị chính bước làm sạch
 * che mất. Mọi ca «không lộ» đứng cạnh một vế tự-kiểm: cùng bộ dò áp lên nơi dữ liệu chắc chắn có mặt
 * PHẢI tìm thấy.
 *
 * Ngày sinh fixture tính theo giờ CỤC BỘ của tiến trình (API và spec chạy chung một tiến trình);
 * không bao giờ rơi vào 29/02.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { RealtimeEmitterService } from "../../src/realtime/realtime-emitter.service";
import { hasDb } from "../helpers/integration-db";
import {
  EMPLOYEE_FEED_PAIRS,
  addComment,
  bootQa1World,
  findIdentity,
  pollPost,
  sharePost,
  stripVolatile,
  votePoll,
  type Json,
  type Qa1Actor,
  type Qa1World,
} from "../helpers/social-qa1-kit";

const hasLaneDb = hasDb && !!process.env.LANE_DB;
const BOOT_TIMEOUT_MS = 90_000;

// ─── Hàm thuần: ngày sinh nhật theo giờ cục bộ ────────────────────────────────────────────────────

interface DayMonth {
  day: number;
  month: number;
}

/** Ngày + tháng của `today + plus` ngày, theo giờ CỤC BỘ. */
function birthdayAt(today: Date, plus: number): DayMonth {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + plus);
  return { day: d.getDate(), month: d.getMonth() + 1 };
}

const isLeapDay = (b: DayMonth): boolean => b.month === 2 && b.day === 29;

/**
 * Hai mốc của ca cửa sổ tuần: «trong» (hôm nay + 3) và «ngoài» (hôm nay + 8). Một trong hai rơi vào
 * 29/02 thì dịch CẢ HAI thêm một ngày (+4 vẫn trong cửa sổ 7 ngày, +9 vẫn ngoài).
 */
function weekMarks(today: Date): { inside: DayMonth; outside: DayMonth; shift: 0 | 1 } {
  const shift = isLeapDay(birthdayAt(today, 3)) || isLeapDay(birthdayAt(today, 8)) ? 1 : 0;
  return { inside: birthdayAt(today, 3 + shift), outside: birthdayAt(today, 8 + shift), shift };
}

/** Ngày của THÁNG hiện tại dùng cho `range=month` (29/02 ⇒ 28/02). */
function monthMark(today: Date): DayMonth {
  const now = birthdayAt(today, 0);
  return isLeapDay(now) ? { day: 28, month: 2 } : now;
}

const pad = (n: number): string => String(n).padStart(2, "0");
const dobOf = (year: number, b: DayMonth): string => `${year}-${pad(b.month)}-${pad(b.day)}`;

// ─── Bộ dò ────────────────────────────────────────────────────────────────────────────────────────

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const YEAR_RE = /\b(19|20)\d{2}\b/;
const BIRTHDAY_KEYS = ["avatar", "day", "employeeId", "fullName", "month"];
const DOB_KEYS = new Set(["dateofbirth", "date_of_birth", "dob", "birthdate", "userid", "user_id"]);
const VOTER_KEYS = new Set(["voters", "voterids", "voteruserids", "votedby", "userid", "user_id"]);

/** Mọi tên khoá (đã hạ chữ thường) ở mọi độ sâu. */
function allKeys(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => allKeys(v, out));
  else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Json)) {
      out.add(k.toLowerCase());
      allKeys(v, out);
    }
  }
  return out;
}

interface BirthdayPerson {
  userId: string;
  email: string;
  dob: string;
}

/** Danh sách dấu hiệu rò ngày sinh trong MỘT thân response; `[]` = sạch. */
function birthdayLeaks(body: unknown, people: readonly BirthdayPerson[]): string[] {
  const leaks: string[] = [];
  const cleaned = JSON.stringify(stripVolatile(body, { uuids: true }));
  const year = cleaned.match(YEAR_RE);
  if (year) leaks.push(`năm:${year[0]}`);
  const noUuid = JSON.stringify(body).replace(UUID_RE, "<uuid>");
  for (const p of people) {
    const y = p.dob.slice(0, 4);
    if (noUuid.includes(p.dob)) leaks.push(`ngày đầy đủ:${p.dob}`);
    if (new RegExp(`\\b${y}\\b`).test(noUuid)) leaks.push(`năm sinh fixture:${y}`);
  }
  for (const key of allKeys(body)) if (DOB_KEYS.has(key)) leaks.push(`khoá:${key}`);
  leaks.push(
    ...findIdentity(
      body,
      people.flatMap((p) => [p.userId, p.email]),
    ),
  );
  return leaks;
}

/** Danh sách dấu hiệu lộ danh tính cử tri trong một thân; `[]` = sạch. */
function voterLeaks(body: unknown, voter: Qa1Actor): string[] {
  const leaks = findIdentity(body, [
    voter.userId,
    voter.employeeId ?? "",
    voter.email,
    voter.fullName,
  ]);
  for (const key of allKeys(body)) if (VOTER_KEYS.has(key)) leaks.push(`khoá:${key}`);
  return leaks;
}

describe.skipIf(!hasLaneDb)("S16-SOCIAL-QA-1 · L7 · dữ liệu cá nhân", () => {
  let w: Qa1World;
  /** Người đọc thường — 7 cặp của nhân viên. */
  let reader: Qa1Actor;
  /** Tác giả các bài bình chọn. */
  let host: Qa1Actor;

  const dataOf = (body: unknown): Json => ((body as { data?: unknown }).data ?? {}) as Json;

  beforeAll(async () => {
    w = await bootQa1World("qa1pii");
    reader = await w.actor(w.A, "reader", { pairs: EMPLOYEE_FEED_PAIRS });
    host = await w.actor(w.A, "host", { pairs: EMPLOYEE_FEED_PAIRS });
  }, BOOT_TIMEOUT_MS);

  afterAll(async () => {
    await w?.close();
  });

  // ══════════════ Sinh nhật (026) ══════════════

  describe("sinh nhật", () => {
    const YEAR_A = 1973;
    const YEAR_B = 1968;
    const today = new Date();
    const marks = weekMarks(today);
    const inMonth = monthMark(today);

    let pIn: Qa1Actor;
    let pOut: Qa1Actor;
    let pMonth: Qa1Actor;
    let pForeign: Qa1Actor;
    let people: BirthdayPerson[];

    interface Row {
      employeeId: string;
      fullName: string | null;
      avatar: string | null;
      day: number;
      month: number;
    }

    const birthdays = async (
      range: "today" | "week" | "month",
    ): Promise<{ body: unknown; rows: Row[] }> => {
      const res = await w.get(reader.token, `/social/birthdays?range=${range}`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return { body: res.body, rows: (dataOf(res.body).data ?? []) as Row[] };
    };
    const rowOf = (rows: readonly Row[], who: Qa1Actor): Row | undefined =>
      rows.find((r) => r.employeeId === who.employeeId);
    const person = (a: Qa1Actor, dob: string): BirthdayPerson => ({
      userId: a.userId,
      email: a.email,
      dob,
    });

    beforeAll(async () => {
      const dobIn = dobOf(YEAR_B, marks.inside);
      const dobOut = dobOf(YEAR_B, marks.outside);
      const dobMonth = dobOf(YEAR_A, inMonth);
      pIn = await w.actor(w.A, "bin", { pairs: EMPLOYEE_FEED_PAIRS, profile: { dob: dobIn } });
      pOut = await w.actor(w.A, "bout", { pairs: EMPLOYEE_FEED_PAIRS, profile: { dob: dobOut } });
      pMonth = await w.actor(w.A, "bmonth", {
        pairs: EMPLOYEE_FEED_PAIRS,
        profile: { dob: dobMonth },
      });
      pForeign = await w.actor(w.B, "bforeign", {
        pairs: EMPLOYEE_FEED_PAIRS,
        profile: { dob: dobIn },
      });
      people = [
        person(pIn, dobIn),
        person(pOut, dobOut),
        person(pMonth, dobMonth),
        person(pForeign, dobIn),
      ];
    });

    it("QA1-P-B0 · tự-kiểm: hàm ngày đúng ở các mốc vắt năm / vắt tháng / năm nhuận, và bộ dò báo được rò rỉ", () => {
      // Mốc cố định (giờ cục bộ): 28/12 vắt năm · 29/01 vắt tháng · 26/02 năm nhuận và năm thường.
      expect(weekMarks(new Date(2026, 11, 28))).toEqual({
        inside: { day: 31, month: 12 },
        outside: { day: 5, month: 1 },
        shift: 0,
      });
      expect(weekMarks(new Date(2027, 0, 29))).toEqual({
        inside: { day: 1, month: 2 },
        outside: { day: 6, month: 2 },
        shift: 0,
      });
      expect(weekMarks(new Date(2028, 1, 26)), "năm nhuận: +3 là 29/02 ⇒ dịch cả hai").toEqual({
        inside: { day: 1, month: 3 },
        outside: { day: 6, month: 3 },
        shift: 1,
      });
      expect(weekMarks(new Date(2027, 1, 26)), "năm thường").toEqual({
        inside: { day: 1, month: 3 },
        outside: { day: 6, month: 3 },
        shift: 0,
      });
      expect(weekMarks(new Date(2028, 1, 21)), "năm nhuận: +8 là 29/02 ⇒ dịch cả hai").toEqual({
        inside: { day: 25, month: 2 },
        outside: { day: 1, month: 3 },
        shift: 1,
      });
      expect(monthMark(new Date(2028, 1, 29))).toEqual({ day: 28, month: 2 });
      expect(isLeapDay(marks.inside) || isLeapDay(marks.outside) || isLeapDay(inMonth)).toBe(false);
      expect(dobOf(YEAR_A, { day: 3, month: 4 })).toBe("1973-04-03");

      // Bộ dò: thân SẠCH (UUID có đoạn giống năm + mốc ISO của envelope) ⇒ không báo.
      const who: BirthdayPerson = {
        userId: "aaaaaaaa-1973-4aaa-8aaa-aaaaaaaaaaaa",
        email: "someone@qa1pii.test",
        dob: "1973-04-03",
      };
      const row = {
        employeeId: "bbbbbbbb-1991-4bbb-8bbb-bbbbbbbbbbbb",
        fullName: "Người Thử",
        avatar: null,
        day: 3,
        month: 4,
      };
      const clean = { data: { data: [row] }, meta: { timestamp: "2026-10-09T03:04:05.000Z" } };
      expect(birthdayLeaks(clean, [who])).toEqual([]);
      // Từng kiểu rò PHẢI bị bắt.
      const leak = (extra: Json): string[] =>
        birthdayLeaks({ data: { data: [{ ...row, ...extra }] } }, [who]);
      expect(leak({ dateOfBirth: "1973-04-03" })).toEqual(
        expect.arrayContaining(["năm:1973", "ngày đầy đủ:1973-04-03", "khoá:dateofbirth"]),
      );
      expect(leak({ born: "1973-04-03T00:00:00.000Z" }), "ngày sinh dưới dạng mốc ISO").toContain(
        "năm sinh fixture:1973",
      );
      expect(leak({ age: 53, birthYear: 1973 })).toContain("năm:1973");
      expect(leak({ userId: who.userId }).some((l) => l.startsWith("khoá:userid"))).toBe(true);
      expect(leak({ owner: who.userId }).length, "id tài khoản ở khoá bất kỳ").toBeGreaterThan(0);
      expect(leak({ contact: "SOMEONE@qa1pii.test" }).length).toBeGreaterThan(0);
    });

    it.each(["week", "month"] as const)(
      "QA1-P-B1 · range=%s: mỗi dòng đúng 5 khoá; toàn thân không năm sinh, không ngày đầy đủ, không id tài khoản",
      async (range) => {
        const { body, rows } = await birthdays(range);
        const target = range === "week" ? pIn : pMonth;
        const mark = range === "week" ? marks.inside : inMonth;

        // Neo dương: đúng người đó CÓ MẶT với đúng ngày / tháng.
        expect(rowOf(rows, target), `${target.label} phải có mặt ở range=${range}`).toEqual({
          employeeId: target.employeeId,
          fullName: target.fullName,
          avatar: null,
          day: mark.day,
          month: mark.month,
        });
        for (const r of rows) expect(Object.keys(r).sort()).toEqual(BIRTHDAY_KEYS);
        expect(birthdayLeaks(body, people), JSON.stringify(body)).toEqual([]);
        // Người của công ty khác có cùng ngày sinh không lọt vào.
        expect(rowOf(rows, pForeign)).toBeUndefined();
      },
    );

    it("QA1-P-B2 · range=week: ngày sinh hôm nay + 3 có mặt, hôm nay + 8 vắng; đổi về + 3 thì có mặt", async () => {
      const first = (await birthdays("week")).rows;
      expect(rowOf(first, pIn)).toMatchObject(marks.inside);
      expect(rowOf(first, pOut), "ngoài cửa sổ 7 ngày").toBeUndefined();

      // Đối chứng: CHÍNH người «+ 8» đổi ngày sinh về «+ 3» ⇒ có mặt (không phải vắng vì lý do khác).
      const upd = await w.direct.query(
        `UPDATE employee_profiles SET date_of_birth = $2 WHERE id = $1 AND company_id = $3`,
        [pOut.employeeId, dobOf(YEAR_B, marks.inside), w.A.companyId],
      );
      expect(upd.rowCount).toBe(1);
      const second = (await birthdays("week")).rows;
      expect(rowOf(second, pOut)).toMatchObject(marks.inside);
    });

    it("QA1-P-B3 · cờ hiển thị: chưa có hàng preference ⇒ có mặt; đặt `true` ⇒ có mặt; đặt `false` ⇒ vắng — trong CÙNG một response", async () => {
      const dob = dobOf(YEAR_B, marks.inside);
      // Vai `employee` thật: route đặt cờ (`PATCH /me/preferences`) có cặp quyền riêng ngoài nhóm feed.
      const shown = await w.actor(w.A, "bshown", { canonical: "employee", profile: { dob } });
      const hidden = await w.actor(w.A, "bhidden", { canonical: "employee", profile: { dob } });

      const none = await w.direct.query(
        `SELECT 1 FROM user_preferences WHERE company_id = $1 AND user_id = ANY($2::uuid[])`,
        [w.A.companyId, [pIn.userId, shown.userId, hidden.userId]],
      );
      expect(none.rowCount, "cả ba chưa có hàng preference nào").toBe(0);
      const before = (await birthdays("week")).rows;
      expect(rowOf(before, pIn), "chưa có hàng preference ⇒ có mặt").toBeDefined();
      expect(rowOf(before, shown)).toBeDefined();
      expect(rowOf(before, hidden), "trước khi ẩn: có mặt").toBeDefined();

      const setTrue = await w.patch(shown.token, "/me/preferences").send({ showBirthday: true });
      expect(setTrue.status, JSON.stringify(setTrue.body)).toBe(200);
      const setFalse = await w.patch(hidden.token, "/me/preferences").send({ showBirthday: false });
      expect(setFalse.status, JSON.stringify(setFalse.body)).toBe(200);
      const cols = await w.direct.query<{ user_id: string; show_birthday: boolean | null }>(
        `SELECT user_id, show_birthday FROM user_preferences
          WHERE company_id = $1 AND user_id = ANY($2::uuid[])`,
        [w.A.companyId, [pIn.userId, shown.userId, hidden.userId]],
      );
      expect(
        Object.fromEntries(cols.rows.map((r) => [r.user_id, r.show_birthday])),
        "cột thật: pIn vẫn không có hàng",
      ).toEqual({ [shown.userId]: true, [hidden.userId]: false });

      const after = (await birthdays("week")).rows;
      expect(rowOf(after, hidden), "đặt false ⇒ vắng").toBeUndefined();
      expect(rowOf(after, pIn), "không có hàng preference ⇒ vẫn có mặt").toBeDefined();
      expect(rowOf(after, shown), "đặt true ⇒ vẫn có mặt").toBeDefined();
    });

    it("QA1-P-B4 · trạng thái `terminated` ⇒ vắng (trước khi đổi: có mặt)", async () => {
      const leaver = await w.actor(w.A, "bterm", {
        pairs: EMPLOYEE_FEED_PAIRS,
        profile: { dob: dobOf(YEAR_B, marks.inside) },
      });
      expect(rowOf((await birthdays("week")).rows, leaver), "khi còn active").toBeDefined();

      const upd = await w.direct.query(
        `UPDATE employee_profiles SET status = 'terminated'
          WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL`,
        [leaver.employeeId, w.A.companyId],
      );
      expect(upd.rowCount, "hàng hồ sơ vẫn sống — nghỉ việc không phải xoá mềm").toBe(1);

      const rows = (await birthdays("week")).rows;
      expect(rowOf(rows, leaver)).toBeUndefined();
      expect(rowOf(rows, pIn), "người khác vẫn có mặt").toBeDefined();
    });

    /**
     * Ghim HIỆN TRẠNG — nợ đã có WO `S16-SOCIAL-BDAYMASKED-1` (bỏ hẳn dòng): hồ sơ còn `active` nhưng
     * tài khoản bị khoá thì dòng vẫn ra, tên và ảnh bị che. WO đó đổi hành vi thì sửa ca này cùng lúc.
     */
    it("QA1-P-B5 · tài khoản bị khoá: dòng còn, tên + ảnh là `null` [S16-SOCIAL-BDAYMASKED-1]", async () => {
      const locked = await w.actor(w.A, "block", {
        pairs: EMPLOYEE_FEED_PAIRS,
        profile: { dob: dobOf(YEAR_B, marks.inside) },
      });
      expect(rowOf((await birthdays("week")).rows, locked)?.fullName).toBe(locked.fullName);

      await w.direct.query(`UPDATE users SET status = 'locked' WHERE id = $1 AND company_id = $2`, [
        locked.userId,
        w.A.companyId,
      ]);
      const { body, rows } = await birthdays("week");
      expect(rowOf(rows, locked)).toEqual({
        employeeId: locked.employeeId,
        fullName: null,
        avatar: null,
        day: marks.inside.day,
        month: marks.inside.month,
      });
      expect(findIdentity(body, [locked.fullName, locked.email, locked.userId])).toEqual([]);
    });
  });

  // ══════════════ Bình chọn ══════════════

  describe("danh tính cử tri của bình chọn", () => {
    /** Thẻ của bài `postId` trong feed 001 (đi hết các trang). */
    const feedCard = async (token: string, postId: string): Promise<Json> => {
      let cursor: string | null = null;
      for (let page = 0; page < 20; page += 1) {
        const url: string =
          cursor === null
            ? "/social/feed?limit=50"
            : `/social/feed?limit=50&cursor=${encodeURIComponent(cursor)}`;
        const res = await w.get(token, url);
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        const data = dataOf(res.body);
        const hit = ((data.data ?? []) as Json[]).find((p) => p.id === postId);
        if (hit) return hit;
        cursor = (data.nextCursor ?? null) as string | null;
        if (cursor === null) break;
      }
      throw new Error(`[QA1-P] bài ${postId} không có trong feed`);
    };

    const pollListItem = async (token: string, postId: string): Promise<Json> => {
      const res = await w.get(token, "/social/polls?limit=100");
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const hit = ((dataOf(res.body).data ?? []) as Json[]).find((p) => p.postId === postId);
      expect(hit, `bài ${postId} phải có trong 040`).toBeDefined();
      return hit as Json;
    };

    /**
     * Cử tri bỏ một phiếu; người đọc gọi 043 · 003 · 001 · 040 · 041 · 042 và từng thân được dò.
     * Bài tự-kiểm của cử tri được tạo SAU mọi lượt đọc.
     */
    const surfacesHideVoter = async (
      label: string,
      who: Qa1Actor,
      isAnonymous: boolean,
    ): Promise<void> => {
      // Cử tri KHÔNG là tác giả / người bình luận / người được nhắc ở bài bình chọn.
      const voter = await w.actor(w.A, `voter${label}`, { pairs: EMPLOYEE_FEED_PAIRS });
      const poll = await pollPost(w, host, { isAnonymous });
      await votePoll(w, voter, poll.id, [poll.optionIds[0]]);

      const clean = (surface: string, body: unknown): void => {
        expect(voterLeaks(body, voter), `${surface}: ${JSON.stringify(body)}`).toEqual([]);
      };

      // 043 — neo dương: phiếu ĐÃ ghi và người đọc thấy con số.
      const results = await w.get(who.token, `/social/posts/${poll.id}/poll/results`);
      expect(results.status, JSON.stringify(results.body)).toBe(200);
      const r = dataOf(results.body);
      expect(r.isAnonymous).toBe(isAnonymous);
      expect(r.totalVoters).toBe(1);
      expect(r.myVote, "myVote là của NGƯỜI GỌI").toEqual([]);
      expect(
        (r.options as Array<{ id: string; voteCount: number }>).map((o) => [o.id, o.voteCount]),
      ).toEqual([
        [poll.optionIds[0], 1],
        [poll.optionIds[1], 0],
        [poll.optionIds[2], 0],
      ]);
      clean("043", results.body);

      // 003 — toàn thân; khối poll trên thẻ cùng con số.
      const detail = await w.get(who.token, `/social/posts/${poll.id}`);
      expect(detail.status, JSON.stringify(detail.body)).toBe(200);
      expect((dataOf(detail.body).poll as Json).totalVoters).toBe(1);
      clean("003", detail.body);

      // 001 · 040 — route danh sách: chỉ chuỗi hoá ĐÚNG thẻ của bài bình chọn.
      const card = await feedCard(who.token, poll.id);
      expect((card.poll as Json).totalVoters).toBe(1);
      clean("001", card);
      const item = await pollListItem(who.token, poll.id);
      expect(item.isAnonymous).toBe(isAnonymous);
      clean("040", item);

      // 041 · 042 — người đọc tự bỏ rồi rút phiếu: thân trả về không mang danh tính của cử tri kia.
      const vote = await w
        .put(who.token, `/social/posts/${poll.id}/poll/vote`)
        .send({ optionIds: [poll.optionIds[1]] });
      expect(vote.status, JSON.stringify(vote.body)).toBe(200);
      expect(dataOf(vote.body).totalVoters).toBe(2);
      expect(dataOf(vote.body).myVote).toEqual([poll.optionIds[1]]);
      clean("041", vote.body);
      const withdraw = await w.del(who.token, `/social/posts/${poll.id}/poll/vote`);
      expect(withdraw.status, JSON.stringify(withdraw.body)).toBe(200);
      expect(dataOf(withdraw.body).totalVoters).toBe(1);
      clean("042", withdraw.body);

      // Tự-kiểm: CÙNG bộ dò áp lên thẻ một bài do chính cử tri đăng PHẢI thấy danh tính của họ.
      const own = await sharePost(w, voter);
      const ownCard = await w.get(who.token, `/social/posts/${own.id}`);
      expect(ownCard.status).toBe(200);
      expect(voterLeaks(ownCard.body, voter)).toEqual(
        expect.arrayContaining([
          `$.data.author.employeeId=${voter.employeeId}`,
          `$.data.author.fullName=${voter.fullName.toLowerCase()}`,
        ]),
      );
    };

    it("QA1-P-V0 · tự-kiểm: bộ dò tập khoá bắt được khoá danh sách cử tri, không bắt nhầm `totalVoters`", () => {
      const fake = { ...host, userId: "cccccccc-0000-4ccc-8ccc-cccccccccccc" };
      expect(voterLeaks({ totalVoters: 3, options: [{ id: "x", voteCount: 3 }] }, fake)).toEqual(
        [],
      );
      expect(voterLeaks({ voters: [] }, fake)).toEqual(["khoá:voters"]);
      expect(voterLeaks({ options: [{ userId: null }] }, fake)).toEqual(["khoá:userid"]);
      expect(voterLeaks({ options: [{ by: fake.userId }] }, fake).length).toBe(1);
    });

    it("QA1-P-V1 · poll ẨN DANH: 043 · 003 · 001 · 040 · 041 · 042 của người đọc khác không mang danh tính cử tri", async () => {
      await surfacesHideVoter("anon", reader, true);
    });

    it("QA1-P-V2 · poll KHÔNG ẩn danh, người đọc là company-admin: vẫn không có danh tính cử tri", async () => {
      const admin = await w.actor(w.A, "admin", { canonical: "company-admin" });
      await surfacesHideVoter("named", admin, false);
    });

    it("QA1-P-V3 · 041 · 042 · 044 không phát sự kiện feed nào và không ghi vết kiểm toán mang danh tính cử tri", async () => {
      const voter = await w.actor(w.A, "voterws", { pairs: EMPLOYEE_FEED_PAIRS });
      const poll = await pollPost(w, host, { isAnonymous: true });
      const anchorPost = await sharePost(w, host);

      const emitter = w.app.get(RealtimeEmitterService);
      const spies = [
        vi.spyOn(emitter, "emitFeedPostCreated"),
        vi.spyOn(emitter, "emitFeedCommentCreated"),
        vi.spyOn(emitter, "emitFeedReactionChanged"),
      ];
      // Thu MỌI lời gọi của cả ba hàm phát rồi mới lọc — không assert theo một lời gọi cụ thể.
      const allCalls = (): string[] =>
        spies.flatMap((s) => s.mock.calls.map((args) => JSON.stringify(args)));
      const mentioning = (needle: string): string[] => allCalls().filter((c) => c.includes(needle));

      try {
        await votePoll(w, voter, poll.id, [poll.optionIds[0]]);
        const withdraw = await w.del(voter.token, `/social/posts/${poll.id}/poll/vote`);
        expect(withdraw.status, JSON.stringify(withdraw.body)).toBe(200);
        await votePoll(w, voter, poll.id, [poll.optionIds[2]]);
        const close = await w.post(host.token, `/social/posts/${poll.id}/poll/close`);
        expect(close.status, `044 ⇒ ${JSON.stringify(close.body)}`).toBe(201);
        expect(dataOf(close.body).status).toBe("closed");
        expect(voterLeaks(close.body, voter), "thân 044").toEqual([]);

        expect(allCalls(), "041 · 042 · 044 không phát sự kiện feed nào").toEqual([]);

        // Vết kiểm toán gắn bài này: đúng MỘT hàng đóng poll của người đóng, không hàng nào của cử tri.
        const audit = await w.direct.query<{ action: string; actor_user_id: string | null }>(
          `SELECT action, actor_user_id FROM audit_logs
            WHERE company_id = $1
              AND (object_id = $2 OR entity_id::text = $2::text OR metadata::text LIKE '%' || $2::text || '%')`,
          [w.A.companyId, poll.id],
        );
        expect(audit.rows.filter((a) => a.actor_user_id === voter.userId)).toEqual([]);
        expect(audit.rows.filter((a) => a.action === "social.poll.close")).toEqual([
          { action: "social.poll.close", actor_user_id: host.userId },
        ]);
        const byVoter = await w.direct.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM audit_logs
            WHERE company_id = $1 AND actor_user_id = $2 AND module_code = 'SOCIAL'`,
          [w.A.companyId, voter.userId],
        );
        expect(byVoter.rows[0].n, "cử tri không để lại vết kiểm toán SOCIAL nào").toBe(0);

        // Neo dương: một sự kiện khác (bình luận của CHÍNH cử tri) phát SAU vẫn tới các hàm phát đang
        // theo dõi — và bộ lọc theo danh tính tìm thấy nó.
        await addComment(w, voter, anchorPost.id);
        await vi.waitFor(() => {
          expect(mentioning(voter.employeeId ?? "∅").length).toBeGreaterThanOrEqual(1);
        });
        expect(mentioning(poll.id), "không sự kiện nào nhắc tới bài bình chọn").toEqual([]);
      } finally {
        for (const s of spies) s.mockRestore();
      }
    });
  });
});
