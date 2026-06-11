/**
 * Workflow Templates (G7-1c) — domain errors cho aggregate template.
 * Service ném các error này; controller/catch map sang HTTP exception.
 */

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
