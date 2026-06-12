export const rendererMeetingWidgetPathname = "/desktop/meeting-widget";

export const rendererRoutePrefixes = [
	"/automations",
	"/chat",
	rendererMeetingWidgetPathname,
	"/home",
	"/inbox",
	"/note",
	"/project",
	"/settings",
	"/shared",
];

export const isRendererAppRoutePath = (pathname) =>
	pathname === "/" ||
	rendererRoutePrefixes.some(
		(prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
	);
