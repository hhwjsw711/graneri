export const rendererMeetingWidgetPathname = "/desktop/meeting-widget";

export const rendererRoutePrefixes = [
	"/automations",
	"/chat",
	rendererMeetingWidgetPathname,
	"/home",
	"/inbox",
	"/note",
	"/settings",
	"/shared",
];

export const isRendererAppRoutePath = (pathname) =>
	pathname === "/" ||
	rendererRoutePrefixes.some(
		(prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
	);
