export const apiClient = {
  get: jest.fn(),
  post: jest.fn(),
  put: jest.fn(),
  delete: jest.fn(),
  storeTokens: jest.fn(),
  clearTokens: jest.fn(),
  signOut: jest.fn(),
  refreshToken: jest.fn(),
  getStoredTokens: jest.fn(),
  clearStoredTokens: jest.fn(),
};

export default apiClient;