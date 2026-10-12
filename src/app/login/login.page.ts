import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../auth.service';

@Component({
  selector: 'app-login',
  templateUrl: 'login.page.html',
  styleUrls: ['login.page.scss'],
  standalone: false,
})
export class LoginPage {
  private authService = inject(AuthService);
  private router = inject(Router);

  email = '';
  password = '';
  readonly busy = signal(false);
  readonly error = signal('');

  async submit() {
    if (!this.email || !this.password || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      await this.authService.signIn(this.email, this.password);
      await this.router.navigateByUrl('/home', { replaceUrl: true });
    } catch (err) {
      const code = (err as { code?: string }).code ?? '';
      this.error.set(
        code === 'auth/network-request-failed'
          ? 'No internet connection. Connect once to sign in.'
          : code === 'auth/too-many-requests'
            ? 'Too many attempts. Try again in a few minutes.'
            : 'Wrong email or password.',
      );
    } finally {
      this.busy.set(false);
    }
  }
}
