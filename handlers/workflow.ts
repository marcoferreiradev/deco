import { WorkflowService } from "https://denopkg.dev/gh/mcandeia/deno-workflows@main/mod.ts";
import { Handler } from "./handler.ts";

const workflowRouteFor = (alias: string, svc: WorkflowService): Handler => {
  return async (req) => {
    const instance = await svc.startWorkflow({ alias }, [{}, await req.json()]);
    return Response.json(instance);
  };
};

const workflowGet =
  (svc: WorkflowService): Handler =>
  async (req) => {
    const splitted = req.url.split("/");
    return Response.json(await svc.runWorkflow(splitted[-1]));
  };

export const buildWorkflowRoutesFor = (
  svc: WorkflowService,
  path: string,
  aliases: string[]
): [Record<string, Handler>, Handler] => {
  return [
    aliases.reduce(
      (routes, alias) => ({
        ...routes,
        [`${path}/${alias}`]: workflowRouteFor(alias, svc),
      }),
      {}
    ),
    workflowGet(svc),
  ];
};
