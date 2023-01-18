// deno-lint-ignore-file no-explicit-any
import { HandlerContext } from "$fresh/server.ts";
import { Arg } from "https://denopkg.dev/gh/mcandeia/deno-workflows@main/types.ts";
import { Workflow } from "https://denopkg.dev/gh/mcandeia/deno-workflows@main/workflow.ts";

export type LoaderFunction<Props = any, Data = any, State = any> = (
  req: Request,
  ctx: HandlerContext<any, State>,
  props: Props
) => Promise<{ data: Data } & Partial<Pick<Response, "status" | "headers">>>;

export type WorkflowFunction<TProps = any, TResult = any> = Workflow<
  [TProps, ...Arg],
  TResult
>;

export type MatchDuration = "request" | "session";

export type MatchFunction<Props = any, Data = any, State = any> = (
  req: Request,
  ctx: HandlerContext<Data, State>,
  props: Props
) => { isMatch: boolean; duration: MatchDuration };

export type EffectFunction<Props = any, Data = any, State = any> = (
  req: Request,
  ctx: HandlerContext<Data, State>,
  props: Props
) => void;

export type LoaderReturnType<O = unknown> = O;
