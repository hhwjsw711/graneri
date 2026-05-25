import { HoverCard as HoverCardPrimitive } from "radix-ui";
import { HoverCardContent } from "./hover-card-content";
import { HoverCardTrigger } from "./hover-card-trigger";

function HoverCard({
	...props
}: React.ComponentProps<typeof HoverCardPrimitive.Root>) {
	return <HoverCardPrimitive.Root data-slot="hover-card" {...props} />;
}

export { HoverCard, HoverCardContent, HoverCardTrigger };
