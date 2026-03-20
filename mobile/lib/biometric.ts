import * as LocalAuthentication from 'expo-local-authentication';

export interface BiometricCapabilities {
  isAvailable: boolean;
  supportedTypes: LocalAuthentication.AuthenticationType[];
  hasHardware: boolean;
  isEnrolled: boolean;
}

export interface BiometricAuthResult {
  success: boolean;
  error?: string;
  errorCode?: string;
}

export class BiometricAuth {
  /**
   * Check if biometric authentication is available on the device
   */
  static async checkAvailability(): Promise<BiometricCapabilities> {
    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();
      const supportedTypes = await LocalAuthentication.supportedAuthenticationTypesAsync();

      const isAvailable = hasHardware && isEnrolled && supportedTypes.length > 0;

      return {
        isAvailable,
        supportedTypes,
        hasHardware,
        isEnrolled,
      };
    } catch (error) {
      console.error('Error checking biometric availability:', error);
      return {
        isAvailable: false,
        supportedTypes: [],
        hasHardware: false,
        isEnrolled: false,
      };
    }
  }

  /**
   * Get user-friendly name for the primary biometric type available
   */
  static async getBiometricTypeName(): Promise<string> {
    const capabilities = await this.checkAvailability();

    if (!capabilities.isAvailable) {
      return 'Biometric authentication';
    }

    const { supportedTypes } = capabilities;

    // Prioritize Face ID and Touch ID (iOS)
    if (supportedTypes.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
      return 'Face ID';
    }

    if (supportedTypes.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
      return 'Touch ID';
    }

    // Android or other types
    if (supportedTypes.length > 0) {
      return 'Biometric authentication';
    }

    return 'Biometric authentication';
  }

  /**
   * Prompt user for biometric authentication
   */
  static async authenticate(options?: {
    promptMessage?: string;
    cancelLabel?: string;
    fallbackLabel?: string;
  }): Promise<BiometricAuthResult> {
    try {
      const capabilities = await this.checkAvailability();

      if (!capabilities.isAvailable) {
        return {
          success: false,
          error: 'Biometric authentication is not available',
          errorCode: 'NOT_AVAILABLE',
        };
      }

      const biometricName = await this.getBiometricTypeName();

      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: options?.promptMessage || `Use ${biometricName} to unlock WorkerMill`,
        cancelLabel: options?.cancelLabel || 'Cancel',
        fallbackLabel: options?.fallbackLabel || 'Use Passcode',
        requireConfirmation: false,
        disableDeviceFallback: false,
      });

      if (result.success) {
        return {
          success: true,
        };
      } else {
        let errorMessage = 'Authentication failed';
        let errorCode = 'UNKNOWN';

        const errorType = (result as any).error;
        if (errorType === 'user_cancel') {
          errorMessage = 'Authentication was cancelled';
          errorCode = 'USER_CANCEL';
        } else if (errorType === 'user_fallback') {
          errorMessage = 'User chose to use device passcode';
          errorCode = 'USER_FALLBACK';
        } else if (errorType === 'system_cancel') {
          errorMessage = 'Authentication was cancelled by system';
          errorCode = 'SYSTEM_CANCEL';
        } else if (errorType === 'authentication_failed') {
          errorMessage = 'Authentication failed';
          errorCode = 'AUTH_FAILED';
        } else if (errorType === 'too_many_attempts') {
          errorMessage = 'Too many failed attempts';
          errorCode = 'TOO_MANY_ATTEMPTS';
        }

        return {
          success: false,
          error: errorMessage,
          errorCode,
        };
      }
    } catch (error) {
      console.error('Biometric authentication error:', error);
      return {
        success: false,
        error: 'An unexpected error occurred during authentication',
        errorCode: 'UNEXPECTED_ERROR',
      };
    }
  }

  /**
   * Check if biometric authentication should be offered to the user
   * (combines availability check with user preferences)
   */
  static async shouldOfferBiometric(): Promise<boolean> {
    const capabilities = await this.checkAvailability();
    return capabilities.isAvailable;
  }

  /**
   * Get security level information for biometric authentication
   */
  static async getSecurityLevel(): Promise<LocalAuthentication.SecurityLevel> {
    try {
      return await LocalAuthentication.getEnrolledLevelAsync();
    } catch (error) {
      console.error('Error getting security level:', error);
      return LocalAuthentication.SecurityLevel.NONE;
    }
  }

  /**
   * Check if biometric authentication is currently locked out due to too many attempts
   */
  static async isLockedOut(): Promise<boolean> {
    try {
      // This is an indirect way to check - try a quick authentication
      // If it fails with too_many_attempts, we know it's locked out
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Checking availability...',
        cancelLabel: 'Cancel',
        disableDeviceFallback: true,
      });

      return (result as any).error === 'too_many_attempts';
    } catch {
      // If there's an error, assume not locked out
      return false;
    }
  }
}

// Export convenience functions for common usage patterns
export const checkBiometricAvailability = BiometricAuth.checkAvailability;
export const authenticateWithBiometric = BiometricAuth.authenticate;
export const getBiometricTypeName = BiometricAuth.getBiometricTypeName;
export const shouldOfferBiometric = BiometricAuth.shouldOfferBiometric;