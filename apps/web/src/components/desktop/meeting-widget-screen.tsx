import {
	dismissDesktopDetectedMeetingWidget,
	getDesktopMeetingDetectionState,
	isDesktopRuntime,
	onDesktopMeetingDetectionState,
	reportDesktopMeetingWidgetSize,
	startDesktopDetectedMeetingNote,
} from "@workspace/platform/desktop";
import type { DesktopMeetingDetectionState } from "@workspace/platform/desktop-bridge";
import { Button } from "@workspace/ui/components/button";
import { Card, CardContent } from "@workspace/ui/components/card";
import { Separator } from "@workspace/ui/components/separator";
import { cn } from "@workspace/ui/lib/utils";
import { X } from "lucide-react";
import * as React from "react";

const widgetTitleByStatus: Record<
	DesktopMeetingDetectionState["status"],
	string
> = {
	idle: "Listening for calls",
	monitoring: "Listening for calls",
	prompting: "Meeting detected",
};

export function MeetingWidgetScreen() {
	const [state, setState] = React.useState<DesktopMeetingDetectionState | null>(
		null,
	);
	const frameRef = React.useRef<HTMLDivElement | null>(null);
	const title = state ? widgetTitleByStatus[state.status] : "Meeting detected";

	React.useEffect(() => {
		document.title = "Graneri meeting widget";
		document.documentElement.setAttribute("style", "background: transparent;");
		document.body.setAttribute("style", "background: transparent; margin: 0;");

		return () => {
			document.documentElement.removeAttribute("style");
			document.body.removeAttribute("style");
		};
	}, []);

	React.useEffect(() => {
		if (!isDesktopRuntime()) {
			return;
		}

		let isMounted = true;
		const unsubscribe = onDesktopMeetingDetectionState((nextState) => {
			if (isMounted) {
				setState(nextState);
			}
		});

		void getDesktopMeetingDetectionState()
			.then((nextState) => {
				if (isMounted && nextState) {
					setState(nextState);
				}
			})
			.catch(() => {});

		return () => {
			isMounted = false;
			unsubscribe?.();
		};
	}, []);

	React.useLayoutEffect(() => {
		const frameElement = frameRef.current;
		if (!frameElement || !isDesktopRuntime()) {
			return;
		}

		const reportSize = () => {
			const rect = frameElement.getBoundingClientRect();
			reportDesktopMeetingWidgetSize({
				width: Math.ceil(rect.width),
				height: Math.ceil(rect.height),
			});
		};

		reportSize();

		const resizeObserver = new ResizeObserver(() => {
			reportSize();
		});

		resizeObserver.observe(frameElement);

		return () => {
			resizeObserver.disconnect();
		};
	}, []);

	return (
		<div ref={frameRef} className="dark inline-flex p-1.5">
			<Card
				data-app-region="drag"
				size="sm"
				className={cn(
					"relative rounded-lg border border-border/70 bg-card py-0 text-card-foreground shadow-none",
				)}
			>
				<CardContent className="flex items-center gap-2 p-1.5">
					<div
						data-app-region="no-drag"
						className="flex size-8 shrink-0 items-center justify-center"
					>
						<Button
							type="button"
							size="icon-xs"
							variant="ghost"
							aria-label="Dismiss meeting widget"
							className="cursor-pointer text-muted-foreground hover:text-foreground"
							onClick={() => void dismissDesktopDetectedMeetingWidget()}
						>
							<X className="size-3" />
						</Button>
					</div>
					<Separator
						orientation="vertical"
						className="h-6 shrink-0 bg-border/70"
					/>
					<div className="min-w-0 flex-1 px-0.5">
						<div className="flex min-w-0 flex-col gap-1">
							<p className="truncate text-sm leading-none font-medium text-foreground">
								{title}
							</p>
							{state?.sourceName ? (
								<p className="truncate text-xs leading-none text-muted-foreground">
									{state.sourceName}
								</p>
							) : null}
						</div>
					</div>
					<Separator
						orientation="vertical"
						className="h-6 shrink-0 bg-border/70"
					/>
					<div data-app-region="no-drag" className="flex shrink-0 items-center">
						<Button
							type="button"
							size="sm"
							className="h-8 cursor-pointer px-3"
							onClick={() => void startDesktopDetectedMeetingNote()}
						>
							<img
								src="/graneri-dock.svg"
								alt=""
								aria-hidden="true"
								className="size-5 rounded-md"
							/>
							Take note
						</Button>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}
