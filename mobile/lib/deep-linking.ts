import * as Linking from 'expo-linking';
import { router } from 'expo-router';

// Types
export interface DeepLinkData {
  screen: string;
  params?: Record<string, string>;
}

export interface NotificationData {
  type: 'task_completed' | 'task_failed' | 'blocker' | 'plan_ready';
  taskId: string;
  issueKey?: string;
  summary?: string;
}

// Deep link URL scheme configuration
const DEEP_LINK_SCHEME = 'workermill';

/**
 * Initialize deep linking for the app
 */
export function initializeDeepLinking(): () => void {
  // Handle app opening from deep link when app was closed
  const handleInitialURL = async () => {
    try {
      const url = await Linking.getInitialURL();
      if (url) {
        console.log('App opened with initial URL:', url);
        handleDeepLink(url);
      }
    } catch (error) {
      console.error('Failed to get initial URL:', error);
    }
  };

  // Handle deep links when app is already running
  const subscription = Linking.addEventListener('url', (event) => {
    console.log('Deep link received:', event.url);
    handleDeepLink(event.url);
  });

  // Check for initial URL
  handleInitialURL();

  // Return cleanup function
  return () => {
    subscription?.remove();
  };
}

/**
 * Handle incoming deep link URLs
 */
export function handleDeepLink(url: string): void {
  try {
    const linkData = parseDeepLink(url);
    if (!linkData) {
      console.warn('Invalid deep link format:', url);
      return;
    }

    console.log('Parsed deep link:', linkData);
    navigateToScreen(linkData);
  } catch (error) {
    console.error('Failed to handle deep link:', error);
  }
}

/**
 * Parse deep link URL and extract navigation data
 */
export function parseDeepLink(url: string): DeepLinkData | null {
  try {
    const parsed = Linking.parse(url);

    // Handle auth callback URLs
    if (parsed.path === 'auth/callback') {
      // This is handled by the SSO auth flow, not navigation
      console.log('Auth callback deep link received');
      return null;
    }

    // Handle task detail URLs: workermill://task/123
    if (parsed.path === 'task' && parsed.queryParams?.id) {
      return {
        screen: 'task',
        params: {
          id: String(parsed.queryParams.id),
          tab: parsed.queryParams.tab ? String(parsed.queryParams.tab) : undefined,
        },
      };
    }

    // Handle task URLs with task ID as path: workermill://task/123
    const taskMatch = parsed.path?.match(/^task\/(.+)$/);
    if (taskMatch) {
      return {
        screen: 'task',
        params: {
          id: taskMatch[1],
          tab: parsed.queryParams?.tab ? String(parsed.queryParams.tab) : undefined,
        },
      };
    }

    // Handle board detail URLs: workermill://board/123
    const boardMatch = parsed.path?.match(/^board\/(.+)$/);
    if (boardMatch) {
      return {
        screen: 'board',
        params: {
          id: boardMatch[1],
        },
      };
    }

    // Handle card detail URLs: workermill://board/123/card/456
    const cardMatch = parsed.path?.match(/^board\/(.+)\/card\/(.+)$/);
    if (cardMatch) {
      return {
        screen: 'card',
        params: {
          id: cardMatch[1],
          cardId: cardMatch[2],
        },
      };
    }

    // Handle root/dashboard: workermill:// or workermill://dashboard
    if (!parsed.path || parsed.path === 'dashboard' || parsed.path === '') {
      return {
        screen: 'dashboard',
      };
    }

    // Handle boards list: workermill://boards
    if (parsed.path === 'boards') {
      return {
        screen: 'boards',
      };
    }

    // Handle settings: workermill://settings
    if (parsed.path === 'settings') {
      return {
        screen: 'settings',
      };
    }

    console.warn('Unhandled deep link path:', parsed.path);
    return null;
  } catch (error) {
    console.error('Failed to parse deep link:', error);
    return null;
  }
}

/**
 * Navigate to screen based on deep link data
 */
