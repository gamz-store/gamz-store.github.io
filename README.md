# Gamz Fireworks and Liquors

A mobile-first Next.js storefront for Gamz with Firebase Authentication, Firestore inventory and pickup orders, an admin workspace, and an optional UploadThing image worker. The public menu can be browsed without an account; account sign-in is required to order. The storefront asks visitors to confirm they are at least 18 before continuing.

## Local development

1. Install Node.js 22 or later, then run `npm install`.
2. Create a local `.env.local` file with the `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`, `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`, `NEXT_PUBLIC_FIREBASE_APP_ID`, and `NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID` values from Firebase Console. `.env.local` is git-ignored and is not included in the repository.
3. In Firebase Console for `gamz-store`, enable Email/Password Authentication, create the default Firestore database, add `localhost` and `gamz-store.github.io` to authorized domains, and publish `firestore.rules`.
4. Run `npm run dev`.
5. Create the first account using the website, then grant admin access as described below. Add products from the admin Display tab.

Firebase web configuration is public client configuration, not an admin credential. Values prefixed with `NEXT_PUBLIC_` are compiled into the browser bundle and cannot be kept secret in a static website. Restrict the Firebase API key to the intended APIs and domains in Google Cloud Console, and rely on Firestore rules for data authorization. Never put Firebase service-account credentials or the UploadThing token in this repository.

## First admin

Create an account for `jerosales00@gmail.com` through the website using a strong password. Do not use the requested `123456`; it is short, widely guessable, and Firebase password policies should reject it. Then use a trusted environment authenticated as a project administrator with Google Application Default Credentials:

```powershell
gcloud auth application-default login
npm run set:admin -- jerosales00@gmail.com
```

The script promotes that existing account by email in Firebase Auth and Firestore. Sign out and back in to refresh the account. The service-account access stays on the trusted machine and is never deployed to the site. Firestore rules protect user roles and admin operations.

## UploadThing image uploads

The UploadThing token included in the original setup request has been exposed in chat. Revoke it and create a replacement before enabling uploads. Store the replacement only as the `UPLOADTHING_TOKEN` secret on the Cloudflare Worker. Do not add it to `.env.local`, GitHub variables, or source control.

From `uploadthing-worker`:

```powershell
npm install
npx wrangler login
npx wrangler secret put UPLOADTHING_TOKEN
npx wrangler secret put FIREBASE_API_KEY
npm run deploy
```

`FIREBASE_API_KEY` is the public Firebase web API key used to verify Firebase ID tokens. Set `NEXT_PUBLIC_UPLOADTHING_URL` to `https://gamz-store-uploadthing.<your-account-subdomain>.workers.dev/api/uploadthing` in `.env.local` and GitHub Actions Variables. For local worker development, copy `.dev.vars.example` to `.dev.vars`, fill in the two worker values, run `npm run dev` from `uploadthing-worker`, and point the app URL at `http://localhost:8787/api/uploadthing`.

## GitHub Pages

The Actions workflow builds a static export and deploys it to `https://gamz-store.github.io`. Push the repository to the `main` branch, then in repository Settings > Pages select **GitHub Actions**. Add the `NEXT_PUBLIC_FIREBASE_*` values and `NEXT_PUBLIC_UPLOADTHING_URL` as repository Actions Variables. GitHub Pages needs no deployment token for the included workflow.

## Cloudflare

The static storefront has been deployed to Cloudflare at `https://gamz-store.ps-taguibo-uploadthing-worker.workers.dev` and to a standalone static-assets Worker at `https://gamz-store-github-io.ps-taguibo-uploadthing-worker.workers.dev`. The root `wrangler.toml` serves Next.js `out/`; redeploy after `npm run build` with `npx wrangler deploy`. The UploadThing Worker is deployed at `https://gamz-store-uploadthing.ps-taguibo-uploadthing-worker.workers.dev`, but it is not connected to the app until a replacement token is added as a Worker secret and `NEXT_PUBLIC_UPLOADTHING_URL` is configured.

## Firebase collections

- `products`: public active catalog; admins manage the order name, description, stock, price, sale type, optional promo date range, and visibility.
- `users`: customer profile and server-managed `role` (`user` or `admin`).
- `orders`: product snapshot, quantity, pickup date and time, pickup status, payment status, and customer contact. Inventory deduction and order creation are a single transaction.

Firebase Authentication, Firestore, GitHub Pages, and Cloudflare services must be enabled/deployed in their respective consoles; source configuration alone cannot create or authorize those external accounts.
