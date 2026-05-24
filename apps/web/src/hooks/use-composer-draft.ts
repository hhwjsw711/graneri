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
	clear: () => void;
} => {
	const [draft, setDraftState] = React.useState(() =>
		readComposerDraft<TMetadata>(scopeKey),
	);
	const draftRef = React.useRef(draft);

	React.useEffect(() => {
		const nextDraft = readComposerDraft<TMetadata>(scopeKey);
		draftRef.current = nextDraft;
		setDraftState(nextDraft);
	}, [scopeKey]);

	const persist = React.useCallback(
		(nextDraft: ComposerDraftSnapshot<TMetadata>) => {
			if (!scopeKey) {
				return;
			}

			storeComposerDraft(scopeKey, nextDraft.text, nextDraft.metadata);
		},
		[scopeKey],
	);

	const setDraft = React.useCallback(
		(nextDraft: ComposerDraftSnapshot<TMetadata>) => {
			draftRef.current = nextDraft;
			setDraftState(nextDraft);
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

	const clear = React.useCallback(() => {
		const nextDraft = emptyComposerDraft<TMetadata>();
		draftRef.current = nextDraft;
		setDraftState(nextDraft);
		if (scopeKey) {
			clearComposerDraft(scopeKey);
		}
	}, [scopeKey]);

	return {
		text: draft.text,
		metadata: draft.metadata,
		setText,
		setMetadata,
		clear,
	};
};
