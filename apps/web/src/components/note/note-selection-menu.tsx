import type { Editor } from "@tiptap/core";
import { useTiptap, useTiptapState } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { Button } from "@workspace/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import {
	Bold,
	Check,
	ChevronDown,
	Code2,
	Heading1,
	Heading2,
	Heading3,
	Italic,
	List,
	ListOrdered,
	MessageSquareText,
	Pilcrow,
	Quote,
	Strikethrough,
	Underline,
} from "lucide-react";
import * as React from "react";

const hasTextSelection = (editor: Editor) => {
	const { empty, from, to } = editor.state.selection;

	if (empty || from === to) {
		return false;
	}

	return editor.state.doc.textBetween(from, to, "\n").trim().length > 0;
};

const getTextSelectionKey = (editor: Editor) => {
	if (!hasTextSelection(editor)) {
		return null;
	}

	const { from, to } = editor.state.selection;
	return `${from}:${to}`;
};

function NoteSelectionMenuTooltip({
	label,
	children,
}: {
	label: string;
	children: React.ReactNode;
}) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>{children}</TooltipTrigger>
			<TooltipContent
				side="bottom"
				sideOffset={8}
				className="pointer-events-none select-none"
			>
				{label}
			</TooltipContent>
		</Tooltip>
	);
}

type BlockStyleOption = {
	id:
		| "paragraph"
		| "heading1"
		| "heading2"
		| "heading3"
		| "bulletList"
		| "orderedList"
		| "blockquote"
		| "codeBlock";
	label: string;
	icon: React.ComponentType<{ className?: string }>;
	isActive: (editor: Editor) => boolean;
	apply: (editor: Editor) => void;
};

const BLOCK_STYLE_OPTIONS: BlockStyleOption[] = [
	{
		id: "paragraph",
		label: "Text",
		icon: Pilcrow,
		isActive: (editor) =>
			!editor.isActive("heading") &&
			!editor.isActive("bulletList") &&
			!editor.isActive("orderedList") &&
			!editor.isActive("blockquote") &&
			!editor.isActive("codeBlock"),
		apply: (editor) => {
			editor.chain().focus().clearNodes().run();
		},
	},
	{
		id: "heading1",
		label: "Heading 1",
		icon: Heading1,
		isActive: (editor) => editor.isActive("heading", { level: 1 }),
		apply: (editor) => {
			editor.chain().focus().clearNodes().setHeading({ level: 1 }).run();
		},
	},
	{
		id: "heading2",
		label: "Heading 2",
		icon: Heading2,
		isActive: (editor) => editor.isActive("heading", { level: 2 }),
		apply: (editor) => {
			editor.chain().focus().clearNodes().setHeading({ level: 2 }).run();
		},
	},
	{
		id: "heading3",
		label: "Heading 3",
		icon: Heading3,
		isActive: (editor) => editor.isActive("heading", { level: 3 }),
		apply: (editor) => {
			editor.chain().focus().clearNodes().setHeading({ level: 3 }).run();
		},
	},
	{
		id: "bulletList",
		label: "Bulleted list",
		icon: List,
		isActive: (editor) => editor.isActive("bulletList"),
		apply: (editor) => {
			editor.chain().focus().toggleBulletList().run();
		},
	},
	{
		id: "orderedList",
		label: "Numbered list",
		icon: ListOrdered,
		isActive: (editor) => editor.isActive("orderedList"),
		apply: (editor) => {
			editor.chain().focus().toggleOrderedList().run();
		},
	},
	{
		id: "blockquote",
		label: "Blockquote",
		icon: Quote,
		isActive: (editor) => editor.isActive("blockquote"),
		apply: (editor) => {
			editor.chain().focus().toggleBlockquote().run();
		},
	},
	{
		id: "codeBlock",
		label: "Code block",
		icon: Code2,
		isActive: (editor) => editor.isActive("codeBlock"),
		apply: (editor) => {
			editor.chain().focus().toggleCodeBlock().run();
		},
	},
];

const preventEditorBlur = (event: React.MouseEvent<HTMLElement>) => {
	event.preventDefault();
};

