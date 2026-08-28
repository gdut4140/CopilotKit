import { ComponentContext, GenericBinder } from "@a2ui/web_core/v0_9";
import type { SurfaceModel } from "@a2ui/web_core/v0_9";
import { renderToIR } from "@copilotkit/channels-core";
import type { ChannelNode, Renderable } from "@copilotkit/channels-core";
import type { ChannelA2UIComponentImplementation } from "./types.js";

export class A2UIIncompleteSurfaceError extends Error {
  constructor(componentId = "root") {
    super(`A2UI surface is waiting for component "${componentId}"`);
    this.name = "A2UIIncompleteSurfaceError";
  }
}

export class A2UIUnsupportedComponentError extends Error {
  constructor(readonly componentName: string) {
    super(`Unsupported A2UI component "${componentName}"`);
    this.name = "A2UIUnsupportedComponentError";
  }
}

export function lowerSurface(
  surface: SurfaceModel<ChannelA2UIComponentImplementation>,
): ChannelNode[] {
  const lower = (
    componentId: string,
    basePath: string,
    ancestors: ReadonlySet<string>,
  ): ChannelNode[] => {
    if (ancestors.has(componentId)) {
      throw new Error(`Cyclic A2UI component reference at "${componentId}"`);
    }
    const model = surface.componentsModel.get(componentId);
    if (!model) throw new A2UIIncompleteSurfaceError(componentId);
    const implementation = surface.catalog.components.get(model.type);
    if (!implementation) {
      throw new A2UIUnsupportedComponentError(model.type);
    }
    const context = new ComponentContext(surface, componentId, basePath);
    const binder = new GenericBinder<Record<string, unknown>>(
      context,
      implementation.schema,
    );
    const nextAncestors = new Set(ancestors);
    nextAncestors.add(componentId);
    const children = (id: string, specificPath?: string): Renderable =>
      lower(id, specificPath ?? context.dataContext.path, nextAncestors);
    try {
      return renderToIR(
        implementation.lower(binder.snapshot ?? {}, {
          componentId,
          surfaceId: surface.id,
          rawProps: model.properties,
          children,
          dispatch: (action) => context.dispatchAction(action),
        }),
      );
    } finally {
      binder.dispose();
    }
  };

  return lower("root", "/", new Set());
}
