import { Kbd } from "@workspace/ui/components/kbd";
import { cn } from "@workspace/ui/lib/utils";

export function ShortcutHint({
	keyLabel,
	className,
}: {
	keyLabel: string;
	className?: string;
}) {
	return (
		<Kbd
			aria-hidden="true"
			className={cn("ml-auto shrink-0 font-mono", className)}
		>
			<span className="text-xs">⌘</span>
			<span>{keyLabel}</span>
		</Kbd>
	);
}
