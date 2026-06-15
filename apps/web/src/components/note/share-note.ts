import { getDesktopBridge } from "@workspace/platform/desktop";

export type NoteVisibility = "private" | "public";

export async function writeTextToClipboard(value: string) {
	const desktopBridge = getDesktopBridge();

	if (desktopBridge) {
		await desktopBridge.writeClipboardText(value);
		return;
	}

	if (navigator.clipboard?.writeText) {
		await navigator.clipboard.writeText(value);
		return;
	}

	const textarea = document.createElement("textarea");
	textarea.value = value;
	textarea.setAttribute("readonly", "");
	textarea.style.cssText = "position: fixed; opacity: 0;";
	document.body.appendChild(textarea);
	textarea.select();
	document.execCommand("copy");
	document.body.removeChild(textarea);
}

const copyRichTextWithSelectionFallback = async ({
	html,
	text,
}: {
	html: string;
	text: string;
}) => {
	const sanitizedHtml = sanitizeClipboardHtml(html);
	const container = document.createElement("div");
	container.setAttribute("contenteditable", "true");
	container.setAttribute("aria-hidden", "true");
	container.style.cssText =
		"position: fixed; pointer-events: none; opacity: 0; white-space: pre-wrap; inset: 0;";
	container.innerHTML = sanitizedHtml;
	document.body.appendChild(container);

	const selection = window.getSelection();
	const previousRanges =
		selection && selection.rangeCount > 0
			? Array.from({ length: selection.rangeCount }, (_, index) =>
					selection.getRangeAt(index).cloneRange(),
				)
			: [];

	const range = document.createRange();
	range.selectNodeContents(container);
	selection?.removeAllRanges();
	selection?.addRange(range);

	try {
		const succeeded = document.execCommand("copy");
		if (!succeeded) {
			throw new Error("execCommand copy returned false");
		}
	} catch (error) {
		document.body.removeChild(container);
		selection?.removeAllRanges();
		for (const previousRange of previousRanges) {
			selection?.addRange(previousRange);
		}
		void error;
		await writeTextToClipboard(text);
		return;
	}

	document.body.removeChild(container);
	selection?.removeAllRanges();
	for (const previousRange of previousRanges) {
		selection?.addRange(previousRange);
	}
};

const URL_ATTRIBUTE_NAMES = new Set(["action", "href", "src", "xlink:href"]);

function sanitizeClipboardHtml(html: string) {
	const parsedDocument = new DOMParser().parseFromString(html, "text/html");

	for (const element of parsedDocument.body.querySelectorAll(
		"script, iframe, object, embed, link, meta",
	)) {
		element.remove();
	}

	for (const element of parsedDocument.body.querySelectorAll("*")) {
		for (const attribute of Array.from(element.attributes)) {
			const attributeName = attribute.name.toLowerCase();
			const attributeValue = attribute.value.trim().toLowerCase();

			if (
				attributeName.startsWith("on") ||
				(URL_ATTRIBUTE_NAMES.has(attributeName) &&
					(attributeValue.startsWith("javascript:") ||
						attributeValue.startsWith("data:text/html")))
			) {
				element.removeAttribute(attribute.name);
			}
		}
	}

	return parsedDocument.body.innerHTML;
}

export async function writeRichTextToClipboard({
	html,
	text,
}: {
	html: string;
	text: string;
}) {
	const sanitizedHtml = sanitizeClipboardHtml(html);
	const desktopBridge = getDesktopBridge();

	if (desktopBridge?.writeClipboardRichText) {
		await desktopBridge.writeClipboardRichText({
			html: sanitizedHtml,
			text,
		});
		return;
	}

	if (
		typeof ClipboardItem !== "undefined" &&
		navigator.clipboard?.write &&
		window.isSecureContext
	) {
		try {
			await navigator.clipboard.write([
				new ClipboardItem({
					"text/html": new Blob([sanitizedHtml], { type: "text/html" }),
					"text/plain": new Blob([text], { type: "text/plain" }),
				}),
			]);
			return;
		} catch {
			// Fall through to selection/plain-text fallback when rich clipboard writes
			// are exposed but blocked by the browser.
		}
	}

	await copyRichTextWithSelectionFallback({
		html: sanitizedHtml,
		text,
	});
}

async function getShareBaseUrl() {
	const desktopBridge = getDesktopBridge();

	if (desktopBridge?.getShareBaseUrl) {
		return (await desktopBridge.getShareBaseUrl()).url;
	}

	return window.location.origin;
}

export async function buildNoteShareUrl(shareId: string) {
	const baseUrl = new URL(await getShareBaseUrl());

	baseUrl.pathname = `/shared/${shareId}`;
	baseUrl.search = "";
	baseUrl.hash = "";

	return baseUrl.toString();
}
