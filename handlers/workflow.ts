import { WorkflowService } from "$workflows/mod.ts";
import { Handler, MethodHandler } from "./handler.ts";

const startWorkflowHandler = (svc: WorkflowService): MethodHandler => {
  return async (req, { params: { alias } }) => {
    const { props, input } = await req.json();
    return Response.json(await svc.startWorkflow({ alias }, [props, input]));
  };
};

const workflowGetHandler =
  (svc: WorkflowService): MethodHandler =>
  async (_, { params: { id } }) => {
    return Response.json(await svc.runWorkflow(id));
  };

const signalWorkflowHandler =
  (svc: WorkflowService): MethodHandler =>
  async (req, { params: { id, signal } }) => {
    await svc.signalWorkflow(id, signal, await req.json());
    return Response.json({
      message: "signal received",
    });
  };

type HTTPVerb = "POST" | "GET";
const handlers = (
  base: string,
  svc: WorkflowService
): Record<string, Partial<Record<HTTPVerb, MethodHandler>>> => ({
  [`${base}/:alias`]: {
    POST: startWorkflowHandler(svc),
  },
  [`${base}/:alias/:id`]: {
    GET: workflowGetHandler(svc),
  },
  [`${base}/:alias/:id/signals/:signal`]: {
    POST: signalWorkflowHandler(svc),
  },
});

export const workflowRoutes = (base: string, svc: WorkflowService): Handler => {
  const builtHandlers = handlers(base, svc);
  return (req, ctx): Promise<Response> => {
    for (const [route, handler] of Object.entries(builtHandlers)) {
      const pattern = new URLPattern({ pathname: route });
      if (pattern.test(req.url)) {
        const optsParams = pattern.exec(req.url);
        const methodHandler = handler[req.method as HTTPVerb];
        if (methodHandler !== undefined) {
          return methodHandler(
            req,
            { params: optsParams?.pathname.groups! },
            ctx
          );
        }
      }
    }
    return Promise.resolve(Response.json({}));
  };
};
