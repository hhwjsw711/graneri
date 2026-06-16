const GRANERI_MARK_SVG = `
<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
	<path
		d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3"
		stroke="currentColor"
		stroke-width="2"
		stroke-linecap="round"
		stroke-linejoin="round"
	/>
</svg>`;

export const createAuthCallbackSuccessHtml = () => `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>Graneri</title>
		<style>
			* {
				box-sizing: border-box;
			}

			body {
				margin: 0;
				min-height: 100vh;
				display: grid;
				place-items: center;
				background: #0a0a0a;
				color: #fafafa;
				font-family: ui-sans-serif, system-ui, sans-serif;
			}

			.shell {
				width: min(calc(100vw - 48px), 24rem);
				text-align: center;
				padding: 24px;
			}

			.mark {
				width: 24px;
				height: 24px;
				margin: 0 auto 16px;
				display: flex;
				align-items: center;
				justify-content: center;
				border: 1px solid rgba(255, 255, 255, 0.1);
				border-radius: 6px;
				background: #18181b;
				color: #fafafa;
			}

			.mark svg {
				width: 16px;
				height: 16px;
				display: block;
			}

			h1 {
				margin: 0 0 8px;
				font-size: 20px;
				line-height: 1.75rem;
				font-weight: 600;
			}

			p {
				margin: 0;
				font-size: 14px;
				line-height: 1.25rem;
				color: #a1a1aa;
			}

			p + p {
				margin-top: 8px;
			}
		</style>
	</head>
	<body>
		<main class="shell">
			<div class="mark">${GRANERI_MARK_SVG}</div>
			<h1>Authentication complete</h1>
			<p>Return to Graneri to continue. You can close this window if it stays open.</p>
		</main>
	</body>
</html>`;
