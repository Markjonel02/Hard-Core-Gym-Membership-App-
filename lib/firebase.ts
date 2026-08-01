import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  browserLocalPersistence,
  getAuth,
  initializeAuth,
  type Auth,
  // @ts-expect-error — shipped by firebase/auth for RN but omitted from the public types.
  getReactNativePersistence,
} from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';

/**
 * These EXPO_PUBLIC_* values are compiled into the client bundle. That is expected and safe:
 * a Firebase web config is an identifier, not a credential. Access is enforced by
 * firestore.rules and by the role custom claim — never by hiding this config.
 */
const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

/**
 * Fail loudly at startup rather than at the first sign-in attempt.
 *
 * A placeholder API key is structurally valid, so Google accepts the key and then reports
 * CONFIGURATION_NOT_FOUND — which surfaces in the UI as a generic "something went wrong"
 * and sends you hunting through form code for a bug that is really a missing .env.
 */
const PLACEHOLDER_MARKERS = ['your-', 'YOUR_', 'xxx', '000000000000', 'changeme'];

function looksUnset(value: string | undefined): boolean {
  if (!value) return true;
  return PLACEHOLDER_MARKERS.some((marker) => value.includes(marker));
}

const unsetKeys = Object.entries(firebaseConfig)
  .filter(([, value]) => looksUnset(value))
  .map(([key]) => key);

if (unsetKeys.length > 0) {
  console.error(
    '[firebase] Configuration is missing or still contains placeholders: ' +
      unsetKeys.join(', ') +
      '\n  Sign-in and sign-up will fail until this is fixed.' +
      '\n  Copy the real values from Firebase console -> Project settings -> General -> Your apps -> Web app into .env,' +
      '\n  then restart the dev server (the .env file is only read at startup).'
  );
} else {
  console.log(`[firebase] initialized project "${firebaseConfig.projectId}"`);
}

export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

/**
 * Web can use the standard getAuth (persistence handled by the SDK). React Native has no
 * localStorage, so auth must be initialized once with AsyncStorage or the session is lost
 * on every app restart. initializeAuth throws if called twice, hence the getApps() guard above
 * plus this try/catch for Fast Refresh.
 */
function createAuth(): Auth {
  if (Platform.OS === 'web') {
    const webAuth = getAuth(app);
    void webAuth.setPersistence(browserLocalPersistence);
    return webAuth;
  }
  try {
    return initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage),
    });
  } catch {
    return getAuth(app);
  }
}

export const auth = createAuth();
export const db = getFirestore(app);
export const functions = getFunctions(app);
