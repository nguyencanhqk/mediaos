import type {
  CreateDependencyRequest,
  CreateStepRequest,
  CreateTemplateRequest,
  DependencyDto,
  TemplateDetailDto,
  TemplateDto,
  TemplateStepDto,
  UpdateStepPositionRequest,
  UpdateStepRequest,
  UpdateTemplateRequest,
} from "./contract";
import { validateDag } from "./dag";

/**
 * Mock store in-memory cho Workflow Builder — fallback DEV khi không chạy API thật
 * (bật bằng VITE_WORKFLOW_MOCK=true ở `workflow-templates-api.ts`). Reset mỗi lần reload trang.
 * Hình dạng khớp contract FROZEN (`@mediaos/contracts`). Mutation immutable: thay mảng/đối tượng mới.
 */

const COMPANY_ID = "00000000-0000-4000-8000-000000000001";
const SEED_USER_ID = "00000000-0000-4000-8000-0000000000aa";

function uuid(): string {
  return crypto.randomUUID();
}

const delay = (ms = 120): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ─── Seed ─────────────────────────────────────────────────────────────────────

interface MockState {
  templates: TemplateDto[];
  steps: TemplateStepDto[];
  dependencies: DependencyDto[];
}

function seedStep(
  defId: string,
  order: number,
  code: string,
  name: string,
  assignee: string,
  x: number,
  y: number,
): TemplateStepDto {
  return {
    id: `a1000000-0000-4000-8000-0000000000${order.toString().padStart(2, "0")}`,
    companyId: COMPANY_ID,
    workflowDefinitionId: defId,
    nodeKey: code,
    stepType: "task",
    stepOrder: order,
    code,
    name,
    defaultTaskTitle: name,
    assigneeRoleCode: assignee,
    reviewerRoleCode: "project_manager",
    isRequired: true,
    positionX: x,
    positionY: y,
    defaultChecklistId: null,
  };
}

function seedDep(defId: string, from: TemplateStepDto, to: TemplateStepDto): DependencyDto {
  return {
    id: uuid(),
    companyId: COMPANY_ID,
    workflowDefinitionId: defId,
    fromStepId: from.id,
    toStepId: to.id,
    dependencyType: "finish_to_start",
    createdAt: "2026-05-01T00:00:00.000Z",
  };
}

function seedTemplate(
  id: string,
  code: string,
  name: string,
  appliesTo: string,
  status: TemplateDto["status"],
  publishedAt: string | null,
  createdAt: string,
): TemplateDto {
  return {
    id,
    companyId: COMPANY_ID,
    code,
    name,
    appliesTo,
    maxApprovalLevel: 1,
    allowParallelSteps: true,
    isActive: true,
    version: 1,
    status,
    publishedAt,
    createdBy: SEED_USER_ID,
    createdAt,
    deletedAt: null,
  };
}

function buildSeed(): MockState {
  const videoDefId = "a0000000-0000-4000-8000-000000000001";
  const socialDefId = "b0000000-0000-4000-8000-000000000001";

  // Template 1: video_standard_v0 — PUBLISHED, tuyến tính (D7 backfill).
  const videoSteps: TemplateStepDto[] = [
    seedStep(videoDefId, 1, "script", "Viết kịch bản", "script_writer", 40, 40),
    seedStep(videoDefId, 2, "edit", "Dựng video", "video_editor", 40, 180),
    seedStep(videoDefId, 3, "qa", "Kiểm tra chất lượng", "qa_reviewer", 40, 320),
    seedStep(videoDefId, 4, "upload", "Upload lên kênh", "uploader", 40, 460),
  ];
  const videoDeps: DependencyDto[] = [
    seedDep(videoDefId, videoSteps[0]!, videoSteps[1]!),
    seedDep(videoDefId, videoSteps[1]!, videoSteps[2]!),
    seedDep(videoDefId, videoSteps[2]!, videoSteps[3]!),
  ];

  // Template 2: social_campaign — DRAFT, có fork song song (brief → {design, copy} → review).
  const sBrief = seedStep(socialDefId, 1, "brief", "Lên brief chiến dịch", "content_lead", 220, 40);
  sBrief.id = "b1000000-0000-4000-8000-000000000001";
  const sDesign = seedStep(socialDefId, 2, "design", "Thiết kế ấn phẩm", "video_editor", 60, 200);
  sDesign.id = "b1000000-0000-4000-8000-000000000002";
  const sCopy = seedStep(socialDefId, 3, "copy", "Viết nội dung", "script_writer", 380, 200);
  sCopy.id = "b1000000-0000-4000-8000-000000000003";
  const sReview = seedStep(socialDefId, 4, "review", "Duyệt & lên lịch", "qa_reviewer", 220, 360);
  sReview.id = "b1000000-0000-4000-8000-000000000004";
  const socialSteps = [sBrief, sDesign, sCopy, sReview];
  const socialDeps: DependencyDto[] = [
    seedDep(socialDefId, sBrief, sDesign),
    seedDep(socialDefId, sBrief, sCopy),
    seedDep(socialDefId, sDesign, sReview),
    seedDep(socialDefId, sCopy, sReview),
  ];

  const templates: TemplateDto[] = [
    seedTemplate(
      videoDefId,
      "video_standard_v0",
      "Video chuẩn MVP-0",
      "content_item",
      "published",
      "2026-05-01T00:00:00.000Z",
      "2026-04-20T00:00:00.000Z",
    ),
    seedTemplate(
      socialDefId,
      "social_campaign",
      "Chiến dịch social (song song)",
      "project",
      "draft",
      null,
      "2026-06-05T00:00:00.000Z",
    ),
  ];

  return {
    templates,
    steps: [...videoSteps, ...socialSteps],
    dependencies: [...videoDeps, ...socialDeps],
  };
}

