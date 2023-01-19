import { Workflow, workflowHTTPHandler } from "$workflows/mod.ts";
import { Routes } from "https://deno.land/x/rutt@0.0.13/mod.ts";
import { Handler, router } from "https://deno.land/x/rutt@0.0.14/mod.ts";
import { WorkflowModule } from "../types.ts";

const routesFor = (
  route: string,
  workflow: Workflow,
): Routes => ({
  [`POST@${route}`]: workflowHTTPHandler(workflow),
});

export type Workflows = Record<string, WorkflowModule>;
export const workflowsRoutes = async (
  workflowsAPIAddr: string,
  base: string,
  workflows: Workflows,
): Promise<Handler> => {
  let routes: Routes = {};
  const routePaths: { path: string; alias: string }[] = [];
  for (const [_, workflow] of Object.entries(workflows)) {
    const alias = workflow.default.name;
    const path = `${base}/${alias}`;
    routes = {
      ...routes,
      ...routesFor(path, workflow.default),
    };
    routePaths.push({ path, alias });
  }
  await Promise.all(routePaths.map(({ path, alias }) => {
    fetch(`${workflowsAPIAddr}/workflows/${alias}`, {
      method: "PUT",
      body: JSON.stringify({
        url: `http://localhost:8000${path}`,
        type: "http",
      }),
    });
  }));
  return router(routes);
};
