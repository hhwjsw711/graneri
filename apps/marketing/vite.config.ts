import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

const srcDir = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, process.cwd(), "");
	const marketingSiteUrl =
		env.VITE_MARKETING_SITE_URL?.trim() || "https://graneri-oss.vercel.app";

	return {
		plugins: [
			react(),
			tailwindcss(),
			{
				name: "marketing-site-url",
				transformIndexHtml(html) {
					return html.replaceAll("%%MARKETING_SITE_URL%%", marketingSiteUrl);
				},
			},
		],
		resolve: {
			alias: {
				"@": path.resolve(srcDir),
			},
		},
	};
});
