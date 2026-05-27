import type { Editor, Range } from "@tiptap/core";
import Mention from "@tiptap/extension-mention";
import type { DOMOutputSpec } from "@tiptap/pm/model";
import {
	type ChatAppSourceProvider,
	isChatAppSourceProvider,
} from "@/lib/chat-source-display";

export const TypedMention = Mention.extend({
	addAttributes() {
		return {
			...this.parent?.(),
			type: {
				default: null,
				parseHTML: (element) => element.getAttribute("data-mention-type"),
				renderHTML: (attributes) =>
					attributes.type
						? { "data-mention-type": String(attributes.type) }
						: {},
			},
			provider: {
				default: null,
				parseHTML: (element) => element.getAttribute("data-mention-provider"),
				renderHTML: (attributes) =>
					attributes.provider
						? { "data-mention-provider": String(attributes.provider) }
						: {},
			},
		};
	},
});

export type MentionPickerPosition = {
	top: number;
	left: number;
};

export const INLINE_MENTION_CLASS =
	"inline cursor-pointer align-baseline whitespace-nowrap text-inherit";

const INLINE_MENTION_LABEL_CLASS =
	"cursor-pointer font-medium text-blue-400 decoration-blue-300/80 decoration-dotted underline-offset-4 hover:underline";

export const getMentionProvider = (provider: unknown) =>
	isChatAppSourceProvider(provider) ? provider : null;

