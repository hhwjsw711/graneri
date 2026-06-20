import { cn } from "@workspace/ui/lib/utils";
import * as React from "react";
import type { AutomationDeleteConfirmation } from "@/lib/chat-automation-confirmation";

const optionLetter = (index: number) => String.fromCharCode(65 + index);

export function ChatAutomationConfirmationBar({
	confirmation,
	disabled,
	onCancel,
	onConfirm,
	onTextAnswer,
}: {
	confirmation: AutomationDeleteConfirmation;
	disabled?: boolean;
	onCancel: () => void;
	onConfirm: () => void;
	onTextAnswer: (answer: string) => void;
}) {
	const [textAnswer, setTextAnswer] = React.useState("");
	const handleTextSubmit = React.useCallback(() => {
		const answer = textAnswer.trim();
		if (!answer) {
			return;
		}
		onTextAnswer(answer);
		setTextAnswer("");
	}, [onTextAnswer, textAnswer]);

	return (
		<fieldset
			className={cn(
				"mx-auto w-[calc(100%-1rem)] max-w-[548px] overflow-hidden rounded-t-lg rounded-b-none bg-transparent text-sm",
			)}
			aria-label={confirmation.title}
		>
			<div className="flex h-9 items-center gap-3 border-border/20 bg-muted/30 px-3.5 outline-none first:rounded-t-lg not-last:border-b">
				<div className="flex min-w-0 items-baseline gap-2">
					<legend className="shrink-0 font-medium text-foreground">
						Question
					</legend>
					<span className="min-w-0 truncate text-muted-foreground">
						{confirmation.message}
					</span>
				</div>
			</div>
			{confirmation.options.map((option, index) => {
				const isConfirm = option.id === "confirm";
				return (
					<button
						key={option.id}
						type="button"
						disabled={disabled}
						onClick={isConfirm ? onConfirm : onCancel}
						className={cn(
							"flex h-9 w-full items-center gap-3 border-border/20 bg-muted/30 px-3.5 text-left outline-none transition-colors not-last:border-b hover:bg-muted/45 focus-visible:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-60",
						)}
					>
						<span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md border bg-background font-medium text-muted-foreground">
							{optionLetter(index)}
						</span>
						<span className="min-w-0 truncate font-medium text-foreground">
							{option.label}
						</span>
					</button>
				);
			})}
			<div className="flex h-9 w-full items-center gap-3 border-border/20 bg-muted/30 px-3.5 not-last:border-b">
				<span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md border bg-background font-medium text-muted-foreground">
					{optionLetter(confirmation.options.length)}
				</span>
				<input
					type="text"
					value={textAnswer}
					disabled={disabled}
					onChange={(event) => setTextAnswer(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter") {
							event.preventDefault();
							handleTextSubmit();
						}
					}}
					placeholder="Type your answer..."
					className="min-w-0 flex-1 bg-transparent font-medium text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-default"
				/>
			</div>
		</fieldset>
	);
}
