import { type SVGProps, useId } from "react";

type GraneriMarkProps = SVGProps<SVGSVGElement> & {
	shimmer?: boolean;
};

export function GraneriMark({
	className,
	shimmer = false,
	...props
}: GraneriMarkProps) {
	const shimmerId = useId().replaceAll(":", "");
	const shimmerGradientId = `${shimmerId}-graneri-mark-shimmer`;
	const shimmerMaskId = `${shimmerId}-graneri-mark-shimmer-mask`;
	const markPath =
		"M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3";

	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			className={className}
			aria-hidden="true"
			{...props}
		>
			{shimmer ? (
				<defs>
					<linearGradient id={shimmerGradientId} x1="0" x2="1" y1="0" y2="0">
						<stop offset="0%" stopColor="white" stopOpacity="0" />
						<stop offset="28%" stopColor="white" stopOpacity="0" />
						<stop offset="42%" stopColor="white" stopOpacity="0.72" />
						<stop offset="50%" stopColor="white" stopOpacity="1" />
						<stop offset="58%" stopColor="white" stopOpacity="0.72" />
						<stop offset="72%" stopColor="white" stopOpacity="0" />
						<stop offset="100%" stopColor="white" stopOpacity="0" />
					</linearGradient>
					<mask id={shimmerMaskId}>
						<path
							d={markPath}
							stroke="white"
							strokeWidth="2"
							strokeLinecap="round"
							strokeLinejoin="round"
						/>
					</mask>
				</defs>
			) : null}
			<path
				d={markPath}
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
				opacity={shimmer ? 0.28 : undefined}
			/>
			{shimmer ? (
				<g mask={`url(#${shimmerMaskId})`}>
					<rect
						x="24"
						y="0"
						width="36"
						height="24"
						fill={`url(#${shimmerGradientId})`}
					>
						<animate
							attributeName="x"
							from="-36"
							to="24"
							dur="2s"
							repeatCount="indefinite"
						/>
					</rect>
				</g>
			) : null}
		</svg>
	);
}