const INLINE_TOOL_ICON_DATA_URIS: Record<ChatAppSourceProvider, string> = {
	context7:
		"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' aria-hidden='true' viewBox='0 0 32 32' fill='none' stroke='none'%3E%3Crect width='32' height='32' rx='7' fill='%230F172A'/%3E%3Cpath d='M9 8.5h14v3H12v9h11v3H9v-15Z' fill='%23F8FAFC'/%3E%3Cpath d='M14 14h9v3h-9v-3Z' fill='%2338BDF8'/%3E%3C/svg%3E",
	figma:
		"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' aria-hidden='true' viewBox='0 0 32 32' fill='none' stroke='none'%3E%3Crect width='32' height='32' rx='7' fill='%23181818'/%3E%3Ccircle cx='13' cy='10' r='4' fill='%23F24E1E'/%3E%3Ccircle cx='19' cy='10' r='4' fill='%23FF7262'/%3E%3Ccircle cx='13' cy='16' r='4' fill='%23A259FF'/%3E%3Ccircle cx='19' cy='16' r='4' fill='%231ABCFE'/%3E%3Ccircle cx='13' cy='22' r='4' fill='%230ACF83'/%3E%3C/svg%3E",
	linear:
		"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' aria-hidden='true' viewBox='0 0 32 32' fill='none' stroke='none'%3E%3Crect width='32' height='32' rx='7' fill='%235E6AD2'/%3E%3Cpath d='M7 19.8 19.8 7H25L12.2 19.8H7Zm0 5.2L25 7v5.2L12.2 25H7Zm8.2 0L25 15.2V20l-5 5h-4.8Z' fill='white'/%3E%3C/svg%3E",
	"google-calendar":
		"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' aria-hidden='true' viewBox='0 0 48 48' fill='none' stroke='none'%3E%3Crect width='22' height='22' x='13' y='13' fill='%23fff'/%3E%3Cpolygon fill='%231e88e5' points='25.68,20.92 26.69,22.36 28.27,21.21 28.27,29.56 30,29.56 30,18.62 28.56,18.62'/%3E%3Cpath fill='%231e88e5' d='M22.94,23.75c0.63-0.57,1.01-1.37,1.01-2.25c0-1.75-1.53-3.17-3.42-3.17 c-1.6,0-2.97,1.01-3.33,2.45l1.66,0.42c0.17-0.66,0.87-1.15,1.67-1.15c0.94,0,1.71,0.65,1.71,1.44 c0,0.79-0.77,1.44-1.71,1.44h-1v1.73h1c1.08,0,1.99,0.75,1.99,1.64c0,0.9-0.87,1.64-1.93,1.64 c-0.96,0-1.78-0.61-1.91-1.42L17,26.8c0.26,1.64,1.81,2.87,3.6,2.87c2.01,0,3.64-1.51,3.64-3.37 C24.24,25.28,23.74,24.36,22.94,23.75z'/%3E%3Cpolygon fill='%23fbc02d' points='34,42 14,42 13,38 14,34 34,34 35,38'/%3E%3Cpolygon fill='%234caf50' points='38,35 42,34 42,14 38,13 34,14 34,34'/%3E%3Cpath fill='%231e88e5' d='M34,14l1-4l-1-4H9C7.34,6,6,7.34,6,9v25l4,1l4-1V14H34z'/%3E%3Cpolygon fill='%23e53935' points='34,34 34,42 42,34'/%3E%3Cpath fill='%231565c0' d='M39,6h-5v8h8V9C42,7.34,40.66,6,39,6z'/%3E%3Cpath fill='%231565c0' d='M9,42h5v-8H6v5C6,40.66,7.34,42,9,42z'/%3E%3C/svg%3E",
	"google-drive":
		"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' aria-hidden='true' viewBox='0 0 48 48' fill='none' stroke='none'%3E%3Cpath fill='%231e88e5' d='M38.59,39c-0.54,0.93-0.3,1.68-1.2,2.2C36.5,41.72,35.47,42,34.39,42H13.61 c-1.07,0-2.11-0.28-3-0.8C9.71,40.68,9.95,39.93,9.41,39l7.67-9h13.84L38.59,39z'/%3E%3Cpath fill='%23fbc02d' d='M27.46,7c1.07-0,2.1-0.72,3-0.2c0.9,0.52,1.66,1.27,2.2,2.2l10.39,18 c0.54,0.93,0.81,1.97,0.81,3c0,1.04-1.27,2.07-1.81,3l-11.13-3l-6.92-11.99L27.46,7z'/%3E%3Cpath fill='%23e53935' d='M43.86,30c0,1.04-0.27,2.07-0.81,3l-3.67,6.35c-0.53,0.78-1.21,1.4-1.99,1.85L30.92,30H43.86z'/%3E%3Cpath fill='%234caf50' d='M5.95,33c-0.54-0.93-1.81-1.96-1.81-3c0-1.04,0.27-2.07,0.81-3l10.39-18 c0.54-0.93,1.3-1.68,2.2-2.2c0.9-0.52,1.93,0.2,3,0.2l3.46,11.01l-6.92,11.99L5.95,33z'/%3E%3Cpath fill='%231565c0' d='M17.08,30l-6.47,11.2c-0.78-0.45-1.46-1.07-1.99-1.85L4.95,33c-0.54-0.93-0.81-1.96-0.81-3H17.08z'/%3E%3Cpath fill='%232e7d32' d='M30.46,6.8L24,18L17.53,6.8c0.78-0.45,1.66-0.73,2.6-0.79L27.46,6C28.54,6,29.57,6.28,30.46,6.8z'/%3E%3C/svg%3E",
	jira: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' aria-hidden='true' viewBox='0 -30.63 255.32 285.96'%3E%3Crect x='0' y='-30.63' width='255.32' height='285.96' rx='58' fill='%231868DB'/%3E%3Cg transform='translate(32 17) scale(0.75)'%3E%3Cpath fill='%23DEEBFF' d='M244.66 0H121.71a55.5 55.5 0 0 0 55.5 55.5h22.65V77.37c.02 30.63 24.84 55.45 55.47 55.47V10.67C255.32 4.78 250.55 0 244.66 0z'/%3E%3Cpath fill='%23DEEBFF' d='M183.82 61.26H60.87c.019 30.63 24.84 55.45 55.47 55.47h22.65v21.94c.039 30.63 24.88 55.43 55.5 55.43V71.93c0-5.89-4.78-10.67-10.67-10.67z'/%3E%3Cpath fill='%23DEEBFF' d='M122.95 122.49H0c0 30.65 24.85 55.5 55.5 55.5h22.72v21.87c.02 30.6 24.8 55.41 55.4 55.47V133.16c0-5.89-4.78-10.67-10.67-10.67z'/%3E%3C/g%3E%3C/svg%3E",
	"jira-mcp":
		"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' aria-hidden='true' viewBox='0 -30.63 255.32 285.96'%3E%3Crect x='0' y='-30.63' width='255.32' height='285.96' rx='58' fill='%231868DB'/%3E%3Cg transform='translate(32 17) scale(0.75)'%3E%3Cpath fill='%23DEEBFF' d='M244.66 0H121.71a55.5 55.5 0 0 0 55.5 55.5h22.65V77.37c.02 30.63 24.84 55.45 55.47 55.47V10.67C255.32 4.78 250.55 0 244.66 0z'/%3E%3Cpath fill='%23DEEBFF' d='M183.82 61.26H60.87c.019 30.63 24.84 55.45 55.47 55.47h22.65v21.94c.039 30.63 24.88 55.43 55.5 55.43V71.93c0-5.89-4.78-10.67-10.67-10.67z'/%3E%3Cpath fill='%23DEEBFF' d='M122.95 122.49H0c0 30.65 24.85 55.5 55.5 55.5h22.72v21.87c.02 30.6 24.8 55.41 55.4 55.47V133.16c0-5.89-4.78-10.67-10.67-10.67z'/%3E%3C/g%3E%3C/svg%3E",
	notion:
		"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' aria-hidden='true' viewBox='0 0 48 48' fill='none' stroke='none'%3E%3Cpath fill='%23fff' fill-rule='evenodd' clip-rule='evenodd' d='M11.55,11.1c1.23,1,1.69,0.93,4.01,0.77 l21.81-1.31c0.46,0,0.08-0.46-0.08-0.54l-3.62-2.62c-0.69-0.54-1.62-1.16-3.39-1l-21.12,1.54 c-0.77,0.08-0.92,0.46-0.62,0.77L11.55,11.1z'/%3E%3Cpath fill='%23fff' fill-rule='evenodd' clip-rule='evenodd' d='M12.86,16.18v22.95c0,1.23,0.62,1.7,2,1.62 l23.97-1.39c1.39-0.08,1.54-0.93,1.54-1.93V14.64c0-1-0.39-1.54-1.23-1.46l-25.05,1.46 C13.17,14.72,12.86,15.18,12.86,16.18L12.86,16.18z'/%3E%3Cpath fill='%23424242' fill-rule='evenodd' clip-rule='evenodd' d='M11.55,11.1c1.23,1,1.69,0.93,4.01,0.77 l21.81-1.31c0.46,0,0.08-0.46-0.08-0.54l-3.62-2.62c-0.69-0.54-1.62-1.16-3.39-1l-21.12,1.54 c-0.77,0.08-0.92,0.46-0.62,0.77L11.55,11.1z M12.86,16.18v22.95c0,1.23,0.62,1.7,2,1.62l23.97-1.39 c1.39-0.08,1.54-0.93,1.54-1.93V14.64c0-1-0.39-1.54-1.23-1.46l-25.05,1.46C13.17,14.72,12.86,15.18,12.86,16.18 L12.86,16.18z M36.53,17.41c0.15,0.69,0,1.39-0.69,1.47l-1.16,0.23v16.94c-1,0.54-1.93,0.85-2.7,0.85 c-1.23,0-1.54-0.39-2.47-1.54l-7.55-11.86v11.47l2.39,0.54c0,0,0,1.39-1.93,1.39l-5.32,0.31 c-0.15-0.31,0-1.08,0.54-1.23l1.39-0.39V20.42l-1.93-0.15c-0.15-0.69,0.23-1.69,1.31-1.77l5.7-0.39l7.86,12.02 V19.49l-2-0.23c-0.15-0.85,0.46-1.46,1.23-1.54L36.53,17.41z M7.39,5.86l21.97-1.62 c2.7-0.23,3.39-0.08,5.09,1.16l7.01,4.93C42.61,11.18,43,11.41,43,12.33v27.03c0,1.69-0.62,2.7-2.77,2.85 l-25.51,1.54c-1.62,0.08-2.39-0.15-3.24-1.23l-5.16-6.7C5.38,34.59,5,33.66,5,32.59V8.56 C5,7.17,5.62,6.01,7.39,5.86z'/%3E%3C/svg%3E",
	posthog:
		"data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20aria-hidden='true'%20viewBox='0%200%20236%20142'%20fill='none'%20stroke='none'%3E%3Cpath%20d='M51.27%2080.99C49.53%2084.46%2044.58%2084.46%2042.85%2080.99L38.7%2072.69C38.03%2071.37%2038.03%2069.81%2038.7%2068.48L42.85%2060.18C44.58%2056.71%2049.53%2056.71%2051.27%2060.18L55.41%2068.48C56.08%2069.81%2056.08%2071.37%2055.41%2072.69L51.27%2080.99Z'%20fill='%231D4AFF'/%3E%3Cpath%20d='M51.27%20128.04C49.53%20131.51%2044.58%20131.51%2042.85%20128.04L38.7%20119.75C38.03%20118.42%2038.03%20116.86%2038.7%20115.54L42.85%20107.24C44.58%20103.77%2049.53%20103.77%2051.27%20107.24L55.41%20115.54C56.08%20116.86%2056.08%20118.42%2055.41%20119.75L51.27%20128.04Z'%20fill='%231D4AFF'/%3E%3Cpath%20d='M0%20110.18C0%20105.99%205.07%20103.89%208.04%20106.85L29.61%20128.43C32.57%20131.39%2030.47%20136.46%2026.28%20136.46H4.71C2.11%20136.46%200%20134.36%200%20131.76V110.18ZM0%2087.46C0%2088.71%200.5%2089.9%201.38%2090.79L45.68%20135.09C46.56%20135.97%2047.76%20136.46%2049.01%20136.46H73.34C77.53%20136.46%2079.63%20131.39%2076.67%20128.43L8.04%2059.8C5.07%2056.83%200%2058.93%200%2063.13V87.46ZM0%2040.4C0%2041.65%200.5%2042.85%201.38%2043.73L92.73%20135.09C93.62%20135.97%2094.81%20136.46%2096.06%20136.46H120.39C124.59%20136.46%20126.69%20131.39%20123.72%20128.43L8.04%2012.74C5.07%209.78%200%2011.88%200%2016.07V40.4ZM47.06%2040.4C47.06%2041.65%2047.55%2042.85%2048.43%2043.73L133.13%20128.43C136.1%20131.39%20141.17%20129.29%20141.17%20125.1V100.77C141.17%2099.52%20140.67%2098.32%20139.79%2097.44L55.09%2012.74C52.13%209.78%2047.06%2011.88%2047.06%2016.07V40.4ZM102.15%2012.74C99.18%209.78%2094.11%2011.88%2094.11%2016.07V40.4C94.11%2041.65%2094.61%2042.85%2095.49%2043.73L133.13%2081.37C136.1%2084.34%20141.17%2082.24%20141.17%2078.04V53.71C141.17%2052.46%20140.67%2051.27%20139.79%2050.38L102.15%2012.74Z'%20fill='%23F9BD2B'/%3E%3Cpath%20d='M200.16%20110.76L155.86%2066.45C152.89%2063.49%20147.82%2065.59%20147.82%2069.78V131.76C147.82%20134.36%20149.93%20136.46%20152.53%20136.46H221.16C223.76%20136.46%20225.87%20134.36%20225.87%20131.76V126.11C225.87%20123.51%20223.75%20121.44%20221.17%20121.1C213.26%20120.07%20205.86%20116.46%20200.16%20110.76ZM170.41%20121.41C166.25%20121.41%20162.88%20118.03%20162.88%20113.88C162.88%20109.72%20166.25%20106.35%20170.41%20106.35C174.57%20106.35%20177.94%20109.72%20177.94%20113.88C177.94%20118.03%20174.57%20121.41%20170.41%20121.41Z'%20fill='%23000'/%3E%3Cpath%20d='M0%20131.76C0%20134.36%202.11%20136.46%204.71%20136.46H26.28C30.47%20136.46%2032.57%20131.39%2029.61%20128.43L8.04%20106.85C5.07%20103.89%200%20105.99%200%20110.18V131.76Z'%20fill='%231D4AFF'/%3E%3Cpath%20d='M47.06%2051.76L8.04%2012.74C5.07%209.78%200%2011.88%200%2016.07V40.4C0%2041.65%200.5%2042.85%201.38%2043.73L47.06%2089.41V51.76Z'%20fill='%231D4AFF'/%3E%3Cpath%20d='M8.04%2059.8C5.07%2056.83%200%2058.93%200%2063.13V87.46C0%2088.71%200.5%2089.9%201.38%2090.79L47.06%20136.46V98.82L8.04%2059.8Z'%20fill='%231D4AFF'/%3E%3Cpath%20d='M94.11%2053.71C94.11%2052.46%2093.62%2051.27%2092.73%2050.38L55.09%2012.74C52.13%209.78%2047.06%2011.88%2047.06%2016.07V40.4C47.06%2041.65%2047.55%2042.85%2048.43%2043.73L94.11%2089.41V53.71Z'%20fill='%23F54E00'/%3E%3Cpath%20d='M47.06%20136.46H73.34C77.53%20136.46%2079.63%20131.39%2076.67%20128.43L47.06%2098.82V136.46Z'%20fill='%23F54E00'/%3E%3Cpath%20d='M47.06%2051.76V87.46C47.06%2088.71%2047.55%2089.9%2048.43%2090.79L94.11%20136.46V100.77C94.11%2099.52%2093.62%2098.32%2092.73%2097.44L47.06%2051.76Z'%20fill='%23F54E00'/%3E%3C/svg%3E",
	zoom: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' aria-hidden='true' viewBox='0 0 32 32' fill='none' stroke='none'%3E%3Cpath d='M2 11.6C2 8.23969 2 6.55953 2.65396 5.27606C3.2292 4.14708 4.14708 3.2292 5.27606 2.65396C6.55953 2 8.23969 2 11.6 2H20.4C23.7603 2 25.4405 2 26.7239 2.65396C27.8529 3.2292 28.7708 4.14708 29.346 5.27606C30 6.55953 30 8.23969 30 11.6V20.4C30 23.7603 30 25.4405 29.346 26.7239C28.7708 27.8529 27.8529 28.7708 26.7239 29.346C25.4405 30 23.7603 30 20.4 30H11.6C8.23969 30 6.55953 30 5.27606 29.346C4.14708 28.7708 3.2292 27.8529 2.65396 26.7239C2 25.4405 2 23.7603 2 20.4V11.6Z' fill='%234087FC'/%3E%3Cpath d='M8.26667 10C7.56711 10 7 10.6396 7 11.4286V18.3571C7 20.369 8.44612 22 10.23 22L17.7333 21.9286C18.4329 21.9286 19 21.289 19 20.5V13.5C19 11.4881 17.2839 10 15.5 10L8.26667 10Z' fill='white'/%3E%3Cpath d='M20.7122 12.7276C20.2596 13.1752 20 13.8211 20 14.5V17.3993C20 18.0782 20.2596 18.7242 20.7122 19.1717L23.5288 21.6525C24.1019 22.2191 25 21.7601 25 20.9005V11.1352C25 10.2755 24.1019 9.81654 23.5288 10.3832L20.7122 12.7276Z' fill='white'/%3E%3C/svg%3E",
	"yandex-calendar":
		"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' aria-hidden='true' viewBox='0 0 64 64' fill='none' stroke='none'%3E%3Ccircle cx='32' cy='32' r='28' fill='%23ff4743'/%3E%3Cpath fill='%23fff' d='M24 15C22.34 15 21 16.34 21 18V19H19.5C17.57 19 16.17 20.85 16.73 22.7L18.97 30.11C19.18 30.8 19.18 31.53 18.97 32.21L16.73 39.63C16.17 41.48 17.57 43.32 19.5 43.32H21V44C21 45.66 22.34 47 24 47H40C41.66 47 43 45.66 43 44V43.32H44.5C46.43 43.32 47.83 41.48 47.27 39.63L45.03 32.21C44.82 31.53 44.82 30.8 45.03 30.11L47.27 22.7C47.83 20.85 46.43 19 44.5 19H43V18C43 16.34 41.66 15 40 15H24Z'/%3E%3Ctext x='32' y='36.5' fill='%23ff4743' font-family='ui-sans-serif, system-ui, sans-serif' font-size='18' font-weight='500' text-anchor='middle'%3E30%3C/text%3E%3C/svg%3E",
	"yandex-tracker":
		"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' aria-hidden='true' viewBox='0 0 16 16' fill='%233b82f6' stroke='none'%3E%3Cpath fill-rule='evenodd' clip-rule='evenodd' d='M2.75 2.5a.25.25 0 0 0-.25.25v2.17c0 .138.11.25.25.25h2.42V2.5zm3.92 0v2.67h2.67V2.5zm4.17 0v2.67h2.42a.25.25 0 0 0 .25-.25V2.75a.25.25 0 0 0-.25-.25zm0 4.17h2.42A1.75 1.75 0 0 0 15 4.92V2.75A1.75 1.75 0 0 0 13.25 1H2.75A1.75 1.75 0 0 0 1 2.75v2.17c0 .966.78 1.75 1.75 1.75h2.42v6.58c0 .966.78 1.75 1.75 1.75h2.17a1.75 1.75 0 0 0 1.75-1.75zm-1.5 0H6.67v2.67h2.67zm0 4.17H6.67v2.42c0 .138.11.25.25.25h2.17a.25.25 0 0 0 .25-.25z'/%3E%3C/svg%3E",
};

