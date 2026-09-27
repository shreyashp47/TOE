/**
 * Firebase wiring. Loaded **only** when the Firebase env block is present, so
 * a demo-mode visitor never downloads the SDK (see issue #3 / NFR "zero/low
 * infrastructure cost, fast on mobile data").
 *
 * `import type` is erased at compile time, so the type imports below cost
 * nothing at runtime; the value imports are behind a dynamic `import()`.
 */

import { firebaseConfig } from "../config";

type FirebaseApp = import("firebase/app").FirebaseApp;
type Auth = import("firebase/auth").Auth;
type Firestore = import("firebase/firestore").Firestore;

let appPromise: Promise<{ app: FirebaseApp; auth: Auth; db: Firestore }> | null =
  null;

async function getFirebase() {
  if (!firebaseConfig) {
    throw new Error(
      "Firebase is not configured. Add the NEXT_PUBLIC_FIREBASE_* variables, or keep running in demo mode.",
    );
  }

  appPromise ??= (async () => {
    const [{ initializeApp, getApps, getApp }, authMod, fsMod] =
      await Promise.all([
        import("firebase/app"),
        import("firebase/auth"),
        import("firebase/firestore"),
      ]);

    const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
    return {
      app,
      auth: authMod.getAuth(app),
      db: fsMod.initializeFirestore(app, {
        // One long-lived listener per device; keeps reads inside free tier.
        experimentalAutoDetectLongPolling: true,
      }),
    };
  })();

  return appPromise;
}

export default getFirebase;
