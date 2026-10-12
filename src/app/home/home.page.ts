import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ActionSheetController, AlertController, ModalController, ToastController } from '@ionic/angular/lazy';
import { Expense, ExpenseService, effectiveAmount } from '../expense.service';
import { ExpenseFormComponent } from '../expense-form/expense-form.component';
import { AuthService } from '../auth.service';

interface DayGroup {
  date: string;
  total: number;
  items: Expense[];
}

const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD', 'AUD', 'CAD', 'JPY'];

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
  standalone: false,
})
export class HomePage {
  readonly service = inject(ExpenseService);
  readonly effective = effectiveAmount;
  private modalCtrl = inject(ModalController);
  private actionSheet = inject(ActionSheetController);
  private alertCtrl = inject(AlertController);
  private toastCtrl = inject(ToastController);
  private authService = inject(AuthService);
  private router = inject(Router);

  /** First day of the month being viewed. */
  readonly month = signal(new Date(new Date().getFullYear(), new Date().getMonth(), 1));

  readonly monthLabel = computed(() =>
    this.month().toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
  );

  readonly monthExpenses = computed(() => {
    const m = this.month();
    const prefix = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`;
    return this.service.sorted().filter(e => e.date.startsWith(prefix));
  });

  readonly total = computed(() => this.monthExpenses().reduce((sum, e) => sum + effectiveAmount(e), 0));

  readonly byCategory = computed(() => {
    const totals = new Map<string, number>();
    this.monthExpenses().forEach(e => totals.set(e.category, (totals.get(e.category) ?? 0) + effectiveAmount(e)));
    const total = this.total() || 1;
    return [...totals.entries()]
      .filter(([, amount]) => amount > 0)
      .map(([name, amount]) => ({ ...this.service.category(name), amount, pct: (amount / total) * 100 }))
      .sort((a, b) => b.amount - a.amount);
  });

  readonly days = computed<DayGroup[]>(() => {
    const groups: DayGroup[] = [];
    for (const e of this.monthExpenses()) {
      let g = groups[groups.length - 1];
      if (!g || g.date !== e.date) {
        g = { date: e.date, total: 0, items: [] };
        groups.push(g);
      }
      g.items.push(e);
      g.total += effectiveAmount(e);
    }
    return groups;
  });

  readonly isCurrentMonth = computed(() => {
    const now = new Date();
    return this.month().getFullYear() === now.getFullYear() && this.month().getMonth() === now.getMonth();
  });

  shiftMonth(delta: number) {
    const m = this.month();
    this.month.set(new Date(m.getFullYear(), m.getMonth() + delta, 1));
  }

  dayLabel(date: string): string {
    const [y, m, d] = date.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  }

  async openForm(expense?: Expense) {
    const modal = await this.modalCtrl.create({ component: ExpenseFormComponent, componentProps: { expense } });
    await modal.present();
  }

  async gotBack(loan: Expense) {
    const owed = effectiveAmount(loan);
    const alert = await this.alertCtrl.create({
      header: `Got back from ${loan.lentTo}`,
      message: `${this.service.formatMoney(owed)} still to get back`,
      inputs: [{ name: 'amount', type: 'number', value: owed, min: 0, max: owed, attributes: { inputmode: 'decimal' } }],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Save',
          handler: ({ amount }: { amount: string }) => {
            const value = Number(amount);
            if (!(value > 0)) return false;
            this.service.recordReturn(loan.id, Math.min(value, owed));
            return true;
          },
        },
      ],
    });
    await alert.present();
  }

  async confirmDelete(expense: Expense) {
    const alert = await this.alertCtrl.create({
      header: 'Delete expense?',
      message: `${this.service.formatMoney(expense.amount)} · ${expense.lentTo ? 'Lent to ' + expense.lentTo : expense.category}`,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: 'Delete', role: 'destructive', handler: () => this.service.remove(expense.id) },
      ],
    });
    await alert.present();
  }

  async openMenu() {
    const sheet = await this.actionSheet.create({
      header: 'Options',
      buttons: [
        { text: `Currency (${this.service.currency()})`, handler: () => { this.chooseCurrency(); } },
        {
          text: this.service.badgeEnabled() ? 'Hide total on app icon' : 'Show total on app icon',
          handler: () => { this.toggleBadge(); },
        },
        { text: 'Export CSV', handler: () => this.download('expenses.csv', this.service.toCsv(), 'text/csv') },
        { text: 'Back up (JSON)', handler: () => this.download(`expenses-backup-${new Date().toISOString().slice(0, 10)}.json`, this.service.toJson(), 'application/json') },
        { text: 'Restore backup', handler: () => { document.getElementById('restore-input')?.click(); } },
        { text: 'Sign out', role: 'destructive', handler: () => { this.signOut(); } },
        { text: 'Cancel', role: 'cancel' },
      ],
      subHeader: this.authService.user()?.email ?? undefined,
    });
    await sheet.present();
  }

  private async signOut() {
    await this.authService.signOut();
    await this.router.navigateByUrl('/login', { replaceUrl: true });
  }

  private async toggleBadge() {
    const turningOn = !this.service.badgeEnabled();
    const ok = await this.service.setBadgeEnabled(turningOn);
    let message: string;
    if (!turningOn) {
      message = 'Icon badge turned off';
    } else if (ok) {
      message = "This month's total now shows on the app icon";
    } else if (!this.service.badgeSupported) {
      message = 'Open the app from your home screen (iOS 16.4+) to use the icon badge';
    } else {
      message = 'Allow notifications for this app in Settings to show the badge';
    }
    const toast = await this.toastCtrl.create({ message, duration: 3000, position: 'bottom' });
    await toast.present();
  }

  private async chooseCurrency() {
    const alert = await this.alertCtrl.create({
      header: 'Currency',
      inputs: CURRENCIES.map(code => ({
        type: 'radio' as const,
        label: code,
        value: code,
        checked: code === this.service.currency(),
      })),
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: 'OK', handler: (code: string) => { if (code) this.service.setCurrency(code); } },
      ],
    });
    await alert.present();
  }

  private async download(filename: string, content: string, type: string) {
    const file = new File([content], filename, { type });
    // On iPhone the share sheet lets you save to Files, AirDrop, mail, etc.
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: filename });
        return;
      } catch (err) {
        if ((err as DOMException).name === 'AbortError') return;
      }
    }
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async restore(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    let message: string;
    try {
      const count = this.service.importJson(await file.text());
      message = `Restored ${count} expenses`;
    } catch {
      message = 'That file is not a valid backup';
    }
    const toast = await this.toastCtrl.create({ message, duration: 2000, position: 'bottom' });
    await toast.present();
  }
}