export function navigateToScreen(linkData: DeepLinkData): void {
  try {
    switch (linkData.screen) {
      case 'task':
        if (linkData.params?.id) {
          const taskPath = `/task/${linkData.params.id}`;
          router.push(taskPath as any);
        }
        break;

      case 'board':
        if (linkData.params?.id) {
          const boardPath = `/board/${linkData.params.id}`;
          router.push(boardPath as any);
        }
        break;

      case 'card':
        if (linkData.params?.id && linkData.params?.cardId) {
          const cardPath = `/board/${linkData.params.id}/card/${linkData.params.cardId}`;
          router.push(cardPath as any);
        }
        break;

      case 'dashboard':
        router.push('/(tabs)/' as any);
        break;

      case 'boards':
        router.push('/(tabs)/boards' as any);
        break;

      case 'settings':
        router.push('/(tabs)/settings' as any);
        break;

      default:
        console.warn('Unknown screen for navigation:', linkData.screen);
        // Fallback to dashboard
        router.push('/(tabs)/' as any);
    }
  } catch (error) {
    console.error('Failed to navigate to screen:', error);
  }
}

/**
 * Handle push notification tap - extract data and navigate
 */
export function handleNotificationTap(notificationData: Record<string, any>): void {
  try {
    console.log('Handling notification tap:', notificationData);

    // Extract task ID from notification data
    const taskId = notificationData.taskId || notificationData.task_id;
    if (!taskId) {
      console.warn('No task ID in notification data');
      return;
    }

    // Determine which tab to open based on notification type
    let targetTab: string | undefined;
    const notificationType = notificationData.type;

    switch (notificationType) {
      case 'blocker':
        // Open coordination tab for blocker notifications
        targetTab = 'coordination';
        break;
      case 'plan_ready':
        // Open main tab for plan approval
        targetTab = 'logs';
        break;
      default:
        // For task_completed, task_failed - open main/logs tab
        targetTab = 'logs';
    }

    // Navigate to task detail screen
    const taskPath = `/task/${taskId}`;
    router.push(taskPath as any);

    console.log(`Navigated to task ${taskId} from notification`);
  } catch (error) {
    console.error('Failed to handle notification tap:', error);
  }
}

/**
 * Generate deep link URL for sharing
 */
export function generateDeepLink(screen: string, params?: Record<string, string>): string {
  try {
    switch (screen) {
      case 'task':
        if (params?.id) {
          return `${DEEP_LINK_SCHEME}://task/${params.id}`;
        }
        break;

      case 'board':
        if (params?.id) {
          return `${DEEP_LINK_SCHEME}://board/${params.id}`;
        }
        break;

      case 'card':
        if (params?.id && params?.cardId) {
          return `${DEEP_LINK_SCHEME}://board/${params.id}/card/${params.cardId}`;
        }
        break;

      case 'dashboard':
        return `${DEEP_LINK_SCHEME}://dashboard`;

      case 'boards':
        return `${DEEP_LINK_SCHEME}://boards`;

      case 'settings':
        return `${DEEP_LINK_SCHEME}://settings`;
    }

    // Fallback to dashboard
    return `${DEEP_LINK_SCHEME}://dashboard`;
  } catch (error) {
    console.error('Failed to generate deep link:', error);
    return `${DEEP_LINK_SCHEME}://dashboard`;
  }
}

/**
 * Check if a URL is a valid WorkerMill deep link
 */
export function isValidDeepLink(url: string): boolean {
  try {
    const parsed = Linking.parse(url);
    return parsed.scheme === DEEP_LINK_SCHEME;
  } catch {
    return false;
  }
}

/**
 * Get the current URL that can be used to deep link to this screen
 */
export function getCurrentDeepLink(): string {
  // This would typically use router state to determine current screen
  // For now, return dashboard link as fallback
  return generateDeepLink('dashboard');
}

/**
 * Test deep link functionality (for debugging)
 */
export function testDeepLink(url: string): DeepLinkData | null {
  console.log('Testing deep link:', url);
  const result = parseDeepLink(url);
  console.log('Parse result:', result);
  return result;
}