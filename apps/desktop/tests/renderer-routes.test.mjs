import assert from "node:assert/strict";
import test from "node:test";
import {
	isRendererAppRoutePath,
	rendererMeetingWidgetPathname,
	rendererRoutePrefixes,
} from "../../../packages/platform/src/renderer-routes.mjs";

test("renderer route manifest includes desktop and web app routes", () => {
	assert.equal(rendererMeetingWidgetPathname, "/desktop/meeting-widget");
	assert.deepEqual(rendererRoutePrefixes, [
		"/automations",
		"/chat",
		"/desktop/meeting-widget",
		"/home",
		"/inbox",
		"/note",
		"/settings",
		"/shared",
	]);
});

test("renderer route predicate accepts app routes and rejects assets", () => {
	for (const pathname of [
		"/",
		"/home",
		"/chat",
		"/chat/thread",
		"/desktop/meeting-widget",
		"/settings/profile",
		"/shared/note",
	]) {
		assert.equal(isRendererAppRoutePath(pathname), true, pathname);
	}

	for (const pathname of [
		"/assets/index.js",
		"/favicon.ico",
		"/api/chat",
		"/desktop",
		"/settings-profile",
	]) {
		assert.equal(isRendererAppRoutePath(pathname), false, pathname);
	}
});
