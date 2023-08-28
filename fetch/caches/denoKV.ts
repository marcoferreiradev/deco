import { sha1 } from "./utils.ts";

interface KVData {
  etag: string | null;
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

export const getCacheStorageKV = (): CacheStorage => {
  const NAMESPACE = "CACHES";
  const MAX_KV_ENTRIES = 50;
  const HOUSEKEEPING_INTERVAL_MS = 1_000; // 5 * 60 * 1000; // 5minutes

  const SMALL_EXPIRE_MS = 1 * 1000; // 1second
  const LARGE_EXPIRE_MS = 3600 * 1000; // 1hour

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

      const remove = async (key: string) => {
        const prefix = [NAMESPACE, cacheName, key];

        const entry = await kv.get<KVData>(prefix);
        await kv.delete(prefix);

        const etag = entry.value?.etag;

        if (!etag) return;

        for await (const entry of kv.list({ prefix: [...prefix, etag] })) {
          await kv.set(entry.key, entry.value, { expireIn: SMALL_EXPIRE_MS });
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

      // Evicts cache
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

          const entry = await kv.get<KVData>(key, {
            consistency: "eventual",
          });

          if (!entry.value) {
            return;
          }

          const { headers, status, etag } = entry.value;

          // Stream body from KV
          let iterator = 0;
          const MAX_KV_BATCH_SIZE = 10;
          const body = etag
            ? new ReadableStream({
              async pull(controller) {
                try {
                  const keys = new Array(MAX_KV_BATCH_SIZE)
                    .fill(0)
                    .map((_, index) => index + iterator)
                    .map((chunk) => [...key, etag, chunk]);

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
                  controller.error(error);
                }
              },
            })
            : null;

          return new Response(body, { headers, status });
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

          // Remove previous cache
          const removing = remove(key.at(-1)!);

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

          // Save each file chunk
          const etag = crypto.randomUUID();
          const reader = kvChunks.readable.getReader();
          for (let chunk = 0; true; chunk++) {
            const { value, done } = await reader.read();

            if (done) break;

            await kv.set([...key, etag, chunk], value, {
              expireIn: LARGE_EXPIRE_MS + SMALL_EXPIRE_MS,
            });
          }

          await removing;

          // Save file metadata
          await kv.set(
            key,
            {
              etag: response.body ? etag : null,
              status: response.status,
              headers: [...response.headers.entries()],
            } satisfies KVData,
            {
              expireIn: LARGE_EXPIRE_MS,
            },
          );
        },
      };
    },
  };
};
