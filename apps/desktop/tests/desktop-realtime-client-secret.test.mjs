import assert from "node:assert/strict";
import test from "node:test";
import { createDesktopRealtimeClientSecret } from "../src/desktop-realtime-client-secret.mjs";

test("desktop realtime client secret request uses the production transcription session config", async () => {
	let requestBody = null;

	const clientSecret = await createDesktopRealtimeClientSecret({
		fetchImpl: async (_url, init) => {
			requestBody = JSON.parse(String(init.body));

			return new Response(JSON.stringify({ value: "client-secret" }), {
				headers: {
					"Content-Type": "application/json",
					"openai-processing-ms": "10",
					"x-request-id": "request-id",
				},
				status: 200,
			});
		},
		getHostedConvexSiteUrl: () => null,
		getOpenAIApiKey: () => "test-openai-key",
		lang: "en-US",
		source: "systemAudio",
		speaker: "them",
	});

	assert.equal(clientSecret, "client-secret");
	assert.equal(requestBody.session.type, "transcription");
	assert.equal(requestBody.session.audio.input.format.type, "audio/pcm");
	assert.equal(requestBody.session.audio.input.format.rate, 24_000);
	assert.equal(requestBody.session.audio.input.noise_reduction, null);
	assert.equal(
		Object.hasOwn(requestBody.session.audio.input, "turn_detection"),
		false,
	);
	assert.deepEqual(requestBody.session.audio.input.transcription, {
		delay: "high",
		language: "en",
		model: "gpt-realtime-whisper",
	});
});
