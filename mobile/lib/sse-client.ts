import { EventSource } from 'react-native-sse';
import { AppState, AppStateStatus } from 'react-native';
import { tokenManager } from './api-client';
import { SSE_BASE_URL } from '@/constants/config';

// Types
export type SSEEventHandler = (event: MessageEvent) => void;
export type SSEErrorHandler = (error: Event | Error) => void;

export interface SSEConnectionConfig {
  endpoint: string;
  onMessage?: SSEEventHandler;
  onError?: SSEErrorHandler;
  onOpen?: () => void;
  onClose?: () => void;
}

// SSE Connection State
export enum ConnectionState {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  RECONNECTING = 'reconnecting',
  ERROR = 'error',
}

// Exponential backoff configuration
const BACKOFF_DELAYS = [1000, 2000, 4000, 8000, 30000]; // 1s, 2s, 4s, 8s, 30s cap
const MAX_BACKOFF_INDEX = BACKOFF_DELAYS.length - 1;

// SSE Client Manager
export class SSEClient {
  private eventSource: EventSource | null = null;
  private connectionConfig: SSEConnectionConfig | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private backoffIndex = 0;
  private isManuallyDisconnected = false;
  private appStateSubscription: any = null;
  private state: ConnectionState = ConnectionState.DISCONNECTED;

  // Event handlers
  private stateChangeHandlers: ((state: ConnectionState) => void)[] = [];

  constructor() {
    this.setupAppStateListener();
  }

  /**
   * Setup app state listener to connect/disconnect based on app focus
   */
  private setupAppStateListener() {
    this.appStateSubscription = AppState.addEventListener('change', this.handleAppStateChange);
  }

  /**
   * Handle app state changes - connect on active, disconnect on background/inactive
   */
  private handleAppStateChange = (nextAppState: AppStateStatus) => {
    if (nextAppState === 'active' && this.connectionConfig && !this.isManuallyDisconnected) {
      // App came to foreground - reconnect if we have a config and weren't manually disconnected
      this.connect(this.connectionConfig);
    } else if ((nextAppState === 'background' || nextAppState === 'inactive') && this.eventSource) {
      // App went to background/inactive - disconnect but keep config for reconnect
      this.disconnect(false); // don't mark as manually disconnected
    }
  };

