import * as React from "react";
import { logError } from "@/lib/logger";

type ComponentEntryBoundaryProps = {
	children: React.ReactNode;
};

type ComponentEntryBoundaryState = {
	error: Error | null;
};

export class ComponentEntryBoundary extends React.Component<
	ComponentEntryBoundaryProps,
	ComponentEntryBoundaryState
> {
	state: ComponentEntryBoundaryState = {
		error: null,
	};

	static getDerivedStateFromError(error: Error): ComponentEntryBoundaryState {
		return { error };
	}

	componentDidCatch(error: Error) {
		logError({
			event: "client.error",
			error: error,
			message: "Failed to load component entry",
		});
	}

	render() {
		if (this.state.error) {
			return null;
		}

		return this.props.children;
	}
}
