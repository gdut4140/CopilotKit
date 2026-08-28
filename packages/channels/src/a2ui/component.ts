import type { ComponentApi } from "@a2ui/web_core/v0_9";
import type {
  ChannelA2UIComponentImplementation,
  ChannelA2UIRenderer,
} from "./types.js";

export function defineChannelA2UIComponent<Props>(
  api: ComponentApi,
  renderer: ChannelA2UIRenderer<Props>,
): ChannelA2UIComponentImplementation {
  return {
    name: api.name,
    schema: api.schema,
    lower(props, context) {
      return renderer({
        props: props as unknown as Props,
        componentId: context.componentId,
        surfaceId: context.surfaceId,
        rawProps: context.rawProps,
        children: context.children,
        dispatch: context.dispatch,
      });
    },
  };
}
