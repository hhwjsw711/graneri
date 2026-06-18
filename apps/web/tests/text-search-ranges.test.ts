import { describe, expect, it } from "vitest";
import { createTextMatchRanges, escapeRegExp } from "@/lib/text-search-ranges";

describe("text search ranges", () => {
	it("escapes regular expression syntax in literal search queries", () => {
		expect(escapeRegExp("a+b? [test]")).toBe("a\\+b\\? \\[test\\]");
	});

	it("returns no ranges for blank queries", () => {
		const element = document.createElement("div");
		element.textContent = "Searchable text";

		expect(createTextMatchRanges({ element, query: "   " })).toEqual([]);
	});

	it("creates ranges across descendant text nodes with case-insensitive matching", () => {
		const element = document.createElement("div");
		element.append("Find ");
		const child = document.createElement("span");
		child.textContent = "Needle and needle.";
		element.append(child);

		const ranges = createTextMatchRanges({ element, query: "needle" });

		expect(ranges.map((range) => range.toString())).toEqual([
			"Needle",
			"needle",
		]);
	});

	it("treats regexp metacharacters as literal text", () => {
		const element = document.createElement("div");
		element.textContent = "Use a+b? literally, not aaab.";

		const ranges = createTextMatchRanges({ element, query: "a+b?" });

		expect(ranges.map((range) => range.toString())).toEqual(["a+b?"]);
	});
});
