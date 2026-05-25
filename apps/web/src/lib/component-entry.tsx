import * as React from "react";

type ComponentModuleLoader<Module> = () => Promise<Module>;
type ComponentEntryBoundaryProps = {
	children: React.ReactNode;
};
type ComponentEntryBoundaryState = {
	error: Error | null;
};

class ComponentEntryBoundary extends React.Component<
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

export function getOnlyComponentModule<Module>(
	modules: Record<string, ComponentModuleLoader<Module>>,
) {
	const loaders = Object.values(modules);
	const [loadModule] = loaders;

	if (loaders.length !== 1 || !loadModule) {
		throw new Error("Expected exactly one component module.");
	}

	return loadModule;
}

export function createComponentEntry<Props extends object, Module>(
	loadModule: ComponentModuleLoader<Module>,
	selectComponent: (module: Module) => React.ComponentType<Props>,
) {
	const Component = React.lazy(async () => {
		const module = await loadModule();

		return {
			default: selectComponent(module),
		};
	});

	return function ComponentEntry(props: Props) {
		return (
			<ComponentEntryBoundary>
				<React.Suspense>
					<Component {...props} />
				</React.Suspense>
			</ComponentEntryBoundary>
		);
	};
}

export function createOpenComponentEntry<
	Props extends {
		open: boolean;
	},
	Module,
>(
	loadModule: ComponentModuleLoader<Module>,
	selectComponent: (module: Module) => React.ComponentType<Props>,
) {
	const ComponentEntry = createComponentEntry(loadModule, selectComponent);

	return function OpenComponentEntry(props: Props) {
		if (!props.open) {
			return null;
		}

		return <ComponentEntry {...props} />;
	};
}
