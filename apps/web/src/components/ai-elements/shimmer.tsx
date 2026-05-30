import { cn } from "@workspace/ui/lib/utils";
import type { CSSProperties, ElementType, ReactNode } from "react";

type ShimmerTextProps = {
	children: ReactNode;
	as?: ElementType;
	className?: string;
	duration?: number;
	spread?: number;
};

export function ShimmerText({
	children,
	as: Component = "p",
	className,
	duration = 2,
	spread = 2,
}: ShimmerTextProps) {
	const content = String(children ?? "");
	const dynamicSpread = Math.max(content.length * spread, 24);

	return (
		<>
			<style>{`
				@keyframes graneri-text-shimmer {
					0% {
						background-position: 100% 50%;
					}
					100% {
						background-position: 0% 50%;
					}
				}
			`}</style>
			<Component
				className={cn(
					"relative inline-block bg-clip-text text-transparent [background-repeat:no-repeat,padding-box]",
					className,
				)}
				style={
					{
						"--spread": `${dynamicSpread}px`,
						backgroundImage:
							"linear-gradient(90deg, transparent calc(50% - var(--spread)), var(--background) 50%, transparent calc(50% + var(--spread))), linear-gradient(var(--muted-foreground), var(--muted-foreground))",
						backgroundSize: "250% 100%, auto",
						animation: `graneri-text-shimmer ${duration}s linear infinite`,
					} as CSSProperties
				}
			>
				{children}
			</Component>
		</>
	);
}
