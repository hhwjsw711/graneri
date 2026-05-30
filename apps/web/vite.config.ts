import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import type { HtmlTagDescriptor, Plugin } from "vite";
import { defineConfig } from "vite";
import { graneriChatPlugin } from "./server/chat-plugin";

const srcDir = fileURLToPath(new URL("./src", import.meta.url));
const workspaceRoot = fileURLToPath(new URL("../../", import.meta.url));
const platformSrcDir = fileURLToPath(
	new URL("../../packages/platform/src", import.meta.url),
);
const envFileName =
	process.env.GRANERI_ENV_MODE?.trim() === "production" ? ".env" : ".env.local";
const envFilePath = path.resolve(workspaceRoot, envFileName);

const parseEnvLine = (line: string) => {
	const trimmed = line.trim();

	if (!trimmed || trimmed.startsWith("#")) {
		return null;
	}

	const separatorIndex = trimmed.indexOf("=");
	if (separatorIndex === -1) {
		return null;
	}

	const key = trimmed.slice(0, separatorIndex).trim();
	let value = trimmed.slice(separatorIndex + 1).trim();

	if (
		(value.startsWith('"') && value.endsWith('"')) ||
		(value.startsWith("'") && value.endsWith("'"))
	) {
		value = value.slice(1, -1);
	}

	return { key, value };
};

const loadSelectedEnvFile = () => {
	if (!fs.existsSync(envFilePath)) {
		return;
	}

	const rawEnv = fs.readFileSync(envFilePath, "utf8");

	for (const line of rawEnv.split(/\r?\n/)) {
		const entry = parseEnvLine(line);
		if (!entry || process.env[entry.key]) {
			continue;
		}

		process.env[entry.key] = entry.value;
	}
};

const getRequiredEnv = (name: string) => {
	const value = process.env[name]?.trim();

	if (!value) {
		throw new Error(`Missing required environment variable: ${name}`);
	}

	return value;
};

const getOrigin = (name: string) => {
	const value = getRequiredEnv(name);

	try {
		return new URL(value).origin;
	} catch (error) {
		throw new Error(`Invalid URL in environment variable ${name}: ${value}`, {
			cause: error,
		});
	}
};

const convexSitePreconnectPlugin = (): Plugin => ({
	name: "graneri-convex-site-preconnect",
	transformIndexHtml() {
		const tags: HtmlTagDescriptor[] = [
			{
				tag: "link",
				attrs: {
					rel: "preconnect",
					href: getOrigin("VITE_CONVEX_SITE_URL"),
					crossorigin: "anonymous",
				},
				injectTo: "head-prepend",
			},
		];

		return tags;
	},
});

type VendorChunkPolicy = {
	name: string;
	match: (normalizedId: string) => boolean;
};

const includesAny =
	(...needles: string[]) =>
	(normalizedId: string) =>
		needles.some((needle) => normalizedId.includes(needle));

const vendorChunkPolicies: VendorChunkPolicy[] = [
	{
		name: "react-vendors",
		match: includesAny(
			"/node_modules/react/",
			"/node_modules/react-dom/",
			"/node_modules/scheduler/",
		),
	},
	{
		name: "convex-vendors",
		match: includesAny("/node_modules/convex/"),
	},
	{
		name: "radix-vendors",
		match: includesAny("/node_modules/@radix-ui/"),
	},
	{
		name: "shell-vendors",
		match: includesAny("/node_modules/sonner/", "/node_modules/@better-fetch/"),
	},
	{
		name: "ui-vendors",
		match: includesAny(
			"/node_modules/clsx/",
			"/node_modules/class-variance-authority/",
			"/node_modules/tailwind-merge/",
		),
	},
	{
		name: "tiptap-note-vendors",
		match: includesAny(
			"/node_modules/@tiptap/markdown/",
			"/node_modules/@tiptap/extension-table-of-contents/",
			"/node_modules/@tiptap/extension-underline/",
			"/node_modules/@tiptap/starter-kit/",
		),
	},
	{
		name: "tiptap-editor-vendors",
		match: includesAny("/node_modules/@tiptap/"),
	},
	{
		name: "prosemirror-vendors",
		match: includesAny("/node_modules/prosemirror-"),
	},
	{
		name: "streamdown-vendors",
		match: includesAny("/node_modules/streamdown/"),
	},
	{
		name: "marked-vendors",
		match: includesAny("/node_modules/marked/"),
	},
	{
		name: "linkify-vendors",
		match: includesAny("/node_modules/linkify"),
	},
	{
		name: "markdown-parse-vendors",
		match: includesAny(
			"/node_modules/micromark",
			"/node_modules/mdast",
			"/node_modules/remark",
			"/node_modules/rehype",
			"/node_modules/unified/",
			"/node_modules/unist",
		),
	},
	{
		name: "html-parse-vendors",
		match: includesAny("/node_modules/parse5/", "/node_modules/entities/"),
	},
	{
		name: "ai-vendors",
		match: includesAny("/node_modules/ai/", "/node_modules/@ai-sdk/"),
	},
	{
		name: "sidebar-dialog-vendors",
		match: includesAny(
			"/node_modules/@dnd-kit/",
			"/node_modules/react-day-picker/",
		),
	},
];

const getVendorChunkName = (id: string) => {
	const normalizedId = id.replaceAll("\\", "/");

	if (
		normalizedId.includes("\0vite/") ||
		normalizedId.includes("vite/preload-helper")
	) {
		return "vite-runtime";
	}

	if (!normalizedId.includes("/node_modules/")) {
		return undefined;
	}

	return vendorChunkPolicies.find((policy) => policy.match(normalizedId))?.name;
};

// https://vite.dev/config/
export default defineConfig(() => {
	loadSelectedEnvFile();
	process.env.VITE_CONVEX_URL ??= process.env.CONVEX_URL;
	process.env.VITE_CONVEX_SITE_URL ??= process.env.CONVEX_SITE_URL;

	return {
		envDir: workspaceRoot,
		envPrefix: ["VITE_"],
		plugins: [
			convexSitePreconnectPlugin(),
			react(),
			tailwindcss(),
			graneriChatPlugin(),
		],
		build: {
			modulePreload: false,
			rollupOptions: {
				output: {
					manualChunks: getVendorChunkName,
				},
			},
		},
		resolve: {
			alias: {
				"@": path.resolve(srcDir),
				"@workspace/platform": path.resolve(platformSrcDir),
			},
		},
		test: {
			setupFiles: ["./tests/setup.ts"],
		},
	};
});
