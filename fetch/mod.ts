import { createFetch as withCache } from "./fetchCache.ts";
import { createFetch as withLogs } from "./fetchLog.ts";

export const fetcher = [
  withLogs,
  withCache,
].reduceRight((acc, curr) => curr(acc), globalThis.fetch);
