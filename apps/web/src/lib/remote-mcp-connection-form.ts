export type RemoteMcpEnvVar = {
	id: string;
	key: string;
	value: string;
};

export type RemoteMcpConnectionFormState = {
	name: string;
	baseUrl: string;
	envVars: RemoteMcpEnvVar[];
};

export type RemoteMcpOAuthFields = {
	oauthClientId: string;
	oauthClientSecret: string;
};

export type RemoteMcpConnectArgs<TWorkspaceId extends string> = {
	workspaceId: TWorkspaceId;
	displayName: string;
	baseUrl: string;
	env: Record<string, string>;
	oauthClientId?: string;
	oauthClientSecret?: string;
};

export const isRemoteMcpConnectionFormValid = (
	formState: RemoteMcpConnectionFormState,
) => formState.name.trim().length > 0 && formState.baseUrl.trim().length > 0;

const getNonEmptyRemoteMcpEnvRecord = (
	envVars: RemoteMcpEnvVar[],
	options: { requireValue: boolean },
) => {
	const entries: Array<[string, string]> = [];
	for (const envVar of envVars) {
		const key = envVar.key.trim();
		const value = envVar.value;
		if (key.length === 0 || (options.requireValue && value.length === 0)) {
			continue;
		}
		entries.push([key, value]);
	}
	return Object.fromEntries(entries);
};

export const buildRemoteMcpConnectArgs = <TWorkspaceId extends string>({
	formState,
	requireEnvValue,
	workspaceId,
}: {
	formState: RemoteMcpConnectionFormState & Partial<RemoteMcpOAuthFields>;
	requireEnvValue: boolean;
	workspaceId: TWorkspaceId;
}): RemoteMcpConnectArgs<TWorkspaceId> => ({
	workspaceId,
	displayName: formState.name.trim(),
	baseUrl: formState.baseUrl.trim(),
	env: getNonEmptyRemoteMcpEnvRecord(formState.envVars, {
		requireValue: requireEnvValue,
	}),
	...(formState.oauthClientId?.trim()
		? { oauthClientId: formState.oauthClientId.trim() }
		: {}),
	...(formState.oauthClientSecret?.trim()
		? { oauthClientSecret: formState.oauthClientSecret.trim() }
		: {}),
});
