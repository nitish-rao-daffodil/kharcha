# Kharcha — personal expense tracker

Ionic 9 + Angular 22 (NgModules, zoneless, signals) PWA, used on an iPhone via "Add to Home Screen".
Data: Firebase Auth (email/password, sign-up disabled) + Firestore at `users/{uid}/expenses/{id}`.
Hosting: Firebase Hosting, project `kharcha-ac8d4` → https://kharcha-ac8d4.web.app

## Workflow — always do this after any change
1. Build: `npm run build` (needs Node ≥ 22.22 or ≥ 24.15; on the laptop use `~/.nvm/versions/node/v22.23.2/bin`).
2. Commit with a clear message and push to `main`.
3. Pushing to `main` deploys automatically via GitHub Actions. To deploy by hand:
   `npx firebase-tools deploy --only hosting,firestore:rules`.

## Notes
- `src/environments/firebase.config.ts` holds the public Firebase web config (not a secret).
- Security lives in `firestore.rules`; keep each user limited to `users/{their uid}`.
- No zone.js: state that changes after an `await` must be a signal or the view won't update.
- Loans: entries with `lentTo`; `effectiveAmount()` = amount − returned. Totals use effective amounts.
