import { StatusBar } from 'expo-status-bar';
import React, { useState } from 'react';
import { Modal, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import SchoolScreen from './src/screens/SchoolScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import TimetableScreen from './src/screens/TimetableScreen';
import { AccountProvider } from './src/store/account';
import { SchoolDataProvider } from './src/store/schoolData';
import { SettingsProvider, useSettings } from './src/store/settings';

function Root() {
  const { theme, ready } = useSettings();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [schoolOpen, setSchoolOpen] = useState(false);
  const [jumpTo, setJumpTo] = useState<string | null>(null);

  if (!ready) return <View style={{ flex: 1, backgroundColor: theme.bg }} />;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }} edges={['top', 'bottom']}>
      <StatusBar style={theme.dark ? 'light' : 'dark'} />
      <TimetableScreen
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenSchool={() => setSchoolOpen(true)}
        jumpTo={jumpTo}
        onJumped={() => setJumpTo(null)}
      />
      <Modal
        visible={settingsOpen}
        animationType="slide"
        onRequestClose={() => setSettingsOpen(false)}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }} edges={['top', 'bottom']}>
          <SettingsScreen onClose={() => setSettingsOpen(false)} />
        </SafeAreaView>
      </Modal>
      <Modal
        visible={schoolOpen}
        animationType="slide"
        onRequestClose={() => setSchoolOpen(false)}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }} edges={['top', 'bottom']}>
          <SchoolScreen
            onClose={() => setSchoolOpen(false)}
            onOpenDate={(d) => {
              setJumpTo(d);
              setSchoolOpen(false);
            }}
          />
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <SettingsProvider>
        <AccountProvider>
          <SchoolDataProvider>
            <Root />
          </SchoolDataProvider>
        </AccountProvider>
      </SettingsProvider>
    </SafeAreaProvider>
  );
}
