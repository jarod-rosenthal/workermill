import * as LocalAuthentication from 'expo-local-authentication';
import { BiometricAuth, checkBiometricAvailability, authenticateWithBiometric, getBiometricTypeName, shouldOfferBiometric } from '../biometric';

// Mock expo-local-authentication
jest.mock('expo-local-authentication');

const mockedLocalAuth = LocalAuthentication as jest.Mocked<typeof LocalAuthentication>;

describe('BiometricAuth', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('checkAvailability', () => {
    it('should return availability info when biometric is fully available', async () => {
      mockedLocalAuth.hasHardwareAsync.mockResolvedValue(true);
      mockedLocalAuth.isEnrolledAsync.mockResolvedValue(true);
      mockedLocalAuth.supportedAuthenticationTypesAsync.mockResolvedValue([
        LocalAuthentication.AuthenticationType.FINGERPRINT,
        LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION,
      ]);

      const result = await BiometricAuth.checkAvailability();

      expect(result).toEqual({
        isAvailable: true,
        supportedTypes: [
          LocalAuthentication.AuthenticationType.FINGERPRINT,
          LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION,
        ],
        hasHardware: true,
        isEnrolled: true,
      });
    });

    it('should return not available when no hardware exists', async () => {
      mockedLocalAuth.hasHardwareAsync.mockResolvedValue(false);
      mockedLocalAuth.isEnrolledAsync.mockResolvedValue(false);
      mockedLocalAuth.supportedAuthenticationTypesAsync.mockResolvedValue([]);

      const result = await BiometricAuth.checkAvailability();

      expect(result).toEqual({
        isAvailable: false,
        supportedTypes: [],
        hasHardware: false,
        isEnrolled: false,
      });
    });

    it('should return not available when hardware exists but not enrolled', async () => {
      mockedLocalAuth.hasHardwareAsync.mockResolvedValue(true);
      mockedLocalAuth.isEnrolledAsync.mockResolvedValue(false);
      mockedLocalAuth.supportedAuthenticationTypesAsync.mockResolvedValue([
        LocalAuthentication.AuthenticationType.FINGERPRINT,
      ]);

      const result = await BiometricAuth.checkAvailability();

      expect(result).toEqual({
        isAvailable: false,
        supportedTypes: [LocalAuthentication.AuthenticationType.FINGERPRINT],
        hasHardware: true,
        isEnrolled: false,
      });
    });

    it('should handle errors gracefully', async () => {
      mockedLocalAuth.hasHardwareAsync.mockRejectedValue(new Error('Hardware check failed'));

      const result = await BiometricAuth.checkAvailability();

      expect(result).toEqual({
        isAvailable: false,
        supportedTypes: [],
        hasHardware: false,
        isEnrolled: false,
      });
    });
  });

  describe('getBiometricTypeName', () => {
    it('should return Face ID for facial recognition', async () => {
      mockedLocalAuth.hasHardwareAsync.mockResolvedValue(true);
      mockedLocalAuth.isEnrolledAsync.mockResolvedValue(true);
      mockedLocalAuth.supportedAuthenticationTypesAsync.mockResolvedValue([
        LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION,
      ]);

      const result = await BiometricAuth.getBiometricTypeName();

      expect(result).toBe('Face ID');
    });

    it('should return Touch ID for fingerprint', async () => {
      mockedLocalAuth.hasHardwareAsync.mockResolvedValue(true);
      mockedLocalAuth.isEnrolledAsync.mockResolvedValue(true);
      mockedLocalAuth.supportedAuthenticationTypesAsync.mockResolvedValue([
        LocalAuthentication.AuthenticationType.FINGERPRINT,
      ]);

      const result = await BiometricAuth.getBiometricTypeName();

      expect(result).toBe('Touch ID');
    });

    it('should prioritize Face ID over Touch ID when both are available', async () => {
      mockedLocalAuth.hasHardwareAsync.mockResolvedValue(true);
      mockedLocalAuth.isEnrolledAsync.mockResolvedValue(true);
      mockedLocalAuth.supportedAuthenticationTypesAsync.mockResolvedValue([
        LocalAuthentication.AuthenticationType.FINGERPRINT,
        LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION,
      ]);

      const result = await BiometricAuth.getBiometricTypeName();

      expect(result).toBe('Face ID');
    });

    it('should return generic name when biometric is not available', async () => {
      mockedLocalAuth.hasHardwareAsync.mockResolvedValue(false);
      mockedLocalAuth.isEnrolledAsync.mockResolvedValue(false);
      mockedLocalAuth.supportedAuthenticationTypesAsync.mockResolvedValue([]);

      const result = await BiometricAuth.getBiometricTypeName();

      expect(result).toBe('Biometric authentication');
    });
  });

  describe('authenticate', () => {
    beforeEach(() => {
      // Setup default availability
      mockedLocalAuth.hasHardwareAsync.mockResolvedValue(true);
      mockedLocalAuth.isEnrolledAsync.mockResolvedValue(true);
      mockedLocalAuth.supportedAuthenticationTypesAsync.mockResolvedValue([
        LocalAuthentication.AuthenticationType.FINGERPRINT,
      ]);
    });

    it('should authenticate successfully', async () => {
      mockedLocalAuth.authenticateAsync.mockResolvedValue({
        success: true,
      });

      const result = await BiometricAuth.authenticate();

      expect(result).toEqual({
        success: true,
      });

      expect(mockedLocalAuth.authenticateAsync).toHaveBeenCalledWith({
        promptMessage: 'Use Touch ID to unlock WorkerMill',
        cancelLabel: 'Cancel',
        fallbackLabel: 'Use Passcode',
        requireConfirmation: false,
        disableDeviceFallback: false,
      });
    });

    it('should use custom prompt message when provided', async () => {
      mockedLocalAuth.authenticateAsync.mockResolvedValue({
        success: true,
      });

      await BiometricAuth.authenticate({
        promptMessage: 'Custom prompt message',
      });

      expect(mockedLocalAuth.authenticateAsync).toHaveBeenCalledWith({
        promptMessage: 'Custom prompt message',
        cancelLabel: 'Cancel',
        fallbackLabel: 'Use Passcode',
        requireConfirmation: false,
        disableDeviceFallback: false,
      });
    });

    it('should handle authentication failure', async () => {
      mockedLocalAuth.authenticateAsync.mockResolvedValue({
        success: false,
        error: 'authentication_failed',
      } as any);

      const result = await BiometricAuth.authenticate();

      expect(result).toEqual({
        success: false,
        error: 'Authentication failed',
        errorCode: 'AUTH_FAILED',
      });
    });

    it('should handle user cancellation', async () => {
      mockedLocalAuth.authenticateAsync.mockResolvedValue({
        success: false,
        error: 'user_cancel',
      } as any);

      const result = await BiometricAuth.authenticate();

      expect(result).toEqual({
        success: false,
        error: 'Authentication was cancelled',
        errorCode: 'USER_CANCEL',
      });
    });

    it('should handle user fallback to passcode', async () => {
      mockedLocalAuth.authenticateAsync.mockResolvedValue({
        success: false,
        error: 'user_fallback',
      } as any);

      const result = await BiometricAuth.authenticate();

      expect(result).toEqual({
        success: false,
        error: 'User chose to use device passcode',
        errorCode: 'USER_FALLBACK',
      });
    });

    it('should handle too many attempts', async () => {
      mockedLocalAuth.authenticateAsync.mockResolvedValue({
        success: false,
        error: 'too_many_attempts',
      } as any);

      const result = await BiometricAuth.authenticate();

      expect(result).toEqual({
        success: false,
        error: 'Too many failed attempts',
        errorCode: 'TOO_MANY_ATTEMPTS',
      });
    });

    it('should return not available when biometric is not available', async () => {
      mockedLocalAuth.hasHardwareAsync.mockResolvedValue(false);
      mockedLocalAuth.isEnrolledAsync.mockResolvedValue(false);
      mockedLocalAuth.supportedAuthenticationTypesAsync.mockResolvedValue([]);

      const result = await BiometricAuth.authenticate();

      expect(result).toEqual({
        success: false,
        error: 'Biometric authentication is not available',
        errorCode: 'NOT_AVAILABLE',
      });

      expect(mockedLocalAuth.authenticateAsync).not.toHaveBeenCalled();
    });

    it('should handle unexpected errors', async () => {
      mockedLocalAuth.authenticateAsync.mockRejectedValue(new Error('Unexpected error'));

      const result = await BiometricAuth.authenticate();

      expect(result).toEqual({
        success: false,
        error: 'An unexpected error occurred during authentication',
        errorCode: 'UNEXPECTED_ERROR',
      });
    });
  });

  describe('shouldOfferBiometric', () => {
    it('should return true when biometric is available', async () => {
      mockedLocalAuth.hasHardwareAsync.mockResolvedValue(true);
      mockedLocalAuth.isEnrolledAsync.mockResolvedValue(true);
      mockedLocalAuth.supportedAuthenticationTypesAsync.mockResolvedValue([
        LocalAuthentication.AuthenticationType.FINGERPRINT,
      ]);

      const result = await BiometricAuth.shouldOfferBiometric();

      expect(result).toBe(true);
    });

    it('should return false when biometric is not available', async () => {
      mockedLocalAuth.hasHardwareAsync.mockResolvedValue(false);
      mockedLocalAuth.isEnrolledAsync.mockResolvedValue(false);
      mockedLocalAuth.supportedAuthenticationTypesAsync.mockResolvedValue([]);

      const result = await BiometricAuth.shouldOfferBiometric();

      expect(result).toBe(false);
    });
  });

  describe('getSecurityLevel', () => {
    it('should return security level', async () => {
      mockedLocalAuth.getEnrolledLevelAsync.mockResolvedValue(LocalAuthentication.SecurityLevel.BIOMETRIC_STRONG);

      const result = await BiometricAuth.getSecurityLevel();

      expect(result).toBe(LocalAuthentication.SecurityLevel.BIOMETRIC_STRONG);
    });

    it('should handle errors gracefully', async () => {
      mockedLocalAuth.getEnrolledLevelAsync.mockRejectedValue(new Error('Error getting security level'));

      const result = await BiometricAuth.getSecurityLevel();

      expect(result).toBe(LocalAuthentication.SecurityLevel.NONE);
    });
  });

  describe('isLockedOut', () => {
    it('should return true when locked out due to too many attempts', async () => {
      mockedLocalAuth.authenticateAsync.mockResolvedValue({
        success: false,
        error: 'too_many_attempts',
      } as any);

      const result = await BiometricAuth.isLockedOut();

      expect(result).toBe(true);
    });

    it('should return false when not locked out', async () => {
      mockedLocalAuth.authenticateAsync.mockResolvedValue({
        success: false,
        error: 'user_cancel',
      } as any);

      const result = await BiometricAuth.isLockedOut();

      expect(result).toBe(false);
    });

    it('should return false on authentication error', async () => {
      mockedLocalAuth.authenticateAsync.mockRejectedValue(new Error('Auth error'));

      const result = await BiometricAuth.isLockedOut();

      expect(result).toBe(false);
    });
  });

  describe('Convenience exports', () => {
    it('should export convenience functions', () => {
      expect(checkBiometricAvailability).toBe(BiometricAuth.checkAvailability);
      expect(authenticateWithBiometric).toBe(BiometricAuth.authenticate);
      expect(getBiometricTypeName).toBe(BiometricAuth.getBiometricTypeName);
      expect(shouldOfferBiometric).toBe(BiometricAuth.shouldOfferBiometric);
    });
  });
});