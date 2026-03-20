module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.(ts|tsx|js)', '**/*.(test|spec).(ts|tsx|js)'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    '^react-native$': '<rootDir>/node_modules/react-native',
    '^expo-(.*)$': '<rootDir>/__mocks__/expo-$1.js',
  },
  transform: {
    '^.+\\.(ts|tsx)$': 'ts-jest',
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],
  collectCoverageFrom: [
    'lib/**/*.{ts,tsx}',
    'stores/**/*.{ts,tsx}',
    '!**/*.d.ts',
  ],
  transformIgnorePatterns: [
    'node_modules/(?!(react-native|expo|@expo|@react-native))',
  ],
};