import { getCacheStorageKV } from "./denoKV.ts";

export const getCacheStorage = (): CacheStorage | null => {
  if (typeof Deno.openKv === "function") {
    return getCacheStorageKV();
  }

  if (typeof caches !== "undefined") {
    return caches;
  }

  return null;
};
