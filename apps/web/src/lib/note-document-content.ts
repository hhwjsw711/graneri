import type { JSONContent } from "@tiptap/core";
import type { Editor } from "@tiptap/react";

type NoteContentEditor = Pick<Editor, "getHTML" | "getMarkdown" | "getText">;

const escapeHtml = (value: string) =>
	value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");

export const getPlainTextContent = ({
	editor,
	title,
	searchableText,
}: {
	editor: NoteContentEditor;
	title: string;
	searchableText: string;
}) => {
	const editorText = editor.getText({ blockSeparator: "\n\n" }).trim();
	return [title.trim(), editorText || searchableText.trim()]
		.filter(Boolean)
		.join("\n\n");
};

export const getMarkdownContent = ({
	editor,
	title,
	searchableText,
}: {
	editor: NoteContentEditor;
	title: string;
	searchableText: string;
}) => {
	const editorMarkdown = editor.getMarkdown().trim();
	const titleText = title.trim();

	return [
		titleText ? `# ${titleText}` : "",
		editorMarkdown || searchableText.trim(),
	]
		.filter(Boolean)
		.join("\n\n");
};

export const getExportFileName = (title: string) =>
	`${
		title
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "") || "note"
	}.md`;

export const getRichTextContent = ({
	editor,
	title,
	searchableText,
}: {
	editor: NoteContentEditor;
	title: string;
	searchableText: string;
}) => {
	const plainText = getPlainTextContent({
		editor,
		title,
		searchableText,
	});
	const titleText = title.trim();
	const editorHtml = editor.getHTML().trim();
	const titleHtml = titleText ? `<h1>${escapeHtml(titleText)}</h1>` : "";
	const bodyHtml =
		editorHtml && editorHtml !== "<p></p>"
			? editorHtml
			: searchableText
					.trim()
					.split(/\n{2,}/)
					.flatMap((paragraph) => {
						const trimmedParagraph = paragraph.trim();
						return trimmedParagraph
							? [`<p>${escapeHtml(trimmedParagraph)}</p>`]
							: [];
					})
					.join("");

	return {
		text: plainText,
		html: `<article>${titleHtml}${bodyHtml}</article>`,
	};
};

export const plainTextToDocumentNodes = (text: string): JSONContent[] =>
	text.split(/\n{2,}/).flatMap((chunk) => {
		const trimmedChunk = chunk.trim();
		return trimmedChunk
			? [
					{
						type: "paragraph",
						content: [{ type: "text", text: trimmedChunk }],
					} satisfies JSONContent,
				]
			: [];
	});
