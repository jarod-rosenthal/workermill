import '@testing-library/jest-dom'

// Mock window.location for tests
delete (window as Window & typeof globalThis).location;
window.location = { ...window.location, href: '' };

// Mock environment variables for tests
global.window = window;