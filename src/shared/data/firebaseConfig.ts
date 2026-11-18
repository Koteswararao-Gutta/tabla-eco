// The Tabla Firebase project. These values identify the project; they are not secrets.
// Access is controlled by the Firestore rules (signed-in devices only).
import type { FirebaseOptions } from 'firebase/app';

export const firebaseConfig: FirebaseOptions = {
  apiKey: 'AIzaSyCqoEEGS5HNeATd7Z-XAMpYaCgGnJjrlHQ',
  authDomain: 'tabla-eco-2e94b.firebaseapp.com',
  projectId: 'tabla-eco-2e94b',
  storageBucket: 'tabla-eco-2e94b.firebasestorage.app',
  messagingSenderId: '521266629394',
  appId: '1:521266629394:web:87761a8a1b62f79cf5c1cb',
};

/** Public "Web Push certificate" key (Firebase console > Project settings > Cloud Messaging). Not a secret.
 *  Empty means phone alerts are not set up yet, and the app doesn't offer them. */
export const vapidKey = '';