let state: MockState = buildSeed();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function requireTemplate(id: string): TemplateDto {
  const t = state.templates.find((x) => x.id === id);
  if (!t) throw new Error(`Không tìm thấy template ${id}.`);
  return t;
}

function assertDraft(t: TemplateDto): void {
  if (t.status !== "draft") {
    throw new Error("Template đã xuất bản — không sửa được. Hãy nhân bản (clone) sang bản nháp mới.");
  }
}

function stepsOf(defId: string): TemplateStepDto[] {
  return state.steps
    .filter((s) => s.workflowDefinitionId === defId)
    .sort((a, b) => a.stepOrder - b.stepOrder);
}

function depsOf(defId: string): DependencyDto[] {
  return state.dependencies.filter((d) => d.workflowDefinitionId === defId);
}

// ─── Public mock API ────────────────────────────────────────────────────────

export const mockTemplatesStore = {
  async list(): Promise<TemplateDto[]> {
    await delay();
    return state.templates;
  },

  async get(id: string): Promise<TemplateDetailDto> {
    await delay();
    return {
      template: requireTemplate(id),
      steps: stepsOf(id),
      dependencies: depsOf(id),
      checklists: [],
    };
  },

  async create(req: CreateTemplateRequest): Promise<TemplateDto> {
    await delay();
    const template = seedTemplate(
      uuid(),
      req.code,
      req.name,
      req.appliesTo,
      "draft",
      null,
      new Date().toISOString(),
    );
    state = { ...state, templates: [template, ...state.templates] };
    return template;
  },

  async update(id: string, req: UpdateTemplateRequest): Promise<TemplateDto> {
    await delay();
    const t = requireTemplate(id);
    assertDraft(t);
    const next: TemplateDto = { ...t, name: req.name ?? t.name };
    state = { ...state, templates: state.templates.map((x) => (x.id === id ? next : x)) };
    return next;
  },

  async remove(id: string): Promise<void> {
    await delay();
    state = {
      templates: state.templates.filter((t) => t.id !== id),
      steps: state.steps.filter((s) => s.workflowDefinitionId !== id),
      dependencies: state.dependencies.filter((d) => d.workflowDefinitionId !== id),
    };
  },

  async addStep(templateId: string, req: CreateStepRequest): Promise<TemplateStepDto> {
    await delay();
    const t = requireTemplate(templateId);
    assertDraft(t);
    const existing = stepsOf(templateId);
    if (existing.some((s) => s.nodeKey === req.nodeKey)) {
      throw new Error(`Node key '${req.nodeKey}' đã tồn tại trong quy trình này.`);
    }
    const step: TemplateStepDto = {
      id: uuid(),
      companyId: COMPANY_ID,
      workflowDefinitionId: templateId,
      nodeKey: req.nodeKey,
      stepType: req.stepType ?? "task",
      stepOrder: req.stepOrder ?? existing.length + 1,
      code: req.code,
      name: req.name,
      defaultTaskTitle: req.defaultTaskTitle,
      assigneeRoleCode: req.assigneeRoleCode ?? null,
      reviewerRoleCode: req.reviewerRoleCode ?? null,
      isRequired: req.isRequired ?? true,
      positionX: req.positionX ?? null,
      positionY: req.positionY ?? null,
      defaultChecklistId: null,
    };
    state = { ...state, steps: [...state.steps, step] };
    return step;
  },

  async updateStep(templateId: string, stepId: string, req: UpdateStepRequest): Promise<TemplateStepDto> {
    await delay();
    assertDraft(requireTemplate(templateId));
    const current = state.steps.find((s) => s.id === stepId);
    if (!current) throw new Error(`Không tìm thấy bước ${stepId}.`);
    const next: TemplateStepDto = {
      ...current,
      code: req.code ?? current.code,
      name: req.name ?? current.name,
      defaultTaskTitle: req.defaultTaskTitle ?? current.defaultTaskTitle,
      stepType: req.stepType ?? current.stepType,
      assigneeRoleCode: req.assigneeRoleCode === undefined ? current.assigneeRoleCode : req.assigneeRoleCode,
      reviewerRoleCode: req.reviewerRoleCode === undefined ? current.reviewerRoleCode : req.reviewerRoleCode,
      isRequired: req.isRequired ?? current.isRequired,
      positionX: req.positionX === undefined ? current.positionX : req.positionX,
      positionY: req.positionY === undefined ? current.positionY : req.positionY,
    };
    state = { ...state, steps: state.steps.map((s) => (s.id === stepId ? next : s)) };
    return next;
  },

  async updateStepPosition(
    templateId: string,
    stepId: string,
    req: UpdateStepPositionRequest,
  ): Promise<TemplateStepDto> {
    await delay(40);
    assertDraft(requireTemplate(templateId));
    const current = state.steps.find((s) => s.id === stepId);
    if (!current) throw new Error(`Không tìm thấy bước ${stepId}.`);
    const next: TemplateStepDto = { ...current, positionX: req.positionX, positionY: req.positionY };
    state = { ...state, steps: state.steps.map((s) => (s.id === stepId ? next : s)) };
    return next;
  },

  async removeStep(templateId: string, stepId: string): Promise<void> {
    await delay();
    assertDraft(requireTemplate(templateId));
    state = {
      ...state,
      steps: state.steps.filter((s) => s.id !== stepId),
      dependencies: state.dependencies.filter((d) => d.fromStepId !== stepId && d.toStepId !== stepId),
    };
  },

  async addDependency(templateId: string, req: CreateDependencyRequest): Promise<DependencyDto> {
    await delay();
    assertDraft(requireTemplate(templateId));
    if (req.fromStepId === req.toStepId) throw new Error("Một bước không thể tự phụ thuộc.");
    const duplicate = state.dependencies.find(
      (d) =>
        d.workflowDefinitionId === templateId &&
        d.fromStepId === req.fromStepId &&
        d.toStepId === req.toStepId,
    );
    if (duplicate) throw new Error("Phụ thuộc này đã tồn tại.");
    const dep: DependencyDto = {
      id: uuid(),
      companyId: COMPANY_ID,
      workflowDefinitionId: templateId,
      fromStepId: req.fromStepId,
      toStepId: req.toStepId,
      dependencyType: req.dependencyType ?? "finish_to_start",
      createdAt: new Date().toISOString(),
    };
    state = { ...state, dependencies: [...state.dependencies, dep] };
    return dep;
  },

  async removeDependency(templateId: string, depId: string): Promise<void> {
    await delay();
    assertDraft(requireTemplate(templateId));
    state = { ...state, dependencies: state.dependencies.filter((d) => d.id !== depId) };
  },

  async validate(templateId: string) {
    await delay(60);
    requireTemplate(templateId);
    return validateDag(stepsOf(templateId), depsOf(templateId));
  },

  async publish(templateId: string): Promise<TemplateDto> {
    await delay();
    const t = requireTemplate(templateId);
    assertDraft(t);
    const result = validateDag(stepsOf(templateId), depsOf(templateId));
    if (!result.valid) {
      throw new Error(`DAG chưa hợp lệ — không thể xuất bản (${result.errors.length} lỗi). Sửa lỗi rồi thử lại.`);
    }
    const next: TemplateDto = { ...t, status: "published", publishedAt: new Date().toISOString() };
    state = { ...state, templates: state.templates.map((x) => (x.id === templateId ? next : x)) };
    return next;
  },

  async clone(templateId: string): Promise<TemplateDto> {
    await delay();
    const t = requireTemplate(templateId);
    const newId = uuid();
    const clone: TemplateDto = {
      ...t,
      id: newId,
      version: t.version + 1,
      status: "draft",
      publishedAt: null,
      createdAt: new Date().toISOString(),
    };
    // Copy steps (id mới, nodeKey giữ nguyên) + map deps theo id mới.
    const idMap = new Map<string, string>();
    const clonedSteps = stepsOf(templateId).map((s) => {
      const id = uuid();
      idMap.set(s.id, id);
      return { ...s, id, workflowDefinitionId: newId };
    });
    const clonedDeps = depsOf(templateId).map((d) => ({
      ...d,
      id: uuid(),
      workflowDefinitionId: newId,
      fromStepId: idMap.get(d.fromStepId)!,
      toStepId: idMap.get(d.toStepId)!,
    }));
    state = {
      templates: [clone, ...state.templates],
      steps: [...state.steps, ...clonedSteps],
      dependencies: [...state.dependencies, ...clonedDeps],
    };
    return clone;
  },

  async apply(): Promise<{ instanceId: string }> {
    await delay();
    return { instanceId: uuid() };
  },
};

/** Reset store về seed — phục vụ test. */
export function __resetMockStore(): void {
  state = buildSeed();
}
