/**
 * S12-RECRUIT-BE-1 — BẢNG HẰNG route → cặp quyền, NGUỒN SỰ THẬT DUY NHẤT cho CẢ BA nơi (plan §5,
 * plan-review vòng 2 finding #3):
 *   1. `@RequirePermission(PAIR.action, PAIR.resourceType)` ở decorator route.
 *   2. Assert tầng THỨ HAI trong service (không gõ lại literal).
 *   3. `RecruitAccessService` tính `peopleVisibleCond` MỘT LẦN/request theo cặp CỦA ROUTE.
 *
 * Census 2 tầng (`recruit-two-layer-guard-census.unit-spec.ts`) so CẢ decorator lẫn service với
 * CHÍNH bảng này — một tầng sửa lệch là ĐỎ, kể cả khi hai tầng "khớp nhau" do cùng sai.
 *
 * 7 cặp resource `candidate` là SENSITIVE (seed 0560) — mọi `permission.can()` cho chúng phải truyền
 * `isSensitive: true` tường minh (wildcard `*:*` không thoả cổng sensitive — plan §4.4).
 */
export interface RecruitPair {
  readonly action: string;
  readonly resourceType: string;
  /** true = cặp trong danh sách 7 cặp sensitive `candidate` (mig 0560). */
  readonly isSensitive: boolean;
  /**
   * SÀN SCOPE Company (FULL gate security M1, khuôn `dash-widget-gate-needs-scope-floor`):
   * §13.6 chốt job-opening/candidate/offer CHỈ Company (đọc lẫn ghi) — scope hẹp hơn phải bị TỪ
   * CHỐI 403 chứ không "coi như" Company, nếu không một lần đổi `data_scope` (DELETE+INSERT
   * per-pair) sẽ âm thầm nới quyền. false CHỈ cho 4 key interview view/feedback (Own hợp lệ §13.6).
   */
  readonly companyFloor: boolean;
}

const pair = (
  action: string,
  resourceType: string,
  isSensitive = false,
  companyFloor = true,
): RecruitPair => ({ action, resourceType, isSensitive, companyFloor });

/** Key = mã route API-17 (RECRUIT-API-XXX) — đủ 32 route. */
export const RECRUIT_ROUTE_PAIRS = {
  // Job openings 001–005
  jobOpeningList: pair("view", "job-opening"),
  jobOpeningCreate: pair("create", "job-opening"),
  jobOpeningDetail: pair("view", "job-opening"),
  jobOpeningUpdate: pair("update", "job-opening"),
  jobOpeningChangeStatus: pair("update", "job-opening"),
  // Candidates 006–017, 029
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
  // Interviews 018–024 — 4 key view/feedback là NGOẠI LỆ sàn (Own hợp lệ theo §13.6).
  interviewList: pair("view", "interview", false, false),
  interviewCreate: pair("manage", "interview"),
  interviewDetail: pair("view", "interview", false, false),
  interviewUpdate: pair("manage", "interview"),
  interviewChangeStatus: pair("manage", "interview"),
  interviewFeedbackCreate: pair("feedback", "interview", false, false),
  interviewFeedbackUpdate: pair("feedback", "interview", false, false),
  // Offers 025–028, 030
  offerList: pair("view", "offer"),
  offerCreate: pair("manage", "offer"),
  offerUpdate: pair("manage", "offer"),
  offerChangeStatus: pair("manage", "offer"),
  offerDetail: pair("view", "offer"),
  // Pickers 031–032 — gate bằng cặp GHI tương ứng (SPEC-12 §15 ghi chú 031).
  pickerEmployees: pair("manage", "interview"),
  pickerRecruiterUsers: pair("update", "job-opening"),
} as const satisfies Record<string, RecruitPair>;

export type RecruitRouteKey = keyof typeof RECRUIT_ROUTE_PAIRS;
