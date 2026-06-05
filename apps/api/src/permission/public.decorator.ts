import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'IS_PUBLIC';

/** Mark a route or controller as public — all guards (JWT, Company, Permission) skip it. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
