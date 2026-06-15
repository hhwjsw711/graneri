import { useAction, useQuery } from "convex/react";
import * as React from "react";
import type { ChatAppSourceProvider } from "@/lib/chat-source-display";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

export type AppSource = {
	id: string;
	title: string;
	preview: string;
	provider: ChatAppSourceProvider;
};

type GoogleSourcesState = {
	sources: AppSource[];
	error: unknown;
	workspaceId: Id<"workspaces"> | null;
};

type GoogleSourcesAction =
	| {
			type: "loaded";
			sources: AppSource[];
			workspaceId: Id<"workspaces">;
	  }
	| {
			type: "failed";
			error: unknown;
			workspaceId: Id<"workspaces">;
	  };

const initialGoogleSourcesState: GoogleSourcesState = {
	sources: [],
	error: null,
	workspaceId: null,
};
const EMPTY_APP_SOURCES: AppSource[] = [];

const googleSourcesReducer = (
	_state: GoogleSourcesState,
	action: GoogleSourcesAction,
): GoogleSourcesState => {
	switch (action.type) {
		case "loaded":
			return {
				sources: action.sources,
				error: null,
				workspaceId: action.workspaceId,
			};
		case "failed":
			return {
				sources: [],
				error: action.error,
				workspaceId: action.workspaceId,
			};
	}
};

export function useAppSources(
	workspaceId: Id<"workspaces"> | null | undefined,
) {
	const connectionSources = useQuery(
		api.appConnections.listSources,
		workspaceId ? { workspaceId } : "skip",
	);
	const listGoogleSources = useAction(api.googleTools.listAvailableSources);
	const [googleSourcesState, dispatchGoogleSources] = React.useReducer(
		googleSourcesReducer,
		initialGoogleSourcesState,
	);

	React.useEffect(() => {
		let cancelled = false;

		if (!workspaceId) {
			return () => {
				cancelled = true;
			};
		}

		void listGoogleSources({ workspaceId })
			.then((sources) => {
				if (!cancelled) {
					dispatchGoogleSources({ type: "loaded", sources, workspaceId });
				}
			})
			.catch((error: unknown) => {
				if (!cancelled) {
					dispatchGoogleSources({ type: "failed", error, workspaceId });
				}
			});

		return () => {
			cancelled = true;
		};
	}, [listGoogleSources, workspaceId]);

	const googleSources =
		workspaceId && googleSourcesState.workspaceId === workspaceId
			? googleSourcesState.sources
			: EMPTY_APP_SOURCES;

	const sources = React.useMemo(
		() => [...googleSources, ...(connectionSources ?? [])],
		[connectionSources, googleSources],
	);

	if (workspaceId && googleSourcesState.workspaceId === workspaceId) {
		if (googleSourcesState.error) {
			throw googleSourcesState.error;
		}
	}

	return sources;
}
