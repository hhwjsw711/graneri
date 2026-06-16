import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AppShellContent } from "../src/app/app-shell-content";

describe("AppShellContent", () => {
	afterEach(() => {
		cleanup();
	});

	it("keeps unresolved resource routes neutral", () => {
		const { container } = render(
			<AppShellContent view={{ kind: "resolving" }} />,
		);

		expect(container.textContent).toBe("");
		expect(screen.queryByText("Page Not Found")).toBeNull();
		expect(screen.queryByText("Ask anything")).toBeNull();
	});
});
