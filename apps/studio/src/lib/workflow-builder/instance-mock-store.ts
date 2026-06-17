import type {
  DependencyDto,
  InstanceDetailDto,
  InstanceDto,
  InstanceStepDto,
  StepInstanceStatus,
} from "./contract";

/**
 * Mock store cho workflow INSTANCE (3d) — read-only view tô màu theo status.
 * Bật khi BE chưa ship endpoint instance (toggle ở `workflow-instances-api.ts`).
 * Seed một instance fork ĐANG CHẠY (2 bước song song in_progress) để minh hoạ đa-bước-song-song.
 */

const COMPANY = "00000000-0000-4000-8000-000000000001";
const USER = "00000000-0000-4000-8000-0000000000aa";

const delay = (ms = 120): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface SeedStep {
  key: string;
  order: number;
  name: string;
  status: StepInstanceStatus;
  x: number;
  y: number;
}

function makeInstanceSteps(instanceId: string, defs: SeedStep[]): InstanceStepDto[] {
  return defs.map((d) => ({
    id: `${instanceId}-${d.key}`,
    companyId: COMPANY,
    workflowInstanceId: instanceId,
    nodeKey: d.key,
    stepOrder: d.order,
    stepCode: d.key,
    stepName: d.name,
    status: d.status,
    assigneeUserId: USER,
    reviewerUserId: USER,
    positionX: d.x,
    positionY: d.y,
  }));
}

function edge(instanceId: string, from: string, to: string): DependencyDto {
  return {
    id: `${instanceId}-${from}-${to}`,
    companyId: COMPANY,
    workflowDefinitionId: instanceId,
    fromStepId: `${instanceId}-${from}`,
    toStepId: `${instanceId}-${to}`,
    dependencyType: "finish_to_start",
    createdAt: "2026-06-08T00:00:00.000Z",
  };
}

// ─── Seed ─────────────────────────────────────────────────────────────────────

const SOCIAL_INSTANCE = "c0000000-0000-4000-8000-000000000001";
const VIDEO_INSTANCE = "c0000000-0000-4000-8000-000000000002";

const socialSteps = makeInstanceSteps(SOCIAL_INSTANCE, [
  { key: "brief", order: 1, name: "Lên brief chiến dịch", status: "approved", x: 220, y: 40 },
  { key: "design", order: 2, name: "Thiết kế ấn phẩm", status: "in_progress", x: 60, y: 200 },
  { key: "copy", order: 3, name: "Viết nội dung", status: "in_progress", x: 380, y: 200 },
  { key: "review", order: 4, name: "Duyệt & lên lịch", status: "not_started", x: 220, y: 360 },
]);
const socialDeps = [
  edge(SOCIAL_INSTANCE, "brief", "design"),
  edge(SOCIAL_INSTANCE, "brief", "copy"),
  edge(SOCIAL_INSTANCE, "design", "review"),
  edge(SOCIAL_INSTANCE, "copy", "review"),
];

const videoSteps = makeInstanceSteps(VIDEO_INSTANCE, [
  { key: "script", order: 1, name: "Viết kịch bản", status: "approved", x: 40, y: 40 },
  { key: "edit", order: 2, name: "Dựng video", status: "approved", x: 40, y: 180 },
  { key: "qa", order: 3, name: "Kiểm tra chất lượng", status: "waiting_review", x: 40, y: 320 },
  { key: "upload", order: 4, name: "Upload lên kênh", status: "not_started", x: 40, y: 460 },
]);
const videoDeps = [
  edge(VIDEO_INSTANCE, "script", "edit"),
  edge(VIDEO_INSTANCE, "edit", "qa"),
  edge(VIDEO_INSTANCE, "qa", "upload"),
];

const instances: { instance: InstanceDto; steps: InstanceStepDto[]; deps: DependencyDto[] }[] = [
  {
    instance: {
      id: SOCIAL_INSTANCE,
      companyId: COMPANY,
      workflowDefinitionId: "b0000000-0000-4000-8000-000000000001",
      definitionVersion: 1,
      contentItemId: null,
      projectId: "d0000000-0000-4000-8000-000000000001",
      status: "active",
      templateName: "Chiến dịch social (song song)",
      createdAt: "2026-06-09T02:00:00.000Z",
    },
    steps: socialSteps,
    deps: socialDeps,
  },
  {
    instance: {
      id: VIDEO_INSTANCE,
      companyId: COMPANY,
      workflowDefinitionId: "a0000000-0000-4000-8000-000000000001",
      definitionVersion: 1,
      contentItemId: "e0000000-0000-4000-8000-000000000001",
      projectId: null,
      status: "active",
      templateName: "Video chuẩn MVP-0",
      createdAt: "2026-06-08T08:00:00.000Z",
    },
    steps: videoSteps,
    deps: videoDeps,
  },
];

// ─── Public mock API ────────────────────────────────────────────────────────

export const mockInstancesStore = {
  async list(): Promise<InstanceDto[]> {
    await delay();
    return instances.map((x) => x.instance);
  },

  async get(id: string): Promise<InstanceDetailDto> {
    await delay();
    const found = instances.find((x) => x.instance.id === id);
    if (!found) throw new Error(`Không tìm thấy instance ${id}.`);
    return { instance: found.instance, steps: found.steps, dependencies: found.deps };
  },
};
