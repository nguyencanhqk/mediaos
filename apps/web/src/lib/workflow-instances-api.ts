import { z } from "zod";
import { apiFetch } from "@mediaos/web-core";
import {
  instanceDetailSchema,
  instanceSchema,
  type InstanceDetailDto,
  type InstanceDto,
} from "./workflow-builder/contract";
import { mockInstancesStore } from "./workflow-builder/instance-mock-store";

/**
 * Client cho workflow INSTANCE (3d, read-only view).
 * MOCK mặc định BẬT tới khi LUỒNG A ship endpoint — `VITE_WORKFLOW_MOCK=false` để dùng API thật.
 */
export interface WorkflowInstancesApi {
  list(): Promise<InstanceDto[]>;
  get(id: string): Promise<InstanceDetailDto>;
}

const BASE = "/workflow/instances";

const realInstancesApi: WorkflowInstancesApi = {
  list: () => apiFetch(BASE, z.array(instanceSchema)),
  get: (id) => apiFetch(`${BASE}/${id}`, instanceDetailSchema),
};

const USE_MOCK = import.meta.env.VITE_WORKFLOW_MOCK !== "false";

export const workflowInstancesApi: WorkflowInstancesApi = USE_MOCK
  ? mockInstancesStore
  : realInstancesApi;
