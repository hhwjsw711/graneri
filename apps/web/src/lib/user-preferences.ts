import type { Id } from "../../../../convex/_generated/dataModel";
import {
	DEFAULT_FONT_SMOOTHING,
	DEFAULT_REDUCE_MOTION,
	DEFAULT_TRANSLUCENT_SIDEBAR,
	type ReduceMotionPreference,
} from "./appearance-preferences";

export type UserPreferencesState = {
	transcriptionLanguage: string | null;
	jobTitle: string | null;
	companyName: string | null;
	fontSmoothing: boolean;
	reduceMotion: ReduceMotionPreference;
	translucentSidebar: boolean;
	avatarStorageId: Id<"_storage"> | null;
	avatarUrl: string | null;
};

export function mergeUserPreferencesForOptimisticUpdate(
	currentPreferences: UserPreferencesState | null | undefined,
	args: Partial<UserPreferencesState>,
): UserPreferencesState {
	return {
		transcriptionLanguage:
			args.transcriptionLanguage !== undefined
				? args.transcriptionLanguage
				: (currentPreferences?.transcriptionLanguage ?? null),
		jobTitle:
			args.jobTitle !== undefined
				? args.jobTitle
				: (currentPreferences?.jobTitle ?? null),
		companyName:
			args.companyName !== undefined
				? args.companyName
				: (currentPreferences?.companyName ?? null),
		fontSmoothing:
			args.fontSmoothing !== undefined
				? args.fontSmoothing
				: (currentPreferences?.fontSmoothing ?? DEFAULT_FONT_SMOOTHING),
		reduceMotion:
			args.reduceMotion !== undefined
				? args.reduceMotion
				: (currentPreferences?.reduceMotion ?? DEFAULT_REDUCE_MOTION),
		translucentSidebar:
			args.translucentSidebar !== undefined
				? args.translucentSidebar
				: (currentPreferences?.translucentSidebar ??
					DEFAULT_TRANSLUCENT_SIDEBAR),
		avatarStorageId:
			args.avatarStorageId !== undefined
				? args.avatarStorageId
				: (currentPreferences?.avatarStorageId ?? null),
		avatarUrl:
			args.avatarUrl !== undefined
				? args.avatarUrl
				: (currentPreferences?.avatarUrl ?? null),
	};
}
