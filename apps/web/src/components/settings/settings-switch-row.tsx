import { Label } from "@workspace/ui/components/label";
import { Switch } from "@workspace/ui/components/switch";

type SettingsSwitchRowProps = {
	id: string;
	label: string;
	checked: boolean;
	disabled: boolean;
	onCheckedChange: (checked: boolean) => void;
};

export function SettingsSwitchRow({
	id,
	label,
	checked,
	disabled,
	onCheckedChange,
}: SettingsSwitchRowProps) {
	return (
		<div className="flex items-center justify-between gap-4">
			<Label htmlFor={id} className="text-sm font-medium text-foreground">
				{label}
			</Label>
			<Switch
				id={id}
				checked={checked}
				disabled={disabled}
				onCheckedChange={onCheckedChange}
			/>
		</div>
	);
}