const getInlineToolMentionIconHTML = (provider: ChatAppSourceProvider) =>
	[
		"img",
		{
			"aria-hidden": "true",
			alt: "",
			class: "inline-tool-mention-svg",
			draggable: "false",
			src: INLINE_TOOL_ICON_DATA_URIS[provider],
		},
	] satisfies DOMOutputSpec;

export const renderInlineMentionHTML = ({
	id,
	label,
	provider,
	type,
}: {
	id: string;
	label: string;
	provider?: ChatAppSourceProvider;
	type?: "note" | "tool" | null;
}): DOMOutputSpec => {
	if (type === "tool") {
		if (!provider) {
			throw new Error("Tool mentions require a known app source provider.");
		}

		return [
			"span",
			{
				"data-type": "mention",
				"data-mention-type": "tool",
				"data-mention-id": id,
				...(provider ? { "data-mention-provider": provider } : {}),
				class: "inline-tool-mention",
			},
			[
				"span",
				{
					"aria-hidden": "true",
					class: "inline-tool-mention-icon",
					...(provider ? { "data-provider": provider } : {}),
				},
				getInlineToolMentionIconHTML(provider),
			],
			["span", { class: "inline-tool-mention-label" }, label],
		];
	}

	return [
		"span",
		{
			"data-type": "mention",
			class: INLINE_MENTION_CLASS,
		},
		[
			"span",
			{
				"aria-hidden": "true",
				class: "inline-note-mention-icon",
			},
		],
		[
			"span",
			{
				class: INLINE_MENTION_LABEL_CLASS,
			},
			label,
		],
	];
};

