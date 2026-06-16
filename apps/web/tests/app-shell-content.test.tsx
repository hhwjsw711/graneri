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

	it("renders a real 404 for confirmed missing routes", () => {
		render(<AppShellContent view={{ kind: "notFound", onGoHome: () => {} }} />);

		expect(screen.getByText("404 - Not Found")).not.toBeNull();
		expect(screen.getByRole("button", { name: "Go to Home" })).not.toBeNull();
		expect(screen.queryByText("Ask anything")).toBeNull();
	});
});
