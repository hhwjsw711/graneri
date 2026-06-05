import {
	SidebarGroup,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
} from "@workspace/ui/components/sidebar";
import type { LucideIcon } from "lucide-react";
import { SquarePen } from "lucide-react";
import * as React from "react";
import { SidebarCollapsibleGroup } from "@/components/nav/sidebar-collapsible-group";
import { ShortcutHint } from "@/components/sidebar/shortcut-hint";

type NavItem = {
	title: string;
	icon: LucideIcon;
	action: "search" | "view" | "inbox" | "disabled";
	view?: "home" | "chat" | "automation" | "shared";
	isActive?: boolean;
	badge?: number;
};

export function NavMain({
	className,
	items,
	onCreateNote,
	onViewChange,
	onSearchOpen,
	onInboxToggle,
}: {
	className?: string;
	items: NavItem[];
	onCreateNote: () => void;
	onViewChange: (
		view: "home" | "chat" | "automation" | "shared" | "note",
	) => void;
	onSearchOpen: () => void;
	onInboxToggle: () => void;
}) {
	const handleOpenSearchShortcut = React.useEffectEvent(() => {
		onSearchOpen();
	});
	const handleCreateNoteShortcut = React.useEffectEvent(() => {
		onCreateNote();
	});

	React.useEffect(() => {
		const down = (event: KeyboardEvent) => {
			if (
				event.defaultPrevented ||
				!(event.metaKey || event.ctrlKey) ||
				event.altKey ||
				event.shiftKey
			) {
				return;
			}

			if (event.key.toLowerCase() === "k") {
				event.preventDefault();
				handleOpenSearchShortcut();
				return;
			}

			if (event.key.toLowerCase() !== "n") {
				return;
			}

			event.preventDefault();
			handleCreateNoteShortcut();
		};

		document.addEventListener("keydown", down);
		return () => document.removeEventListener("keydown", down);
	}, []);

	const searchItem = items.find((item) => item.action === "search");
	const viewItems = items.filter((item) => item.action !== "search");

	return (
		<SidebarGroup className={className}>
			<SidebarMenu>
				<SidebarMenuItem>
					<SidebarMenuButton asChild tooltip="New note">
						<button
							type="button"
							onClick={onCreateNote}
							className="flex w-full items-center gap-2"
						>
							<SquarePen />
							<span>New note</span>
							<SidebarMenuShortcutHint keyLabel="N" />
						</button>
					</SidebarMenuButton>
				</SidebarMenuItem>
				{searchItem ? (
					<SidebarMenuItem key={searchItem.title}>
						<SidebarMenuButton
							asChild
							tooltip={searchItem.title}
							isActive={searchItem.isActive}
						>
							<button
								type="button"
								onClick={() => {
									if (searchItem.action === "search") {
										onSearchOpen();
										return;
									}

									if (searchItem.action === "inbox") {
										onInboxToggle();
										return;
									}

									if (searchItem.action !== "view" || !searchItem.view) {
										return;
									}
									onViewChange(searchItem.view);
								}}
								className="flex w-full cursor-text items-center gap-2"
							>
								{searchItem.icon && <searchItem.icon />}
								<span>{searchItem.title}</span>
								{searchItem.action === "search" ? (
									<SidebarMenuShortcutHint keyLabel="K" />
								) : null}
							</button>
						</SidebarMenuButton>
					</SidebarMenuItem>
				) : null}
			</SidebarMenu>
			<SidebarCollapsibleGroup
				title="Platform"
				className="p-0"
				labelClassName="mt-6"
			>
				<SidebarMenu>
					{viewItems.map((item) => (
						<SidebarMenuItem key={item.title}>
							<SidebarMenuButton
								asChild
								tooltip={item.title}
								isActive={item.isActive}
							>
								<button
									type="button"
									onClick={() => {
										if (item.action === "inbox") {
											onInboxToggle();
											return;
										}

										if (item.action !== "view" || !item.view) {
											return;
										}
										onViewChange(item.view);
									}}
									className="flex w-full items-center gap-2"
								>
									{item.icon && <item.icon />}
									<span>{item.title}</span>
									{item.badge ? (
										<span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-sidebar-accent px-1 text-xs font-medium tabular-nums text-sidebar-accent-foreground">
											{formatBadgeCount(item.badge)}
										</span>
									) : null}
								</button>
							</SidebarMenuButton>
						</SidebarMenuItem>
					))}
				</SidebarMenu>
			</SidebarCollapsibleGroup>
		</SidebarGroup>
	);
}

function formatBadgeCount(value: number) {
	return value > 99 ? "99+" : String(value);
}

function SidebarMenuShortcutHint({ keyLabel }: { keyLabel: string }) {
	return (
		<ShortcutHint
			keyLabel={keyLabel}
			className="border border-border/60 bg-muted px-1.5 opacity-0 transition-opacity duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover/menu-item:opacity-100 group-focus-within/menu-item:opacity-100"
		/>
	);
}
