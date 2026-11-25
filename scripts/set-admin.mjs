import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const email = process.argv[2]?.trim().toLowerCase();
if (!email) {
  console.error("Usage: npm run set:admin -- <existing-account-email>");
  process.exit(1);
}

initializeApp({ credential: applicationDefault(), projectId: "gamz-store" });
const auth = getAuth();
const user = await auth.getUserByEmail(email);
await auth.setCustomUserClaims(user.uid, { ...user.customClaims, admin: true });
await getFirestore().collection("users").doc(user.uid).set({ role: "admin" }, { merge: true });
console.log(`Granted admin access to ${user.email ?? user.uid}. Sign out and back in to refresh the ID token.`);
