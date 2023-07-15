import { DecoManifest } from "$live/types.ts";
import * as esbuildWasm from "https://deno.land/x/esbuild@v0.17.19/wasm.js";

export interface File {
  content: string;
  path: string;
}

export interface Props {
  files: File[];
}

const esbuildWasmURL = new URL("./esbuild_v0.17.19.wasm", import.meta.url).href;

await esbuildWasm.initialize({
  wasmURL: esbuildWasmURL,
  worker: false,
});

type BlocksManifest = Omit<DecoManifest, "islands" | "routes" | "baseUrl">;
export default async function Manifest(
  { files }: Props,
): Promise<DecoManifest> {
  const manifest: BlocksManifest = {};
  for (const { path, content } of files) {
    const type = path.split("/")[2];
    const typeKey = type as keyof BlocksManifest;
    manifest[typeKey] ??= {};

    const result = await esbuildWasm.transform(content, {
      loader: "tsx",
      format: "esm",
      jsx: "automatic",
      jsxImportSource: "preact",
    });
    const encodedJs = encodeURIComponent(result.code);
    const dataUri = "data:text/javascript;charset=utf-8," +
      encodedJs;
    manifest[typeKey]![path] = await import(dataUri);
  }

  return manifest as DecoManifest;
}
