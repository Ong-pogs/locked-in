import { useState } from 'react';
import { View, Text, Pressable, Alert, Linking, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useUserStore } from '@/stores';
import { connectWallet } from '@/services/solana';

export function WalletConnectScreen() {
  const setWallet = useUserStore((s) => s.setWallet);
  const [connecting, setConnecting] = useState(false);

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const session = await connectWallet();
      setWallet(session.publicKey, session.authToken);
    } catch (error: any) {
      const code = error?.code;
      if (code === 'ERROR_WALLET_NOT_FOUND') {
        Alert.alert(
          'No Wallet Found',
          'Install a Solana wallet like Phantom to continue.',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Get Phantom',
              onPress: () => Linking.openURL('https://phantom.app/download'),
            },
          ],
        );
      } else if (code === 'ERROR_AUTHORIZATION_FAILED') {
        // User rejected — do nothing, they can try again
      } else {
        Alert.alert('Connection Failed', 'Something went wrong. Please try again.');
        console.warn('Wallet connect error:', error);
      }
    } finally {
      setConnecting(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-neutral-950">
      <View className="flex-1 items-center justify-center px-8">
        <Text className="text-4xl font-bold text-white">Locked In</Text>
        <Text className="mt-3 text-center text-base text-neutral-400">
          Lock your funds. Light the flame. Learn or burn.
        </Text>

        <Pressable
          className="mt-12 w-full rounded-xl bg-purple-600 px-6 py-4 active:bg-purple-700"
          onPress={handleConnect}
          disabled={connecting}
        >
          {connecting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text className="text-center text-lg font-semibold text-white">
              Connect Wallet
            </Text>
          )}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
