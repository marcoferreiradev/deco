// deno-lint-ignore-file no-explicit-any
import { HttpContext } from "$live/blocks/handler.ts";
import StubSection from "$live/components/StubSection.tsx";
import {
  AsyncComponentFunc,
  Block,
  BlockModule,
  ComponentFunc,
  InstanceOf,
  PreactComponent,
} from "$live/engine/block.ts";
import {
  AsyncResolver,
  BaseContext,
  Resolver,
} from "$live/engine/core/resolver.ts";
import { StatefulContext } from "$live/types.ts";
import { JSX } from "preact";
import { PromiseOrValue } from "../engine/core/utils.ts";

const isAsyncComponent = <TProps = any>(
  f: ComponentFunc<TProps> | AsyncComponentFunc<TProps>,
): f is AsyncComponentFunc<TProps> => {
  return f?.constructor?.name === "AsyncFunction";
};

export type Section = InstanceOf<typeof sectionBlock, "#/root/sections">;
// deno-lint-ignore ban-types
export type SectionContext<TState = {}> = StatefulContext<TState>;

export type SectionModule<TProps = any> = BlockModule<
  ComponentFunc<TProps> | AsyncComponentFunc<TProps, SectionContext>,
  JSX.Element | null | (PromiseOrValue<() => JSX.Element | null>),
  PreactComponent
>;

const sectionBlock: Block<SectionModule> = {
  type: "sections",
  introspect: [{
    default: "0",
  }],
  adapt: <TProps = any>(
    mod: SectionModule<TProps>,
    component: string,
  ):
    | Resolver<PreactComponent<JSX.Element | null, TProps>, TProps, BaseContext>
    | AsyncResolver<
      PreactComponent,
      TProps,
      HttpContext
    > => {
    const compFunc = mod.default;
    if (isAsyncComponent(compFunc)) {
      return async (
        props: TProps,
        { resolveChain, request, context }: HttpContext,
      ): Promise<PreactComponent> => {
        const result = await compFunc(props, request, context);
        return {
          Component: result,
          props: {},
          metadata: {
            component,
            resolveChain,
            id: resolveChain.length > 0 ? resolveChain[0] : undefined,
          },
        };
      };
    }
    return (
      props: TProps,
      { resolveChain }: BaseContext,
    ): PreactComponent<JSX.Element | null, TProps> => {
      return {
        Component: compFunc as ComponentFunc,
        props,
        metadata: {
          component,
          resolveChain,
          id: resolveChain.length > 0 ? resolveChain[0] : undefined,
        },
      };
    };
  },
  defaultDanglingRecover: (_, ctx) => {
    return {
      Component: StubSection,
      props: {
        component: ctx.resolveChain[ctx.resolveChain.length - 1],
      },
    };
  },
  defaultPreview: (comp) => comp,
};

/**
 * (props:TProps) => JSX.Element
 * Section are PreactComponents
 */
export default sectionBlock;
