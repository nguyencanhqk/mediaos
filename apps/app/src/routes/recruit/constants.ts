/**
 * S12-RECRUIT-FE-1 — hằng số module Tuyển dụng (SPEC-12). Cặp quyền engine THẬT + hằng dùng chung.
 *
 * `RECRUIT_ENGINE_PAIRS` MIRROR ĐÚNG BẢNG 32 route của `apps/api/src/recruit/recruit-route-pairs.const.ts`
 * (nguồn sự thật cho CẢ HAI tầng census BE) — copy literal, KHÔNG import chéo package (`apps/app` không
 * import `apps/api`). `recruit-wiring.spec.ts` đọc lại file BE bằng `fs` và so KHỚP TỪNG TRƯỜNG với bảng
 * này để bắt drift, cùng kỹ thuật `ASSET_ENGINE_PAIRS` (khuôn `uniqueness-gate-covered-one-of-fifteen-
 * families` — vá đúng LỚP không phải phủ hết THỂ HIỆN, nên census phải so bằng MÃ/CẶP, không phải bằng mắt).
 *
 * 7 cặp resource `candidate` là SENSITIVE (seed mig 0560) ⇒ KHÔNG có mặt trong `/auth/me` capabilities
 * nếu chỉ có wildcard `*:*` — PHẢI gate bằng `useCanExact(action, resourceType)`. Mọi cặp còn lại
 * (job-opening/interview/offer) `isSensitive=false` ⇒ dùng `useCan` như thường (wildcard thoả được).
 *
 * `companyFloor` của BE (sàn scope Company) KHÔNG cần mirror ở FE — đó là ràng buộc server tính
 * `peopleVisibleCond`, FE chỉ hiển thị cái server trả về, không tự suy diễn scope.
 */

export interface RecruitEnginePair {
  readonly action: string;
  readonly resourceType: string;
  readonly isSensitive: boolean;
}

const pair = (action: string, resourceType: string, isSensitive = false): RecruitEnginePair => ({
  action,
  resourceType,
  isSensitive,
});

/** Key = mã route API-17 (RECRUIT-API-XXX), ĐÚNG 32 khoá như BE. */
export const RECRUIT_ENGINE_PAIRS = {
  // Job openings 001–005
  jobOpeningList: pair("view", "job-opening"),
  jobOpeningCreate: pair("create", "job-opening"),
  jobOpeningDetail: pair("view", "job-opening"),
  jobOpeningUpdate: pair("update", "job-opening"),
  jobOpeningChangeStatus: pair("update", "job-opening"),
  // Candidates 006–017, 029 — SENSITIVE
  candidateList: pair("view", "candidate", true),
  candidateCreate: pair("create", "candidate", true),
  candidateCheckDuplicate: pair("create", "candidate", true),
  candidateSummary: pair("view", "candidate", true),
  candidateExport: pair("export", "candidate", true),
  candidateDetail: pair("view", "candidate", true),
  candidateUpdate: pair("update", "candidate", true),
  candidateMoveStage: pair("move-stage", "candidate", true),
  candidateStageEvents: pair("view", "candidate", true),
  candidateNotesList: pair("view", "candidate", true),
  candidateNoteCreate: pair("comment", "candidate", true),
  candidateNoteUpdate: pair("comment", "candidate", true),
  candidateConvert: pair("convert", "candidate", true),
  // Interviews 018–024
  interviewList: pair("view", "interview"),
  interviewCreate: pair("manage", "interview"),
  interviewDetail: pair("view", "interview"),
  interviewUpdate: pair("manage", "interview"),
  interviewChangeStatus: pair("manage", "interview"),
  interviewFeedbackCreate: pair("feedback", "interview"),
  interviewFeedbackUpdate: pair("feedback", "interview"),
  // Offers 025–028, 030
  offerList: pair("view", "offer"),
  offerCreate: pair("manage", "offer"),
  offerUpdate: pair("manage", "offer"),
  offerChangeStatus: pair("manage", "offer"),
  offerDetail: pair("view", "offer"),
  // Pickers 031–032
  pickerEmployees: pair("manage", "interview"),
  pickerRecruiterUsers: pair("update", "job-opening"),
} as const satisfies Record<string, RecruitEnginePair>;

export type RecruitEngineKey = keyof typeof RECRUIT_ENGINE_PAIRS;

/** 6 cột kanban cố định (SPEC-12 §13.1) — Hired/Rejected thu gọn mặc định (REC-SCREEN-002). */
export const RECRUIT_STAGE_COLUMNS = [
  "New",
  "Screening",
  "Interview",
  "Offer",
  "Hired",
  "Rejected",
] as const;

export const RECRUIT_COLLAPSED_STAGES: ReadonlySet<string> = new Set(["Hired", "Rejected"]);

/** Trần trang mặc định — khớp `RECRUIT_PAGE_DEFAULT` của contracts (max 100). */
export const RECRUIT_PAGE_SIZE = 20;

/** `reason` tối thiểu khi move-stage — khớp `RECRUIT_MOVE_REASON_MIN` của contracts. */
export { RECRUIT_MOVE_REASON_MIN } from "@mediaos/contracts";

/** Màu badge theo stage/status — dùng constants chung, không lặp chuỗi hex rải rác. */
export const RECRUIT_STAGE_BADGE_VARIANT: Readonly<
  Record<string, "success" | "brand" | "warning" | "muted" | "danger">
> = {
  New: "muted",
  Screening: "brand",
  Interview: "brand",
  Offer: "warning",
  Hired: "success",
  Rejected: "danger",
};

export const RECRUIT_JOB_STATUS_BADGE_VARIANT: Readonly<
  Record<string, "success" | "brand" | "warning" | "muted" | "danger">
> = {
  Draft: "muted",
  Open: "success",
  Paused: "warning",
  Closed: "danger",
};

export const RECRUIT_INTERVIEW_STATUS_BADGE_VARIANT: Readonly<
  Record<string, "success" | "brand" | "warning" | "muted" | "danger">
> = {
  Scheduled: "brand",
  Completed: "success",
  Cancelled: "muted",
};

export const RECRUIT_OFFER_STATUS_BADGE_VARIANT: Readonly<
  Record<string, "success" | "brand" | "warning" | "muted" | "danger">
> = {
  Draft: "muted",
  Sent: "brand",
  Accepted: "success",
  Declined: "danger",
  Withdrawn: "danger",
};

/** module_code/entity_type dùng khi gắn CV vào Foundation Files (mirror `RECRUIT_MODULE`/`CANDIDATE_ENTITY` của BE resolver). */
export const RECRUIT_FILE_MODULE_CODE = "RECRUIT";
export const RECRUIT_FILE_ENTITY_TYPE = "candidate";
