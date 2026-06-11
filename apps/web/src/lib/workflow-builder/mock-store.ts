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
 * Mock store in-memory cho Workflow Builder — KÍCH HOẠT khi BE chưa ship endpoint
 * (toggle ở `api.ts` qua VITE_WORKFLOW_MOCK). Reset mỗi lần reload trang.
 * Mutation theo kiểu immutable: thay mảng mới, KHÔNG mutate object đã trả ra ngoài.
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
  title: string,
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
    title,
    assigneeRoleCode: assignee,
    reviewerRoleCode: "project_manager",
    isRequired: true,
    positionX: x,
    positionY: y,
    defaultChecklistId: null,
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
    { from: videoSteps[0], to: videoSteps[1] },
    { from: videoSteps[1], to: videoSteps[2] },
    { from: videoSteps[2], to: videoSteps[3] },
  ].map(({ from, to }) => ({
    id: uuid(),
    companyId: COMPANY_ID,
    workflowDefinitionId: videoDefId,
    fromStepId: from.id,
    toStepId: to.id,
    dependencyType: "finish_to_start",
  }));

  // Template 2: social_campaign — DRAFT, có fork song song (brief → {design, copy} → review).
  const sBrief: TemplateStepDto = {
    id: "b1000000-0000-4000-8000-000000000001",
    companyId: COMPANY_ID,
    workflowDefinitionId: socialDefId,
    nodeKey: "brief",
    stepType: "task",
    stepOrder: 1,
    code: "brief",
    title: "Lên brief chiến dịch",
    assigneeRoleCode: "content_lead",
    reviewerRoleCode: "project_manager",
    isRequired: true,
    positionX: 220,
    positionY: 40,
    defaultChecklistId: null,
  };
  const sDesign: TemplateStepDto = { ...sBrief, id: "b1000000-0000-4000-8000-000000000002", nodeKey: "design", stepOrder: 2, code: "design", title: "Thiết kế ấn phẩm", assigneeRoleCode: "video_editor", positionX: 60, positionY: 200 };
  const sCopy: TemplateStepDto = { ...sBrief, id: "b1000000-0000-4000-8000-000000000003", nodeKey: "copy", stepOrder: 3, code: "copy", title: "Viết nội dung", assigneeRoleCode: "script_writer", positionX: 380, positionY: 200 };
  const sReview: TemplateStepDto = { ...sBrief, id: "b1000000-0000-4000-8000-000000000004", nodeKey: "review", stepOrder: 4, code: "review", title: "Duyệt & lên lịch", assigneeRoleCode: "qa_reviewer", positionX: 220, positionY: 360 };
  const socialSteps = [sBrief, sDesign, sCopy, sReview];
  const socialDeps: DependencyDto[] = [
    { from: sBrief, to: sDesign },
    { from: sBrief, to: sCopy },
    { from: sDesign, to: sReview },
    { from: sCopy, to: sReview },
  ].map(({ from, to }) => ({
    id: uuid(),
    companyId: COMPANY_ID,
    workflowDefinitionId: socialDefId,
    fromStepId: from.id,
    toStepId: to.id,
    dependencyType: "finish_to_start",
  }));

  const templates: TemplateDto[] = [
    {
      id: videoDefId,
      companyId: COMPANY_ID,
      code: "video_standard_v0",
      name: "Video chuẩn MVP-0",
      description: "Quy trình sản xuất video tuần tự: kịch bản → dựng → QA → upload.",
      version: 1,
      status: "published",
      appliesTo: "content",
      publishedAt: "2026-05-01T00:00:00.000Z",
      createdBy: SEED_USER_ID,
      createdAt: "2026-04-20T00:00:00.000Z",
    },
    {
      id: socialDefId,
      companyId: COMPANY_ID,
      code: "social_campaign",
      name: "Chiến dịch social (song song)",
      description: "Brief → thiết kế & viết nội dung chạy song song → duyệt.",
      version: 1,
      status: "draft",
      appliesTo: "project",
      publishedAt: null,
      createdBy: SEED_USER_ID,
      createdAt: "2026-06-05T00:00:00.000Z",
    },
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
  return state.steps.filter((s) => s.workflowDefinitionId === defId).sort((a, b) => a.stepOrder - b.stepOrder);
}

function depsOf(defId: string): DependencyDto[] {
  return state.dependencies.filter((d) => d.workflowDefinitionId === defId);
}

function withStepCount(t: TemplateDto): TemplateDto {
  return { ...t, stepCount: state.steps.filter((s) => s.workflowDefinitionId === t.id).length };
}

// ─── Public mock API ────────────────────────────────────────────────────────

export const mockTemplatesStore = {
  async list(): Promise<TemplateDto[]> {
    await delay();
    return state.templates.map(withStepCount);
  },

  async get(id: string): Promise<TemplateDetailDto> {
    await delay();
    return { template: withStepCount(requireTemplate(id)), steps: stepsOf(id), dependencies: depsOf(id) };
  },

  async create(req: CreateTemplateRequest): Promise<TemplateDto> {
    await delay();
    const template: TemplateDto = {
      id: uuid(),
      companyId: COMPANY_ID,
      code: req.code ?? req.name.toLowerCase().replace(/\s+/g, "_").slice(0, 60),
      name: req.name,
      description: req.description ?? null,
      version: 1,
      status: "draft",
      appliesTo: req.appliesTo,
      publishedAt: null,
      createdBy: SEED_USER_ID,
      createdAt: new Date().toISOString(),
    };
    state = { ...state, templates: [template, ...state.templates] };
    return withStepCount(template);
  },

  async update(id: string, req: UpdateTemplateRequest): Promise<TemplateDto> {
    await delay();
    const t = requireTemplate(id);
    assertDraft(t);
    const next: TemplateDto = {
      ...t,
      name: req.name ?? t.name,
      description: req.description === undefined ? t.description : req.description,
    };
    state = { ...state, templates: state.templates.map((x) => (x.id === id ? next : x)) };
    return withStepCount(next);
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
    const baseKey = req.code.toLowerCase().replace(/[^a-z0-9_]+/g, "_") || "step";
    const usedKeys = new Set(existing.map((s) => s.nodeKey));
    let nodeKey = baseKey;
    let n = 2;
    while (usedKeys.has(nodeKey)) nodeKey = `${baseKey}_${n++}`;
    const step: TemplateStepDto = {
      id: uuid(),
      companyId: COMPANY_ID,
      workflowDefinitionId: templateId,
      nodeKey,
      stepType: req.stepType ?? "task",
      stepOrder: existing.length + 1,
      code: req.code,
      title: req.title,
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
      title: req.title ?? current.title,
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
    return withStepCount(next);
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
    return withStepCount(clone);
  },
};

/** Reset store về seed — phục vụ test. */
export function __resetMockStore(): void {
  state = buildSeed();
}
