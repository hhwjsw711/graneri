import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { Icons } from "@workspace/ui/components/icons";
import { InputGroupButton } from "@workspace/ui/components/input-group";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import { chatModels, reasoningEfforts } from "@/lib/ai/models";

const CodexLogo = Icons.codexLogo;

export type ChatModel = (typeof chatModels)[number];
export type ReasoningEffort = (typeof reasoningEfforts)[number]["id"];

const getSelectedModelDisplayName = (name: string) => name.replace(/^GPT-/, "");

type ChatModelPickerProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	selectedModel: ChatModel;
	onSelectedModelChange: (model: ChatModel) => void;
	triggerClassName?: string;
	triggerIconClassName?: string;
	modelNameClassName?: string;
	contentClassName?: string;
	menuLabel?: string;
	reasoningEffort?: ReasoningEffort;
	onReasoningEffortChange?: (value: ReasoningEffort) => void;
};

export function ChatModelPicker({
	open,
	onOpenChange,
	selectedModel,
	onSelectedModelChange,
	triggerClassName,
	triggerIconClassName,
	modelNameClassName,
	contentClassName,
	menuLabel = "OpenAI",
	reasoningEffort,
	onReasoningEffortChange,
}: ChatModelPickerProps) {
	const showReasoningEffort = Boolean(
		reasoningEffort && onReasoningEffortChange,
	);
	const selectedReasoningEffort = reasoningEfforts.find(
		(effort) => effort.id === reasoningEffort,
	);
	const selectedModelDisplayName = getSelectedModelDisplayName(
		selectedModel.name,
	);

	return (
		<DropdownMenu open={open} onOpenChange={onOpenChange}>
			<Tooltip>
				<TooltipTrigger asChild>
					<DropdownMenuTrigger asChild>
						<InputGroupButton
							type="button"
							size="sm"
							className={cn(
								"group rounded-full gap-2 font-normal",
								triggerClassName,
							)}
							aria-label={`Model: ${selectedModelDisplayName}`}
						>
							<CodexLogo
								className={cn(
									"size-3.5 text-muted-foreground transition-colors group-hover:text-foreground group-data-[state=open]:text-foreground",
									triggerIconClassName,
								)}
							/>
							<span className={modelNameClassName}>
								{selectedModelDisplayName}
							</span>
							{showReasoningEffort ? (
								<span className="text-muted-foreground">
									{selectedReasoningEffort?.name}
								</span>
							) : null}
						</InputGroupButton>
					</DropdownMenuTrigger>
				</TooltipTrigger>
				<TooltipContent>Select model</TooltipContent>
			</Tooltip>
			<DropdownMenuContent
				side="top"
				align="start"
				className={contentClassName}
			>
				<DropdownMenuGroup className={contentClassName ? undefined : "w-42"}>
					<DropdownMenuLabel className="text-muted-foreground text-xs">
						{menuLabel}
					</DropdownMenuLabel>
					{chatModels.map((model) => (
						<DropdownMenuCheckboxItem
							key={model.id}
							checked={model.id === selectedModel.id}
							onCheckedChange={(checked) => {
								if (checked) {
									onSelectedModelChange(model);
								}
							}}
							className="pl-2 *:[span:first-child]:right-2 *:[span:first-child]:left-auto"
						>
							<span className="inline-flex items-center gap-2">
								<CodexLogo className="size-3.5 text-muted-foreground" />
								{model.name}
							</span>
						</DropdownMenuCheckboxItem>
					))}
				</DropdownMenuGroup>
				{showReasoningEffort ? (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuSub>
							<DropdownMenuSubTrigger>
								<span>{selectedReasoningEffort?.name}</span>
							</DropdownMenuSubTrigger>
							<DropdownMenuSubContent className="min-w-44">
								<DropdownMenuLabel className="text-muted-foreground text-xs">
									Reasoning
								</DropdownMenuLabel>
								<DropdownMenuRadioGroup
									value={reasoningEffort}
									onValueChange={(value) => {
										onReasoningEffortChange?.(value as ReasoningEffort);
									}}
								>
									{reasoningEfforts.map((effort) => (
										<DropdownMenuRadioItem
											key={effort.id}
											value={effort.id}
											className="pl-2 pr-8 *:[span:first-child]:right-2 *:[span:first-child]:left-auto"
										>
											{effort.name}
										</DropdownMenuRadioItem>
									))}
								</DropdownMenuRadioGroup>
							</DropdownMenuSubContent>
						</DropdownMenuSub>
					</>
				) : null}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
