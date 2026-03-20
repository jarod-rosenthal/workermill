// Jest setup for React Native
/* eslint-env jest */
import '@testing-library/jest-native/extend-expect';

// Mock Expo modules - disable individual module mocking to use the ones from the test file
// jest.mock('expo-notifications');
// jest.mock('expo-device');
// jest.mock('expo-secure-store');

// Mock AsyncStorage
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
  getAllKeys: jest.fn(),
}));

// Mock react-native-sse
jest.mock('react-native-sse', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    close: jest.fn(),
  })),
}));