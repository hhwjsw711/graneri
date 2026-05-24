import { Button } from "@workspace/ui/components/button";
import { Kbd } from "@workspace/ui/components/kbd";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { ArrowLeft, ArrowRight, type LucideIcon } from "lucide-react";
import { useNavigationHistoryState } from "@/lib/navigation-history-state";

function HistoryButton({
	"aria-label": ariaLabel,
	disabled,
	icon: Icon,
	onClick,
	shortcut,
}: {
	"aria-label": string;
	disabled: boolean;
	icon: LucideIcon;
	onClick: () => void;
	shortcut: string;
}) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					type="button"
					variant="ghost"
					size="icon"
					aria-label={ariaLabel}
					disabled={disabled}
					className="size-8 rounded-xl text-foreground hover:bg-muted disabled:pointer-events-auto disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent"
					onClick={onClick}
				>
					<Icon className="size-4" />
				</Button>
			</TooltipTrigger>
			<TooltipContent side="bottom" align="center" sideOffset={8}>
				<div className="flex items-center gap-2">
					<span>{ariaLabel}</span>
					<Kbd className="h-5 px-1.5 text-[10px]">{shortcut}</Kbd>
				</div>
			</TooltipContent>
		</Tooltip>
	);
}

export function SidebarHistoryControls() {
	const navigationState = useNavigationHistoryState();

	return (
		<div
			data-app-region="no-drag"
			className="absolute top-2 left-[92px] z-20 flex items-center gap-1"
		>
			<HistoryButton
				aria-label="Back"
				disabled={!navigationState.canGoBack}
				icon={ArrowLeft}
				onClick={() => window.history.back()}
				shortcut="⌘["
			/>
			<HistoryButton
				aria-label="Forward"
				disabled={!navigationState.canGoForward}
				icon={ArrowRight}
				onClick={() => window.history.forward()}
				shortcut="⌘]"
			/>
		</div>
	);
}
