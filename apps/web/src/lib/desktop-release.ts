const getEnv = (name: keyof ImportMetaEnv, fallback: string) =>
	import.meta.env[name]?.trim() || fallback;

const GITHUB_OWNER = getEnv("VITE_GITHUB_OWNER", "murabcd");
const GITHUB_REPO = getEnv("VITE_GITHUB_REPO", "graneri");
const DESKTOP_DOWNLOAD_URL = import.meta.env.VITE_DESKTOP_DOWNLOAD_URL?.trim();
const DESKTOP_RELEASE_API_URL =
	import.meta.env.VITE_DESKTOP_RELEASE_API_URL?.trim();

export const createDesktopReleaseUrls = ({
	downloadUrl,
	githubOwner,
	githubRepo,
	releaseApiUrl,
}: {
	downloadUrl?: string;
	githubOwner: string;
	githubRepo: string;
	releaseApiUrl?: string;
}) => ({
	downloadUrl:
		downloadUrl ||
		`https://github.com/${githubOwner}/${githubRepo}/releases/latest`,
	releaseApiUrl:
		releaseApiUrl ||
		`https://api.github.com/repos/${githubOwner}/${githubRepo}/releases/latest`,
});

const desktopReleaseUrls = createDesktopReleaseUrls({
	downloadUrl: DESKTOP_DOWNLOAD_URL,
	githubOwner: GITHUB_OWNER,
	githubRepo: GITHUB_REPO,
	releaseApiUrl: DESKTOP_RELEASE_API_URL,
});

export const DESKTOP_RELEASES_URL = desktopReleaseUrls.downloadUrl;
const DESKTOP_LATEST_RELEASE_API_URL = desktopReleaseUrls.releaseApiUrl;

type GitHubReleaseAsset = {
	name: string;
	browser_download_url: string;
};

type GitHubLatestReleaseResponse = {
	assets?: GitHubReleaseAsset[];
	html_url?: string;
};

const DESKTOP_ASSET_EXTENSIONS = [".dmg", ".zip"];
const DESKTOP_ASSET_EXTENSION_INDEX = new Map(
	DESKTOP_ASSET_EXTENSIONS.map((extension, index) => [extension, index]),
);

export const pickDesktopReleaseAsset = (
	assets: GitHubLatestReleaseResponse["assets"],
) => {
	if (!assets?.length) {
		return null;
	}

	let preferredAsset: GitHubReleaseAsset | null = null;
	let preferredPriority = Number.POSITIVE_INFINITY;

	for (const asset of assets) {
		const lowerName = asset.name.toLowerCase();
		for (const [extension, priority] of DESKTOP_ASSET_EXTENSION_INDEX) {
			if (lowerName.endsWith(extension) && priority < preferredPriority) {
				preferredAsset = asset;
				preferredPriority = priority;
			}
		}
	}

	return preferredAsset;
};

export const resolveLatestDesktopDownloadUrl = async (
	fetchImpl: typeof fetch = fetch,
) => {
	try {
		const response = await fetchImpl(DESKTOP_LATEST_RELEASE_API_URL, {
			headers: {
				Accept: "application/vnd.github+json",
			},
		});

		if (!response.ok) {
			throw new Error(
				`GitHub latest release lookup failed: ${response.status}`,
			);
		}

		const release = (await response.json()) as GitHubLatestReleaseResponse;
		const preferredAsset = pickDesktopReleaseAsset(release.assets);

		return (
			preferredAsset?.browser_download_url ??
			release.html_url ??
			DESKTOP_RELEASES_URL
		);
	} catch {
		return DESKTOP_RELEASES_URL;
	}
};
