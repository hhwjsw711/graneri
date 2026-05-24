import { describe, expect, it } from "vitest";
import {
	countDeferredOpenAITools,
	finalizeOpenAIToolSet,
	hasDeferredOpenAITools,
} from "../../../packages/ai/src/openai-tool-search.mjs";

const deferredTool = {
	description: "Search a connected source.",
	inputSchema: {},
	providerOptions: {
		openai: {
			deferLoading: true,
		},
	},
};

const immediateTool = {
	description: "Run immediately.",
	inputSchema: {},
};

describe("OpenAI tool search finalization", () => {
	it("adds tool search when deferred OpenAI tools are present", () => {
		const finalized = finalizeOpenAIToolSet({
			search_source: deferredTool,
		});

		expect(finalized.hasTools).toBe(true);
		expect(finalized.hasToolSearch).toBe(true);
		expect(finalized.deferredToolCount).toBe(1);
		expect(finalized.toolCount).toBe(2);
		expect(finalized.tools.toolSearch).toBeDefined();
		expect(finalized.tools.search_source).toBe(deferredTool);
	});

	it("does not add tool search for immediate-only tools", () => {
		const finalized = finalizeOpenAIToolSet({
			web_search: immediateTool,
		});

		expect(finalized.hasTools).toBe(true);
		expect(finalized.hasToolSearch).toBe(false);
		expect(finalized.deferredToolCount).toBe(0);
		expect(finalized.toolCount).toBe(1);
		expect(finalized.tools.toolSearch).toBeUndefined();
	});

	it("does not count toolSearch itself as deferred", () => {
		const finalized = finalizeOpenAIToolSet({
			toolSearch: deferredTool,
		});

		expect(hasDeferredOpenAITools(finalized.tools)).toBe(false);
		expect(countDeferredOpenAITools(finalized.tools)).toBe(0);
		expect(finalized.hasToolSearch).toBe(true);
		expect(finalized.toolCount).toBe(1);
	});
});
