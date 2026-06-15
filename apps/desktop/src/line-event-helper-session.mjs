import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { logError } from "./logger.mjs";

export const stopLineEventHelperSession = async (session) => {
	if (!session) {
		return;
	}

	session.isStopping = true;

	if (session.cleanupTimeout) {
		clearTimeout(session.cleanupTimeout);
		session.cleanupTimeout = null;
	}

	session.lineReader?.removeAllListeners();
	session.process.stdout?.removeAllListeners();
	session.process.stderr?.removeAllListeners();
	session.process.removeAllListeners();

	await new Promise((resolvePromise) => {
		let didFinalize = false;
		const finalize = () => {
			if (didFinalize) {
				return;
			}

			didFinalize = true;
			resolvePromise();
		};

		session.process.once("exit", finalize);
		session.process.kill("SIGTERM");

		setTimeout(() => {
			if (!session.process.killed) {
				session.process.kill("SIGKILL");
			}
			finalize();
		}, 1_000);
	});
};

export const startLineEventHelperSession = async ({
	helperPath,
	isExpectedEvent,
	label,
	onEvent,
	onStartFailure,
	onUnexpectedExit,
	onSessionStarted,
	startupTimeoutMessage,
}) =>
	await new Promise((resolvePromise, rejectPromise) => {
		const child = spawn(helperPath, [], {
			stdio: ["ignore", "pipe", "pipe"],
		});
		const lineReader = createInterface({
			input: child.stdout,
			crlfDelay: Infinity,
		});
		let didResolve = false;
		let session;
		const failStart = (error) => {
			if (didResolve) {
				logError({
					error: error,
					message: `[meeting-detection] ${label} failed after start`,
				});
				return;
			}

			didResolve = true;
			onStartFailure?.(session);
			rejectPromise(error);
		};
		const startupTimeout = setTimeout(() => {
			failStart(new Error(startupTimeoutMessage));
			child.kill("SIGKILL");
		}, 5_000);
		session = {
			cleanupTimeout: startupTimeout,
			isStopping: false,
			lineReader,
			process: child,
		};
		onSessionStarted?.(session);

		const resolveReady = () => {
			clearTimeout(startupTimeout);
			session.cleanupTimeout = null;
			if (!didResolve) {
				didResolve = true;
				resolvePromise(session);
			}
		};

		child.stderr.setEncoding("utf8");
		child.stderr.on("data", (chunk) => {
			const message = String(chunk).trim();
			if (message) {
				logError({
					error: message,
					message: `[${label}]`,
				});
			}
		});

		lineReader.on("line", (line) => {
			let event;

			try {
				event = JSON.parse(line);
			} catch (error) {
				logError({
					error: error,
					message: `[meeting-detection] failed to parse ${label} event`,
					details: line,
				});
				return;
			}

			if (!isExpectedEvent(event)) {
				return;
			}

			void Promise.resolve(
				onEvent({ event, failStart, resolveReady, session }),
			).catch((error) => {
				logError({
					error: error,
					message: `[meeting-detection] failed to handle ${label} event`,
				});
				if (event?.type === "ready" && !didResolve) {
					failStart(error);
				}
			});
		});

		child.on("error", (error) => {
			clearTimeout(startupTimeout);
			failStart(error);
		});

		child.on("exit", (code, signal) => {
			clearTimeout(startupTimeout);

			if (!session.isStopping) {
				onUnexpectedExit?.({ code, session, signal });
			}

			if (!didResolve && !session.isStopping) {
				failStart(
					new Error(
						`${label} exited before it became ready (code ${code ?? "null"}, signal ${signal ?? "null"}).`,
					),
				);
			}
		});
	});
