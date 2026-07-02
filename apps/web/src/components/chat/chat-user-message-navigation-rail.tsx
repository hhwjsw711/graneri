import {
	useMessageScroller,
	useMessageScrollerVisibility,
} from "@workspace/ui/components/message-scroller";
import type { UIMessage } from "ai";
import * as React from "react";
import {
	CompactNavigationRail,
	type CompactNavigationRailItem,
} from "@/components/navigation/compact-navigation-rail";
import { getChatText } from "@/lib/chat-message";

type ChatUserMessageNavigationRailProps = {
	messages: UIMessage[];
};

type ChatReaderTurn = CompactNavigationRailItem & {
	index: number;
	responsePreview: string | null;
	title: string;
};

type ChatReaderPosition = {
	currentAnchorId: string | null;
	visibleMessageIds: string[];
};

const MIN_TURNS = 4;
const SCROLL_MARGIN = 72;

const getChatReaderTurns = (messages: UIMessage[]): ChatReaderTurn[] => {
	const turns: ChatReaderTurn[] = [];
	let currentTurn: ChatReaderTurn | null = null;

	for (const message of messages) {
		if (message.role === "assistant") {
			if (currentTurn?.responsePreview === null) {
				const responsePreview = getChatText(message).trim();
				currentTurn.responsePreview = responsePreview || null;
			}

			continue;
		}

		if (message.role !== "user") {
			continue;
		}

		const title = getChatText(message).trim();

		currentTurn = title
			? {
					ariaLabel: `Jump to user message ${turns.length + 1}`,
					id: message.id,
					index: turns.length,
					responsePreview: null,
					title,
				}
			: null;

		if (currentTurn) {
			turns.push(currentTurn);
		}
	}

	return turns;
};

const getActiveTurnIndex = ({
	position,
	turns,
}: {
	position: ChatReaderPosition;
	turns: ChatReaderTurn[];
}) => {
	if (turns.length === 0) {
		return null;
	}

	const visibleMessageIds = new Set(position.visibleMessageIds);
	const activeAnchorId =
		position.currentAnchorId ??
		turns.find((turn) => visibleMessageIds.has(turn.id))?.id ??
		null;
	const activeIndex = activeAnchorId
		? turns.findIndex((turn) => turn.id === activeAnchorId)
		: -1;

	return activeIndex >= 0 ? activeIndex : turns.length - 1;
};

export function ChatUserMessageNavigationRail({
	messages,
}: ChatUserMessageNavigationRailProps) {
	const position = useMessageScrollerVisibility();
	const scroller = useMessageScroller();
	const turns = React.useMemo(() => getChatReaderTurns(messages), [messages]);
	const activeTurnIndex = React.useMemo(
		() => getActiveTurnIndex({ position, turns }),
		[position, turns],
	);

	if (activeTurnIndex === null || turns.length < MIN_TURNS) {
		return null;
	}

	const revealTurn = (turn: ChatReaderTurn, behavior: ScrollBehavior) => {
		scroller.scrollToMessage(turn.id, {
			align: "start",
			behavior,
			scrollMargin: SCROLL_MARGIN,
		});
	};

	return (
		<CompactNavigationRail
			activeIndex={activeTurnIndex}
			ariaLabel="User messages"
			items={turns}
			onReveal={revealTurn}
			renderPreview={(turn) => <ChatNavigationRailPreview turn={turn} />}
		/>
	);
}

function ChatNavigationRailPreview({ turn }: { turn: ChatReaderTurn }) {
	return (
		<div className="flex min-w-0 flex-col gap-1">
			<div className="min-w-0 truncate font-medium">{turn.title}</div>
			{turn.responsePreview ? (
				<div className="line-clamp-3 text-muted-foreground">
					{turn.responsePreview}
				</div>
			) : null}
		</div>
	);
}
