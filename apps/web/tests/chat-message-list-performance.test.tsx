import { cleanup, render } from "@testing-library/react";
import { TooltipProvider } from "@workspace/ui/components/tooltip";
import type { UIMessage } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatMessageListContent } from "../src/components/chat/message-list";
import ChatMessages from "../src/components/chat/messages";
import { parseMarkdownIntoStableBlocks } from "../src/lib/markdown-stable-blocks";

const streamdownRenderCounts = new Map<string, number>();

vi.mock("streamdown", () => ({
	Streamdown: ({
		children,
		isAnimating,
		mode,
	}: {
		children: string;
		isAnimating?: boolean;
		mode?: "streaming" | "static";
	}) => {
		streamdownRenderCounts.set(
			children,
			(streamdownRenderCounts.get(children) ?? 0) + 1,
		);

		return (
			<div
				data-animating={isAnimating === true ? "true" : "false"}
				data-mode={mode}
				data-testid="streamdown"
			>
				{children}
			</div>
		);
	},
}));

const createTextMessage = ({
	id,
	metadata,
	role,
	text,
}: {
	id: string;
	metadata?: UIMessage["metadata"];
	role: UIMessage["role"];
	text: string;
}): UIMessage => ({
	id,
	metadata,
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
		expect(streamdownRenderCounts.get("The morning starts softly.")).toBe(1);

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
		expect(
			streamdownRenderCounts.get(
				"The morning starts softly. More light gathers on the street.",
			),
		).toBe(1);
	});

	it("renders interrupted assistant markdown through the markdown renderer", () => {
		const interruptedText = [
			"# Interrupted answer",
			"",
			"- first point",
			"- second point",
		].join("\n");
		const interruptedAssistantMessage = createTextMessage({
			id: "assistant-1",
			metadata: { interrupted: true },
			role: "assistant",
			text: interruptedText,
		});

		render(
			<TooltipProvider>
				<ChatMessageListContent
					messages={[interruptedAssistantMessage]}
					isLoading={false}
					renderAssistantActions={() => null}
				/>
			</TooltipProvider>,
		);

		const markdown = document.querySelector('[data-testid="streamdown"]');

		expect(streamdownRenderCounts.get(interruptedText)).toBe(1);
		expect(markdown?.getAttribute("data-mode")).toBe("streaming");
		expect(markdown?.getAttribute("data-animating")).toBe("false");
		expect(document.body.textContent).toContain("# Interrupted answer");
		expect(document.body.textContent).toContain("Steered conversation");
	});

	it("marks steer handoff assistant text as a completed steered conversation", () => {
		const assistantText =
			"The original answer was interrupted midway through a paragraph.";
		const handoffAssistantMessage = createTextMessage({
			id: "assistant-handoff",
			role: "assistant",
			text: assistantText,
		});

		render(
			<TooltipProvider>
				<ChatMessageListContent
					messages={[handoffAssistantMessage]}
					isLoading={true}
					streamingMessageIds={new Set(["assistant-handoff"])}
					renderAssistantActions={() => null}
				/>
			</TooltipProvider>,
		);

		const markdown = document.querySelector('[data-testid="streamdown"]');

		expect(streamdownRenderCounts.get(assistantText)).toBe(1);
		expect(markdown?.getAttribute("data-mode")).toBe("streaming");
		expect(markdown?.getAttribute("data-animating")).toBe("false");
		expect(document.body.textContent).toContain("Steered conversation");
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
		expect(streamdownRenderCounts.get("The morning starts softly.")).toBe(1);

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
		expect(
			streamdownRenderCounts.get(
				"The morning starts softly. More light gathers on the street.",
			),
		).toBe(1);
	});

	it("keeps completed streaming markdown blocks stable as the final block grows", () => {
		const firstSnapshot = parseMarkdownIntoStableBlocks(
			[
				"# Summary",
				"",
				"The first paragraph is complete.",
				"",
				"The active paragraph starts",
			].join("\n"),
		);
		const nextSnapshot = parseMarkdownIntoStableBlocks(
			[
				"# Summary",
				"",
				"The first paragraph is complete.",
				"",
				"The active paragraph starts and keeps growing.",
			].join("\n"),
		);

		expect(nextSnapshot.slice(0, -1)).toEqual(firstSnapshot.slice(0, -1));
		expect(nextSnapshot.at(-1)).toBe(
			"The active paragraph starts and keeps growing.",
		);
	});

	it("does not split fenced code blocks while streaming markdown", () => {
		const blocks = parseMarkdownIntoStableBlocks(
			[
				"Before",
				"",
				"```ts",
				"const value = 1;",
				"",
				"console.log(value);",
				"```",
				"",
				"After",
			].join("\n"),
		);

		expect(blocks).toEqual([
			"Before",
			"```ts\nconst value = 1;\n\nconsole.log(value);\n```",
			"After",
		]);
	});
});
