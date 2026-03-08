import { useCallback, useEffect, useRef, useState } from 'react';
import { View, StyleSheet, Animated } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';

// Keep native splash visible until our animated one is painted
SplashScreen.preventAutoHideAsync().catch(() => {});

interface AnimatedSplashProps {
  children: React.ReactNode;
}

export function AnimatedSplash({ children }: AnimatedSplashProps) {
  const [splashDone, setSplashDone] = useState(false);
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const hasHiddenNative = useRef(false);

  // Called once our animated splash View has laid out on screen.
  // At that point it's safe to hide the native splash — no flash.
  const onSplashLayout = useCallback(() => {
    if (hasHiddenNative.current) return;
    hasHiddenNative.current = true;
    SplashScreen.hideAsync().catch(() => {});

    // Hold logo for ~1.2s, then fade out with subtle scale-up
    setTimeout(() => {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 700,
          useNativeDriver: true,
        }),
        Animated.timing(scaleAnim, {
          toValue: 1.2,
          duration: 700,
          useNativeDriver: true,
        }),
      ]).start(() => setSplashDone(true));
    }, 1200);
  }, [fadeAnim, scaleAnim]);

  if (splashDone) return <>{children}</>;

  return (
    <View style={styles.root}>
      {/* App content renders underneath so it's ready when splash fades */}
      <View style={styles.appLayer}>{children}</View>

      {/* Animated splash overlay */}
      <Animated.View
        style={[styles.splash, { opacity: fadeAnim }]}
        pointerEvents="none"
        onLayout={onSplashLayout}
      >
        <Animated.Image
          source={require('../../assets/Lockedin_Logo-removebg-preview.png')}
          style={[styles.logo, { transform: [{ scale: scaleAnim }] }]}
          resizeMode="contain"
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000',
  },
  appLayer: {
    flex: 1,
  },
  splash: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 999,
  },
  logo: {
    width: 160,
    height: 160,
  },
});
