import {
	closestCenter,
	DndContext,
	type DragEndEvent,
	KeyboardSensor,
	PointerSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import {
	arrayMove,
	SortableContext,
	sortableKeyboardCoordinates,
	useSortable,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@workspace/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@workspace/ui/components/dialog";
import { Field, FieldGroup } from "@workspace/ui/components/field";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { ScrollArea } from "@workspace/ui/components/scroll-area";
import { SidebarProvider } from "@workspace/ui/components/sidebar";
import { Textarea } from "@workspace/ui/components/textarea";
import { cn } from "@workspace/ui/lib/utils";
import { useMutation, useQuery } from "convex/react";
import {
	CalendarDays,
	FileText,
	Goal,
	GripVertical,
	Plus,
	UsersRound,
	X,
} from "lucide-react";
import { useEffect, useMemo, useReducer, useState } from "react";
import { toast } from "sonner";
import {
	ManageDialogHeader,
	ManageDialogSidebarNav,
} from "@/components/ui/manage-dialog-navigation";
import { useActiveWorkspaceId } from "@/hooks/use-active-workspace";
import {
	createUniqueDraftName,
	createUniqueDraftSlug,
} from "@/lib/draft-naming";
import { logError } from "@/lib/logger";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";

const templateIcons = {
	"one-to-one": UsersRound,
	"stand-up": Goal,
	"weekly-team-meeting": CalendarDays,
} as const;

const getTemplateIcon = (slug: string) =>
	templateIcons[slug as keyof typeof templateIcons] ?? FileText;

type TemplateSlug = string;
const MAX_TEMPLATE_DRAFTS = 20;
const NEW_TEMPLATE_NAME = "New template";

type TemplateDraft = {
	slug: TemplateSlug;
	name: string;
	meetingContext: string;
	sections: Array<{
		id: string;
		title: string;
		prompt: string;
	}>;
};
type TemplateSectionDraft = TemplateDraft["sections"][number];

export type TemplatesDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
};

type TemplateEditorState = {
	templates: TemplateDraft[];
	activeTemplate: TemplateSlug | null;
};

const toTemplateDrafts = (
	templates: Array<{
		slug: string;
		name: string;
		meetingContext: string;
		sections: Array<{
			id: string;
			title: string;
			prompt: string;
		}>;
	}>,
): TemplateDraft[] =>
	templates.map((template) => ({
		slug: template.slug,
		name: template.name,
		meetingContext: template.meetingContext,
		sections: template.sections.map((section) => ({
			id: section.id,
			title: section.title,
			prompt: section.prompt,
		})),
	}));

const areTemplateSectionsEqual = (
	left: TemplateSectionDraft[],
	right: TemplateSectionDraft[],
) => {
	if (left.length !== right.length) {
		return false;
	}

	for (const [index, section] of left.entries()) {
		const otherSection = right[index];
		if (
			!otherSection ||
			section.id !== otherSection.id ||
			section.title !== otherSection.title ||
			section.prompt !== otherSection.prompt
		) {
			return false;
		}
	}

	return true;
};

const areTemplateDraftsEqual = (
	left: TemplateDraft[],
	right: TemplateDraft[],
): boolean =>
	left.length === right.length &&
	left.every((template, index) => {
		const otherTemplate = right[index];

		return (
			otherTemplate &&
			template.slug === otherTemplate.slug &&
			template.name === otherTemplate.name &&
			template.meetingContext === otherTemplate.meetingContext &&
			areTemplateSectionsEqual(template.sections, otherTemplate.sections)
		);
	});

const getNextActiveTemplate = ({
	currentActiveTemplate,
	templates,
	resetSelection,
}: {
	currentActiveTemplate: TemplateSlug | null;
	templates: TemplateDraft[];
	resetSelection: boolean;
}) => {
	if (!resetSelection && currentActiveTemplate) {
		const matchingTemplate = templates.find(
			(template) => template.slug === currentActiveTemplate,
		);

		if (matchingTemplate) {
			return matchingTemplate.slug;
		}
	}

	return templates[0]?.slug ?? null;
};

const syncTemplateEditorState = ({
	currentState,
	templates,
	resetSelection,
}: {
	currentState: TemplateEditorState;
	templates: TemplateDraft[];
	resetSelection: boolean;
}): TemplateEditorState => ({
	templates,
	activeTemplate: getNextActiveTemplate({
		currentActiveTemplate: currentState.activeTemplate,
		templates,
		resetSelection,
	}),
});

type TemplateEditorAction =
	| {
			type: "sync";
			templates: TemplateDraft[];
			resetSelection: boolean;
	  }
	| {
			type: "select";
			slug: TemplateSlug | null;
	  }
	| {
			type: "update";
			updater: (templates: TemplateDraft[]) => TemplateDraft[];
	  };

const templateEditorReducer = (
	state: TemplateEditorState,
	action: TemplateEditorAction,
): TemplateEditorState => {
	if (action.type === "sync") {
		return syncTemplateEditorState({
			currentState: state,
			templates: action.templates,
			resetSelection: action.resetSelection,
		});
	}

	if (action.type === "select") {
		return {
			...state,
			activeTemplate: action.slug,
		};
	}

	const templates = action.updater(state.templates);
	return syncTemplateEditorState({
		currentState: state,
		templates,
		resetSelection: false,
	});
};

const useTemplateEditorState = ({
	open,
	templateData,
}: {
	open: boolean;
	templateData:
		| Array<{
				slug: string;
				name: string;
				meetingContext: string;
				sections: Array<{
					id: string;
					title: string;
					prompt: string;
				}>;
		  }>
		| undefined;
}) => {
	const [state, dispatch] = useReducer(templateEditorReducer, {
		templates: [],
		activeTemplate: null,
	});

	useEffect(() => {
		if (!templateData) {
			return;
		}

		dispatch({
			type: "sync",
			templates: toTemplateDrafts(templateData),
			resetSelection: false,
		});
	}, [templateData]);

	useEffect(() => {
		if (!open) {
			return;
		}

		dispatch({
			type: "sync",
			templates: templateData ? toTemplateDrafts(templateData) : [],
			resetSelection: true,
		});
	}, [open, templateData]);

	return {
		activeTemplate: state.activeTemplate,
		templates: state.templates,
		selectTemplate: (slug: TemplateSlug | null) =>
			dispatch({ type: "select", slug }),
		updateTemplates: (
			updater: (templates: TemplateDraft[]) => TemplateDraft[],
		) => dispatch({ type: "update", updater }),
	};
};

const useTemplateDraftEditor = ({
	activeTemplate,
	activeWorkspaceId,
	onOpenChange,
	saveTemplates,
	selectTemplate,
	templateData,
	templates,
	updateTemplates,
}: {
	activeTemplate: TemplateSlug | null;
	activeWorkspaceId: Id<"workspaces"> | null;
	onOpenChange: (open: boolean) => void;
	saveTemplates: ReturnType<typeof useMutation<typeof api.templates.saveAll>>;
	selectTemplate: (slug: TemplateSlug | null) => void;
	templateData:
		| Array<{
				slug: string;
				name: string;
				meetingContext: string;
				sections: Array<{
					id: string;
					title: string;
					prompt: string;
				}>;
		  }>
		| undefined;
	templates: TemplateDraft[];
	updateTemplates: (
		updater: (templates: TemplateDraft[]) => TemplateDraft[],
	) => void;
}) => {
	const [isSaving, setIsSaving] = useState(false);
	const savedTemplates = useMemo(
		() => (templateData ? toTemplateDrafts(templateData) : []),
		[templateData],
	);
	const selectedTemplate = useMemo(
		() =>
			templates.find((template) => template.slug === activeTemplate) ??
			templates[0] ??
			null,
		[activeTemplate, templates],
	);
	const hasChanges = useMemo(
		() => !areTemplateDraftsEqual(templates, savedTemplates),
		[templates, savedTemplates],
	);

	const updateSelectedTemplate = (
		updater: (template: TemplateDraft) => TemplateDraft,
	) => {
		if (!selectedTemplate) {
			return;
		}

		updateTemplates((currentTemplates) =>
			currentTemplates.map((template) =>
				template.slug === selectedTemplate.slug ? updater(template) : template,
			),
		);
	};

	const updateMeetingContext = (value: string) => {
		updateSelectedTemplate((template) => ({
			...template,
			meetingContext: value,
		}));
	};

	const updateName = (value: string) => {
		updateSelectedTemplate((template) => ({
			...template,
			name: value,
		}));
	};

	const updateSectionPrompt = (sectionId: string, value: string) => {
		updateSelectedTemplate((template) => ({
			...template,
			sections: template.sections.map((section) =>
				section.id === sectionId ? { ...section, prompt: value } : section,
			),
		}));
	};

	const updateSectionTitle = (sectionId: string, value: string) => {
		updateSelectedTemplate((template) => ({
			...template,
			sections: template.sections.map((section) =>
				section.id === sectionId ? { ...section, title: value } : section,
			),
		}));
	};

	const removeSection = (sectionId: string) => {
		updateSelectedTemplate((template) => ({
			...template,
			sections: template.sections.filter((section) => section.id !== sectionId),
		}));
	};

	const addSection = () => {
		updateSelectedTemplate((template) => ({
			...template,
			sections: [
				...template.sections,
				{
					id: crypto.randomUUID(),
					title: "New section",
					prompt: "",
				},
			],
		}));
	};

	const canCreateTemplate = templates.length < MAX_TEMPLATE_DRAFTS;

	const createTemplate = () => {
		if (!canCreateTemplate) {
			return;
		}

		const name = createUniqueDraftName(
			NEW_TEMPLATE_NAME,
			templates.map((template) => template.name),
		);
		const slug = createUniqueDraftSlug({
			baseName: name,
			existingSlugs: templates.map((template) => template.slug),
			fallbackPrefix: "template",
		});

		updateTemplates((currentTemplates) => [
			...currentTemplates,
			{
				slug,
				name,
				meetingContext: "",
				sections: [
					{
						id: crypto.randomUUID(),
						title: "Summary",
						prompt: "",
					},
				],
			},
		]);
		selectTemplate(slug);
	};

	const handleSectionDragEnd = (event: DragEndEvent) => {
		const { active, over } = event;

		if (!over || !selectedTemplate || String(active.id) === String(over.id)) {
			return;
		}

		updateSelectedTemplate((template) => {
			const oldIndex = template.sections.findIndex(
				(section) => section.id === String(active.id),
			);
			const newIndex = template.sections.findIndex(
				(section) => section.id === String(over.id),
			);

			if (oldIndex < 0 || newIndex < 0) {
				return template;
			}

			return {
				...template,
				sections: arrayMove(template.sections, oldIndex, newIndex),
			};
		});
	};

	const handleCancel = () => {
		if (hasChanges) {
			updateTemplates(() => savedTemplates);
		}

		onOpenChange(false);
	};

	const handleSave = async () => {
		setIsSaving(true);

		try {
			if (!activeWorkspaceId) {
				return;
			}

			const savedTemplates = await saveTemplates({
				workspaceId: activeWorkspaceId,
				templates: templates.map((template) => ({
					slug: template.slug,
					name: template.name,
					meetingContext: template.meetingContext,
					sections: template.sections.map((section) => ({
						id: section.id,
						title: section.title,
						prompt: section.prompt,
					})),
				})),
			});
			const nextTemplates = toTemplateDrafts(savedTemplates);
			updateTemplates(() => nextTemplates);
			selectTemplate(nextTemplates[0]?.slug ?? null);
			toast.success("Templates saved");
			onOpenChange(false);
		} catch (error) {
			logError({
				event: "client.error",
				error: error,
				message: "Failed to save templates",
			});
			toast.error("Failed to save templates");
		} finally {
			setIsSaving(false);
		}
	};

	return {
		addSection,
		canCreateTemplate,
		createTemplate,
		handleCancel,
		handleSave,
		handleSectionDragEnd,
		hasChanges,
		isSaving,
		removeSection,
		selectedTemplate,
		updateName,
		updateMeetingContext,
		updateSectionPrompt,
		updateSectionTitle,
	};
};

function TemplatesEditor({
	hasChanges,
	isSaving,
	onAddSection,
	onCancel,
	onNameChange,
	onMeetingContextChange,
	onPromptChange,
	onRemoveSection,
	onSave,
	onSectionDragEnd,
	onTitleChange,
	selectedTemplate,
	sensors,
	templatesCount,
}: {
	hasChanges: boolean;
	isSaving: boolean;
	onAddSection: () => void;
	onCancel: () => void;
	onNameChange: (value: string) => void;
	onMeetingContextChange: (value: string) => void;
	onPromptChange: (sectionId: string, value: string) => void;
	onRemoveSection: (sectionId: string) => void;
	onSave: () => void;
	onSectionDragEnd: (event: DragEndEvent) => void;
	onTitleChange: (sectionId: string, value: string) => void;
	selectedTemplate: TemplateDraft | null;
	sensors: ReturnType<typeof useSensors>;
	templatesCount: number;
}) {
	return (
		<ScrollArea className="min-h-0 flex-1" viewportClassName="p-4 pt-0">
			{selectedTemplate ? (
				<div className="py-4">
					<FieldGroup className="gap-6">
						<Field>
							<Label
								htmlFor="template-name"
								className="text-xs text-muted-foreground"
							>
								Name
							</Label>
							<Input
								id="template-name"
								value={selectedTemplate.name}
								onChange={(event) => onNameChange(event.target.value)}
								className="border-border/70 bg-background/30"
							/>
						</Field>
						<Field>
							<Label
								htmlFor="template-meeting-context"
								className="text-xs text-muted-foreground"
							>
								Meeting context
							</Label>
							<Textarea
								id="template-meeting-context"
								value={selectedTemplate.meetingContext}
								onChange={(event) => onMeetingContextChange(event.target.value)}
								className="h-32 resize-none border-border/70 bg-background/30 text-sm leading-6"
							/>
						</Field>
						<Field>
							<Label className="text-xs text-muted-foreground">Sections</Label>
							<DndContext
								sensors={sensors}
								collisionDetection={closestCenter}
								onDragEnd={onSectionDragEnd}
							>
								<SortableContext
									items={selectedTemplate.sections.map((section) => section.id)}
									strategy={verticalListSortingStrategy}
								>
									{selectedTemplate.sections.map((section) => (
										<SortableTemplateSectionCard
											key={section.id}
											section={section}
											canRemove={selectedTemplate.sections.length > 1}
											onTitleChange={onTitleChange}
											onPromptChange={onPromptChange}
											onRemove={onRemoveSection}
										/>
									))}
								</SortableContext>
							</DndContext>
							<Button
								type="button"
								variant="outline"
								size="sm"
								className="w-fit"
								onClick={onAddSection}
							>
								<Plus />
								Add section
							</Button>
						</Field>
					</FieldGroup>
					<div className="flex justify-end gap-2 pt-6">
						<Button variant="ghost" onClick={onCancel} disabled={isSaving}>
							Cancel
						</Button>
						<Button
							onClick={onSave}
							disabled={!hasChanges || isSaving || templatesCount === 0}
						>
							{isSaving ? "Saving..." : "Save"}
						</Button>
					</div>
				</div>
			) : (
				<div className="py-4" />
			)}
		</ScrollArea>
	);
}

export function TemplatesDialog({ open, onOpenChange }: TemplatesDialogProps) {
	const activeWorkspaceId = useActiveWorkspaceId();
	const templateData = useQuery(
		api.templates.list,
		activeWorkspaceId ? { workspaceId: activeWorkspaceId } : "skip",
	);
	const saveTemplates = useMutation(api.templates.saveAll);
	const { activeTemplate, templates, selectTemplate, updateTemplates } =
		useTemplateEditorState({
			open,
			templateData,
		});
	const editor = useTemplateDraftEditor({
		activeTemplate,
		activeWorkspaceId,
		onOpenChange,
		saveTemplates,
		selectTemplate,
		templateData,
		templates,
		updateTemplates,
	});
	const sensors = useSensors(
		useSensor(PointerSensor, {
			activationConstraint: {
				distance: 6,
			},
		}),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		}),
	);
	const navigationItems = useMemo(
		() =>
			templates.map((template) => ({
				id: template.slug,
				icon: getTemplateIcon(template.slug),
				label: template.name,
			})),
		[templates],
	);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="overflow-hidden p-0 md:max-h-[500px] md:max-w-[700px] lg:max-w-[800px]">
				<DialogHeader className="sr-only">
					<DialogTitle>Manage templates</DialogTitle>
					<DialogDescription>
						Browse and manage your note templates.
					</DialogDescription>
				</DialogHeader>
				<DialogDescription className="sr-only">
					Browse and manage your note templates.
				</DialogDescription>
				<SidebarProvider className="h-[480px] min-h-0 items-start">
					<ManageDialogSidebarNav
						activeItemId={activeTemplate}
						footerAction={{
							label: "New template",
							icon: Plus,
							onClick: editor.createTemplate,
							disabled: !editor.canCreateTemplate,
						}}
						items={navigationItems}
						onSelect={(slug) => selectTemplate(slug as TemplateSlug)}
					/>
					<main className="flex h-[480px] flex-1 flex-col overflow-hidden">
						<ManageDialogHeader
							activeItemId={activeTemplate}
							items={navigationItems}
							mobileAction={{
								label: "New template",
								icon: Plus,
								onClick: editor.createTemplate,
								disabled: !editor.canCreateTemplate,
							}}
							onSelect={(slug) => selectTemplate(slug as TemplateSlug)}
							title="Templates"
						/>
						<TemplatesEditor
							hasChanges={editor.hasChanges}
							isSaving={editor.isSaving}
							onAddSection={editor.addSection}
							onCancel={editor.handleCancel}
							onNameChange={editor.updateName}
							onMeetingContextChange={editor.updateMeetingContext}
							onPromptChange={editor.updateSectionPrompt}
							onRemoveSection={editor.removeSection}
							onSave={editor.handleSave}
							onSectionDragEnd={editor.handleSectionDragEnd}
							onTitleChange={editor.updateSectionTitle}
							selectedTemplate={editor.selectedTemplate}
							sensors={sensors}
							templatesCount={templates.length}
						/>
					</main>
				</SidebarProvider>
			</DialogContent>
		</Dialog>
	);
}

