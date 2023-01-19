import { Handler } from "https://deno.land/x/rutt@0.0.14/mod.ts";

export const noopHandler: Handler = (): Promise<Response> => {
  return Promise.resolve(Response.json({}, { status: 404 }));
};
