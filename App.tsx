import './global.css';

import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppNavigator } from '@/navigation';
import { DungeonProvider } from '@/components/DungeonProvider';

const theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: '#0a0a0a',
    card: '#111111',
    border: '#222222',
    primary: '#a855f7',
  },
};

export default function App() {
  return (
    <SafeAreaProvider>
      <NavigationContainer theme={theme}>
        <DungeonProvider>
          <AppNavigator />
        </DungeonProvider>
        <StatusBar style="light" />
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
