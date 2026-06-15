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
import { useMutation, useQuery } from "convex/react";
import { Plus } from "lucide-react";
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
import {
	getRecipeIcon,
	type RecipePrompt,
	type RecipeSlug,
} from "@/lib/recipes";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";

type RecipeDraft = RecipePrompt;

export type RecipesDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
};

type RecipeEditorState = {
	activeRecipe: RecipeSlug | null;
	recipes: RecipeDraft[];
};

type RecipePayload = Array<{
	slug: string;
	name: string;
	prompt: string;
}>;

const MAX_RECIPE_DRAFTS = 10;
const NEW_RECIPE_NAME = "New recipe";

const toRecipeDrafts = (recipes: RecipePayload): RecipeDraft[] =>
	recipes.map((recipe) => ({
		slug: recipe.slug,
		name: recipe.name,
		prompt: recipe.prompt,
	}));

const areRecipeDraftsEqual = (
	left: RecipeDraft[],
	right: RecipeDraft[],
): boolean =>
	left.length === right.length &&
	left.every((recipe, index) => {
		const otherRecipe = right[index];

		return (
			otherRecipe &&
			recipe.slug === otherRecipe.slug &&
			recipe.name === otherRecipe.name &&
			recipe.prompt === otherRecipe.prompt
		);
	});

const getNextActiveRecipe = ({
	currentActiveRecipe,
	recipes,
	resetSelection,
}: {
	currentActiveRecipe: RecipeSlug | null;
	recipes: RecipeDraft[];
	resetSelection: boolean;
}) => {
	if (!resetSelection && currentActiveRecipe) {
		const matchingRecipe = recipes.find(
			(recipe) => recipe.slug === currentActiveRecipe,
		);

		if (matchingRecipe) {
			return matchingRecipe.slug;
		}
	}

	return recipes[0]?.slug ?? null;
};

const syncRecipeEditorState = ({
	currentState,
	recipes,
	resetSelection,
}: {
	currentState: RecipeEditorState;
	recipes: RecipeDraft[];
	resetSelection: boolean;
}): RecipeEditorState => ({
	activeRecipe: getNextActiveRecipe({
		currentActiveRecipe: currentState.activeRecipe,
		recipes,
		resetSelection,
	}),
	recipes,
});

type RecipeEditorAction =
	| {
			type: "select";
			slug: RecipeSlug | null;
	  }
	| {
			type: "sync";
			recipes: RecipeDraft[];
			resetSelection: boolean;
	  }
	| {
			type: "update";
			updater: (recipes: RecipeDraft[]) => RecipeDraft[];
	  };

const recipeEditorReducer = (
	state: RecipeEditorState,
	action: RecipeEditorAction,
): RecipeEditorState => {
	if (action.type === "sync") {
		return syncRecipeEditorState({
			currentState: state,
			recipes: action.recipes,
			resetSelection: action.resetSelection,
		});
	}

	if (action.type === "select") {
		return {
			...state,
			activeRecipe: action.slug,
		};
	}

	const recipes = action.updater(state.recipes);
	return syncRecipeEditorState({
		currentState: state,
		recipes,
		resetSelection: false,
	});
};

const useRecipeEditorState = ({
	open,
	recipeData,
}: {
	open: boolean;
	recipeData: RecipePayload | undefined;
}) => {
	const [state, dispatch] = useReducer(recipeEditorReducer, {
		activeRecipe: null,
		recipes: [],
	});

	useEffect(() => {
		if (!recipeData) {
			return;
		}

		dispatch({
			type: "sync",
			recipes: toRecipeDrafts(recipeData),
			resetSelection: false,
		});
	}, [recipeData]);

	useEffect(() => {
		if (!open) {
			return;
		}

		dispatch({
			type: "sync",
			recipes: recipeData ? toRecipeDrafts(recipeData) : [],
			resetSelection: true,
		});
	}, [open, recipeData]);

	return {
		activeRecipe: state.activeRecipe,
		recipes: state.recipes,
		selectRecipe: (slug: RecipeSlug | null) =>
			dispatch({ type: "select", slug }),
		updateRecipes: (updater: (recipes: RecipeDraft[]) => RecipeDraft[]) =>
			dispatch({ type: "update", updater }),
	};
};

