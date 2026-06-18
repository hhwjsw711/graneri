import { Button } from "@workspace/ui/components/button";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@workspace/ui/components/collapsible";
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
import { ChevronDown, Plus, X } from "lucide-react";
import type { RemoteMcpConnectionFormState } from "@/lib/remote-mcp-connection-form";
import { ConnectionDialogFooter } from "./connection-dialog-footer";

const SETTINGS_LABEL_CLASSNAME = "text-xs text-muted-foreground";
const SETTINGS_COLLAPSIBLE_TRIGGER_CLASSNAME =
	"group w-full justify-between px-0 text-sm font-medium text-foreground hover:!bg-transparent hover:text-foreground active:!bg-transparent aria-expanded:!bg-transparent aria-expanded:hover:!bg-transparent focus-visible:!bg-transparent";

type RemoteMcpDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	idPrefix: string;
	title: string;
	description: string;
	keyPlaceholder?: string;
	formState: RemoteMcpConnectionFormState;
	onNameChange: (name: string) => void;
	onBaseUrlChange: (baseUrl: string) => void;
	onAddEnvVar: () => void;
	onRemoveEnvVar: (id: string) => void;
	onUpdateEnvVar: (id: string, key: "key" | "value", value: string) => void;
	oauthClientId?: string;
	oauthClientSecret?: string;
	onOAuthClientIdChange?: (oauthClientId: string) => void;
	onOAuthClientSecretChange?: (oauthClientSecret: string) => void;
	onConnect: () => void;
	onDisable?: () => void;
	isFormValid: boolean;
	isSaving: boolean;
	isDisabling: boolean;
};

export function RemoteMcpDialog({
	open,
	onOpenChange,
	idPrefix,
	title,
	description,
	keyPlaceholder,
	formState,
	onNameChange,
	onBaseUrlChange,
	onAddEnvVar,
	onRemoveEnvVar,
	onUpdateEnvVar,
	oauthClientId,
	oauthClientSecret,
	onOAuthClientIdChange,
	onOAuthClientSecretChange,
	onConnect,
	onDisable,
	isFormValid,
	isSaving,
	isDisabling,
}: RemoteMcpDialogProps) {
	const nameInputId = `${idPrefix}-name`;
	const baseUrlInputId = `${idPrefix}-base-url`;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription>{description}</DialogDescription>
				</DialogHeader>
				<FieldGroup className="gap-4">
					<Field>
						<Label htmlFor={nameInputId} className={SETTINGS_LABEL_CLASSNAME}>
							Name
						</Label>
						<Input
							id={nameInputId}
							value={formState.name}
							onChange={(event) => onNameChange(event.target.value)}
							placeholder={formState.name}
						/>
					</Field>
					<Field>
						<Label
							htmlFor={baseUrlInputId}
							className={SETTINGS_LABEL_CLASSNAME}
						>
							Base URL
						</Label>
						<Input
							id={baseUrlInputId}
							value={formState.baseUrl}
							onChange={(event) => onBaseUrlChange(event.target.value)}
							placeholder={formState.baseUrl}
						/>
					</Field>
					<Field>
						<div className="flex items-center justify-between gap-3">
							<Label className={SETTINGS_LABEL_CLASSNAME}>
								Environment variables (optional)
							</Label>
							<Button
								type="button"
								variant="outline"
								size="sm"
								onClick={onAddEnvVar}
							>
								<Plus />
								Add variable
							</Button>
						</div>
						{formState.envVars.length > 0 ? (
							<div className="space-y-2">
								{formState.envVars.map((envVar) => (
									<div key={envVar.id} className="flex gap-2">
										<Input
											value={envVar.key}
											onChange={(event) =>
												onUpdateEnvVar(envVar.id, "key", event.target.value)
											}
											placeholder={keyPlaceholder ?? "Authorization"}
										/>
										<Input
											type="password"
											value={envVar.value}
											onChange={(event) =>
												onUpdateEnvVar(envVar.id, "value", event.target.value)
											}
											placeholder="value"
										/>
										<Button
											type="button"
											variant="ghost"
											size="icon"
											onClick={() => onRemoveEnvVar(envVar.id)}
											aria-label="Remove variable"
										>
											<X />
										</Button>
									</div>
								))}
							</div>
						) : null}
					</Field>
					{onOAuthClientIdChange && onOAuthClientSecretChange ? (
						<Collapsible>
							<CollapsibleTrigger asChild>
								<Button
									type="button"
									variant="ghost"
									className={SETTINGS_COLLAPSIBLE_TRIGGER_CLASSNAME}
								>
									Advanced settings
									<ChevronDown className="size-4 transition-transform group-data-[state=open]:rotate-180" />
								</Button>
							</CollapsibleTrigger>
							<CollapsibleContent className="space-y-4 pt-4">
								<Field>
									<Label
										htmlFor={`${idPrefix}-oauth-client-id`}
										className={SETTINGS_LABEL_CLASSNAME}
									>
										OAuth Client ID
									</Label>
									<Input
										id={`${idPrefix}-oauth-client-id`}
										value={oauthClientId ?? ""}
										onChange={(event) =>
											onOAuthClientIdChange(event.target.value)
										}
										placeholder="OAuth Client ID"
									/>
								</Field>
								<Field>
									<Label
										htmlFor={`${idPrefix}-oauth-client-secret`}
										className={SETTINGS_LABEL_CLASSNAME}
									>
										OAuth Client Secret
									</Label>
									<Input
										id={`${idPrefix}-oauth-client-secret`}
										type="password"
										value={oauthClientSecret ?? ""}
										onChange={(event) =>
											onOAuthClientSecretChange(event.target.value)
										}
										placeholder="OAuth Client Secret"
									/>
								</Field>
							</CollapsibleContent>
						</Collapsible>
					) : null}
				</FieldGroup>
				<ConnectionDialogFooter
					onCancel={() => onOpenChange(false)}
					onConnect={onConnect}
					onDisable={onDisable}
					isFormValid={isFormValid}
					isSaving={isSaving}
					isDisabling={isDisabling}
				/>
			</DialogContent>
		</Dialog>
	);
}
