import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from "@workspace/ui/components/breadcrumb";
import { Button } from "@workspace/ui/components/button";
import {
	Sidebar,
	SidebarContent,
	SidebarGroup,
	SidebarGroupContent,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarMenuSkeleton,
} from "@workspace/ui/components/sidebar";
import type { LucideIcon } from "lucide-react";

type ManageDialogNavigationItem = {
	id: string;
	icon: LucideIcon;
	label: string;
};

type ManageDialogNavigationAction = {
	disabled?: boolean;
	icon: LucideIcon;
	label: string;
	onClick: () => void;
};

export function ManageDialogSidebarNav({
	activeItemId,
	footerAction,
	isLoading,
	items,
	onSelect,
}: {
	activeItemId: string | null;
	footerAction?: ManageDialogNavigationAction;
	isLoading?: boolean;
	items: ManageDialogNavigationItem[];
	onSelect: (itemId: string) => void;
}) {
	return (
		<Sidebar collapsible="none" className="hidden md:flex">
			<SidebarContent viewportClassName="flex h-full min-h-full min-w-0 flex-col gap-0 [&>div]:!flex [&>div]:h-full [&>div]:min-h-full [&>div]:min-w-0 [&>div]:w-full [&>div]:flex-col">
				<section className="flex h-full min-h-full flex-1 flex-col">
					<SidebarGroup className="pb-0">
						<SidebarGroupContent>
							<SidebarMenu>
								{items.map((item) => {
									const Icon = item.icon;

									return (
										<SidebarMenuItem key={item.id}>
											<SidebarMenuButton
												asChild
												isActive={activeItemId === item.id}
											>
												<button type="button" onClick={() => onSelect(item.id)}>
													<Icon />
													<span>{item.label}</span>
												</button>
											</SidebarMenuButton>
										</SidebarMenuItem>
									);
								})}
								{isLoading
									? ["version-skeleton-1", "version-skeleton-2"].map((id) => (
											<SidebarMenuItem key={id}>
												<SidebarMenuSkeleton showIcon />
											</SidebarMenuItem>
										))
									: null}
							</SidebarMenu>
						</SidebarGroupContent>
					</SidebarGroup>
					{footerAction ? (
						<div className="mt-auto p-2 pt-1">
							<SidebarMenu>
								<SidebarMenuItem>
									{(() => {
										const Icon = footerAction.icon;

										return (
											<SidebarMenuButton
												type="button"
												onClick={footerAction.onClick}
												disabled={footerAction.disabled}
												className="h-8 gap-2 px-2"
											>
												<div className="flex size-6 items-center justify-center rounded-md bg-transparent">
													<Icon className="size-4" />
												</div>
												<span className="font-medium">
													{footerAction.label}
												</span>
											</SidebarMenuButton>
										);
									})()}
								</SidebarMenuItem>
							</SidebarMenu>
						</div>
					) : null}
				</section>
			</SidebarContent>
		</Sidebar>
	);
}

export function ManageDialogHeader({
	activeItemId,
	items,
	mobileAction,
	onSelect,
	title,
}: {
	activeItemId: string | null;
	items: ManageDialogNavigationItem[];
	mobileAction?: ManageDialogNavigationAction;
	onSelect: (itemId: string) => void;
	title: string;
}) {
	const activeItemLabel =
		items.find((item) => item.id === activeItemId)?.label ?? title;

	return (
		<header className="flex h-16 shrink-0 items-center justify-between gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
			<div className="flex min-w-0 items-center gap-2 px-4">
				<Breadcrumb className="hidden md:block">
					<BreadcrumbList>
						<BreadcrumbItem className="hidden md:block">
							<BreadcrumbLink href="#">{title}</BreadcrumbLink>
						</BreadcrumbItem>
						<BreadcrumbSeparator className="hidden md:block" />
						<BreadcrumbItem>
							<BreadcrumbPage>{activeItemLabel}</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
				</Breadcrumb>
				<div className="flex gap-2 overflow-x-auto md:hidden">
					{items.map((item) => {
						const Icon = item.icon;

						return (
							<Button
								key={item.id}
								variant={activeItemId === item.id ? "secondary" : "ghost"}
								size="sm"
								onClick={() => onSelect(item.id)}
								className="whitespace-nowrap"
							>
								<Icon />
								{item.label}
							</Button>
						);
					})}
				</div>
			</div>
			{mobileAction ? (
				<div className="px-4 md:hidden">
					{(() => {
						const Icon = mobileAction.icon;

						return (
							<Button
								type="button"
								variant="outline"
								size="sm"
								onClick={mobileAction.onClick}
								disabled={mobileAction.disabled}
								className="whitespace-nowrap"
							>
								<Icon />
								{mobileAction.label}
							</Button>
						);
					})()}
				</div>
			) : null}
		</header>
	);
}
