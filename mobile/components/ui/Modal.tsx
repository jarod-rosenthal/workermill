import React from 'react';
import { Modal as RNModal, View, TouchableOpacity, Text, Dimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface ModalProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}

export function Modal({ visible, onClose, title, children }: ModalProps) {
  const screenHeight = Dimensions.get('window').height;

  return (
    <RNModal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View className="flex-1 bg-black/50 justify-end">
        <View
          className="bg-white dark:bg-slate-900 rounded-t-2xl"
          style={{ maxHeight: screenHeight * 0.9 }}
        >
          {/* Header */}
          <View className="flex-row items-center justify-between p-4 border-b border-slate-200 dark:border-slate-700">
            {title ? (
              <Text className="text-lg font-semibold text-slate-900 dark:text-white flex-1">
                {title}
              </Text>
            ) : (
              <View className="flex-1" />
            )}
            <TouchableOpacity
              onPress={onClose}
              className="ml-4"
              style={{ minHeight: 44, minWidth: 44 }}
              accessibilityRole="button"
              accessibilityLabel="Close modal"
            >
              <Ionicons name="close" size={24} className="text-slate-500 dark:text-slate-400" />
            </TouchableOpacity>
          </View>

          {/* Content */}
          <View className="p-4">
            {children}
          </View>
        </View>
      </View>
    </RNModal>
  );
}