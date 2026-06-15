import { isDesktopRuntime } from "@workspace/platform/desktop";
import {
	Field,
	FieldContent,
	FieldGroup,
} from "@workspace/ui/components/field";
import { Label } from "@workspace/ui/components/label";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectLabel,
	SelectTrigger,
	SelectValue,
} from "@workspace/ui/components/select";
import { useTheme } from "@workspace/ui/components/theme-provider";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";
import {
	DEFAULT_FONT_SMOOTHING,
	DEFAULT_REDUCE_MOTION,
	DEFAULT_TRANSLUCENT_SIDEBAR,
	type ReduceMotionPreference,
} from "@/lib/appearance-preferences";
import { logError } from "@/lib/logger";
import {
	getTranscriptionLanguageSelectValue,
	OTHER_TRANSCRIPTION_LANGUAGE_OPTIONS,
	PRIMARY_TRANSCRIPTION_LANGUAGE_OPTIONS,
	parseTranscriptionLanguageSelectValue,
	TRANSCRIPTION_LANGUAGE_OPTIONS,
} from "@/lib/transcription-languages";
import {
	mergeUserPreferencesForOptimisticUpdate,
	type UserPreferencesState,
} from "@/lib/user-preferences";
import { api } from "../../../../../convex/_generated/api";
import { SettingsSwitchRow } from "./settings-switch-row";

type UserPreferencesUpdatePatch = Partial<
	Pick<
		UserPreferencesState,
		| "fontSmoothing"
		| "reduceMotion"
		| "transcriptionLanguage"
		| "translucentSidebar"
	>
>;
type SavingPreference = keyof UserPreferencesUpdatePatch;

const themeOptions = [
	{
		value: "system",
		label: "System",
	},
	{
		value: "light",
		label: "Light",
	},
	{
		value: "dark",
		label: "Dark",
	},
] as const;
type ThemePreference = (typeof themeOptions)[number]["value"];

const reduceMotionOptions = [
	{
		value: "system",
		label: "System",
	},
	{
		value: "on",
		label: "On",
	},
	{
		value: "off",
		label: "Off",
	},
] as const;

function isThemePreference(value: string): value is ThemePreference {
	return themeOptions.some((option) => option.value === value);
}

function isReduceMotionPreference(
	value: string,
): value is ReduceMotionPreference {
	return reduceMotionOptions.some((option) => option.value === value);
}