  /**
   * Connect to SSE endpoint with authentication token
   */
  async connect(config: SSEConnectionConfig): Promise<void> {
    // Store config for reconnect scenarios
    this.connectionConfig = config;
    this.isManuallyDisconnected = false;

    try {
      // Get authentication token
      const token = await tokenManager.getAccessToken();
      if (!token) {
        const error = new Error('No access token available for SSE connection');
        this.setState(ConnectionState.ERROR);
        config.onError?.(error);
        return;
      }

      // Close existing connection
      this.closeConnection();

      // Build URL with auth token as query parameter
      const url = new URL(config.endpoint, SSE_BASE_URL);
      url.searchParams.set('token', token);

      this.setState(ConnectionState.CONNECTING);

      // Create new EventSource connection
      this.eventSource = new EventSource(url.toString());

      this.eventSource.onopen = () => {
        this.setState(ConnectionState.CONNECTED);
        this.backoffIndex = 0; // Reset backoff on successful connection
        config.onOpen?.();
      };

      this.eventSource.onmessage = (event) => {
        config.onMessage?.(event);
      };

      this.eventSource.onerror = (error) => {
        console.warn('SSE connection error:', error);

        if (this.state === ConnectionState.CONNECTED || this.state === ConnectionState.CONNECTING) {
          // Connection was established but now failed, or failed during connection
          this.setState(ConnectionState.RECONNECTING);
          this.scheduleReconnect();
        } else {
          // Already in error/reconnecting state
          this.setState(ConnectionState.ERROR);
        }

        config.onError?.(error);
      };

      this.eventSource.onclose = () => {
        config.onClose?.();

        if (!this.isManuallyDisconnected) {
          // Unexpected close - attempt reconnect
          this.setState(ConnectionState.RECONNECTING);
          this.scheduleReconnect();
        } else {
          this.setState(ConnectionState.DISCONNECTED);
        }
      };

    } catch (error) {
      console.error('Failed to establish SSE connection:', error);
      this.setState(ConnectionState.ERROR);
      config.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Schedule reconnect with exponential backoff
   */
  private scheduleReconnect(): void {
    // Clear any existing timer
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Don't reconnect if manually disconnected or no config
    if (this.isManuallyDisconnected || !this.connectionConfig) {
      return;
    }

    // Get current backoff delay
    const delay = BACKOFF_DELAYS[this.backoffIndex];

    // Increment backoff index but cap at max
    if (this.backoffIndex < MAX_BACKOFF_INDEX) {
      this.backoffIndex++;
    }

    console.log(`Scheduling SSE reconnect in ${delay}ms (attempt ${this.backoffIndex})`);

    this.reconnectTimer = setTimeout(() => {
      if (!this.isManuallyDisconnected && this.connectionConfig) {
        this.connect(this.connectionConfig);
      }
    }, delay);
  }

  /**
   * Manually disconnect from SSE
   */
  disconnect(manual = true): void {
    this.isManuallyDisconnected = manual;

    // Clear reconnect timer
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.closeConnection();

    if (manual) {
      // Only clear config on manual disconnect
      this.connectionConfig = null;
      this.backoffIndex = 0;
    }

    this.setState(ConnectionState.DISCONNECTED);
  }

  /**
   * Close the actual EventSource connection
   */
  private closeConnection(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }

  /**
   * Set connection state and notify handlers
   */
  private setState(state: ConnectionState): void {
    if (this.state !== state) {
      this.state = state;
      this.stateChangeHandlers.forEach(handler => handler(state));
    }
  }

  /**
   * Get current connection state
   */
  getState(): ConnectionState {
    return this.state;
  }

  /**
   * Check if currently connected
   */
  isConnected(): boolean {
    return this.state === ConnectionState.CONNECTED;
  }

  /**
   * Subscribe to state changes
   */
  onStateChange(handler: (state: ConnectionState) => void): () => void {
    this.stateChangeHandlers.push(handler);

    // Return unsubscribe function
    return () => {
      const index = this.stateChangeHandlers.indexOf(handler);
      if (index > -1) {
        this.stateChangeHandlers.splice(index, 1);
      }
    };
  }

  /**
   * Cleanup - call when component unmounts or app shuts down
   */
  destroy(): void {
    this.disconnect(true);

    // Clean up app state listener
    if (this.appStateSubscription) {
      this.appStateSubscription.remove();
      this.appStateSubscription = null;
    }

    // Clear all handlers
    this.stateChangeHandlers = [];
  }
}

// Shared SSE client instance
export const sseClient = new SSEClient();

// Utility functions for common SSE endpoints

/**
 * Connect to dashboard task updates stream
 */
export const connectToTaskStream = (
  onMessage: SSEEventHandler,
  onError?: SSEErrorHandler
): void => {
  sseClient.connect({
    endpoint: '/control-center/stream',
    onMessage,
    onError,
  });
};

/**
 * Connect to coordination messages stream for a specific task
 */
export const connectToCoordinationStream = (
  parentTaskId: string,
  onMessage: SSEEventHandler,
  onError?: SSEErrorHandler
): void => {
  sseClient.connect({
    endpoint: `/coordination/context/${parentTaskId}/stream`,
    onMessage,
    onError,
  });
};

/**
 * Connect to task logs stream
 */
export const connectToLogsStream = (
  taskId: string,
  onMessage: SSEEventHandler,
  onError?: SSEErrorHandler
): void => {
  sseClient.connect({
    endpoint: `/control-center/logs/${taskId}`,
    onMessage,
    onError,
  });
};

/**
 * Disconnect from any active SSE stream
 */
export const disconnectSSE = (): void => {
  sseClient.disconnect();
};

/**
 * Get current SSE connection state
 */
export const getSSEState = (): ConnectionState => {
  return sseClient.getState();
};

/**
 * Subscribe to SSE connection state changes
 */
export const subscribeToSSEState = (
  handler: (state: ConnectionState) => void
): (() => void) => {
  return sseClient.onStateChange(handler);
};