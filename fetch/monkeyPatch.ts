/** Monkey patch fetch */

import { createFetch as withCache } from "./fetchCache.ts";
import { createFetch as withLogs } from "./fetchLog.ts";

console.log("monkey patching fetch");

globalThis.fetch = [
  withLogs,
  withCache,
].reduceRight((acc, curr) => curr(acc), globalThis.fetch);
window.fetch = globalThis.fetch
