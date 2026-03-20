export const apiClient = {
  get: jest.fn(() => Promise.resolve({})),
  post: jest.fn(() => Promise.resolve({})),
  put: jest.fn(() => Promise.resolve({})),
  delete: jest.fn(() => Promise.resolve({})),
  storeTokens: jest.fn(() => Promise.resolve()),
  clearTokens: jest.fn(() => Promise.resolve()),
  signOut: jest.fn(() => Promise.resolve()),
  refreshToken: jest.fn(() => Promise.resolve('')),
  getStoredTokens: jest.fn(() => Promise.resolve({
    accessToken: null,
    refreshToken: null,
    idToken: null,
  })),
  clearStoredTokens: jest.fn(() => Promise.resolve()),
};

export default apiClient;