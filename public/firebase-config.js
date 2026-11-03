/* Firebase Web App configuration for hunger-games-1f090. */
window.DS_FIREBASE_CONFIG = {
  apiKey: ,
  authDomain: "hunger-games-1f090.firebaseapp.com",
  databaseURL: "https://hunger-games-1f090-default-rtdb.firebaseio.com",
  projectId: "hunger-games-1f090",
  storageBucket: "hunger-games-1f090.firebasestorage.app",
  messagingSenderId: "1064235361060",
  appId: "1:1064235361060:web:db2db56daa6ae25dc1c9b1"
};

const firebaseConfig = window.DS_FIREBASE_CONFIG;
const DS_FIREBASE_REQUIRED = ['apiKey', 'authDomain', 'databaseURL', 'projectId', 'messagingSenderId', 'appId'];
const DS_FIREBASE_PLACEHOLDER = /REPLACE_ME|REPLACE_WITH_YOUR_FIREBASE_PROJECT_ID/i;
const dsFirebaseMissing = DS_FIREBASE_REQUIRED.filter(k => !firebaseConfig[k] || DS_FIREBASE_PLACEHOLDER.test(String(firebaseConfig[k])));
window.DS_FIREBASE_STATUS = { configured: dsFirebaseMissing.length === 0, missing: dsFirebaseMissing, initialized: false, error: null };

if (dsFirebaseMissing.length) {
  console.warn('[FIREBASE CONFIG] Missing/placeholder values:', dsFirebaseMissing.join(', '));
} else {
  try {
    firebase.initializeApp(firebaseConfig);
    window.DS_FIREBASE_STATUS.initialized = true;
    console.info('[FIREBASE INIT] Firebase app initialized for hunger-games-1f090');
  } catch (e) {
    window.DS_FIREBASE_STATUS.error = e;
    console.error('[FIREBASE INIT] initializeApp failed:', e);
  }
}
