import { cleanup, render } from "@testing-library/react";
import { TooltipProvider } from "@workspace/ui/components/tooltip";
import type { UIMessage } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatMessageListContent } from "../src/components/chat/message-list";
import ChatMessages from "../src/components/chat/messages";

const streamdownRenderCounts = new Map<string, number>();

vi.mock("streamdown", () => ({
	Streamdown: ({ children }: { children: string }) => {
		streamdownRenderCounts.set(
			children,
			(streamdownRenderCounts.get(children) ?? 0) + 1,
		);

		return <div data-testid="streamdown">{children}</div>;
	},
}));

const createTextMessage = ({
	id,
	role,
	text,
}: {
	id: string;
	role: UIMessage["role"];
	text: string;
}): UIMessage => ({
	id,
	role,
	parts: [{ type: "text", text }],
});

describe("ChatMessageListContent performance", () => {
	afterEach(() => {
		cleanup();
		streamdownRenderCounts.clear();
	});

	it("does not rerender historical markdown when only the active stream changes", () => {
		const longHistoricalText = [
			"# Earlier city morning",
			"",
			...Array.from(
				{ length: 60 },
				(_, index) =>
					`Paragraph ${index + 1}: the city stays quiet while windows brighten and footsteps pass below.`,
			),
		].join("\n\n");
		const userMessage = createTextMessage({
			id: "user-1",
			role: "user",
			text: "write a long city morning story",
		});
		const historicalAssistantMessage = createTextMessage({
			id: "assistant-1",
			role: "assistant",
			text: longHistoricalText,
		});
		const streamingAssistantMessage = createTextMessage({
			id: "assistant-2",
			role: "assistant",
			text: "The morning starts softly.",
		});
		const renderAssistantActions = () => null;
		const renderUserActions = () => null;

		const { rerender } = render(
			<ChatMessageListContent
				messages={[
					userMessage,
					historicalAssistantMessage,
					streamingAssistantMessage,
				]}
				isLoading={true}
				renderAssistantActions={renderAssistantActions}
				renderUserActions={renderUserActions}
			/>,
		);

		expect(streamdownRenderCounts.get(longHistoricalText)).toBe(1);

		rerender(
			<ChatMessageListContent
				messages={[
					userMessage,
					historicalAssistantMessage,
					createTextMessage({
						id: "assistant-2",
						role: "assistant",
						text: "The morning starts softly. More light gathers on the street.",
					}),
				]}
				isLoading={true}
				renderAssistantActions={renderAssistantActions}
				renderUserActions={renderUserActions}
			/>,
		);

		expect(streamdownRenderCounts.get(longHistoricalText)).toBe(1);
	});

	it("keeps historical markdown stable through the production chat message wrapper", () => {
		const longHistoricalText = [
			"# Earlier city morning",
			"",
			...Array.from(
				{ length: 60 },
				(_, index) =>
					`Paragraph ${index + 1}: the city stays quiet while windows brighten and footsteps pass below.`,
			),
		].join("\n\n");
		const userMessage = createTextMessage({
			id: "user-1",
			role: "user",
			text: "write a long city morning story",
		});
		const historicalAssistantMessage = createTextMessage({
			id: "assistant-1",
			role: "assistant",
			text: longHistoricalText,
		});
		const onDeleteMessage = vi.fn();
		const onEditMessage = vi.fn();
		const onPlusAction = vi.fn();
		const onRegenerateMessage = vi.fn();

		const { rerender } = render(
			<TooltipProvider>
				<ChatMessages
					messages={[
						userMessage,
						historicalAssistantMessage,
						createTextMessage({
							id: "assistant-2",
							role: "assistant",
							text: "The morning starts softly.",
						}),
					]}
					isLoading={true}
					onDeleteMessage={onDeleteMessage}
					onEditMessage={onEditMessage}
					onPlusAction={onPlusAction}
					onRegenerateMessage={onRegenerateMessage}
				/>
			</TooltipProvider>,
		);

		expect(streamdownRenderCounts.get(longHistoricalText)).toBe(1);

		rerender(
			<TooltipProvider>
				<ChatMessages
					messages={[
						userMessage,
						historicalAssistantMessage,
						createTextMessage({
							id: "assistant-2",
							role: "assistant",
							text: "The morning starts softly. More light gathers on the street.",
						}),
					]}
					isLoading={true}
					onDeleteMessage={onDeleteMessage}
					onEditMessage={onEditMessage}
					onPlusAction={onPlusAction}
					onRegenerateMessage={onRegenerateMessage}
				/>
			</TooltipProvider>,
		);

		expect(streamdownRenderCounts.get(longHistoricalText)).toBe(1);
	});
});
