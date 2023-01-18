import { MiddlewareHandlerContext } from "https://deno.land/x/fresh@1.1.2/server.ts";
import { LiveState } from "$live/types.ts";

export type PathParams = { params: Record<string, string> };

export type Handler = (
  req: Request,
  ctx: MiddlewareHandlerContext<LiveState>
) => Promise<Response>;

export type MethodHandler = (
  req: Request,
  pathParams: PathParams,
  ctx: MiddlewareHandlerContext<LiveState>
) => Promise<Response>;

export const noopHandler = (
  _: Request,
  ctx: MiddlewareHandlerContext<LiveState>
): Promise<Response> => {
  return ctx.next();
};
