import { Button } from "@workspace/ui/components/button";
import { LoaderCircle } from "lucide-react";

type ConnectionDialogFooterProps = {
	onCancel: () => void;
	onConnect: () => void;
	onDisable?: () => void;
	isFormValid: boolean;
	isSaving: boolean;
	isDisabling: boolean;
};

export function ConnectionDialogFooter({
	onCancel,
	onConnect,
	onDisable,
	isFormValid,
	isSaving,
	isDisabling,
}: ConnectionDialogFooterProps) {
	return (
		<div className="flex items-center justify-between gap-2 pt-2">
			{onDisable ? (
				<Button
					type="button"
					variant="destructive"
					onClick={onDisable}
					disabled={isSaving || isDisabling}
				>
					{isDisabling ? (
						<>
							<LoaderCircle className="animate-spin" />
							Disabling
						</>
					) : (
						"Disable"
					)}
				</Button>
			) : (
				<span />
			)}
			<div className="flex justify-end gap-2">
				<Button
					type="button"
					variant="ghost"
					onClick={onCancel}
					disabled={isSaving || isDisabling}
				>
					Cancel
				</Button>
				<Button
					type="button"
					onClick={onConnect}
					disabled={!isFormValid || isSaving || isDisabling}
				>
					{isSaving ? (
						<>
							<LoaderCircle className="animate-spin" />
							Connecting
						</>
					) : (
						"Connect"
					)}
				</Button>
			</div>
		</div>
	);
}
