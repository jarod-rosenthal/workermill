import React from 'react';
import { Modal as RNModal, View, TouchableOpacity, Text, TouchableWithoutFeedback } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

interface ModalProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  className?: string;
}

export function Modal({ visible, onClose, title, children, className }: ModalProps) {
  return (
    <RNModal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      accessibilityViewIsModal={true}
    >
      <View className="flex-1 bg-black/50 justify-end">
        <TouchableWithoutFeedback onPress={onClose}>
          <View className="flex-1" />
        </TouchableWithoutFeedback>

        <View
          className={`
            bg-white dark:bg-slate-850
            rounded-t-3xl p-6 max-h-[90%]
            ${className || ''}
          `}
        >
          {title && (
            <View className="flex-row items-center justify-between mb-4">
              <Text className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                {title}
              </Text>
              <TouchableOpacity
                onPress={onClose}
                className="p-2 min-h-[44] min-w-[44] justify-center items-center"
                accessibilityRole="button"
                accessibilityLabel="Close modal"
              >
                <MaterialIcons
                  name="close"
                  size={24}
                  color="#64748b"
                  accessibilityHidden={true}
                />
              </TouchableOpacity>
            </View>
          )}

          {children}
        </View>
      </View>
    </RNModal>
  );
}