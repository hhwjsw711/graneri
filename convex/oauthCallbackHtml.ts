const escapeHtml = (value: string) =>
	value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");

export const oauthCallbackHtmlResponse = (
	title: string,
	message: string,
	status = 200,
) => {
	const isSuccess = status >= 200 && status < 300;
	const safeTitle = escapeHtml(title);
	const safeMessage = escapeHtml(message);

	return new Response(
		`<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1" />
	<title>${safeTitle}</title>
	<style>
		:root {
			color-scheme: light dark;
			background: #fff;
			color: #0a0a0a;
			font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
		}
		* {
			box-sizing: border-box;
		}
		body {
			min-height: 100vh;
			margin: 0;
			background: #fff;
			color: #0a0a0a;
		}
		main {
			display: flex;
			flex-direction: column;
			align-items: center;
			justify-content: center;
			gap: 24px;
			min-height: 100vh;
			padding: 24px;
		}
		.shell {
			width: min(100%, 460px);
			display: flex;
			flex-direction: column;
			gap: 24px;
		}
		.brand {
			display: flex;
			align-items: center;
			justify-content: center;
			gap: 12px;
			color: #0a0a0a;
			font-size: 16px;
			font-weight: 600;
		}
		.mark-wrap {
			display: flex;
			width: 24px;
			height: 24px;
			align-items: center;
			justify-content: center;
			border: 1px solid #e5e5e5;
			border-radius: 6px;
			background: #fff;
			color: #0a0a0a;
		}
		.mark {
			width: 16px;
			height: 16px;
		}
		.card {
			border: 1px solid #e5e5e5;
			border-radius: 12px;
			background: #fff;
			box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
			overflow: hidden;
		}
		.header {
			padding: 24px 24px 12px;
			text-align: center;
		}
		h1 {
			margin: 0 0 8px;
			color: #0a0a0a;
			font-size: 20px;
			line-height: 1.4;
			font-weight: 600;
		}
		p {
			margin: 0;
			color: #737373;
			font-size: 14px;
			line-height: 1.45;
		}
		@media (min-width: 768px) {
			main {
				padding: 40px;
			}
		}
		@media (prefers-color-scheme: dark) {
			:root,
			body {
				background: #0a0a0a;
				color: #fafafa;
			}
			.brand {
				color: #fafafa;
			}
			.mark-wrap,
			.card {
				border-color: #27272a;
				background: #18181b;
				color: #fafafa;
			}
			h1 {
				color: #fafafa;
			}
			p {
				color: #a1a1aa;
			}
		}
	</style>
</head>
<body>
	<main>
		<div class="shell">
			<div class="brand">
				<span class="mark-wrap" aria-hidden="true">
					<svg class="mark" viewBox="0 0 24 24" fill="none">
						<path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
					</svg>
				</span>
				<span>OpenGran</span>
			</div>
			<section class="card" aria-labelledby="callback-title">
				<div class="header">
					<h1 id="callback-title">${safeTitle}</h1>
					<p>${safeMessage}</p>
				</div>
			</section>
		</div>
	</main>
	${isSuccess ? "<script>setTimeout(() => window.close(), 2500);</script>" : ""}
</body>
</html>`,
		{
			status,
			headers: { "Content-Type": "text/html; charset=utf-8" },
		},
	);
};