export function AppearanceSettings() {
	const { theme, setTheme } = useTheme();
	const isDesktopApp = isDesktopRuntime();
	const userPreferences = useQuery(api.userPreferences.get, {});
	const updateUserPreferences = useMutation(
		api.userPreferences.update,
	).withOptimisticUpdate((localStore, args) => {
		const currentPreferences = localStore.getQuery(api.userPreferences.get, {});
		localStore.setQuery(
			api.userPreferences.get,
			{},
			mergeUserPreferencesForOptimisticUpdate(currentPreferences, args),
		);
	});
	const [savingPreference, setSavingPreference] =
		useState<SavingPreference | null>(null);

	const transcriptionLanguageValue = getTranscriptionLanguageSelectValue(
		userPreferences?.transcriptionLanguage,
	);
	const fontSmoothing =
		userPreferences?.fontSmoothing ?? DEFAULT_FONT_SMOOTHING;
	const reduceMotion = userPreferences?.reduceMotion ?? DEFAULT_REDUCE_MOTION;
	const translucentSidebar =
		userPreferences?.translucentSidebar ?? DEFAULT_TRANSLUCENT_SIDEBAR;

	const saveUserPreference = async (
		patch: UserPreferencesUpdatePatch,
		key: SavingPreference,
		errorLabel: string,
	) => {
		setSavingPreference(key);

		try {
			await updateUserPreferences(patch);
		} catch (error) {
			logError({
				event: "client.error",
				error: error,
				message: `Failed to update ${errorLabel}`,
			});
			toast.error(`Failed to update ${errorLabel}`);
		} finally {
			setSavingPreference(null);
		}
	};

	const handleThemeChange = (value: string) => {
		if (isThemePreference(value)) {
			setTheme(value);
		}
	};

	const handleTranscriptionLanguageChange = async (value: string) => {
		await saveUserPreference(
			{
				transcriptionLanguage: parseTranscriptionLanguageSelectValue(value),
			},
			"transcriptionLanguage",
			"transcription language",
		);
	};

	const handleFontSmoothingChange = async (value: boolean) => {
		await saveUserPreference(
			{
				fontSmoothing: value,
			},
			"fontSmoothing",
			"font smoothing",
		);
	};

	const handleReduceMotionChange = async (value: string) => {
		if (!isReduceMotionPreference(value)) {
			return;
		}

		await saveUserPreference(
			{
				reduceMotion: value,
			},
			"reduceMotion",
			"reduce motion",
		);
	};

	const handleTranslucentSidebarChange = async (value: boolean) => {
		await saveUserPreference(
			{
				translucentSidebar: value,
			},
			"translucentSidebar",
			"translucent sidebar",
		);
	};

	return (
		<div className="py-4">
			<FieldGroup className="gap-6">
				<Field
					orientation="responsive"
					className="@md/field-group:items-center @md/field-group:has-[>[data-slot=field-content]]:items-center"
				>
					<FieldContent className="@md/field-group:justify-center">
						<Label>Theme</Label>
					</FieldContent>
					<Select value={theme} onValueChange={handleThemeChange}>
						<SelectTrigger
							size="sm"
							className="w-full cursor-pointer justify-between @md/field-group:w-48"
							aria-label="Select theme"
						>
							<span>
								{themeOptions.find((option) => option.value === theme)?.label ??
									"System"}
							</span>
						</SelectTrigger>
						<SelectContent align="end">
							<SelectGroup>
								{themeOptions.map(({ value, label }) => (
									<SelectItem key={value} value={value}>
										<span>{label}</span>
									</SelectItem>
								))}
							</SelectGroup>
						</SelectContent>
					</Select>
				</Field>
				{isDesktopApp ? (
					<>
						<Field
							orientation="responsive"
							className="@md/field-group:items-center @md/field-group:has-[>[data-slot=field-content]]:items-center"
						>
							<FieldContent className="@md/field-group:justify-center">
								<Label>Reduce motion</Label>
							</FieldContent>
							<Select
								value={reduceMotion}
								onValueChange={(value) => {
									void handleReduceMotionChange(value);
								}}
								disabled={savingPreference === "reduceMotion"}
							>
								<SelectTrigger
									size="sm"
									className="w-full cursor-pointer justify-between @md/field-group:w-48"
									aria-label="Select reduced motion preference"
								>
									<span>
										{reduceMotionOptions.find(
											(option) => option.value === reduceMotion,
										)?.label ?? "System"}
									</span>
								</SelectTrigger>
								<SelectContent align="end">
									<SelectGroup>
										{reduceMotionOptions.map(({ value, label }) => (
											<SelectItem key={value} value={value}>
												<span>{label}</span>
											</SelectItem>
										))}
									</SelectGroup>
								</SelectContent>
							</Select>
						</Field>
						<SettingsSwitchRow
							id="settings-font-smoothing"
							label="Font smoothing"
							checked={fontSmoothing}
							disabled={savingPreference === "fontSmoothing"}
							onCheckedChange={(checked) => {
								void handleFontSmoothingChange(checked);
							}}
						/>
						<SettingsSwitchRow
							id="settings-translucent-sidebar"
							label="Translucent sidebar"
							checked={translucentSidebar}
							disabled={savingPreference === "translucentSidebar"}
							onCheckedChange={(checked) => {
								void handleTranslucentSidebarChange(checked);
							}}
						/>
					</>
				) : null}
				<Field
					orientation="responsive"
					className="@md/field-group:items-start @md/field-group:has-[>[data-slot=field-content]]:items-start"
				>
					<FieldContent>
						<Label>Transcription language</Label>
					</FieldContent>
					<Select
						value={transcriptionLanguageValue}
						onValueChange={(value) => {
							void handleTranscriptionLanguageChange(value);
						}}
					>
						<SelectTrigger
							size="sm"
							className="w-full cursor-pointer justify-between @md/field-group:w-56"
							aria-label="Select transcription language"
							disabled={savingPreference === "transcriptionLanguage"}
						>
							<SelectValue>
								{TRANSCRIPTION_LANGUAGE_OPTIONS.find(
									(option) => option.value === transcriptionLanguageValue,
								)?.label ?? "Auto-detect"}
							</SelectValue>
						</SelectTrigger>
						<SelectContent
							align="end"
							className="max-h-80"
							showScrollButtons={false}
						>
							<SelectGroup>
								<SelectLabel>Suggested</SelectLabel>
								{PRIMARY_TRANSCRIPTION_LANGUAGE_OPTIONS.map(
									({ value, label }) => (
										<SelectItem key={value} value={value}>
											<span>{label}</span>
										</SelectItem>
									),
								)}
							</SelectGroup>
							<SelectGroup>
								<SelectLabel>More languages</SelectLabel>
								{OTHER_TRANSCRIPTION_LANGUAGE_OPTIONS.map(
									({ value, label }) => (
										<SelectItem key={value} value={value}>
											<span>{label}</span>
										</SelectItem>
									),
								)}
							</SelectGroup>
						</SelectContent>
					</Select>
				</Field>
			</FieldGroup>
		</div>
	);
}
