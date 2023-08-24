/** Monkey patch fetch */

import { createFetch as withCache } from "./fetchCache.ts";
import { createFetch as withLogs } from "./fetchLog.ts";

const DecoFetch = [
  withLogs,
  withCache,
].reduceRight((acc, curr) => curr(acc), globalThis.fetch);

function fetcher(input: URL | RequestInfo, init?: RequestInit | undefined) {
  return DecoFetch(input, init);
}

globalThis.fetch = fetcher;
window.fetch = fetcher;
self.fetch = fetcher;


