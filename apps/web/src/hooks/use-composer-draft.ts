import * as React from "react";
import {
	clearComposerDraft,
	loadComposerDraft,
	storeComposerDraft,
} from "@/lib/composer-draft";

type ComposerDraftSnapshot<TMetadata> = {
	text: string;
	metadata: TMetadata | null;
};

const emptyComposerDraft = <TMetadata>(): ComposerDraftSnapshot<TMetadata> => ({
	text: "",
	metadata: null,
});

const readComposerDraft = <TMetadata>(
	scopeKey: string | null,
): ComposerDraftSnapshot<TMetadata> =>
	scopeKey
		? (loadComposerDraft<TMetadata>(scopeKey) ?? emptyComposerDraft())
		: emptyComposerDraft();

export const useComposerDraft = <TMetadata>(
	scopeKey: string | null,
): {
	text: string;
	metadata: TMetadata | null;
	setText: (value: React.SetStateAction<string>) => void;
	setMetadata: (value: TMetadata | null) => void;
	getSnapshot: () => ComposerDraftSnapshot<TMetadata>;
	clear: () => void;
} => {
	const [draft, setDraftState] = React.useState(() =>
		readComposerDraft<TMetadata>(scopeKey),
	);
	const draftRef = React.useRef(draft);
	const persistTimeoutRef = React.useRef<number | null>(null);

	const cancelPendingPersist = React.useCallback(() => {
		if (persistTimeoutRef.current === null) {
			return;
		}

		window.clearTimeout(persistTimeoutRef.current);
		persistTimeoutRef.current = null;
	}, []);

	const persistNow = React.useCallback(
		(nextDraft: ComposerDraftSnapshot<TMetadata>) => {
			if (!scopeKey) {
				return;
			}

			storeComposerDraft(scopeKey, nextDraft.text, nextDraft.metadata);
		},
		[scopeKey],
	);

	React.useEffect(() => {
		cancelPendingPersist();
		const nextDraft = readComposerDraft<TMetadata>(scopeKey);
		draftRef.current = nextDraft;
		// Draft state hydrates from scope-keyed localStorage when the active composer changes.
		// react-doctor-disable-next-line react-doctor/no-derived-state
		setDraftState(nextDraft);
	}, [cancelPendingPersist, scopeKey]);

	const persist = React.useCallback(
		(nextDraft: ComposerDraftSnapshot<TMetadata>) => {
			if (!scopeKey) {
				return;
			}

			cancelPendingPersist();
			persistTimeoutRef.current = window.setTimeout(() => {
				persistTimeoutRef.current = null;
				persistNow(nextDraft);
			}, 200);
		},
		[cancelPendingPersist, persistNow, scopeKey],
	);

	const setDraft = React.useCallback(
		(nextDraft: ComposerDraftSnapshot<TMetadata>) => {
			draftRef.current = nextDraft;
			React.startTransition(() => {
				setDraftState(nextDraft);
			});
			persist(nextDraft);
		},
		[persist],
	);

	const setText = React.useCallback(
		(value: React.SetStateAction<string>) => {
			const nextText =
				typeof value === "function" ? value(draftRef.current.text) : value;
			setDraft({
				...draftRef.current,
				text: nextText,
			});
		},
		[setDraft],
	);

	const setMetadata = React.useCallback(
		(value: TMetadata | null) => {
			setDraft({
				...draftRef.current,
				metadata: value,
			});
		},
		[setDraft],
	);

	const getSnapshot = React.useCallback(() => draftRef.current, []);

	const clear = React.useCallback(() => {
		const nextDraft = emptyComposerDraft<TMetadata>();
		cancelPendingPersist();
		draftRef.current = nextDraft;
		setDraftState(nextDraft);
		if (scopeKey) {
			clearComposerDraft(scopeKey);
		}
	}, [cancelPendingPersist, scopeKey]);

	React.useEffect(() => {
		return () => {
			if (persistTimeoutRef.current === null || !scopeKey) {
				return;
			}

			cancelPendingPersist();
			persistNow(draftRef.current);
		};
	}, [cancelPendingPersist, persistNow, scopeKey]);

	return {
		text: draft.text,
		metadata: draft.metadata,
		setText,
		setMetadata,
		getSnapshot,
		clear,
	};
};
