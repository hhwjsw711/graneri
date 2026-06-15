export const getBearerTokenFromAuthorizationHeader = (authorization) => {
	const value = Array.isArray(authorization) ? authorization[0] : authorization;
	if (!value?.startsWith("Bearer ")) {
		return null;
	}

	return value.slice("Bearer ".length);
};
