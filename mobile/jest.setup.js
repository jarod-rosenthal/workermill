// Jest setup for React Native
/* eslint-env jest */
import '@testing-library/jest-native/extend-expect';

// Expo modules global mocks
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
  setNotificationHandler: jest.fn(),
  addNotificationReceivedListener: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn(),
  removeNotificationSubscription: jest.fn(),
  openSettingsAsync: jest.fn(),
  setNotificationChannelAsync: jest.fn(),
  AndroidImportance: { MAX: 5, HIGH: 4, DEFAULT: 3, LOW: 2, MIN: 1 },
}));

jest.mock('expo-device', () => {
  const obj = {};
  Object.defineProperty(obj, 'isDevice', { value: true, writable: true, configurable: true });
  Object.defineProperty(obj, 'deviceName', { value: 'Test Device', writable: true, configurable: true });
  Object.defineProperty(obj, 'brand', { value: 'Test Brand', writable: true, configurable: true });
  Object.defineProperty(obj, 'modelName', { value: 'Test Model', writable: true, configurable: true });
  return obj;
});

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