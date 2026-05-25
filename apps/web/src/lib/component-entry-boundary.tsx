import * as React from "react";

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
		console.error("Failed to load component entry", error);
	}

	render() {
		if (this.state.error) {
			return null;
		}

		return this.props.children;
	}
}
