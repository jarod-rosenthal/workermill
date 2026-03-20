import EventSource from 'react-native-sse';
import { AppState, AppStateStatus } from 'react-native';
import { SSE_BASE_URL } from '@/constants/config';

export type SSEEventType = 'task_update' | 'coordination_message' | 'log_entry' | 'code_event';

export interface SSEEvent {
  type: SSEEventType;
  data: any;
  timestamp: string;
}

export type SSEConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

interface SSEClientOptions {
  url: string;
  token?: string;
  onEvent?: (event: SSEEvent) => void;
  onStateChange?: (state: SSEConnectionState) => void;
  onError?: (error: Error) => void;
}

export class SSEClient {
  private eventSource: EventSource | null = null;
  private options: SSEClientOptions;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempt = 0;
  private readonly maxReconnectAttempts = Infinity; // Keep trying
  private readonly reconnectDelays = [1000, 2000, 4000, 8000, 30000]; // 1s, 2s, 4s, 8s, 30s (cap)
  private state: SSEConnectionState = 'disconnected';
  private appStateSubscription: any = null;

  constructor(options: SSEClientOptions) {
    this.options = options;
    this.setupAppStateHandling();
  }

  private setupAppStateHandling() {
    // Listen to app state changes
    this.appStateSubscription = AppState.addEventListener('change', this.handleAppStateChange);
  }

  private handleAppStateChange = (nextAppState: AppStateStatus) => {
    if (nextAppState === 'background' || nextAppState === 'inactive') {
      // App is backgrounding, disconnect SSE
      this.disconnect();
    } else if (nextAppState === 'active') {
      // App is coming to foreground, reconnect if we should be connected
      if (this.state === 'disconnected' && this.reconnectTimer === null) {
        this.connect();
      }
    }
  };

  private setState(newState: SSEConnectionState) {
    if (this.state !== newState) {
      this.state = newState;
      this.options.onStateChange?.(newState);
    }
  }

  private getReconnectDelay(): number {
    const delayIndex = Math.min(this.reconnectAttempt, this.reconnectDelays.length - 1);
    return this.reconnectDelays[delayIndex];
  }

  private buildUrl(): string {
    const url = new URL(this.options.url, SSE_BASE_URL);
    if (this.options.token) {
      url.searchParams.set('token', this.options.token);
    }
    return url.toString();
  }

  connect(): void {
    if (this.state === 'connected' || this.state === 'connecting') {
      return; // Already connected or connecting
    }

    this.setState('connecting');
    this.clearReconnectTimer();

    try {
      const url = this.buildUrl();
      this.eventSource = new EventSource(url, {
        headers: {},
      });

      this.eventSource.addEventListener('open', this.handleOpen);
      this.eventSource.addEventListener('error', this.handleError);
      this.eventSource.addEventListener('message', this.handleMessage);

      // Listen for specific event types
      this.eventSource.addEventListener('task_update' as any, this.handleTaskUpdate);
      this.eventSource.addEventListener('coordination_message' as any, this.handleCoordinationMessage);
      this.eventSource.addEventListener('log_entry' as any, this.handleLogEntry);
      this.eventSource.addEventListener('code_event' as any, this.handleCodeEvent);

    } catch (error) {
      console.error('SSE connection failed:', error);
      this.handleConnectionFailure(error as Error);
    }
  }

  disconnect(): void {
    this.clearReconnectTimer();

    if (this.eventSource) {
      this.eventSource.removeEventListener('open', this.handleOpen);
      this.eventSource.removeEventListener('error', this.handleError);
      this.eventSource.removeEventListener('message', this.handleMessage);
      this.eventSource.removeEventListener('task_update' as any, this.handleTaskUpdate);
      this.eventSource.removeEventListener('coordination_message' as any, this.handleCoordinationMessage);
      this.eventSource.removeEventListener('log_entry' as any, this.handleLogEntry);
      this.eventSource.removeEventListener('code_event' as any, this.handleCodeEvent);

      this.eventSource.close();
      this.eventSource = null;
    }

    this.setState('disconnected');
    this.reconnectAttempt = 0;
  }

  updateToken(token: string): void {
    this.options.token = token;

    // Reconnect with new token if currently connected
    if (this.state === 'connected') {
      this.disconnect();
      this.connect();
    }
  }

