import * as Linking from 'expo-linking';
import * as Notifications from 'expo-notifications';

export type DeepLinkRoute = 'task' | 'board' | 'card' | 'auth';

export interface DeepLinkParams {
  taskId?: string;
  boardId?: string;
  cardId?: string;
  code?: string;
  state?: string;
}

export interface ParsedDeepLink {
  route: DeepLinkRoute | null;
  params: DeepLinkParams;
  isValid: boolean;
}

export interface NotificationDeepLink {
  route: DeepLinkRoute;
  params: DeepLinkParams;
  notificationData: any;
}

export class DeepLinkManager {
  private static listeners: ((link: ParsedDeepLink) => void)[] = [];

  /**
   * Initialize deep linking system
   */
  static initialize() {
    // Listen for incoming links when app is already running
    const linkSubscription = Linking.addEventListener('url', this.handleIncomingLink);

    // Handle notification taps that trigger deep links
    const notificationSubscription = Notifications.addNotificationResponseReceivedListener(
      this.handleNotificationResponse
    );

    return () => {
      linkSubscription.remove();
      notificationSubscription.remove();
    };
  }

  /**
   * Parse a deep link URL
   */
  static parseDeepLink(url: string): ParsedDeepLink {
    try {
      const parsed = Linking.parse(url);
      const { hostname, path, queryParams } = parsed;

      // Handle auth callback URLs (workermill://auth/callback)
      if (hostname === 'auth' && path === '/callback') {
        return {
          route: 'auth',
          params: {
            code: queryParams?.code as string,
            state: queryParams?.state as string,
          },
          isValid: !!(queryParams?.code),
        };
      }

      // Handle task deep links (workermill://task/123)
      if (hostname === 'task') {
        const taskId = path?.replace('/', '') || queryParams?.id as string;
        return {
          route: 'task',
          params: { taskId },
          isValid: !!taskId,
        };
      }

      // Handle board deep links (workermill://board/456)
      if (hostname === 'board') {
        const pathParts = path?.split('/').filter(Boolean) || [];
        const boardId = pathParts[0] || queryParams?.id as string;

        // Check for card deep link (workermill://board/456/card/789)
        if (pathParts[1] === 'card' && pathParts[2]) {
          return {
            route: 'card',
            params: {
              boardId,
              cardId: pathParts[2],
            },
            isValid: !!(boardId && pathParts[2]),
          };
        }

        return {
          route: 'board',
          params: { boardId },
          isValid: !!boardId,
        };
      }

      // Handle card deep links (workermill://card/789?boardId=456)
      if (hostname === 'card') {
        const cardId = path?.replace('/', '') || queryParams?.id as string;
        const boardId = queryParams?.boardId as string;

        return {
          route: 'card',
          params: { cardId, boardId },
          isValid: !!(cardId && boardId),
        };
      }

      // Unknown route
      return {
        route: null,
        params: {},
        isValid: false,
      };
    } catch (error) {
      console.error('Error parsing deep link:', error);
      return {
        route: null,
        params: {},
        isValid: false,
      };
    }
  }

  /**
   * Handle incoming link when app is already running
   */
  private static handleIncomingLink = (event: { url: string }) => {
    const parsed = this.parseDeepLink(event.url);
    console.log('Incoming deep link:', parsed);

    // Notify all listeners
    this.listeners.forEach(listener => {
      try {
        listener(parsed);
      } catch (error) {
        console.error('Error in deep link listener:', error);
      }
    });
  };

  /**
   * Handle notification response (tap)
   */
  private static handleNotificationResponse = (
    response: Notifications.NotificationResponse
  ) => {
    const notification = response.notification;
    const data = notification.request.content.data;

    // Extract deep link information from notification data
    const notificationDeepLink = this.parseNotificationData(data);

    if (notificationDeepLink) {
      console.log('Notification deep link:', notificationDeepLink);

      // Convert to regular deep link format for consistency
      const parsed: ParsedDeepLink = {
        route: notificationDeepLink.route,
        params: notificationDeepLink.params,
        isValid: true,
      };

      // Notify listeners
      this.listeners.forEach(listener => {
        try {
          listener(parsed);
        } catch (error) {
          console.error('Error in notification deep link listener:', error);
        }
      });
    }
  };

  /**
   * Parse notification data to extract deep link information
   */
  private static parseNotificationData(data: any): NotificationDeepLink | null {
    try {
      // Expected notification data structure:
      // {
      //   type: "task_completed" | "task_failed" | "blocker" | "plan_ready",
      //   taskId: "task-id",
      //   boardId?: "board-id",
      //   cardId?: "card-id"
      // }

      if (!data || typeof data !== 'object') {
        return null;
      }

      // Task notifications
      if (data.taskId) {
        return {
          route: 'task',
          params: { taskId: data.taskId },
          notificationData: data,
        };
      }

      // Card notifications (if we add card-specific notifications in the future)
      if (data.cardId && data.boardId) {
        return {
          route: 'card',
          params: { cardId: data.cardId, boardId: data.boardId },
          notificationData: data,
        };
      }

      // Board notifications
      if (data.boardId) {
        return {
          route: 'board',
          params: { boardId: data.boardId },
          notificationData: data,
        };
      }

      return null;
    } catch (error) {
      console.error('Error parsing notification data:', error);
      return null;
    }
  }

  /**
   * Add a listener for deep link events
   */
  static addListener(listener: (link: ParsedDeepLink) => void): () => void {
    this.listeners.push(listener);

    // Return a function to remove the listener
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index > -1) {
        this.listeners.splice(index, 1);
      }
    };
  }

  /**
   * Remove all listeners
   */
  static removeAllListeners(): void {
    this.listeners = [];
  }

  /**
   * Get the initial deep link URL (when app was opened from link)
   */
  static async getInitialURL(): Promise<ParsedDeepLink | null> {
    try {
      const url = await Linking.getInitialURL();
      if (url) {
        return this.parseDeepLink(url);
      }
      return null;
    } catch (error) {
      console.error('Error getting initial URL:', error);
      return null;
    }
  }

  /**
   * Build a deep link URL for the app
   */
  static buildDeepLink(route: DeepLinkRoute, params: DeepLinkParams = {}): string {
    const scheme = 'workermill://';

    switch (route) {
      case 'task':
        return `${scheme}task/${params.taskId}`;

      case 'board':
        return `${scheme}board/${params.boardId}`;

      case 'card':
        return `${scheme}board/${params.boardId}/card/${params.cardId}`;

      case 'auth':
        const queryString = new URLSearchParams({
          ...(params.code && { code: params.code }),
          ...(params.state && { state: params.state }),
        }).toString();
        return `${scheme}auth/callback${queryString ? `?${queryString}` : ''}`;

      default:
        return scheme;
    }
  }

  /**
   * Check if the app can handle a given URL
   */
  static async canOpenURL(url: string): Promise<boolean> {
    try {
      return await Linking.canOpenURL(url);
    } catch (error) {
      console.error('Error checking if URL can be opened:', error);
      return false;
    }
  }

  /**
   * Open an external URL
   */
  static async openURL(url: string): Promise<boolean> {
    try {
      const canOpen = await this.canOpenURL(url);
      if (canOpen) {
        await Linking.openURL(url);
        return true;
      }
      return false;
    } catch (error) {
      console.error('Error opening URL:', error);
      return false;
    }
  }
}

// Export convenience functions
export const parseDeepLink = DeepLinkManager.parseDeepLink;
export const buildDeepLink = DeepLinkManager.buildDeepLink;
export const addDeepLinkListener = DeepLinkManager.addListener;
export const getInitialDeepLink = DeepLinkManager.getInitialURL;