const useRecipeDraftEditor = ({
	activeRecipe,
	activeWorkspaceId,
	onOpenChange,
	recipeData,
	recipes,
	saveRecipes,
	selectRecipe,
	updateRecipes,
}: {
	activeRecipe: RecipeSlug | null;
	activeWorkspaceId: Id<"workspaces"> | null;
	onOpenChange: (open: boolean) => void;
	recipeData: RecipePayload | undefined;
	recipes: RecipeDraft[];
	saveRecipes: ReturnType<typeof useMutation<typeof api.recipes.saveAll>>;
	selectRecipe: (slug: RecipeSlug | null) => void;
	updateRecipes: (updater: (recipes: RecipeDraft[]) => RecipeDraft[]) => void;
}) => {
	const [isSaving, setIsSaving] = useState(false);
	const savedRecipes = useMemo(
		() => (recipeData ? toRecipeDrafts(recipeData) : []),
		[recipeData],
	);
	const selectedRecipe = useMemo(
		() =>
			recipes.find((recipe) => recipe.slug === activeRecipe) ??
			recipes[0] ??
			null,
		[activeRecipe, recipes],
	);
	const hasChanges = useMemo(
		() => !areRecipeDraftsEqual(recipes, savedRecipes),
		[recipes, savedRecipes],
	);

	const updateSelectedRecipe = (
		updater: (recipe: RecipeDraft) => RecipeDraft,
	) => {
		if (!selectedRecipe) {
			return;
		}

		updateRecipes((currentRecipes) =>
			currentRecipes.map((recipe) =>
				recipe.slug === selectedRecipe.slug ? updater(recipe) : recipe,
			),
		);
	};

	const updatePrompt = (value: string) => {
		updateSelectedRecipe((recipe) => ({
			...recipe,
			prompt: value,
		}));
	};

	const updateName = (value: string) => {
		updateSelectedRecipe((recipe) => ({
			...recipe,
			name: value,
		}));
	};

	const canCreateRecipe = recipes.length < MAX_RECIPE_DRAFTS;

	const createRecipe = () => {
		if (!canCreateRecipe) {
			return;
		}

		const name = createUniqueDraftName(
			NEW_RECIPE_NAME,
			recipes.map((recipe) => recipe.name),
		);
		const slug = createUniqueDraftSlug({
			baseName: name,
			existingSlugs: recipes.map((recipe) => recipe.slug),
			fallbackPrefix: "recipe",
		});

		updateRecipes((currentRecipes) => [
			...currentRecipes,
			{
				slug,
				name,
				prompt: "",
			},
		]);
		selectRecipe(slug);
	};

	const handleCancel = () => {
		if (hasChanges) {
			updateRecipes(() => savedRecipes);
		}

		onOpenChange(false);
	};

	const handleSave = async () => {
		setIsSaving(true);

		try {
			if (!activeWorkspaceId) {
				return;
			}

			const savedRecipes = await saveRecipes({
				recipes: recipes.map((recipe) => ({
					slug: recipe.slug,
					name: recipe.name,
					prompt: recipe.prompt,
				})),
				workspaceId: activeWorkspaceId,
			});
			const nextRecipes = toRecipeDrafts(savedRecipes);
			updateRecipes(() => nextRecipes);
			selectRecipe(nextRecipes[0]?.slug ?? null);
			toast.success("Recipes saved");
			onOpenChange(false);
		} catch (error) {
			logError({
				event: "client.error",
				error: error,
				message: "Failed to save recipes",
			});
			toast.error("Failed to save recipes");
		} finally {
			setIsSaving(false);
		}
	};

	return {
		canCreateRecipe,
		createRecipe,
		handleCancel,
		handleSave,
		hasChanges,
		isSaving,
		selectedRecipe,
		updateName,
		updatePrompt,
	};
};

