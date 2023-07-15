import { File } from "./manifest.ts";
export interface Props {
  content: string;
  path: string;
}

export default function File({ content, path }: Props): File {
  return { content, path };
}
