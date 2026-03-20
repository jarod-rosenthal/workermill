// Jest setup file for mocking problematic modules
import 'react-native-gesture-handler/jestSetup';

// Mock react-native-reanimated worklets
jest.mock('react-native-reanimated', () =>
  require('react-native-reanimated/mock')
);

// Mock @expo/vector-icons
jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'Ionicons',
}));

// Mock expo modules that might cause issues
jest.mock('expo-secure-store', () => ({
  setItemAsync: jest.fn(),
  getItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

jest.mock('expo-local-authentication', () => ({
  hasHardwareAsync: jest.fn(),
  isEnrolledAsync: jest.fn(),
  authenticateAsync: jest.fn(),
}));

// Silence the warning about dynamic import
global.URL = URL;
global.URLSearchParams = URLSearchParams;