const joinPromptSections = (sections) => sections.filter(Boolean).join(" ");

const normalizePromptText = (value) =>
	typeof value === "string" ? value.trim() : "";

const buildUserProfilePromptSection = ({
	name = "",
	jobTitle = "",
	companyName = "",
} = {}) => {
	const normalizedName = normalizePromptText(name);
	const normalizedJobTitle = normalizePromptText(jobTitle);
	const normalizedCompanyName = normalizePromptText(companyName);
	const profileLines = [
		normalizedName ? `- Name: ${normalizedName}` : "",
		normalizedJobTitle ? `- Job title: ${normalizedJobTitle}` : "",
		normalizedCompanyName ? `- Company: ${normalizedCompanyName}` : "",
	].filter(Boolean);

	if (profileLines.length === 0) {
		return "";
	}

	return [
		"User profile context:",
		...profileLines,
		"Use this only as background context to tailor explanations and note assistance. Do not assume facts that are not stated by the user or available in note context.",
	].join("\n");
};

export const BASE_CHAT_SYSTEM_PROMPT = joinPromptSections([
	"You are Graneri AI, a concise assistant for meeting notes and chat.",
	"Answer clearly and directly.",
	"If the user asks about meetings or notes that are not available in context, say that you do not have that context yet.",
]);

export const CHAT_TITLE_SYSTEM_PROMPT = joinPromptSections([
	"Generate a short chat title that summarizes the user's message.",
	"Use 2 to 5 words when possible.",
	"Use the same primary language as the user's message.",
	"Use sentence case for the overall title.",
	"Preserve the original capitalization of proper nouns, organization names, person names, product names, acronyms, and brand styling such as `OpenAI`, `GPT-5`, or `Cirrus Labs`.",
	"Prefer a concise topic label, not a full sentence or question.",
	"Do not copy the user's message verbatim unless it already reads like a title.",
	"If the exchange is just a greeting or a quick check-in, return exactly `Quick check-in`.",
	"Output only the title text.",
	"Do not use quotes, prefixes, markdown, punctuation wrappers, or extra explanation.",
]);

export const buildChatSystemPrompt = ({
	notesContext = "",
	attachedNoteContext = "",
	recipeContext = "",
	userProfileContext = {},
	webSearchEnabled = false,
} = {}) =>
	webSearchEnabled
		? joinPromptSections([
				BASE_CHAT_SYSTEM_PROMPT,
				recipeContext,
				notesContext,
				attachedNoteContext,
				buildUserProfilePromptSection(userProfileContext),
				"Web search is enabled.",
				"Use web search when the answer would benefit from up-to-date or verifiable information.",
				"When you use web search, rely on the tool results instead of making up citations.",
			])
		: joinPromptSections([
				BASE_CHAT_SYSTEM_PROMPT,
				recipeContext,
				notesContext,
				attachedNoteContext,
				buildUserProfilePromptSection(userProfileContext),
			]);

export const ENHANCED_NOTE_SYSTEM_PROMPT = joinPromptSections([
	"You turn raw transcripts and notes into polished structured notes.",
	"Preserve the source language used in the input.",
	"Do not invent facts, decisions, owners, dates, or action items.",
	"Return a concise, specific note title that matches the content.",
	"If the current note title is generic or in a different language than the source, replace it with a title in the dominant source language.",
	"Prefer a short overview only when it adds signal.",
	"Organize the body into 3 to 6 topic-based sections with descriptive titles grounded in the actual discussion.",
	"Group related bullets together under the most relevant topic instead of scattering them across generic headings.",
	"Use generic sections such as Decisions, Risks, Next steps, or Open questions only when the source clearly supports them.",
	"Keep bullets concise, factual, and easy to scan.",
]);

export const buildEnhancedNotePrompt = ({
	title = "",
	rawNotes = "",
	transcript = "",
	noteText = "",
} = {}) =>
	[
		normalizePromptText(title)
			? `Current note title: ${normalizePromptText(title)}`
			: "",
		normalizePromptText(rawNotes)
			? `User notes:\n${normalizePromptText(rawNotes)}`
			: "",
		normalizePromptText(transcript)
			? `Raw transcript:\n${normalizePromptText(transcript)}`
			: "",
		normalizePromptText(noteText)
			? `Source note text:\n${normalizePromptText(noteText)}`
			: "",
		[
			"Rewrite this into a polished note with:",
			"- a concise title",
			"- a short overview only if it helps",
			"- topic-based sections with descriptive titles",
			"- concise bullets grounded only in the source text",
		].join("\n"),
	]
		.filter(Boolean)
		.join("\n\n");

export const APPLY_TEMPLATE_SYSTEM_PROMPT = joinPromptSections([
	"You rewrite existing notes into a selected note template.",
	"Preserve the source language used in the notes.",
	"Do not invent facts, decisions, owners, or dates.",
	"Keep the note title unchanged and do not output it.",
	"Output only the rewritten note body as plain text.",
	"Before the first section, you may include short bullet points only if they are broadly useful.",
	"Then output every template section in the same order using the format `## Section title` on its own line.",
	"Keep section headings in the same language as the source note, translating the template section titles when needed while preserving their meaning.",
	"Under each section heading, use concise bullet points prefixed with `- `.",
	"If a section has no grounded information, keep the heading and leave it empty.",
	"Do not add commentary, markdown code fences, or extra headings.",
]);

export const buildApplyTemplatePrompt = ({
	title = "",
	templateName = "",
	meetingContext = "",
	templateSections = [],
	noteText = "",
} = {}) =>
	[
		normalizePromptText(title)
			? `Current note title: ${normalizePromptText(title)}`
			: "",
		normalizePromptText(templateName)
			? `Template name: ${normalizePromptText(templateName)}`
			: "",
		normalizePromptText(meetingContext)
			? `Template context:\n${normalizePromptText(meetingContext)}`
			: "",
		[
			"Template sections:",
			...templateSections.map(
				(section, index) =>
					`${index + 1}. ${section.title}${
						section.prompt ? `\nPrompt: ${section.prompt}` : ""
					}`,
			),
		].join("\n"),
		`Source note:\n${normalizePromptText(noteText)}`,
		[
			"Return every template section in the same order.",
			"Keep each section aligned to the matching template section.",
			"Use section titles in the same language as the source note, translating the template titles when needed.",
			"Each section should contain concise bullets grounded only in the source note.",
			"Output plain text only in this format:",
			"- optional overview bullet",
			"## First section title",
			"- bullet",
			"## Second section title",
			"- bullet",
		].join("\n"),
	]
		.filter(Boolean)
		.join("\n\n");
