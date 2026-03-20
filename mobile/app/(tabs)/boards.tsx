import React from 'react';
import { View, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function BoardsScreen() {
  return (
    <SafeAreaView className="flex-1 bg-slate-50 dark:bg-slate-950">
      <View className="flex-1 justify-center items-center">
        <Text className="text-slate-600 dark:text-slate-400 text-lg">
          Boards tab coming soon...
        </Text>
      </View>
    </SafeAreaView>
  );
}