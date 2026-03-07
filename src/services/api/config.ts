import Constants from 'expo-constants';
import { Platform } from 'react-native';

const rawBaseUrl = process.env.EXPO_PUBLIC_LESSON_API_BASE_URL ?? '';
const envBaseUrl = rawBaseUrl.replace(/\/$/, '');

function unique(values: string[]): string[] {
  return values.filter((value, index, array) => array.indexOf(value) === index);
}

function getExpoHostUri(): string | null {
  const fromExpoConfig = (Constants.expoConfig as { hostUri?: string } | null)
    ?.hostUri;

  const fromManifest2 = (
    Constants as unknown as {
      manifest2?: { extra?: { expoClient?: { hostUri?: string } } };
    }
  ).manifest2?.extra?.expoClient?.hostUri;

  return fromExpoConfig ?? fromManifest2 ?? null;
}

function getDiscoveredFallbackUrls(): string[] {
  // Keep remote API opt-in behavior: only discover fallbacks when env base URL is set.
  if (!__DEV__ || !envBaseUrl) return [];

  const fallbackUrls: string[] = [];
  const hostUri = getExpoHostUri();

  if (hostUri) {
    const host = hostUri.replace(/^\w+:\/\//, '').split(':')[0];
    if (host) {
      fallbackUrls.push(`http://${host}:3001`);
    }
  }

  if (Platform.OS === 'android') {
    // Physical Android devices can use localhost when adb reverse is active.
    fallbackUrls.push('http://127.0.0.1:3001', 'http://localhost:3001');

    // Android emulator host routes.
    fallbackUrls.push('http://10.0.2.2:3001', 'http://10.0.3.2:3001');
  }

  return fallbackUrls;
}

const LESSON_API_BASE_URLS = unique(
  [envBaseUrl, ...getDiscoveredFallbackUrls()].filter(Boolean),
);

let activeBaseUrl = LESSON_API_BASE_URLS[0] ?? '';

export const LESSON_API_BASE_URL = activeBaseUrl;
export const LESSON_API_TIMEOUT_MS = 15_000;

export function hasRemoteLessonApi(): boolean {
  return LESSON_API_BASE_URLS.length > 0;
}

export function getLessonApiBaseUrl(): string {
  return activeBaseUrl;
}

export function getLessonApiFallbackBaseUrls(currentBaseUrl: string): string[] {
  return LESSON_API_BASE_URLS.filter((url) => url !== currentBaseUrl);
}

export function setLessonApiBaseUrl(nextBaseUrl: string): void {
  if (!nextBaseUrl) return;
  if (!LESSON_API_BASE_URLS.includes(nextBaseUrl)) return;
  activeBaseUrl = nextBaseUrl;
}

if (__DEV__) {
  const mode = hasRemoteLessonApi() ? 'remote' : 'mock';
  console.info(
    `[lesson-api] mode=${mode} baseUrl=${activeBaseUrl || '(empty)'} candidates=${LESSON_API_BASE_URLS.join(',') || '(none)'}`,
  );
}