function SortableTemplateSectionCard({
	section,
	canRemove,
	onTitleChange,
	onPromptChange,
	onRemove,
}: {
	section: TemplateDraft["sections"][number];
	canRemove: boolean;
	onTitleChange: (sectionId: string, value: string) => void;
	onPromptChange: (sectionId: string, value: string) => void;
	onRemove: (sectionId: string) => void;
}) {
	const {
		attributes,
		listeners,
		setNodeRef,
		setActivatorNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({
		id: section.id,
	});

	return (
		<div
			ref={setNodeRef}
			style={{
				transform: CSS.Transform.toString(transform),
				transition,
			}}
			className={cn(
				"group w-full max-w-[512px] rounded-lg border border-input bg-transparent px-3 py-2 dark:bg-input/30",
				isDragging && "z-10 opacity-90 shadow-lg",
			)}
		>
			<div className="flex items-start gap-3">
				<button
					ref={setActivatorNodeRef}
					type="button"
					className="cursor-grab pt-1.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 active:cursor-grabbing"
					aria-label={`Drag ${section.title || "section"}`}
					{...attributes}
					{...listeners}
				>
					<GripVertical className="size-4" />
				</button>
				<div className="min-w-0 flex-1 space-y-1">
					<Input
						id={`template-section-title-${section.id}`}
						value={section.title}
						onChange={(event) => onTitleChange(section.id, event.target.value)}
						className="h-7 border-0 bg-transparent p-0 text-base shadow-none focus-visible:ring-0 dark:bg-transparent"
					/>
					<Textarea
						id={`template-section-prompt-${section.id}`}
						value={section.prompt}
						onChange={(event) => onPromptChange(section.id, event.target.value)}
						className="h-[72px] resize-none border-0 bg-transparent p-0 text-sm leading-6 shadow-none focus-visible:ring-0 dark:bg-transparent"
					/>
				</div>
				<Button
					type="button"
					variant="ghost"
					size="icon"
					className="shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
					onClick={() => onRemove(section.id)}
					disabled={!canRemove}
					aria-label={`Remove ${section.title || "section"}`}
				>
					<X className="size-4" />
				</Button>
			</div>
		</div>
	);
}
