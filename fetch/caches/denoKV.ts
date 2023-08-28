import { sha1 } from "./utils.ts";

interface KVData {
  hasBody?: boolean;
  status: number;
  headers: [string, string][];
}

/** LRU index used for housekeeping KV */
const createIndex = (size: number, onEvict?: (key: string) => void) => {
  const index = new Set<string>();

  return {
    touch: (key: string) => {
      const has = index.has(key);

      if (!has && index.size > size) {
        const evicted = index.keys().next().value;
        index.delete(evicted);
        onEvict?.(evicted);
      }

      index.delete(key);
      index.add(key);
    },
  };
};

const createReadWriteLock = (kv: Deno.Kv, namespace: string[]) => {
  type KVLock = number | "write" | null;

  const MAX_RETRIES = 10;

  const release = (key: string[], mode: "read" | "write") => {
    for (let retry = 0; retry < MAX_RETRIES; retry++) {
      
    }
  };

  return {
    acquire: async (
      key: string,
      mode: "read" | "write",
    ): Promise<() => Promise<void>> => {
      const prefix = [...namespace, key];

      for (let retry = 0; retry < MAX_RETRIES; retry++) {
        const entry = await kv.get<KVLock>(prefix);

        if (entry.value === null || entry.value === 0) {
          const res = await kv
            .atomic()
            .check(entry)
            .set(prefix, mode === "read" ? 0 : "write")
            .commit();

          // someone acquired it first, retry
          if (!res.ok) continue;

          // lock acquired
          return mode === "write"
            ? () => kv.set(prefix, null)
            : () => kv.atomic().sum(prefix, -1n).commit();
        }

        if (mode === "read") {
          if (entry.value === "write") continue;

          const res = await kv
            .atomic()
            .check(entry)
            .set(prefix, entry.value + 1)
            .commit();

          if (!res.ok) continue;

          return () => kv.atomic().sum(prefix, -1n).commit();
        }

        if (mode === "write") {
          if (entry.value !== "write") continue;

          const res = await kv
            .atomic()
            .check(entry)
            .set(prefix, "write")
            .commit();

          if (!res.ok) continue;

          return () => kv.set(prefix, null);
        }
      }
    },
  };
};

