import { describe, expect, it, vi } from "vitest";
import {
	DESKTOP_RELEASES_URL,
	pickDesktopReleaseAsset,
	resolveLatestDesktopDownloadUrl,
} from "@/lib/desktop-release";

describe("pickDesktopReleaseAsset", () => {
	it("prefers dmg assets over zip assets", () => {
		const asset = pickDesktopReleaseAsset([
			{
				name: "Graneri-0.1.0-mac.zip",
				browser_download_url: "https://example.com/Graneri-0.1.0-mac.zip",
			},
			{
				name: "Graneri-0.1.0.dmg",
				browser_download_url: "https://example.com/Graneri-0.1.0.dmg",
			},
		]);

		expect(asset?.name).toBe("Graneri-0.1.0.dmg");
	});

	it("returns null when no desktop asset is available", () => {
		expect(
			pickDesktopReleaseAsset([
				{
					name: "latest.yml",
					browser_download_url: "https://example.com/latest.yml",
				},
			]),
		).toBeNull();
	});
});

describe("resolveLatestDesktopDownloadUrl", () => {
	it("returns the preferred asset url from the latest release response", async () => {
		const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({
			ok: true,
			json: async () => ({
				html_url: "https://github.com/murabcd/graneri/releases/tag/v0.1.0",
				assets: [
					{
						name: "Graneri-0.1.0.zip",
						browser_download_url: "https://example.com/Graneri-0.1.0.zip",
					},
					{
						name: "Graneri-0.1.0.dmg",
						browser_download_url: "https://example.com/Graneri-0.1.0.dmg",
					},
				],
			}),
		} as Response);

		await expect(resolveLatestDesktopDownloadUrl(fetchMock)).resolves.toBe(
			"https://example.com/Graneri-0.1.0.dmg",
		);
	});

	it("falls back to the releases page when the request fails", async () => {
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockRejectedValue(new Error("boom"));

		await expect(resolveLatestDesktopDownloadUrl(fetchMock)).resolves.toBe(
			DESKTOP_RELEASES_URL,
		);
	});
});
