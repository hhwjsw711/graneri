import { describe, expect, it } from "vitest";
import { requireAuthEnv } from "./auth";

describe("auth config", () => {
	it("fails closed when required provider credentials are missing", () => {
		const originalValue = process.env.GITHUB_CLIENT_ID;
		delete process.env.GITHUB_CLIENT_ID;

		try {
			expect(() => requireAuthEnv("GITHUB_CLIENT_ID")).toThrow(
				"Missing required environment variable: GITHUB_CLIENT_ID",
			);
		} finally {
			if (originalValue === undefined) {
				delete process.env.GITHUB_CLIENT_ID;
			} else {
				process.env.GITHUB_CLIENT_ID = originalValue;
			}
		}
	});
});
