/**
 * Workflow Templates (G7-1c) — domain errors cho aggregate template.
 * Service ném các error này; controller/catch map sang HTTP exception.
 */

import type { DagValidationResultDto } from "@mediaos/contracts";

/** Template không tồn tại trong tenant (hoặc đã soft-delete). */
export class TemplateNotFoundError extends Error {
  constructor(id: string) {
    super(`Workflow template not found: ${id}`);
    this.name = "TemplateNotFoundError";
  }
}

/** D4: published version BẤT BIẾN — chỉ draft sửa/xoá được. Sửa published = clone version+1 (2b). */
export class TemplatePublishedImmutableError extends Error {
  readonly status: string;

  constructor(id: string, status: string) {
    super(`Workflow template ${id} is '${status}' and immutable — only draft can be edited (clone to a new version)`);
    this.name = "TemplatePublishedImmutableError";
    this.status = status;
  }
}

/**
 * G7-2b — publish was blocked because the template's step-dependency graph is invalid
 * (cycle / orphan / no-root …). Carries the contract-shaped result so the API can return
 * the full error list to the builder. Maps to HTTP 422 (well-formed request, invalid graph).
 */
export class TemplateDagInvalidError extends Error {
  readonly result: DagValidationResultDto;

  constructor(result: DagValidationResultDto) {
    super("Workflow template DAG is invalid — fix the dependency errors before publishing");
    this.name = "TemplateDagInvalidError";
    this.result = result;
  }
}
