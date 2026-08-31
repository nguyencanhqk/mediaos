import { describe, expect, it } from "vitest";
import type { Candidate, Offer } from "../db/schema/recruit";
import { maskEmail, maskPhone, toCandidateDetail, toOfferDto } from "./recruit.mapper";
import type { RecruitActor } from "./recruit.types";
import { sql } from "drizzle-orm";

/**
 * S12-RECRUIT-BE-1 — mapper masking (plan §9.2): hàm thuần biên rỗng/null/độ lạ + vắng-khoá salary +
 * không lộ field khi piiMasked. Actor giả CHỈ dùng 2 cờ masking (các trường khác không chạm).
 */

const actorWith = (pii: boolean, salary: boolean): RecruitActor => ({
  actorUserId: "u1",
  companyId: "c1",
  routeKey: "candidateDetail",
  routeScope: "Company",
  peopleVisibleCond: sql`true`,
  interviewViewScope: "Company",
  canSeeCandidatePii: pii,
  canSeeSalary: salary,
});

describe("maskEmail / maskPhone — hàm thuần, biên an toàn", () => {
  it("maskEmail giữ ký tự đầu + TLD, không lộ local-part/domain", () => {
    expect(maskEmail("duong.nguyen@gmail.com")).toBe("d***@***.com");
    expect(maskEmail("a@b.vn")).toBe("a***@***.vn");
  });
  it("biên: null/rỗng/không-@/domain-không-chấm", () => {
    expect(maskEmail(null)).toBeNull();
    expect(maskEmail("")).toBeNull();
    expect(maskEmail("khong-phai-email")).toBe("***");
    expect(maskEmail("@x")).toBe("***");
    expect(maskEmail("a@localhost")).toBe("a***@***");
  });
  it("maskPhone giữ 2 đầu + 2 cuối; ngắn quá che hết", () => {
    expect(maskPhone("0912345678")).toBe("09** *** *78");
    expect(maskPhone("+84 91 234 5678")).toBe("+8** *** *78");
    expect(maskPhone("12345")).toBe("***");
    expect(maskPhone(null)).toBeNull();
    expect(maskPhone("")).toBeNull();
  });
});

const CAND: Candidate = {
  id: "cand-1",
  companyId: "c1",
  jobOpeningId: "job-1",
  fullName: "Ứng Viên A",
  email: "candidate@example.com",
  phone: "0912345678",
  source: "TopCV",
  note: "ghi chú nội bộ",
  stage: "Screening",
  employeeId: null,
  createdAt: new Date("2026-08-01T00:00:00Z"),
  createdBy: "u1",
  updatedAt: new Date("2026-08-02T00:00:00Z"),
  updatedBy: "u1",
  deletedAt: null,
  deletedBy: null,
};

describe("toCandidateDetail — masking PII single-exit", () => {
  it("canSeeCandidatePii=false ⇒ email/phone CHE + piiMasked:true, không chứa giá trị gốc", () => {
    const dto = toCandidateDetail(CAND, actorWith(false, false));
    expect(dto.piiMasked).toBe(true);
    expect(dto.email).not.toContain("candidate@example.com");
    expect(dto.email).toBe("c***@***.com");
    expect(dto.phone).toBe("09** *** *78");
    expect(JSON.stringify(dto)).not.toContain("candidate@example.com");
    expect(JSON.stringify(dto)).not.toContain("0912345678");
  });
  it("canSeeCandidatePii=true ⇒ nguyên vẹn + piiMasked:false", () => {
    const dto = toCandidateDetail(CAND, actorWith(true, false));
    expect(dto.piiMasked).toBe(false);
    expect(dto.email).toBe("candidate@example.com");
    expect(dto.phone).toBe("0912345678");
  });
});

const OFFER: Offer = {
  id: "of-1",
  companyId: "c1",
  candidateId: "cand-1",
  title: "Junior Dev",
  startDate: "2026-09-15",
  salary: "15000000.00",
  note: null,
  status: "Sent",
  respondedAt: null,
  createdAt: new Date("2026-08-01T00:00:00Z"),
  createdBy: "u1",
  updatedAt: new Date("2026-08-01T00:00:00Z"),
  updatedBy: "u1",
};

describe("toOfferDto — salary vắng KHOÁ khi thiếu manage:offer", () => {
  it("canSeeSalary=false ⇒ KHÔNG có khoá salary (không phải null — FE `.optional()`)", () => {
    const dto = toOfferDto(OFFER, actorWith(true, false));
    expect("salary" in dto).toBe(false);
    expect(JSON.stringify(dto)).not.toContain("15000000");
  });
  it("canSeeSalary=true ⇒ có khoá salary dạng chuỗi, dù row 'bẩn' kiểu numeric", () => {
    const dirty = { ...OFFER, salary: 15000000.5 as unknown as string };
    const dto = toOfferDto(dirty, actorWith(true, true));
    expect(dto.salary).toBe("15000000.5");
  });
});
