import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { modules } from "./test.setup";

const ownerIdentity = {
	issuer: "https://opengran.test",
	subject: "owner-subject",
	tokenIdentifier: "test|owner",
	name: "Owner",
	email: "owner@example.com",
};

const createWorkspace = async () => {
	const t = convexTest(schema, modules);
	const asOwner = t.withIdentity(ownerIdentity);

	const workspaceId = await t.run(async (ctx) =>
		ctx.db.insert("workspaces", {
			ownerTokenIdentifier: ownerIdentity.tokenIdentifier,
			name: "Workspace",
			normalizedName: "workspace",
			role: "startup-generalist",
			createdAt: 1_000,
			updatedAt: 1_000,
		}),
	);

	return {
		asOwner,
		workspaceId,
	};
};

test("starred.reorder persists mixed starred item order", async () => {
	const { asOwner, workspaceId } = await createWorkspace();
	const noteId = await asOwner.mutation(api.notes.create, { workspaceId });
	await asOwner.mutation(api.notes.toggleStar, { workspaceId, id: noteId });
	const project = await asOwner.mutation(api.projects.create, {
		workspaceId,
		name: "Product",
	});
	await asOwner.mutation(api.projects.toggleStar, {
		workspaceId,
		id: project._id,
	});
	await asOwner.mutation(api.chats.saveMessage, {
		workspaceId,
		chatId: "chat-1",
		preview: "Chat preview",
		message: {
			id: "msg-1",
			role: "user",
			partsJson: JSON.stringify([{ type: "text", text: "Hello" }]),
			text: "Hello",
			createdAt: 2_000,
		},
	});
	await asOwner.mutation(api.chats.toggleStar, {
		workspaceId,
		chatId: "chat-1",
	});
	const chat = await asOwner.query(api.chats.getSession, {
		workspaceId,
		chatId: "chat-1",
	});
	if (!chat) {
		throw new Error("Expected chat to exist.");
	}

	await asOwner.mutation(api.starred.reorder, {
		workspaceId,
		items: [
			{ kind: "chat", id: chat._id },
			{ kind: "note", id: noteId },
			{ kind: "project", id: project._id },
		],
	});

	const stored = await asOwner.run(async (ctx) => {
		const [storedChat, storedNote, storedProject] = await Promise.all([
			ctx.db.get(chat._id),
			ctx.db.get(noteId),
			ctx.db.get(project._id),
		]);

		return {
			chat: storedChat?.starredSortOrder,
			note: storedNote?.starredSortOrder,
			project: storedProject?.starredSortOrder,
		};
	});

	expect(stored).toEqual({
		chat: 0,
		note: 1,
		project: 2,
	});
});
