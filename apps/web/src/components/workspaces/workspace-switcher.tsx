import {
	Avatar,
	AvatarFallback,
	AvatarImage,
} from "@workspace/ui/components/avatar";
import { Button } from "@workspace/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@workspace/ui/components/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import {
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	useSidebarShell,
} from "@workspace/ui/components/sidebar";
import { ChevronsUpDown, LoaderCircle, Plus } from "lucide-react";
import * as React from "react";
import { ShortcutHint } from "@/components/sidebar/shortcut-hint";
import { WorkspaceComposer } from "@/components/workspaces/workspace-composer";
import { getAvatarSrc } from "@/lib/avatar";
import { getWorkspaceRoleOption, type WorkspaceRecord } from "@/lib/workspaces";
import type { Id } from "../../../../../convex/_generated/dataModel";

export function WorkspaceSwitcher({
	workspaces,
	activeWorkspaceId,
	onSelect,
	onCreateWorkspace,
}: {
	workspaces: Array<WorkspaceRecord>;
	activeWorkspaceId: Id<"workspaces"> | null;
	onSelect: (workspaceId: Id<"workspaces">) => void;
	onCreateWorkspace: (input: { name: string }) => Promise<WorkspaceRecord>;
}) {
	const { isMobile } = useSidebarShell();
	const [createOpen, setCreateOpen] = React.useState(false);
	const [menuOpen, setMenuOpen] = React.useState(false);
	const [name, setName] = React.useState("");
	const [createError, setCreateError] = React.useState<string | null>(null);
	const [isCreatingWorkspace, startWorkspaceCreation] = React.useTransition();
	const activeWorkspace =
		workspaces.find((workspace) => workspace._id === activeWorkspaceId) ??
		workspaces[0];

	if (!activeWorkspace) {
		return null;
	}

	const activeWorkspaceMeta = getWorkspaceRoleOption(activeWorkspace.role);
	const activeWorkspaceAvatarSrc =
		activeWorkspace.iconUrl ??
		getAvatarSrc({
			name: activeWorkspace.name,
		});
	const getWorkspaceInitials = (workspaceName: string) =>
		workspaceName
			.split(" ")
			.map((part) => part[0])
			.join("")
			.slice(0, 2)
			.toUpperCase();
	const handleCreateWorkspace = () => {
		startWorkspaceCreation(async () => {
			try {
				setCreateError(null);
				const workspace = await onCreateWorkspace({
					name,
				});
				onSelect(workspace._id);
				setCreateOpen(false);
			} catch (error) {
				setCreateError(
					error instanceof Error
						? error.message
						: "Failed to create workspace.",
				);
			}
		});
	};

	const handleOpenCreateWorkspace = () => {
		setMenuOpen(false);
		setCreateOpen(true);
	};
	const handleCreateOpenChange = (nextOpen: boolean) => {
		setCreateOpen(nextOpen);

		if (!nextOpen) {
			setName("");
			setCreateError(null);
		}
	};

	return (
		<>
			<SidebarMenu>
				<SidebarMenuItem>
					<DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
						<DropdownMenuTrigger asChild>
							<SidebarMenuButton
								size="lg"
								className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
							>
								<Avatar className="size-8 rounded-lg">
									<AvatarImage
										src={activeWorkspaceAvatarSrc}
										alt={activeWorkspace.name}
									/>
									<AvatarFallback className="rounded-lg">
										{getWorkspaceInitials(activeWorkspace.name)}
									</AvatarFallback>
								</Avatar>
								<div className="grid flex-1 text-left text-sm leading-tight">
									<span className="truncate font-medium">
										{activeWorkspace.name}
									</span>
									<span className="truncate text-xs">
										{activeWorkspaceMeta.summary}
									</span>
								</div>
								<ChevronsUpDown className="ml-auto" />
							</SidebarMenuButton>
						</DropdownMenuTrigger>
						<DropdownMenuContent
							className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg [&>[data-slot=dropdown-menu-item]+[data-slot=dropdown-menu-item]]:mt-1"
							side={isMobile ? "bottom" : "right"}
							align="start"
							sideOffset={4}
						>
							{workspaces.map((workspace, index) => {
								const workspaceAvatarSrc =
									workspace.iconUrl ??
									getAvatarSrc({
										name: workspace.name,
									});

								return (
									<DropdownMenuItem
										key={workspace._id}
										onClick={() => onSelect(workspace._id)}
										className="group/workspace-item h-8 gap-2 px-2"
									>
										<Avatar className="size-6 rounded-md">
											<AvatarImage
												src={workspaceAvatarSrc}
												alt={workspace.name}
											/>
											<AvatarFallback className="rounded-md text-[10px]">
												{getWorkspaceInitials(workspace.name)}
											</AvatarFallback>
										</Avatar>
										{workspace.name}
										{index < 9 ? (
											<ShortcutHint
												keyLabel={String(index + 1)}
												className="border border-border/60 bg-muted px-1.5 opacity-0 transition-opacity duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover/workspace-item:opacity-100 group-focus-visible/workspace-item:opacity-100"
											/>
										) : null}
									</DropdownMenuItem>
								);
							})}
							<DropdownMenuSeparator />
							<DropdownMenuItem
								className="h-8 gap-2 px-2"
								onSelect={handleOpenCreateWorkspace}
							>
								<div className="flex size-6 items-center justify-center rounded-md bg-transparent">
									<Plus className="size-4" />
								</div>
								<div className="font-medium">Add workspace</div>
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				</SidebarMenuItem>
			</SidebarMenu>
			<Dialog open={createOpen} onOpenChange={handleCreateOpenChange}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Create a workspace</DialogTitle>
						<DialogDescription>
							Add another workspace to keep your notes and context organized.
						</DialogDescription>
					</DialogHeader>
					<WorkspaceComposer
						name={name}
						onNameChange={setName}
						error={createError}
						nameInputId="workspace-dialog-name"
					/>
					<div className="flex items-center justify-end gap-2">
						<Button variant="ghost" onClick={() => setCreateOpen(false)}>
							Cancel
						</Button>
						<Button
							onClick={handleCreateWorkspace}
							disabled={isCreatingWorkspace || name.trim().length < 2}
						>
							{isCreatingWorkspace ? (
								<LoaderCircle
									data-icon="inline-start"
									className="animate-spin"
								/>
							) : null}
							Create workspace
						</Button>
					</div>
				</DialogContent>
			</Dialog>
		</>
	);
}
