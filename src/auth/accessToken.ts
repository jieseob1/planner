export type AccessTokenProvider = () => Promise<string | null>;

let provider: AccessTokenProvider = async () => null;

export const setAccessTokenProvider = (next: AccessTokenProvider) => {
  provider = next;
};

export const getAccessToken = () => provider();
