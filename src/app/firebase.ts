import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';
import { firebaseConfig } from '../environments/firebase.config';

export const firebaseApp = initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);

// The local cache keeps the app usable offline; writes sync when back online.
export const db = initializeFirestore(firebaseApp, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  ignoreUndefinedProperties: true,
});
