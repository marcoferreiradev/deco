interface KVData {
  status: number;
  headers: [string, string][];
  chunks: number;
}

export const sha1 = async (text: string) => {
  const buffer = await crypto.subtle
    .digest("SHA-1", new TextEncoder().encode(text));

  const hex = Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return hex;
};

export const kvCacheStorage = (): CacheStorage => {
  const CHUNK_SIZE = 64_000; // 64Kb
  const NAMESPACE = "CACHES";

  return {
    delete: (_cacheName: string): Promise<boolean> => {
      throw new Error("Not Implemented");
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

      const assertNoOptions = (
        { ignoreMethod, ignoreSearch, ignoreVary }: CacheQueryOptions = {},
      ) => {
        if (ignoreMethod || ignoreSearch || ignoreVary) {
          throw new Error("Not Implemented");
        }
      };

      const keyForRequest = async (request: RequestInfo | URL) => {
        const url = typeof request === "string"
          ? request
          : request instanceof URL
          ? request.href
          : request.url;

        return [NAMESPACE, cacheName, await sha1(url)];
      };

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
          const entry = await kv.get<KVData>(key, { consistency: "eventual" });

          if (!entry.versionstamp) return true;

          await kv.delete(key);

          const chunks = entry.value?.chunks ?? 0;
          for (let chunk = 0; chunk < chunks; chunk++) {
            await kv.delete([...key, chunks]).catch(console.error);
          }

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
          const entry = await kv.get<KVData>(key, { consistency: "eventual" });

          if (!entry.value) return;

          const { headers, chunks, status } = entry.value;

          const stream = new ReadableStream<Uint8Array>({
            start: async (controller) => {
              try {
                const batchSize = 10;

                for (let it = 0; it < chunks; it += batchSize) {
                  const keys = new Array(batchSize)
                    .fill(0)
                    .map((_, index) => index + it)
                    .filter((chunk) => chunk < chunks)
                    .map((chunk) => [...key, chunk]);

                  const entries = await kv.getMany(keys, {
                    consistency: "eventual",
                  });

                  for (const { value } of entries) {
                    controller.enqueue(value as Uint8Array);
                  }
                }

                controller.close();
              } catch (error) {
                controller.error(error);
              }
            },
          });

          return new Response(stream, { headers, status });
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

          let chunk = 0;
          const reader = response.body?.getReader();
          if (reader) {
            for (chunk = 0; true;) {
              const { value, done } = await reader.read();

              if (value) {
                for (let ch = 0; ch * CHUNK_SIZE < value.byteLength; ch++) {
                  const sliced = value.slice(
                    ch * CHUNK_SIZE,
                    (ch + 1) * CHUNK_SIZE,
                  );
                  await kv.set([...key, chunk], sliced).catch(console.error);
                  chunk++;
                }
              }

              if (done) break;
            }
          }

          const payload: KVData = {
            chunks: chunk,
            status: response.status,
            headers: [...response.headers.entries()],
          };

          await kv.set(key, payload);
        },
      };
    },
  };
};

export const getCacheStorage = (): CacheStorage | null => {
  if (typeof Deno.openKv === "function") {
    return kvCacheStorage();
  }

  if (typeof caches !== "undefined") {
    return caches;
  }

  return null;
};
