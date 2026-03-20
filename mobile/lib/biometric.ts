import * as LocalAuthentication from 'expo-local-authentication';
import { Platform } from 'react-native';

// Types for biometric authentication
export interface BiometricInfo {
  isAvailable: boolean;
  supportedTypes: LocalAuthentication.AuthenticationType[];
  hasEnrolledCredentials: boolean;
}

export interface BiometricAuthResult {
  success: boolean;
  error?: string;
  warning?: string;
}

/**
 * Check if biometric authentication is available on the device
 * and if the user has enrolled biometric credentials.
 */
export const checkBiometricAvailability = async (): Promise<BiometricInfo> => {
  try {
    // Check if hardware supports biometric authentication
    const isAvailable = await LocalAuthentication.hasHardwareAsync();
    if (!isAvailable) {
      return {
        isAvailable: false,
        supportedTypes: [],
        hasEnrolledCredentials: false,
      };
    }

    // Get supported authentication types
    const supportedTypes = await LocalAuthentication.supportedAuthenticationTypesAsync();

    // Check if user has enrolled biometric credentials
    const hasEnrolledCredentials = await LocalAuthentication.isEnrolledAsync();

    return {
      isAvailable: true,
      supportedTypes,
      hasEnrolledCredentials,
    };
  } catch (error) {
    console.warn('Failed to check biometric availability:', error);
    return {
      isAvailable: false,
      supportedTypes: [],
      hasEnrolledCredentials: false,
    };
  }
};

/**
 * Get a user-friendly name for the biometric authentication type.
 */
export const getBiometricTypeName = (types: LocalAuthentication.AuthenticationType[]): string => {
  if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
    return Platform.OS === 'ios' ? 'Face ID' : 'Face Unlock';
  }

  if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
    return Platform.OS === 'ios' ? 'Touch ID' : 'Fingerprint';
  }

  if (types.includes(LocalAuthentication.AuthenticationType.IRIS)) {
    return 'Iris Scan';
  }

  // Fallback for any other types
  return 'Biometric Authentication';
};

/**
 * Prompt the user for biometric authentication.
 */
export const authenticateWithBiometric = async (
  promptMessage?: string
): Promise<BiometricAuthResult> => {
  try {
    // First check if biometrics are available
    const biometricInfo = await checkBiometricAvailability();

    if (!biometricInfo.isAvailable) {
      return {
        success: false,
        error: 'Biometric authentication is not available on this device',
      };
    }

    if (!biometricInfo.hasEnrolledCredentials) {
      return {
        success: false,
        error: 'No biometric credentials are enrolled. Please set up biometric authentication in your device settings.',
      };
    }

    // Get biometric type name for prompt
    const biometricTypeName = getBiometricTypeName(biometricInfo.supportedTypes);
    const defaultPrompt = `Use ${biometricTypeName} to unlock WorkerMill`;

    // Attempt biometric authentication
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: promptMessage || defaultPrompt,
      cancelLabel: 'Cancel',
      fallbackLabel: 'Use Password', // For iOS, allows fallback to device passcode
      disableDeviceFallback: false, // Allow fallback to device passcode
    });

    if (result.success) {
      return {
        success: true,
      };
    }

    // Handle different failure reasons
    if (result.error === 'user_cancel') {
      return {
        success: false,
        error: 'Authentication was cancelled by the user',
      };
    }

    if (result.error === 'system_cancel') {
      return {
        success: false,
        error: 'Authentication was cancelled by the system',
      };
    }

    if (result.error === 'app_cancel') {
      return {
        success: false,
        error: 'Authentication was cancelled by the app',
      };
    }

    if (result.error === 'lockout') {
      return {
        success: false,
        error: 'Biometric authentication is temporarily disabled due to too many failed attempts',
        warning: 'Please wait a moment and try again, or use your device passcode',
      };
    }

    if (result.error === 'lockout_permanent') {
      return {
        success: false,
        error: 'Biometric authentication is permanently disabled',
        warning: 'Please use your device passcode or re-enable biometrics in Settings',
      };
    }

    if (result.error === 'too_many_attempts') {
      return {
        success: false,
        error: 'Too many failed biometric attempts',
        warning: 'Please try again later or use your device passcode',
      };
    }

    if (result.error === 'not_available') {
      return {
        success: false,
        error: 'Biometric authentication is not currently available',
      };
    }

    if (result.error === 'not_enrolled') {
      return {
        success: false,
        error: 'No biometric credentials are enrolled',
        warning: 'Please set up biometric authentication in your device settings',
      };
    }

    // Generic fallback for unknown errors
    return {
      success: false,
      error: 'Biometric authentication failed',
    };
  } catch (error) {
    console.error('Biometric authentication error:', error);
    return {
      success: false,
      error: 'Biometric authentication is currently unavailable',
    };
  }
};

/**
 * Check if the device supports and has biometric authentication set up.
 * This is a convenience function that combines availability and enrollment checks.
 */
export const isBiometricReady = async (): Promise<boolean> => {
  try {
    const info = await checkBiometricAvailability();
    return info.isAvailable && info.hasEnrolledCredentials;
  } catch (error) {
    console.warn('Failed to check biometric readiness:', error);
    return false;
  }
};

/**
 * Get a description of the current biometric setup status for display in settings.
 */
export const getBiometricStatusDescription = async (): Promise<string> => {
  try {
    const info = await checkBiometricAvailability();

    if (!info.isAvailable) {
      return 'Biometric authentication is not supported on this device';
    }

    if (!info.hasEnrolledCredentials) {
      const typeName = getBiometricTypeName(info.supportedTypes);
      return `${typeName} is supported but not set up. Enable it in your device settings.`;
    }

    const typeName = getBiometricTypeName(info.supportedTypes);
    return `${typeName} is available and ready to use`;
  } catch (error) {
    console.warn('Failed to get biometric status:', error);
    return 'Biometric authentication status unknown';
  }
};