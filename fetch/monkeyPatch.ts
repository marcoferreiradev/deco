/** Monkey patch fetch */

import { createFetch as withCache } from "./fetchCache.ts";
import { createFetch as withLogs } from "./fetchLog.ts";

globalThis.fetch = [
  withCache,
  withLogs,
].reduce((acc, curr) => curr(acc), globalThis.fetch);
