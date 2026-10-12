import { Injectable, computed, effect, inject, signal } from '@angular/core';
import {
  Unsubscribe,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { AuthService } from './auth.service';
import { db } from './firebase';

export interface Expense {
  id: string;
  amount: number;
  category: string;
  note: string;
  date: string; // YYYY-MM-DD
  /** Set when this entry is money lent to someone rather than spent. */
  lentTo?: string;
  /** How much of a loan has been paid back so far. */
  returned?: number;
}

export const LENT_CATEGORY: Category = { name: 'Lent', icon: 'people-outline', color: '#14b8a6' };

/** What an entry actually costs you: loans count only for the part not yet paid back. */
export function effectiveAmount(e: Expense): number {
  return e.lentTo ? Math.max(0, e.amount - (e.returned ?? 0)) : e.amount;
}

export interface Category {
  name: string;
  icon: string;
  color: string;
}

export const CATEGORIES: Category[] = [
  { name: 'Food', icon: 'fast-food-outline', color: '#f97316' },
  { name: 'Groceries', icon: 'cart-outline', color: '#22c55e' },
  { name: 'Transport', icon: 'car-outline', color: '#3b82f6' },
  { name: 'Shopping', icon: 'bag-handle-outline', color: '#ec4899' },
  { name: 'Bills', icon: 'receipt-outline', color: '#eab308' },
  { name: 'Health', icon: 'medkit-outline', color: '#ef4444' },
  { name: 'Entertainment', icon: 'film-outline', color: '#8b5cf6' },
  { name: 'Travel', icon: 'airplane-outline', color: '#06b6d4' },
  { name: 'Other', icon: 'ellipsis-horizontal-circle-outline', color: '#64748b' },
];

/** Where expenses lived before cloud sync; uploaded once on first sign-in. */
const LEGACY_EXPENSES_KEY = 'et.expenses';
const CURRENCY_KEY = 'et.currency';
const BADGE_KEY = 'et.badge';

function currentMonthPrefix(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

@Injectable({ providedIn: 'root' })
export class ExpenseService {
  private authService = inject(AuthService);
  private unsubscribers: Unsubscribe[] = [];

  readonly expenses = signal<Expense[]>([]);
  /** False until the first snapshot arrives for the signed-in user. */
  readonly loaded = signal(false);
  readonly currency = signal<string>(localStorage.getItem(CURRENCY_KEY) || 'INR');
  readonly badgeEnabled = signal(localStorage.getItem(BADGE_KEY) === '1');
  readonly badgeSupported = 'setAppBadge' in navigator;

  readonly sorted = computed(() =>
    [...this.expenses()].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id)),
  );

  /** Loans (from any month) that haven't been fully paid back, oldest first. */
  readonly pendingLoans = computed(() =>
    this.sorted().filter(e => e.lentTo && effectiveAmount(e) > 0).reverse(),
  );

  readonly totalOwed = computed(() => this.pendingLoans().reduce((sum, e) => sum + effectiveAmount(e), 0));

  constructor() {
    // Follow the signed-in user's data in Firestore: users/{uid}/expenses/{id}.
    effect(() => {
      const user = this.authService.user();
      this.unsubscribers.forEach(unsub => unsub());
      this.unsubscribers = [];
      this.expenses.set([]);
      this.loaded.set(false);
      if (!user) return;

      this.unsubscribers.push(
        onSnapshot(this.expensesCol(), snap => {
          this.expenses.set(snap.docs.map(d => ({ ...(d.data() as Expense), id: d.id })));
          this.loaded.set(true);
        }),
        onSnapshot(this.userDoc(), snap => {
          const currency = snap.data()?.['currency'];
          if (currency) {
            this.currency.set(currency);
            localStorage.setItem(CURRENCY_KEY, currency);
          }
        }),
      );
      this.uploadLegacyExpenses();
    });

    // Keep the app-icon badge in sync with this month's spending.
    effect(() => {
      this.expenses();
      this.badgeEnabled();
      this.updateBadge();
    });
    // The month may have rolled over while the app was in the background.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.updateBadge();
    });
  }

  /** Turns the icon badge on or off; returns false if the browser can't show it. */
  async setBadgeEnabled(on: boolean): Promise<boolean> {
    if (on) {
      if (!this.badgeSupported) return false;
      // iOS only shows badges for web apps that are allowed to send notifications.
      if ('Notification' in window && Notification.permission !== 'granted') {
        if ((await Notification.requestPermission()) !== 'granted') return false;
      }
    }
    this.badgeEnabled.set(on);
    localStorage.setItem(BADGE_KEY, on ? '1' : '0');
    return true;
  }

  private updateBadge() {
    if (!this.badgeSupported) return;
    const prefix = currentMonthPrefix();
    const total = Math.round(
      this.expenses().filter(e => e.date.startsWith(prefix)).reduce((sum, e) => sum + effectiveAmount(e), 0),
    );
    const nav = navigator as Navigator & { setAppBadge(n?: number): Promise<void>; clearAppBadge(): Promise<void> };
    (this.badgeEnabled() && total > 0 ? nav.setAppBadge(total) : nav.clearAppBadge()).catch(() => {});
  }

  category(name: string): Category {
    if (name === LENT_CATEGORY.name) return LENT_CATEGORY;
    return CATEGORIES.find(c => c.name === name) ?? CATEGORIES[CATEGORIES.length - 1];
  }

  formatMoney(value: number): string {
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: this.currency() }).format(value);
    } catch {
      return value.toFixed(2);
    }
  }

  save(expense: Omit<Expense, 'id'> & { id?: string }) {
    const item: Expense = { ...expense, id: expense.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` };
    this.write(setDoc(doc(this.expensesCol(), item.id), item));
  }

  /** Records money paid back on a loan; capped at the amount lent. */
  recordReturn(id: string, amount: number) {
    const loan = this.expenses().find(e => e.id === id);
    if (!loan) return;
    const returned = Math.min(loan.amount, Math.round(((loan.returned ?? 0) + amount) * 100) / 100);
    this.write(updateDoc(doc(this.expensesCol(), id), { returned }));
  }

  remove(id: string) {
    this.write(deleteDoc(doc(this.expensesCol(), id)));
  }

  setCurrency(code: string) {
    this.currency.set(code);
    localStorage.setItem(CURRENCY_KEY, code);
    this.write(setDoc(this.userDoc(), { currency: code }, { merge: true }));
  }

  toCsv(): string {
    const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const rows = this.sorted().map(e =>
      [e.date, esc(e.category), e.amount.toFixed(2), esc(e.note), esc(e.lentTo ?? ''), (e.returned ?? 0).toFixed(2), effectiveAmount(e).toFixed(2)].join(','),
    );
    return ['Date,Category,Amount,Note,Lent to,Returned,Net amount', ...rows].join('\n');
  }

  toJson(): string {
    return JSON.stringify({ version: 1, currency: this.currency(), expenses: this.expenses() }, null, 2);
  }

  /** Merges a JSON backup into existing data; returns the number of expenses imported. */
  importJson(text: string): number {
    const data = JSON.parse(text);
    const incoming: Expense[] = Array.isArray(data) ? data : data.expenses;
    if (!Array.isArray(incoming)) throw new Error('Invalid backup file');
    const valid = incoming.filter(e => e && e.id && typeof e.amount === 'number' && e.date);
    this.writeAll(valid.map(e => ({ ...e, note: e.note ?? '', category: e.category || 'Other' })));
    if (data.currency) this.setCurrency(data.currency);
    return valid.length;
  }

  private expensesCol() {
    return collection(db, 'users', this.uid(), 'expenses');
  }

  private userDoc() {
    return doc(db, 'users', this.uid());
  }

  private uid(): string {
    const user = this.authService.user();
    if (!user) throw new Error('Not signed in');
    return user.uid;
  }

  /** Saves expenses in batches (Firestore allows up to 500 writes per batch). */
  private writeAll(items: Expense[]) {
    for (let i = 0; i < items.length; i += 400) {
      const batch = writeBatch(db);
      items.slice(i, i + 400).forEach(e => batch.set(doc(this.expensesCol(), e.id), e));
      this.write(batch.commit());
    }
  }

  /**
   * Writes apply to the local cache (and the UI) immediately; the promise only settles once the
   * server confirms, which may be much later when offline, so it isn't awaited.
   */
  private write(pending: Promise<unknown>) {
    pending.catch(err => console.error('Failed to save to Firestore', err));
  }

  private uploadLegacyExpenses() {
    let legacy: Expense[] = [];
    try {
      legacy = JSON.parse(localStorage.getItem(LEGACY_EXPENSES_KEY) || '[]');
    } catch {}
    if (legacy.length) this.writeAll(legacy);
    localStorage.removeItem(LEGACY_EXPENSES_KEY);
  }
}