function RecipesEditor({
	hasChanges,
	isSaving,
	onCancel,
	onNameChange,
	onPromptChange,
	onSave,
	selectedRecipe,
}: {
	hasChanges: boolean;
	isSaving: boolean;
	onCancel: () => void;
	onNameChange: (value: string) => void;
	onPromptChange: (value: string) => void;
	onSave: () => void;
	selectedRecipe: RecipeDraft | null;
}) {
	return (
		<ScrollArea className="min-h-0 flex-1" viewportClassName="p-4 pt-0">
			{selectedRecipe ? (
				<div className="py-4">
					<FieldGroup className="gap-6">
						<Field>
							<Label
								htmlFor="recipe-name"
								className="text-xs text-muted-foreground"
							>
								Name
							</Label>
							<Input
								id="recipe-name"
								value={selectedRecipe.name}
								onChange={(event) => onNameChange(event.target.value)}
								className="border-border/70 bg-background/30"
							/>
						</Field>
						<Field>
							<Label
								htmlFor="recipe-prompt"
								className="text-xs text-muted-foreground"
							>
								Prompt
							</Label>
							<Textarea
								id="recipe-prompt"
								value={selectedRecipe.prompt}
								onChange={(event) => onPromptChange(event.target.value)}
								className="field-sizing-fixed h-[288px] overflow-y-auto resize-none border-border/70 bg-background/30 text-sm leading-6"
							/>
						</Field>
					</FieldGroup>
					<div className="flex justify-end gap-2 pt-6">
						<Button variant="ghost" onClick={onCancel} disabled={isSaving}>
							Cancel
						</Button>
						<Button onClick={onSave} disabled={!hasChanges || isSaving}>
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

export function RecipesDialog({ open, onOpenChange }: RecipesDialogProps) {
	const activeWorkspaceId = useActiveWorkspaceId();
	const recipeData = useQuery(
		api.recipes.list,
		activeWorkspaceId ? { workspaceId: activeWorkspaceId } : "skip",
	);
	const saveRecipes = useMutation(api.recipes.saveAll);
	const { activeRecipe, recipes, selectRecipe, updateRecipes } =
		useRecipeEditorState({
			open,
			recipeData,
		});
	const editor = useRecipeDraftEditor({
		activeRecipe,
		activeWorkspaceId,
		onOpenChange,
		recipeData,
		recipes,
		saveRecipes,
		selectRecipe,
		updateRecipes,
	});
	const navigationItems = useMemo(
		() =>
			recipes.map((recipe) => ({
				id: recipe.slug,
				icon: getRecipeIcon(recipe.slug),
				label: recipe.name,
			})),
		[recipes],
	);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="overflow-hidden p-0 md:max-h-[500px] md:max-w-[700px] lg:max-w-[800px]">
				<DialogHeader className="sr-only">
					<DialogTitle>Manage recipes</DialogTitle>
					<DialogDescription>
						Browse and manage your recipe prompts.
					</DialogDescription>
				</DialogHeader>
				<DialogDescription className="sr-only">
					Browse and manage your recipe prompts.
				</DialogDescription>
				<SidebarProvider className="h-[480px] min-h-0 items-start">
					<ManageDialogSidebarNav
						activeItemId={activeRecipe}
						footerAction={{
							label: "New recipe",
							icon: Plus,
							onClick: editor.createRecipe,
							disabled: !editor.canCreateRecipe,
						}}
						items={navigationItems}
						onSelect={(slug) => selectRecipe(slug as RecipeSlug)}
					/>
					<main className="flex h-[480px] flex-1 flex-col overflow-hidden">
						<ManageDialogHeader
							activeItemId={activeRecipe}
							items={navigationItems}
							mobileAction={{
								label: "New recipe",
								icon: Plus,
								onClick: editor.createRecipe,
								disabled: !editor.canCreateRecipe,
							}}
							onSelect={(slug) => selectRecipe(slug as RecipeSlug)}
							title="Recipes"
						/>
						<RecipesEditor
							hasChanges={editor.hasChanges}
							isSaving={editor.isSaving}
							onCancel={editor.handleCancel}
							onNameChange={editor.updateName}
							onPromptChange={editor.updatePrompt}
							onSave={editor.handleSave}
							selectedRecipe={editor.selectedRecipe}
						/>
					</main>
				</SidebarProvider>
			</DialogContent>
		</Dialog>
	);
}
