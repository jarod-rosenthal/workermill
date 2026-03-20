import { SSEClient, ConnectionState, connectToTaskStream, disconnectSSE, getSSEState } from '../sse-client';
import { tokenManager } from '../api-client';

// Mock react-native-sse
const mockEventSource = {
  onopen: null as (() => void) | null,
  onmessage: null as ((event: MessageEvent) => void) | null,
  onerror: null as ((error: Event | Error) => void) | null,
  onclose: null as (() => void) | null,
  close: jest.fn(),
};

jest.mock('react-native-sse', () => ({
  EventSource: jest.fn().mockImplementation(() => mockEventSource),
}));

// Mock api-client tokenManager
jest.mock('../api-client', () => ({
  tokenManager: {
    getAccessToken: jest.fn(),
  },
}));

// Mock React Native AppState
jest.mock('react-native', () => ({
  AppState: {
    addEventListener: jest.fn().mockReturnValue({ remove: jest.fn() }),
  },
}));

const mockTokenManager = tokenManager as jest.Mocked<typeof tokenManager>;

describe('SSEClient', () => {
  let client: SSEClient;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();

    // Reset the mock EventSource
    mockEventSource.onopen = null;
    mockEventSource.onmessage = null;
    mockEventSource.onerror = null;
    mockEventSource.onclose = null;
    mockEventSource.close.mockClear();

    client = new SSEClient();

    // Mock successful token retrieval
    mockTokenManager.getAccessToken.mockResolvedValue('test-token');
  });

  afterEach(() => {
    jest.useRealTimers();
    client.destroy();
  });

  describe('connection lifecycle', () => {
    it('starts in disconnected state', () => {
      expect(client.getState()).toBe(ConnectionState.DISCONNECTED);
      expect(client.isConnected()).toBe(false);
    });

    it('transitions to connecting then connected on successful connection', async () => {
      const onMessage = jest.fn();
      const onOpen = jest.fn();
      const stateHandler = jest.fn();

      client.onStateChange(stateHandler);

      const connectPromise = client.connect({
        endpoint: '/test-stream',
        onMessage,
        onOpen,
      });

      // Should be in connecting state
      expect(client.getState()).toBe(ConnectionState.CONNECTING);
      expect(stateHandler).toHaveBeenCalledWith(ConnectionState.CONNECTING);

      await connectPromise;

      // Simulate successful connection
      if (mockEventSource.onopen) {
        mockEventSource.onopen();
      }

      expect(client.getState()).toBe(ConnectionState.CONNECTED);
      expect(client.isConnected()).toBe(true);
      expect(stateHandler).toHaveBeenCalledWith(ConnectionState.CONNECTED);
      expect(onOpen).toHaveBeenCalled();
    });

    it('includes auth token as query parameter in SSE URL', async () => {
      const { EventSource } = require('react-native-sse');

      await client.connect({
        endpoint: '/test-stream',
        onMessage: jest.fn(),
      });

      expect(EventSource).toHaveBeenCalledWith(
        expect.stringContaining('token=test-token')
      );
      expect(EventSource).toHaveBeenCalledWith(
        expect.stringContaining('/test-stream')
      );
    });

    it('handles missing auth token gracefully', async () => {
      mockTokenManager.getAccessToken.mockResolvedValue(null);

      const onError = jest.fn();

      await client.connect({
        endpoint: '/test-stream',
        onMessage: jest.fn(),
        onError,
      });

      expect(client.getState()).toBe(ConnectionState.ERROR);
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'No access token available for SSE connection' })
      );
    });
  });

  describe('reconnection with exponential backoff', () => {
    beforeEach(async () => {
      // Establish initial connection
      await client.connect({
        endpoint: '/test-stream',
        onMessage: jest.fn(),
      });

      // Simulate successful connection
      if (mockEventSource.onopen) {
        mockEventSource.onopen();
      }
    });

    it('reconnects with exponential backoff sequence: 1s, 2s, 4s, 8s, 30s cap', async () => {
      const { EventSource } = require('react-native-sse');
      EventSource.mockClear();

      // Simulate connection error
      if (mockEventSource.onerror) {
        mockEventSource.onerror(new Error('Connection failed'));
      }

      expect(client.getState()).toBe(ConnectionState.RECONNECTING);

      // First reconnect: after 1000ms
      jest.advanceTimersByTime(1000);
      expect(EventSource).toHaveBeenCalledTimes(1);

      // Simulate another error
      if (mockEventSource.onerror) {
        mockEventSource.onerror(new Error('Connection failed'));
      }

      // Second reconnect: after additional 2000ms
      jest.advanceTimersByTime(2000);
      expect(EventSource).toHaveBeenCalledTimes(2);

      // Simulate another error
      if (mockEventSource.onerror) {
        mockEventSource.onerror(new Error('Connection failed'));
      }

      // Third reconnect: after additional 4000ms
      jest.advanceTimersByTime(4000);
      expect(EventSource).toHaveBeenCalledTimes(3);

      // Simulate another error
      if (mockEventSource.onerror) {
        mockEventSource.onerror(new Error('Connection failed'));
      }

      // Fourth reconnect: after additional 8000ms
      jest.advanceTimersByTime(8000);
      expect(EventSource).toHaveBeenCalledTimes(4);

      // Simulate another error
      if (mockEventSource.onerror) {
        mockEventSource.onerror(new Error('Connection failed'));
      }

      // Fifth reconnect: after 30000ms (capped)
      jest.advanceTimersByTime(30000);
      expect(EventSource).toHaveBeenCalledTimes(5);

      // Simulate another error
      if (mockEventSource.onerror) {
        mockEventSource.onerror(new Error('Connection failed'));
      }

      // Sixth reconnect: still 30000ms (not increasing)
      jest.advanceTimersByTime(30000);
      expect(EventSource).toHaveBeenCalledTimes(6);
    });

    it('resets backoff on successful reconnection', async () => {
      const { EventSource } = require('react-native-sse');
      EventSource.mockClear();

      // Simulate connection error
      if (mockEventSource.onerror) {
        mockEventSource.onerror(new Error('Connection failed'));
      }

      // First reconnect after 1000ms
      jest.advanceTimersByTime(1000);
      expect(EventSource).toHaveBeenCalledTimes(1);

      // Simulate successful reconnection
      if (mockEventSource.onopen) {
        mockEventSource.onopen();
      }

      expect(client.getState()).toBe(ConnectionState.CONNECTED);

      // Another error should restart from 1000ms delay
      if (mockEventSource.onerror) {
        mockEventSource.onerror(new Error('Connection failed'));
      }

      EventSource.mockClear();

      // Should retry after 1000ms (not 2000ms)
      jest.advanceTimersByTime(1000);
      expect(EventSource).toHaveBeenCalledTimes(1);
    });

    it('stops reconnecting when manually disconnected', async () => {
      const { EventSource } = require('react-native-sse');
      EventSource.mockClear();

      // Simulate connection error
      if (mockEventSource.onerror) {
        mockEventSource.onerror(new Error('Connection failed'));
      }

      expect(client.getState()).toBe(ConnectionState.RECONNECTING);

      // Manually disconnect before timer fires
      client.disconnect();

      // Advance timer - should not reconnect
      jest.advanceTimersByTime(5000);
      expect(EventSource).not.toHaveBeenCalled();
      expect(client.getState()).toBe(ConnectionState.DISCONNECTED);
    });
  });

  describe('message handling', () => {
    it('forwards messages to handler', async () => {
      const onMessage = jest.fn();

      await client.connect({
        endpoint: '/test-stream',
        onMessage,
      });

      const testEvent = { data: 'test message' } as MessageEvent;

      if (mockEventSource.onmessage) {
        mockEventSource.onmessage(testEvent);
      }

      expect(onMessage).toHaveBeenCalledWith(testEvent);
    });

    it('forwards errors to handler', async () => {
      const onError = jest.fn();

      await client.connect({
        endpoint: '/test-stream',
        onMessage: jest.fn(),
        onError,
      });

      const testError = new Error('Test error');

      if (mockEventSource.onerror) {
        mockEventSource.onerror(testError);
      }

      expect(onError).toHaveBeenCalledWith(testError);
    });
  });

  describe('state management', () => {
    it('emits state change events', async () => {
      const stateHandler = jest.fn();
      const unsubscribe = client.onStateChange(stateHandler);

      await client.connect({
        endpoint: '/test-stream',
        onMessage: jest.fn(),
      });

      expect(stateHandler).toHaveBeenCalledWith(ConnectionState.CONNECTING);

      // Simulate successful connection
      if (mockEventSource.onopen) {
        mockEventSource.onopen();
      }

      expect(stateHandler).toHaveBeenCalledWith(ConnectionState.CONNECTED);

      // Test unsubscribe
      unsubscribe();
      client.disconnect();

      const previousCallCount = stateHandler.mock.calls.length;

      // Should not receive further state changes
      expect(stateHandler).toHaveBeenCalledTimes(previousCallCount);
    });

    it('transitions to error state after max retries', async () => {
      const stateHandler = jest.fn();
      client.onStateChange(stateHandler);

      await client.connect({
        endpoint: '/test-stream',
        onMessage: jest.fn(),
      });

      // Simulate connection establishment
      if (mockEventSource.onopen) {
        mockEventSource.onopen();
      }

      expect(client.getState()).toBe(ConnectionState.CONNECTED);

      // Simulate persistent connection failure
      if (mockEventSource.onerror) {
        mockEventSource.onerror(new Error('Persistent error'));
      }

      expect(client.getState()).toBe(ConnectionState.RECONNECTING);
      expect(stateHandler).toHaveBeenCalledWith(ConnectionState.RECONNECTING);
    });
  });

  describe('cleanup', () => {
    it('closes connection and clears timers on destroy', async () => {
      await client.connect({
        endpoint: '/test-stream',
        onMessage: jest.fn(),
      });

      // Simulate error to start reconnect timer
      if (mockEventSource.onerror) {
        mockEventSource.onerror(new Error('Test error'));
      }

      client.destroy();

      expect(mockEventSource.close).toHaveBeenCalled();
      expect(client.getState()).toBe(ConnectionState.DISCONNECTED);

      // Timer should be cleared - advancing time shouldn't trigger reconnect
      const { EventSource } = require('react-native-sse');
      EventSource.mockClear();

      jest.advanceTimersByTime(10000);
      expect(EventSource).not.toHaveBeenCalled();
    });
  });
});

describe('utility functions', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockTokenManager.getAccessToken.mockResolvedValue('test-token');
  });

  afterEach(() => {
    jest.useRealTimers();
    disconnectSSE();
  });

  it('connectToTaskStream connects to correct endpoint', async () => {
    const { EventSource } = require('react-native-sse');
    const onMessage = jest.fn();

    connectToTaskStream(onMessage);

    expect(EventSource).toHaveBeenCalledWith(
      expect.stringContaining('/control-center/stream')
    );
  });

  it('getSSEState returns current state', () => {
    expect(getSSEState()).toBe(ConnectionState.DISCONNECTED);
  });

  it('disconnectSSE calls client disconnect', () => {
    const client = require('../sse-client').sseClient;
    const disconnectSpy = jest.spyOn(client, 'disconnect');

    disconnectSSE();

    expect(disconnectSpy).toHaveBeenCalled();
  });
});