  private handleOpen = () => {
    console.log('SSE connected');
    this.setState('connected');
    this.reconnectAttempt = 0; // Reset on successful connection
  };

  private handleError = (event: any) => {
    console.error('SSE error:', event);
    this.handleConnectionFailure(new Error(`SSE error: ${event.type}`));
  };

  private handleMessage = (event: any) => {
    try {
      const data = JSON.parse(event.data);
      this.options.onEvent?.({
        type: 'task_update', // Default type
        data,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Error parsing SSE message:', error);
    }
  };

  private handleTaskUpdate = (event: any) => {
    try {
      const data = JSON.parse(event.data);
      this.options.onEvent?.({
        type: 'task_update',
        data,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Error parsing task update:', error);
    }
  };

  private handleCoordinationMessage = (event: any) => {
    try {
      const data = JSON.parse(event.data);
      this.options.onEvent?.({
        type: 'coordination_message',
        data,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Error parsing coordination message:', error);
    }
  };

  private handleLogEntry = (event: any) => {
    try {
      const data = JSON.parse(event.data);
      this.options.onEvent?.({
        type: 'log_entry',
        data,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Error parsing log entry:', error);
    }
  };

  private handleCodeEvent = (event: any) => {
    try {
      const data = JSON.parse(event.data);
      this.options.onEvent?.({
        type: 'code_event',
        data,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Error parsing code event:', error);
    }
  };

  private handleConnectionFailure(error: Error): void {
    console.error('SSE connection failure:', error);

    this.setState('error');
    this.options.onError?.(error);

    // Close current connection
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    // Schedule reconnect with exponential backoff
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    this.clearReconnectTimer();

    const delay = this.getReconnectDelay();
    console.log(`Scheduling SSE reconnect in ${delay}ms (attempt ${this.reconnectAttempt + 1})`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectAttempt++;
      this.reconnectTimer = null;

      // Only reconnect if app is active
      if (AppState.currentState === 'active') {
        this.connect();
      }
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  // Getters
  getState(): SSEConnectionState {
    return this.state;
  }

  isConnected(): boolean {
    return this.state === 'connected';
  }

  isConnecting(): boolean {
    return this.state === 'connecting';
  }

  isErrored(): boolean {
    return this.state === 'error';
  }

  getReconnectAttempts(): number {
    return this.reconnectAttempt;
  }

  // Cleanup
  destroy(): void {
    this.disconnect();

    if (this.appStateSubscription) {
      this.appStateSubscription.remove();
      this.appStateSubscription = null;
    }
  }
}

// Singleton instances for different SSE channels
let dashboardSSE: SSEClient | null = null;
let coordinationSSE: SSEClient | null = null;
let logsSSE: SSEClient | null = null;

export const createDashboardSSE = (token: string, options: Omit<SSEClientOptions, 'url' | 'token'>): SSEClient => {
  if (dashboardSSE) {
    dashboardSSE.destroy();
  }

  dashboardSSE = new SSEClient({
    url: '/control-center/stream',
    token,
    ...options,
  });

  return dashboardSSE;
};

export const createCoordinationSSE = (parentTaskId: string, token: string, options: Omit<SSEClientOptions, 'url' | 'token'>): SSEClient => {
  if (coordinationSSE) {
    coordinationSSE.destroy();
  }

  coordinationSSE = new SSEClient({
    url: `/coordination/context/${parentTaskId}/stream`,
    token,
    ...options,
  });

  return coordinationSSE;
};

export const createLogsSSE = (taskId: string, token: string, options: Omit<SSEClientOptions, 'url' | 'token'>): SSEClient => {
  if (logsSSE) {
    logsSSE.destroy();
  }

  logsSSE = new SSEClient({
    url: `/control-center/logs/${taskId}`,
    token,
    ...options,
  });

  return logsSSE;
};

// Helper to get current instances
export const getDashboardSSE = (): SSEClient | null => dashboardSSE;
export const getCoordinationSSE = (): SSEClient | null => coordinationSSE;
export const getLogsSSE = (): SSEClient | null => logsSSE;

// Cleanup all instances
export const destroyAllSSE = (): void => {
  [dashboardSSE, coordinationSSE, logsSSE].forEach(sse => {
    if (sse) {
      sse.destroy();
    }
  });

  dashboardSSE = null;
  coordinationSSE = null;
  logsSSE = null;
};