module.exports = {
  AuthenticationType: {
    FINGERPRINT: 1,
    FACIAL_RECOGNITION: 2,
    IRIS: 3,
    OPTICAL: 4,
  },
  SecurityLevel: {
    NONE: 0,
    BIOMETRIC_WEAK: 1,
    BIOMETRIC_STRONG: 2,
  },
  hasHardwareAsync: jest.fn(() => Promise.resolve(true)),
  isEnrolledAsync: jest.fn(() => Promise.resolve(true)),
  supportedAuthenticationTypesAsync: jest.fn(() => Promise.resolve([1])), // FINGERPRINT
  authenticateAsync: jest.fn(() => Promise.resolve({ success: true })),
  getEnrolledLevelAsync: jest.fn(() => Promise.resolve(2)), // BIOMETRIC_STRONG
};