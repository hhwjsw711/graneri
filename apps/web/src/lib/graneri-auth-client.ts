export type AuthSession = {
	session: Record<string, unknown> & {
		id?: string | null;
		token?: string | null;
	};
	user: Record<string, unknown> & {
		email?: string | null;
		id?: string | null;
		image?: string | null;
		name?: string | null;
	};
};

export type AuthClientError = {
	message: string;
	status: number;
	statusText: string;
};

export type AuthClientResponse<TData> = Promise<{
	data: TData | null;
	error: AuthClientError | null;
}>;

export type JsonWebKeySet = {
	keys: JsonWebKey[];
};

export type GraneriAuthClient = {
	$fetch: <TResult = unknown>(
		path: string,
		options?: {
			body?: unknown;
			headers?: HeadersInit;
			method?: string;
			throw?: boolean;
		},
	) => Promise<TResult>;
	convex: {
		token: (options?: {
			fetchOptions?: {
				headers?: HeadersInit;
				throw?: boolean;
			};
		}) => AuthClientResponse<{ token: string }>;
		jwks: (options?: {
			fetchOptions?: {
				headers?: HeadersInit;
				throw?: boolean;
			};
		}) => AuthClientResponse<JsonWebKeySet>;
	};
	crossDomain: {
		oneTimeToken: {
			verify: (args: { token: string }) => AuthClientResponse<AuthSession>;
		};
	};
	getSession: (options?: {
		fetchOptions?: {
			headers?: HeadersInit;
		};
	}) => AuthClientResponse<AuthSession>;
	signIn: {
		social: (args: {
			callbackURL?: string;
			disableRedirect?: boolean;
			errorCallbackURL?: string;
			provider: "github" | "google";
			scopes?: string[];
		}) => AuthClientResponse<unknown>;
	};
	signOut: () => AuthClientResponse<{ success: boolean }>;
	updateSession: () => void;
	updateUser: (body: { name?: string }) => AuthClientResponse<unknown>;
	useSession: () => {
		data: AuthSession | null;
		error: Error | null;
		isPending: boolean;
		isRefetching: boolean;
		refetch: () => void;
	};
};
