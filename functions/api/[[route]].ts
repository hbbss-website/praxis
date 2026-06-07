import type { Env } from '../../backend/src/cf/env';
import { cfApi } from '../../backend/src/cf/app';

export const onRequest: PagesFunction<Env> = (context) => {
  return cfApi.fetch(context.request, context.env, context.executionCtx);
};
