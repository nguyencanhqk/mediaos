import { Injectable } from '@nestjs/common';
import type { CanInput, IPermissionRepository, PermissionDecision } from './permission.types';

@Injectable()
export class PermissionService {
  constructor(readonly repo: IPermissionRepository) {}

  // G3-2 stub — always deny-default until real algorithm is implemented
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async can(_input: CanInput): Promise<PermissionDecision> {
    return { allow: false, reason: 'deny-default', auditRequired: false };
  }
}
