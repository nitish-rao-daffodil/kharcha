import { Component, Input, OnInit, inject } from '@angular/core';
import { ModalController } from '@ionic/angular/lazy';
import { CATEGORIES, Expense, ExpenseService, LENT_CATEGORY } from '../expense.service';

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

@Component({
  selector: 'app-expense-form',
  templateUrl: 'expense-form.component.html',
  styleUrls: ['expense-form.component.scss'],
  standalone: false,
})
export class ExpenseFormComponent implements OnInit {
  @Input() expense?: Expense;

  private modalCtrl = inject(ModalController);
  readonly service = inject(ExpenseService);
  readonly categories = CATEGORIES;

  kind: 'expense' | 'lent' = 'expense';
  amount: number | null = null;
  category = CATEGORIES[0].name;
  note = '';
  date = today();
  lentTo = '';
  returned: number | null = null;

  ngOnInit() {
    if (this.expense) {
      this.amount = this.expense.amount;
      this.category = this.expense.category;
      this.note = this.expense.note;
      this.date = this.expense.date;
      if (this.expense.lentTo) {
        this.kind = 'lent';
        this.category = CATEGORIES[0].name;
        this.lentTo = this.expense.lentTo;
        this.returned = this.expense.returned || null;
      }
    }
  }

  get valid(): boolean {
    if (!this.amount || this.amount <= 0 || !this.date) return false;
    if (this.kind === 'lent') {
      return !!this.lentTo.trim() && (this.returned ?? 0) >= 0 && (this.returned ?? 0) <= this.amount;
    }
    return true;
  }

  cancel() {
    this.modalCtrl.dismiss(null, 'cancel');
  }

  save() {
    if (!this.valid) return;
    const lent = this.kind === 'lent';
    this.service.save({
      id: this.expense?.id,
      amount: Math.round(this.amount! * 100) / 100,
      category: lent ? LENT_CATEGORY.name : this.category,
      note: this.note.trim(),
      date: this.date.slice(0, 10),
      ...(lent ? { lentTo: this.lentTo.trim(), returned: Math.round((this.returned ?? 0) * 100) / 100 } : {}),
    });
    this.modalCtrl.dismiss(null, 'saved');
  }
}
