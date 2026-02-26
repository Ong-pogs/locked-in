import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { AuthStackParamList } from './types';
import { WalletConnectScreen } from '@/screens/auth/WalletConnectScreen';

const Stack = createNativeStackNavigator<AuthStackParamList>();

export function AuthStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="WalletConnect" component={WalletConnectScreen} />
    </Stack.Navigator>
  );
}