export const getCacheStorageKV = (): CacheStorage => {
  const NAMESPACE = "CACHES";
  const MAX_KV_ENTRIES = 5; // 1_000;
  const HOUSEKEEPING_INTERVAL_MS = 5_000; // 5 * 60 * 1000; // 5minutes

  return {
    delete: async (cacheName: string): Promise<boolean> => {
      const kv = await Deno.openKv();

      for await (
        const entry of kv.list({ prefix: [NAMESPACE, cacheName] })
      ) {
        await kv.delete(entry.key);
      }

      return true;
    },
    has: (_cacheName: string): Promise<boolean> => {
      throw new Error("Not Implemented");
    },
    keys: (): Promise<string[]> => {
      throw new Error("Not Implemented");
    },
    match: (
      _request: URL | RequestInfo,
      _options?: MultiCacheQueryOptions | undefined,
    ): Promise<Response | undefined> => {
      throw new Error("Not Implemented");
    },
    open: async (cacheName: string): Promise<Cache> => {
      const kv = await Deno.openKv();
      const lock = createReadWriteLock(kv, [NAMESPACE, "locks", cacheName]);

      const remove = async (key: string) => {
        const prefix = [NAMESPACE, cacheName, key];

        await kv.delete(prefix);

        const release = await lock.acquire(key, "write");
        try {
          for await (
            const entry of kv.list({ prefix }, { consistency: "eventual" })
          ) {
            await kv.delete(entry.key);
          }
        } finally {
          await release();
        }
      };

      const lru = createIndex(MAX_KV_ENTRIES, remove);

      const assertNoOptions = (
        { ignoreMethod, ignoreSearch, ignoreVary }: CacheQueryOptions = {},
      ) => {
        if (ignoreMethod || ignoreSearch || ignoreVary) {
          throw new Error("Not Implemented");
        }
      };

      const keyForRequest = async (request: RequestInfo | URL) => {
        const key = await sha1(
          typeof request === "string"
            ? request
            : request instanceof URL
            ? request.href
            : request.url,
        );

        lru.touch(key);

        return [NAMESPACE, cacheName, key];
      };

      // Runs once at every 5minutes
      setInterval(async () => {
        const keys = [NAMESPACE, cacheName];

        for await (
          const entry of kv.list({ prefix: keys }, { consistency: "eventual" })
        ) {
          const last = entry.key.at(-1);

          if (typeof last !== "string") continue;

          lru.touch(last);
        }
      }, HOUSEKEEPING_INTERVAL_MS);

      return {
        /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/Cache/add) */
        add: (_request: RequestInfo | URL): Promise<void> => {
          throw new Error("Not Implemented");
        },
        /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/Cache/addAll) */
        addAll: (_requests: RequestInfo[]): Promise<void> => {
          throw new Error("Not Implemented");
        },
        /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/Cache/delete) */
        delete: async (
          request: RequestInfo | URL,
          options?: CacheQueryOptions,
        ): Promise<boolean> => {
          assertNoOptions(options);

          const key = await keyForRequest(request);
          await remove(key.at(-1)!);

          return true;
        },
        /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/Cache/keys) */
        keys: (
          _request?: RequestInfo | URL,
          _options?: CacheQueryOptions,
        ): Promise<ReadonlyArray<Request>> => {
          throw new Error("Not Implemented");
        },
        /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/Cache/match) */
        match: async (
          request: RequestInfo | URL,
          options?: CacheQueryOptions,
        ): Promise<Response | undefined> => {
          assertNoOptions(options);

          const key = await keyForRequest(request);

          const release = await lock.acquire(key.at(-1)!, "read");

          try {
            const entry = await kv.get<KVData>(key, {
              consistency: "eventual",
            });

            if (!entry.value) {
              await release();

              return;
            }

            const { headers, status, hasBody } = entry.value;

            // Stream body from KV
            let iterator = 0;
            const MAX_KV_BATCH_SIZE = 10;
            const body = hasBody
              ? new ReadableStream({
                async pull(controller) {
                  try {
                    const keys = new Array(MAX_KV_BATCH_SIZE)
                      .fill(0)
                      .map((_, index) => index + iterator)
                      .map((chunk) => [...key, chunk]);

                    const entries = await kv.getMany(keys, {
                      consistency: "eventual",
                    }).then((response) =>
                      response.filter((entry) => entry.versionstamp !== null)
                    );

                    if (entries.length === 0) return controller.close();

                    for (const { value } of entries) {
                      controller.enqueue(value as Uint8Array);
                    }

                    iterator += MAX_KV_BATCH_SIZE;
                  } catch (error) {
                    await release();
                    controller.error(error);
                  }
                },
              })
              : null;

            return new Response(body, { headers, status });
          } catch {
            await release();
          }
        },
        /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/Cache/matchAll) */
        matchAll: (
          _request?: RequestInfo | URL,
          _options?: CacheQueryOptions,
        ): Promise<ReadonlyArray<Response>> => {
          throw new Error("Not Implemented");
        },
        /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/Cache/put) */
        put: async (
          request: RequestInfo | URL,
          response: Response,
        ): Promise<void> => {
          const req = new Request(request);

          if (!/^http(s?):\/\//.test(req.url)) {
            throw new TypeError(
              "Request url protocol must be 'http:' or 'https:'",
            );
          }
          if (req.method !== "GET") {
            throw new TypeError("Request method must be GET");
          }

          if (response.status === 206) {
            throw new TypeError("Response status must not be 206");
          }

          const key = await keyForRequest(req);

          // Transform 8Kb stream into 64Kb KV stream
          let accumulator = new Uint8Array();
          const KV_CHUNK_SIZE = 65536; // 64Kb
          const kvChunks = new TransformStream({
            transform(chunk, controller) {
              if (
                accumulator.byteLength + chunk.byteLength > KV_CHUNK_SIZE
              ) {
                controller.enqueue(accumulator);

                accumulator = new Uint8Array(chunk);
              } else {
                accumulator = new Uint8Array([
                  ...accumulator,
                  ...chunk,
                ]);
              }
            },
            flush(controller) {
              if (accumulator.byteLength > 0) {
                controller.enqueue(accumulator);
              }
            },
          });

          response.body?.pipeThrough(kvChunks);

          const release = await lock.acquire(key.at(-1)!, "write");

          try {
            // Save each chunk
            const reader = kvChunks.readable.getReader();
            for (let chunk = 0; true; chunk++) {
              const { value, done } = await reader.read();

              if (done) break;

              await kv.set([...key, chunk], value);
            }

            // Save initial pointer file
            await kv.set(
              key,
              {
                hasBody: Boolean(response.body),
                status: response.status,
                headers: [...response.headers.entries()],
              } satisfies KVData,
            );
          } finally {
            await release();
          }
        },
      };
    },
  };
};
