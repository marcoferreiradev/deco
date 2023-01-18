import { MiddlewareHandlerContext } from "https://deno.land/x/fresh@1.1.2/server.ts";
import { LiveState } from "$live/types.ts";

export type Handler = (
  req: Request,
  ctx: MiddlewareHandlerContext<LiveState>
) => Promise<Response>;

export const noopHandler = (
  _: Request,
  ctx: MiddlewareHandlerContext<LiveState>
): Promise<Response> => {
  return ctx.next();
};
