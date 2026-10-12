import { Injectable, inject, signal } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { User, browserLocalPersistence, onAuthStateChanged, setPersistence, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { auth } from './firebase';

@Injectable({ providedIn: 'root' })
export class AuthService {
  readonly user = signal<User | null>(null);

  /** Resolves once Firebase has restored (or ruled out) a saved session. */
  readonly ready: Promise<void>;

  constructor() {
    this.ready = new Promise(resolve => {
      onAuthStateChanged(auth, user => {
        this.user.set(user);
        resolve();
      });
    });
  }

  async signIn(email: string, password: string) {
    await setPersistence(auth, browserLocalPersistence);
    await signInWithEmailAndPassword(auth, email.trim(), password);
  }

  signOut() {
    return signOut(auth);
  }
}

// inject() only works before the first await, so grab dependencies up front.
export const authGuard: CanActivateFn = async () => {
  const authService = inject(AuthService);
  const router = inject(Router);
  await authService.ready;
  return authService.user() ? true : router.parseUrl('/login');
};

export const guestGuard: CanActivateFn = async () => {
  const authService = inject(AuthService);
  const router = inject(Router);
  await authService.ready;
  return authService.user() ? router.parseUrl('/home') : true;
};
