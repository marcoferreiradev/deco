import { MultivariateFlag } from "../blocks/flag.ts";
import { Section } from "../blocks/section.ts";

import {
  default as mutlivariate,
  MultivariateProps,
  onBeforeResolveProps,
} from "./multivariate.ts";
export { onBeforeResolveProps };

export default function MultivariateSection(
  props: MultivariateProps<Section>,
): MultivariateFlag<Section> {
  return mutlivariate(props);
}
