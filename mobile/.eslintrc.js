// https://docs.expo.dev/guides/using-eslint/
module.exports = {
  extends: ['expo'],
  env: {
    jest: true,
    browser: true,
    node: true,
  },
  globals: {
    jest: 'readonly',
    describe: 'readonly',
    it: 'readonly',
    expect: 'readonly',
    beforeEach: 'readonly',
    afterEach: 'readonly',
    beforeAll: 'readonly',
    afterAll: 'readonly',
    URL: 'readonly',
    URLSearchParams: 'readonly',
  },
  rules: {
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    'react-hooks/exhaustive-deps': 'warn',
    'import/first': 'warn',
  },
  overrides: [
    {
      files: ['**/__tests__/**/*', '**/__mocks__/**/*', 'jest-setup.js'],
      env: {
        jest: true,
      },
      globals: {
        jest: 'readonly',
        describe: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
      },
    },
  ],
};
