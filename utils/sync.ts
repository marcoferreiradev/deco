import { Lock } from "https://deno.land/x/async@v1.2.0/mod.ts";

/**
 * runs the given function only once while putting other calls awaiting for the result.
 * @param f the desired function to run only once
 * @returns the once function.
 */
export const once = (f: () => void): (() => Promise<void>) => {
  let ran = false;
  const mu = new Lock();
  return async () => {
    if (ran) {
      return;
    }
    await mu.acquire();
    if (ran) {
      mu.release();
      return;
    }
    ran = true;
    f();
    mu.release();
  };
};
