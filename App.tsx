import { StatusBar } from 'expo-status-bar';
import React, { useState } from 'react';
import { Modal, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import SettingsScreen from './src/screens/SettingsScreen';
import TimetableScreen from './src/screens/TimetableScreen';
import { SettingsProvider, useSettings } from './src/store/settings';

function Root() {
  const { theme, ready } = useSettings();
  const [settingsOpen, setSettingsOpen] = useState(false);

  if (!ready) return <View style={{ flex: 1, backgroundColor: theme.bg }} />;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }} edges={['top', 'bottom']}>
      <StatusBar style={theme.dark ? 'light' : 'dark'} />
      <TimetableScreen onOpenSettings={() => setSettingsOpen(true)} />
      <Modal
        visible={settingsOpen}
        animationType="slide"
        onRequestClose={() => setSettingsOpen(false)}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }} edges={['top', 'bottom']}>
          <SettingsScreen onClose={() => setSettingsOpen(false)} />
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <SettingsProvider>
        <Root />
      </SettingsProvider>
    </SafeAreaProvider>
  );
}