export function NoteSelectionMenu({ onComment }: { onComment: () => void }) {
	const { editor } = useTiptap();
	const [blockMenuOpen, setBlockMenuOpen] = React.useState(false);
	const [suppressedSelectionKey, setSuppressedSelectionKey] = React.useState<
		string | null
	>(null);
	const bubbleMenuRef = React.useRef<HTMLDivElement | null>(null);
	const blockMenuCloseReasonRef = React.useRef<"apply" | "dismiss" | null>(
		null,
	);
	const editorState = useTiptapState(({ editor: currentEditor }) => ({
		activeBlockStyleId:
			BLOCK_STYLE_OPTIONS.find((option) => option.isActive(currentEditor))
				?.id ?? BLOCK_STYLE_OPTIONS[0].id,
		isBold: currentEditor.isActive("bold"),
		isItalic: currentEditor.isActive("italic"),
		isUnderline: currentEditor.isActive("underline"),
		isStrike: currentEditor.isActive("strike"),
		isCode: currentEditor.isActive("code"),
	}));

	const activeBlockStyle =
		BLOCK_STYLE_OPTIONS.find(
			(option) => option.id === editorState.activeBlockStyleId,
		) ?? BLOCK_STYLE_OPTIONS[0];
	const dismissBlockSelectionMenu = React.useCallback(() => {
		const collapsePosition = editor.state.selection.to;

		editor.chain().setTextSelection(collapsePosition).blur().run();
	}, [editor]);
	const handleCommentClick = React.useCallback(() => {
		const currentSelectionKey = getTextSelectionKey(editor);

		setBlockMenuOpen(false);
		setSuppressedSelectionKey(currentSelectionKey);
		onComment();
		dismissBlockSelectionMenu();
	}, [dismissBlockSelectionMenu, editor, onComment]);

	React.useEffect(() => {
		const handleSelectionUpdate = () => {
			const currentSelectionKey = getTextSelectionKey(editor);
			setSuppressedSelectionKey((previousSelectionKey) =>
				previousSelectionKey === currentSelectionKey
					? previousSelectionKey
					: null,
			);
		};

		editor.on("selectionUpdate", handleSelectionUpdate);
		return () => {
			editor.off("selectionUpdate", handleSelectionUpdate);
		};
	}, [editor]);

	return (
		<BubbleMenu
			ref={bubbleMenuRef}
			updateDelay={150}
			options={{ offset: 8 }}
			shouldShow={({ editor: currentEditor }) => {
				if (blockMenuOpen) {
					return true;
				}

				if (!hasTextSelection(currentEditor)) {
					return false;
				}

				return getTextSelectionKey(currentEditor) !== suppressedSelectionKey;
			}}
		>
			<div className="note-selection-menu">
				<DropdownMenu
					modal={false}
					open={blockMenuOpen}
					onOpenChange={(nextOpen) => {
						if (nextOpen) {
							blockMenuCloseReasonRef.current = null;
						}

						setBlockMenuOpen(nextOpen);
					}}
				>
					<DropdownMenuTrigger asChild>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className="gap-1.5 px-3"
							aria-label="Select text style"
							onMouseDown={preventEditorBlur}
						>
							<span>{activeBlockStyle.label}</span>
							<ChevronDown className="size-3.5 opacity-70" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent
						align="start"
						sideOffset={8}
						container={bubbleMenuRef.current?.parentElement ?? undefined}
						disableCloseAnimation
						className="min-w-44 bg-background text-foreground"
						onEscapeKeyDown={() => {
							blockMenuCloseReasonRef.current = "dismiss";
						}}
						onPointerDownOutside={() => {
							blockMenuCloseReasonRef.current = "dismiss";
						}}
						onCloseAutoFocus={(event) => {
							event.preventDefault();

							if (blockMenuCloseReasonRef.current === "apply") {
								editor.chain().focus().run();
							} else {
								dismissBlockSelectionMenu();
							}

							blockMenuCloseReasonRef.current = null;
						}}
					>
						{BLOCK_STYLE_OPTIONS.map((option) => {
							const Icon = option.icon;
							const isActive = option.isActive(editor);

							return (
								<DropdownMenuItem
									key={option.id}
									onMouseDown={preventEditorBlur}
									onSelect={() => {
										blockMenuCloseReasonRef.current = "apply";
										option.apply(editor);
									}}
									className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2"
								>
									<Icon className="size-4 text-muted-foreground" />
									<span>{option.label}</span>
									{isActive ? (
										<Check className="size-4 text-muted-foreground" />
									) : null}
								</DropdownMenuItem>
							);
						})}
					</DropdownMenuContent>
				</DropdownMenu>
				<div
					aria-hidden="true"
					className="mx-1 h-5 w-px shrink-0 bg-border/80"
				/>
				<NoteSelectionMenuTooltip label="Bold">
					<Button
						type="button"
						variant={editorState.isBold ? "secondary" : "ghost"}
						size="icon-sm"
						onClick={() => editor.chain().focus().toggleBold().run()}
					>
						<Bold />
						<span className="sr-only">Bold</span>
					</Button>
				</NoteSelectionMenuTooltip>
				<NoteSelectionMenuTooltip label="Italic">
					<Button
						type="button"
						variant={editorState.isItalic ? "secondary" : "ghost"}
						size="icon-sm"
						onClick={() => editor.chain().focus().toggleItalic().run()}
					>
						<Italic />
						<span className="sr-only">Italic</span>
					</Button>
				</NoteSelectionMenuTooltip>
				<NoteSelectionMenuTooltip label="Underline">
					<Button
						type="button"
						variant={editorState.isUnderline ? "secondary" : "ghost"}
						size="icon-sm"
						onClick={() => editor.chain().focus().toggleMark("underline").run()}
					>
						<Underline />
						<span className="sr-only">Underline</span>
					</Button>
				</NoteSelectionMenuTooltip>
				<NoteSelectionMenuTooltip label="Strikethrough">
					<Button
						type="button"
						variant={editorState.isStrike ? "secondary" : "ghost"}
						size="icon-sm"
						onClick={() => editor.chain().focus().toggleMark("strike").run()}
					>
						<Strikethrough />
						<span className="sr-only">Strikethrough</span>
					</Button>
				</NoteSelectionMenuTooltip>
				<NoteSelectionMenuTooltip label="Code">
					<Button
						type="button"
						variant={editorState.isCode ? "secondary" : "ghost"}
						size="icon-sm"
						onClick={() => editor.chain().focus().toggleCode().run()}
					>
						<Code2 />
						<span className="sr-only">Code</span>
					</Button>
				</NoteSelectionMenuTooltip>
				<div
					aria-hidden="true"
					className="mx-1 h-5 w-px shrink-0 bg-border/80"
				/>
				<NoteSelectionMenuTooltip label="Comment">
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						onClick={handleCommentClick}
					>
						<MessageSquareText data-icon="inline-start" />
						<span className="sr-only">Comment</span>
					</Button>
				</NoteSelectionMenuTooltip>
			</div>
		</BubbleMenu>
	);
}