const MENTION_PICKER_MAX_HEIGHT = 288;
const MENTION_PICKER_VIEWPORT_MARGIN = 12;
const MENTION_PICKER_HEADER_HEIGHT = 28;
const MENTION_PICKER_ROW_HEIGHT = 32;
const MENTION_PICKER_VERTICAL_PADDING = 8;
const MENTION_PICKER_MIN_SECTIONED_HEIGHT = 168;
const MENTION_PICKER_WIDTH = 224;

const getMentionPickerEstimatedHeight = ({
	itemCount,
	minSectionedHeight = false,
}: {
	itemCount: number;
	minSectionedHeight?: boolean;
}) =>
	Math.min(
		MENTION_PICKER_MAX_HEIGHT,
		Math.max(
			minSectionedHeight && itemCount > 1
				? MENTION_PICKER_MIN_SECTIONED_HEIGHT
				: 0,
			MENTION_PICKER_VERTICAL_PADDING +
				MENTION_PICKER_HEADER_HEIGHT +
				Math.max(1, itemCount) * MENTION_PICKER_ROW_HEIGHT,
		),
	);

export const getMentionAnchorRect = (editor: Editor, range: Range) => {
	const triggerRect = editor.view.coordsAtPos(Math.max(0, range.from));
	const selection = editor.view.dom.ownerDocument.getSelection();
	const selectionRange =
		selection &&
		selection.rangeCount > 0 &&
		selection.anchorNode &&
		editor.view.dom.contains(selection.anchorNode)
			? selection.getRangeAt(0)
			: null;
	const selectionRect = selectionRange?.getBoundingClientRect();
	const caretRect =
		selectionRect && (selectionRect.width > 0 || selectionRect.height > 0)
			? selectionRect
			: editor.view.coordsAtPos(Math.max(0, range.to));

	return {
		bottom: caretRect.bottom,
		left: triggerRect.left,
		top: caretRect.top,
	};
};

export const getMentionPickerPosition = ({
	rect,
	itemCount,
	minSectionedHeight = false,
}: {
	rect: Pick<DOMRect, "bottom" | "left" | "top">;
	itemCount: number;
	minSectionedHeight?: boolean;
}): MentionPickerPosition => {
	const preferredTop = rect.bottom + 8;
	const estimatedHeight = getMentionPickerEstimatedHeight({
		itemCount,
		minSectionedHeight,
	});
	const hasRoomBelow =
		preferredTop + estimatedHeight <=
		window.innerHeight - MENTION_PICKER_VIEWPORT_MARGIN;
	const top = hasRoomBelow
		? preferredTop
		: Math.max(MENTION_PICKER_VIEWPORT_MARGIN, rect.top - estimatedHeight - 8);

	return {
		top,
		left: Math.min(
			Math.max(MENTION_PICKER_VIEWPORT_MARGIN, rect.left),
			window.innerWidth - MENTION_PICKER_WIDTH - MENTION_PICKER_VIEWPORT_MARGIN,
		),
	};
};
