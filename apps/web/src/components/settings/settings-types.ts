import type { WorkspaceRecord } from "@/lib/workspaces";

export type SettingsUser = {
	name: string;
	email: string;
	avatar: string;
};

export type SettingsPage =
	| "Profile"
	| "Appearance"
	| "Preferences"
	| "Notifications"
	| "Workspace"
	| "Calendar"
	| "Plugins"
	| "Data controls";

export type SettingsDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	user: SettingsUser;
	workspace: WorkspaceRecord | null;
	initialPage?: SettingsPage;
	onPageChange?: (page: SettingsPage) => void;
};
