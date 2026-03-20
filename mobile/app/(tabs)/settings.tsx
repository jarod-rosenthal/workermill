import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  Switch,
  TouchableOpacity,
  Alert,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@/stores/auth-store';
import { useNotificationsStore, type NotificationPreferences } from '@/stores/notifications-store';
import { Spinner } from '@/components/ui/Spinner';
import { ErrorState } from '@/components/ui/ErrorState';
import { Button } from '@/components/ui/Button';
import { BiometricAuth } from '@/lib/biometric';
import { registerPushToken, unregisterPushToken } from '@/lib/push';
import { apiClient } from '@/lib/api-client';

interface SettingsSectionProps {
  title: string;
  children: React.ReactNode;
}

function SettingsSection({ title, children }: SettingsSectionProps) {
  return (
    <View className="mb-6">
      <Text className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-3 px-4 uppercase tracking-wider">
        {title}
      </Text>
      <View className="bg-white dark:bg-slate-850 border border-slate-200 dark:border-slate-700 rounded-lg mx-4">
        {children}
      </View>
    </View>
  );
}

interface SettingsRowProps {
  title: string;
  subtitle?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  rightElement?: React.ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  isLast?: boolean;
}

function SettingsRow({
  title,
  subtitle,
  icon,
  rightElement,
  onPress,
  disabled = false,
  isLast = false,
}: SettingsRowProps) {
  const isButton = onPress !== undefined;

  const content = (
    <View
      className={`
        flex-row items-center justify-between p-4
        ${!isLast ? 'border-b border-slate-200 dark:border-slate-700' : ''}
        ${disabled ? 'opacity-50' : ''}
      `}
      style={{ minHeight: 44 }} // Ensure minimum touch target
    >
      <View className="flex-row items-center flex-1">
        {icon && (
          <Ionicons
            name={icon}
            size={20}
            color="#64748b"
            className="mr-3"
          />
        )}
        <View className="flex-1">
          <Text className="text-slate-900 dark:text-slate-100 text-base font-medium">
            {title}
          </Text>
          {subtitle && (
            <Text className="text-slate-500 dark:text-slate-400 text-sm mt-1">
              {subtitle}
            </Text>
          )}
        </View>
      </View>
      {rightElement}
      {isButton && (
        <Ionicons
          name="chevron-forward"
          size={16}
          color="#94a3b8"
          className="ml-2"
        />
      )}
    </View>
  );

  if (isButton) {
    return (
      <TouchableOpacity
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={title}
      >
        {content}
      </TouchableOpacity>
    );
  }

  return content;
}

