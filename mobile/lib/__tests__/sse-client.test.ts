import { AppState } from 'react-native';
import EventSource from 'react-native-sse';
import { SSEClient, createDashboardSSE } from '../sse-client';

// Mock dependencies
jest.mock('react-native-sse');
jest.mock('react-native', () => ({
  AppState: {
    currentState: 'active',
    addEventListener: jest.fn(),
  },
}));

const MockedEventSource = EventSource as jest.MockedClass<typeof EventSource>;
const mockAppState = AppState as jest.Mocked<typeof AppState>;

describe('SSEClient', () => {
  let mockEventSource: jest.Mocked<EventSource>;
  let mockOnEvent: jest.Mock;
  let mockOnStateChange: jest.Mock;
  let mockOnError: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();

    // Mock EventSource instance
    mockEventSource = {
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      close: jest.fn(),
      readyState: 0,
    } as any;

    MockedEventSource.mockImplementation(() => mockEventSource);

    // Mock callback functions
    mockOnEvent = jest.fn();
    mockOnStateChange = jest.fn();
    mockOnError = jest.fn();

    // Mock AppState
    mockAppState.currentState = 'active';
    mockAppState.addEventListener.mockReturnValue({ remove: jest.fn() });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('Connection Management', () => {
    it('should initialize with disconnected state', () => {
      const client = new SSEClient({
        url: '/test',
        onStateChange: mockOnStateChange,
      });

      expect(client.getState()).toBe('disconnected');
      // Note: onStateChange is not called during initialization since the state doesn't change
      expect(mockOnStateChange).not.toHaveBeenCalled();
    });

    it('should connect and set up event listeners', () => {
      const client = new SSEClient({
        url: '/test',
        token: 'test-token',
        onEvent: mockOnEvent,
        onStateChange: mockOnStateChange,
      });

      client.connect();

      expect(MockedEventSource).toHaveBeenCalledWith(
        'https://workermill.com/api/test?token=test-token',
        { headers: {} }
      );

      expect(mockEventSource.addEventListener).toHaveBeenCalledWith('open', expect.any(Function));
      expect(mockEventSource.addEventListener).toHaveBeenCalledWith('error', expect.any(Function));
      expect(mockEventSource.addEventListener).toHaveBeenCalledWith('message', expect.any(Function));
      expect(mockEventSource.addEventListener).toHaveBeenCalledWith('task_update', expect.any(Function));

      expect(mockOnStateChange).toHaveBeenCalledWith('connecting');
    });

    it('should handle successful connection', () => {
      const client = new SSEClient({
        url: '/test',
        onStateChange: mockOnStateChange,
      });

      client.connect();

      // Simulate successful connection
      const openHandler = mockEventSource.addEventListener.mock.calls.find(
        call => call[0] === 'open'
      )?.[1] as Function;

      openHandler();

      expect(mockOnStateChange).toHaveBeenCalledWith('connected');
      expect(client.isConnected()).toBe(true);
    });

    it('should disconnect and clean up properly', () => {
      const client = new SSEClient({
        url: '/test',
        onStateChange: mockOnStateChange,
      });

      client.connect();
      client.disconnect();

      expect(mockEventSource.removeEventListener).toHaveBeenCalledWith('open', expect.any(Function));
      expect(mockEventSource.close).toHaveBeenCalled();
      expect(mockOnStateChange).toHaveBeenCalledWith('disconnected');
      expect(client.getState()).toBe('disconnected');
    });
  });

  describe('Exponential Backoff Reconnect', () => {
    it('should reconnect with exponential backoff sequence', () => {
      const client = new SSEClient({
        url: '/test',
        onStateChange: mockOnStateChange,
        onError: mockOnError,
      });

      // Start connection
      client.connect();

      // Simulate connection failure
      const errorHandler = mockEventSource.addEventListener.mock.calls.find(
        call => call[0] === 'error'
      )?.[1] as Function;

      // First failure
      errorHandler({ type: 'error' });
      expect(mockOnStateChange).toHaveBeenCalledWith('error');

      // Clear previous calls
      MockedEventSource.mockClear();

      // First reconnect after exactly 1000ms
      jest.advanceTimersByTime(1000);
      expect(MockedEventSource).toHaveBeenCalledTimes(1);

      // Simulate another failure
      errorHandler({ type: 'error' });
      MockedEventSource.mockClear();

      // Second reconnect after additional 2000ms
      jest.advanceTimersByTime(2000);
      expect(MockedEventSource).toHaveBeenCalledTimes(1);

      // Simulate another failure
      errorHandler({ type: 'error' });
      MockedEventSource.mockClear();

      // Third reconnect after additional 4000ms
      jest.advanceTimersByTime(4000);
      expect(MockedEventSource).toHaveBeenCalledTimes(1);

      // Simulate another failure
      errorHandler({ type: 'error' });
      MockedEventSource.mockClear();

      // Fourth reconnect after additional 8000ms
      jest.advanceTimersByTime(8000);
      expect(MockedEventSource).toHaveBeenCalledTimes(1);

      // Simulate another failure
      errorHandler({ type: 'error' });
      MockedEventSource.mockClear();

      // Fifth reconnect after 30000ms (cap reached)
      jest.advanceTimersByTime(30000);
      expect(MockedEventSource).toHaveBeenCalledTimes(1);

      // Simulate another failure
      errorHandler({ type: 'error' });
      MockedEventSource.mockClear();

      // Sixth reconnect after another 30000ms (still at cap)
      jest.advanceTimersByTime(30000);
      expect(MockedEventSource).toHaveBeenCalledTimes(1);
    });

    it('should reset reconnect attempts on successful connection', () => {
      const client = new SSEClient({
        url: '/test',
        onStateChange: mockOnStateChange,
        onError: mockOnError,
      });

      client.connect();

      // Simulate connection failure
      const errorHandler = mockEventSource.addEventListener.mock.calls.find(
        call => call[0] === 'error'
      )?.[1] as Function;

      errorHandler({ type: 'error' });
      MockedEventSource.mockClear();

      // First reconnect at 1000ms
      jest.advanceTimersByTime(1000);
      expect(MockedEventSource).toHaveBeenCalledTimes(1);

      // Simulate successful connection
      const openHandler = mockEventSource.addEventListener.mock.calls.find(
        call => call[0] === 'open'
      )?.[1] as Function;

      openHandler();
      expect(client.getReconnectAttempts()).toBe(0); // Should reset

      // If we fail again, should start from 1s again
      errorHandler({ type: 'error' });
      MockedEventSource.mockClear();

      jest.advanceTimersByTime(1000);
      expect(MockedEventSource).toHaveBeenCalledTimes(1);
    });

    it('should emit error state after connection failures', () => {
      const client = new SSEClient({
        url: '/test',
        onStateChange: mockOnStateChange,
        onError: mockOnError,
      });

      client.connect();

      // Simulate connection failure
      const errorHandler = mockEventSource.addEventListener.mock.calls.find(
        call => call[0] === 'error'
      )?.[1] as Function;

      errorHandler({ type: 'error' });

      expect(mockOnStateChange).toHaveBeenCalledWith('error');
      expect(mockOnError).toHaveBeenCalledWith(expect.any(Error));
      expect(client.isErrored()).toBe(true);
    });
  });

  describe('App State Handling', () => {
    it('should disconnect when app goes to background', () => {
      const client = new SSEClient({
        url: '/test',
        onStateChange: mockOnStateChange,
      });

      client.connect();

      // Simulate app going to background
      const appStateHandler = mockAppState.addEventListener.mock.calls.find(
        call => call[0] === 'change'
      )?.[1] as Function;

      appStateHandler('background');

      expect(mockEventSource.close).toHaveBeenCalled();
      expect(mockOnStateChange).toHaveBeenCalledWith('disconnected');
    });

    it('should reconnect when app becomes active after backgrounding', () => {
      const client = new SSEClient({
        url: '/test',
        onStateChange: mockOnStateChange,
      });

      client.connect();

      const appStateHandler = mockAppState.addEventListener.mock.calls.find(
        call => call[0] === 'change'
      )?.[1] as Function;

      // Background the app
      appStateHandler('background');
      MockedEventSource.mockClear();

      // Bring app to foreground
      appStateHandler('active');

      expect(MockedEventSource).toHaveBeenCalled();
    });

    it('should not reconnect on app active if manually disconnected', () => {
      const client = new SSEClient({
        url: '/test',
      });

      // Manually disconnect (not due to backgrounding)
      client.disconnect();
      MockedEventSource.mockClear();

      const appStateHandler = mockAppState.addEventListener.mock.calls.find(
        call => call[0] === 'change'
      )?.[1] as Function;

      // App becomes active
      appStateHandler('active');

      expect(MockedEventSource).not.toHaveBeenCalled();
    });

    it('should only reconnect when app is active', () => {
      mockAppState.currentState = 'background';

      const client = new SSEClient({
        url: '/test',
        onError: mockOnError,
      });

      client.connect();

      // Simulate failure while app is in background
      const errorHandler = mockEventSource.addEventListener.mock.calls.find(
        call => call[0] === 'error'
      )?.[1] as Function;

      errorHandler({ type: 'error' });
      MockedEventSource.mockClear();

      // Should not reconnect while app is in background
      jest.advanceTimersByTime(1000);
      expect(MockedEventSource).not.toHaveBeenCalled();

      // Set app to active and trigger a new failure to start a new timer
      mockAppState.currentState = 'active';

      // Clear the previous timer completely by advancing past it
      jest.advanceTimersByTime(30000); // Advance past the max delay
      MockedEventSource.mockClear();

      // Now trigger a new failure when app is active
      errorHandler({ type: 'error' });
      MockedEventSource.mockClear();

      jest.advanceTimersByTime(1000);
      expect(MockedEventSource).toHaveBeenCalledTimes(1);
    });
  });

  describe('Event Handling', () => {
    it('should handle task update events', () => {
      const client = new SSEClient({
        url: '/test',
        onEvent: mockOnEvent,
      });

      client.connect();

      const taskUpdateHandler = mockEventSource.addEventListener.mock.calls.find(
        call => call[0] === ('task_update' as any)
      )?.[1] as Function;

      const testData = { id: 'task-1', status: 'completed' };
      taskUpdateHandler({ data: JSON.stringify(testData) });

      expect(mockOnEvent).toHaveBeenCalledWith({
        type: 'task_update',
        data: testData,
        timestamp: expect.any(String),
      });
    });

    it('should handle coordination messages', () => {
      const client = new SSEClient({
        url: '/test',
        onEvent: mockOnEvent,
      });

      client.connect();

      const coordinationHandler = mockEventSource.addEventListener.mock.calls.find(
        call => call[0] === ('coordination_message' as any)
      )?.[1] as Function;

      const testData = { persona: 'backend', message_type: 'decision', content: 'test' };
      coordinationHandler({ data: JSON.stringify(testData) });

      expect(mockOnEvent).toHaveBeenCalledWith({
        type: 'coordination_message',
        data: testData,
        timestamp: expect.any(String),
      });
    });

    it('should handle malformed event data gracefully', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      const client = new SSEClient({
        url: '/test',
        onEvent: mockOnEvent,
      });

      client.connect();

      const messageHandler = mockEventSource.addEventListener.mock.calls.find(
        call => call[0] === 'message'
      )?.[1] as Function;

      messageHandler({ data: 'invalid-json' });

      expect(consoleSpy).toHaveBeenCalledWith('Error parsing SSE message:', expect.any(Error));
      expect(mockOnEvent).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('Token Management', () => {
    it('should update token and reconnect if connected', () => {
      const client = new SSEClient({
        url: '/test',
        token: 'old-token',
        onStateChange: mockOnStateChange,
      });

      client.connect();

      // Simulate successful connection
      const openHandler = mockEventSource.addEventListener.mock.calls.find(
        call => call[0] === 'open'
      )?.[1] as Function;
      openHandler();

      MockedEventSource.mockClear();
      mockEventSource.close.mockClear();

      client.updateToken('new-token');

      expect(mockEventSource.close).toHaveBeenCalled();
      expect(MockedEventSource).toHaveBeenCalledWith(
        'https://workermill.com/api/test?token=new-token',
        { headers: {} }
      );
    });
  });

  describe('Factory Functions', () => {
    it('should create dashboard SSE with correct URL', () => {
      const options = {
        onEvent: mockOnEvent,
        onStateChange: mockOnStateChange,
      };

      const client = createDashboardSSE('test-token', options);

      client.connect();

      expect(MockedEventSource).toHaveBeenCalledWith(
        'https://workermill.com/api/control-center/stream?token=test-token',
        { headers: {} }
      );
    });
  });

  describe('Cleanup', () => {
    it('should clean up app state listener on destroy', () => {
      const removeListener = jest.fn();
      mockAppState.addEventListener.mockReturnValue({ remove: removeListener });

      const client = new SSEClient({
        url: '/test',
      });

      client.destroy();

      expect(removeListener).toHaveBeenCalled();
    });
  });
});