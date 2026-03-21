export const getPermissionsAsync = jest.fn();
export const requestPermissionsAsync = jest.fn();
export const getExpoPushTokenAsync = jest.fn();
export const setNotificationHandler = jest.fn();
export const addNotificationReceivedListener = jest.fn();
export const addNotificationResponseReceivedListener = jest.fn();
export const removeNotificationSubscription = jest.fn();
export const removeAllNotificationListeners = jest.fn();
export const openSettingsAsync = jest.fn();

export default {
  getPermissionsAsync,
  requestPermissionsAsync,
  getExpoPushTokenAsync,
  setNotificationHandler,
  addNotificationReceivedListener,
  addNotificationResponseReceivedListener,
  removeNotificationSubscription,
  removeAllNotificationListeners,
  openSettingsAsync,
};