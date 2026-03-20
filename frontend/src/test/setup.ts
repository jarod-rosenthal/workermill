import '@testing-library/jest-dom'

// Mock window.location for tests
Object.defineProperty(window, 'location', {
  writable: true,
  value: { ...window.location, href: '' },
});