export default function SettingsScreen() {
  const [isLoading, setIsLoading] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [switchingOrg, setSwitchingOrg] = useState(false);

  const {
    user,
    isBiometricEnabled,
    enableBiometric,
    disableBiometric,
    signOut,
    refreshUserProfile,
  } = useAuthStore();

  const {
    preferences,
    isLoading: preferencesLoading,
    error: preferencesError,
    updatePreferences,
    loadPreferences,
  } = useNotificationsStore();

  // Check biometric availability
  useEffect(() => {
    const checkBiometric = async () => {
      const capabilities = await BiometricAuth.checkAvailability();
      setBiometricAvailable(capabilities.isAvailable);
    };

    checkBiometric();
  }, []);

  // Load settings on mount
  useEffect(() => {
    if (user) {
      loadPreferences().catch(console.error);
    }
  }, [user, loadPreferences]);

  // Handle biometric toggle
  const handleBiometricToggle = useCallback(async (enabled: boolean) => {
    if (!biometricAvailable) {
      Alert.alert(
        'Biometric Authentication Unavailable',
        `${Platform.OS === 'ios' ? 'Face ID/Touch ID' : 'Fingerprint'} is not available on this device.`,
        [{ text: 'OK' }]
      );
      return;
    }

    try {
      if (enabled) {
        // Test biometric authentication before enabling
        const result = await BiometricAuth.authenticate();
        if (result.success) {
          await enableBiometric();
          Alert.alert(
            'Biometric Authentication Enabled',
            `${Platform.OS === 'ios' ? 'Face ID/Touch ID' : 'Fingerprint'} unlock has been enabled.`,
            [{ text: 'OK' }]
          );
        } else {
          Alert.alert(
            'Authentication Failed',
            result.error || 'Could not authenticate with biometrics.',
            [{ text: 'OK' }]
          );
        }
      } else {
        await disableBiometric();
        Alert.alert(
          'Biometric Authentication Disabled',
          'You will need to sign in with email and password next time.',
          [{ text: 'OK' }]
        );
      }
    } catch (error) {
      console.error('Biometric toggle failed:', error);
      Alert.alert(
        'Error',
        'Failed to update biometric settings. Please try again.',
        [{ text: 'OK' }]
      );
    }
  }, [biometricAvailable, enableBiometric, disableBiometric]);

  // Handle notification preference toggle
  const handleNotificationToggle = useCallback(async (
    category: keyof NotificationPreferences,
    enabled: boolean
  ) => {
    if (!preferences) return;

    try {
      await updatePreferences({ [category]: enabled });
    } catch (error) {
      console.error('Failed to update notification preference:', error);
      Alert.alert(
        'Update Failed',
        'Failed to update notification preference. Please try again.',
        [{ text: 'OK' }]
      );
    }
  }, [preferences, updatePreferences]);

  // Handle sign out
  const handleSignOut = useCallback(() => {
    Alert.alert(
      'Sign Out',
      'Are you sure you want to sign out?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: async () => {
            setIsLoading(true);
            try {
              // Unregister push token before signing out
              await unregisterPushToken();
              await signOut();
            } catch (error) {
              console.error('Sign out failed:', error);
              // Continue with sign out even if push unregister fails
              await signOut();
            } finally {
              setIsLoading(false);
            }
          },
        },
      ]
    );
  }, [signOut]);

  // Handle organization switch
  const handleOrgSwitch = useCallback(() => {
    Alert.alert(
      'Switch Organization',
      'Organization switching will be available in a future update.',
      [{ text: 'OK' }]
    );
  }, []);

  // Handle refresh
  const handleRefresh = useCallback(async () => {
    setIsLoading(true);
    try {
      await Promise.all([
        refreshUserProfile(),
        loadPreferences(),
      ]);
    } catch (error) {
      console.error('Settings refresh failed:', error);
    } finally {
      setIsLoading(false);
    }
  }, [refreshUserProfile, loadPreferences]);

  if (!user && !isLoading) {
    return (
      <SafeAreaView className="flex-1 bg-slate-50 dark:bg-slate-950">
        <View className="flex-1 justify-center items-center px-6">
          <ErrorState
            message="Could not load settings"
            onRetry={handleRefresh}
          />
        </View>
      </SafeAreaView>
    );
  }

  if (isLoading || !user) {
    return (
      <SafeAreaView className="flex-1 bg-slate-50 dark:bg-slate-950">
        <View className="flex-1 justify-center items-center">
          <Spinner />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-slate-50 dark:bg-slate-950">
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View className="px-4 py-6">
          <Text className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            Settings
          </Text>
        </View>

        {/* Profile Section */}
        <SettingsSection title="Profile">
          <SettingsRow
            title={user.name}
            subtitle={user.email}
            icon="person-outline"
            isLast
          />
        </SettingsSection>

        {/* Organization Section */}
        <SettingsSection title="Organization">
          <SettingsRow
            title={user.current_organization?.name || 'Unknown Organization'}
            subtitle={user.current_organization?.plan ? `${user.current_organization.plan} plan` : undefined}
            icon="business-outline"
          />
          <SettingsRow
            title="Switch Organization"
            icon="swap-horizontal-outline"
            onPress={handleOrgSwitch}
            disabled={switchingOrg}
            isLast
          />
        </SettingsSection>

        {/* Notifications Section */}
        <SettingsSection title="Notifications">
          <SettingsRow
            title="Task Completions"
            subtitle="Notify when tasks complete successfully"
            icon="checkmark-circle-outline"
            rightElement={
              <Switch
                value={preferences?.push_completions ?? true}
                onValueChange={(value) => handleNotificationToggle('push_completions', value)}
                trackColor={{ false: '#e2e8f0', true: '#c7d2fe' }}
                thumbColor={preferences?.push_completions ? '#6366f1' : '#f1f5f9'}
                disabled={preferencesLoading}
              />
            }
          />
          <SettingsRow
            title="Task Failures"
            subtitle="Notify when tasks fail or encounter errors"
            icon="alert-circle-outline"
            rightElement={
              <Switch
                value={preferences?.push_failures ?? true}
                onValueChange={(value) => handleNotificationToggle('push_failures', value)}
                trackColor={{ false: '#e2e8f0', true: '#c7d2fe' }}
                thumbColor={preferences?.push_failures ? '#6366f1' : '#f1f5f9'}
                disabled={preferencesLoading}
              />
            }
          />
          <SettingsRow
            title="Blocker Escalations"
            subtitle="Notify when tasks are blocked and need attention"
            icon="stop-circle-outline"
            rightElement={
              <Switch
                value={preferences?.push_blockers ?? true}
                onValueChange={(value) => handleNotificationToggle('push_blockers', value)}
                trackColor={{ false: '#e2e8f0', true: '#c7d2fe' }}
                thumbColor={preferences?.push_blockers ? '#6366f1' : '#f1f5f9'}
                disabled={preferencesLoading}
              />
            }
          />
          <SettingsRow
            title="Plan Approvals"
            subtitle="Notify when plans are ready for review"
            icon="document-text-outline"
            rightElement={
              <Switch
                value={preferences?.push_plan_approvals ?? true}
                onValueChange={(value) => handleNotificationToggle('push_plan_approvals', value)}
                trackColor={{ false: '#e2e8f0', true: '#c7d2fe' }}
                thumbColor={preferences?.push_plan_approvals ? '#6366f1' : '#f1f5f9'}
                disabled={preferencesLoading}
              />
            }
            isLast
          />
        </SettingsSection>

        {/* Security Section */}
        <SettingsSection title="Security">
          <SettingsRow
            title="Biometric Unlock"
            subtitle={
              biometricAvailable
                ? `Use ${Platform.OS === 'ios' ? 'Face ID/Touch ID' : 'fingerprint'} to unlock the app`
                : 'Not available on this device'
            }
            icon="finger-print-outline"
            rightElement={
              <Switch
                value={isBiometricEnabled}
                onValueChange={handleBiometricToggle}
                trackColor={{ false: '#e2e8f0', true: '#c7d2fe' }}
                thumbColor={isBiometricEnabled ? '#6366f1' : '#f1f5f9'}
                disabled={!biometricAvailable}
              />
            }
            isLast
          />
        </SettingsSection>

        {/* App Section */}
        <SettingsSection title="App">
          <SettingsRow
            title="Version"
            subtitle="1.0.0"
            icon="information-circle-outline"
            isLast
          />
        </SettingsSection>

        {/* Sign Out */}
        <View className="mx-4 mb-8">
          <Button
            variant="destructive"
            onPress={handleSignOut}
            disabled={isLoading}
          >
            Sign Out
          </Button>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}