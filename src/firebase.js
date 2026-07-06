import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDsDo78qPF10oIBM1Vjw4EjytE88sVxhg8",
  authDomain: "cologne-inventory.firebaseapp.com",
  projectId: "cologne-inventory",
  storageBucket: "cologne-inventory.firebasestorage.app",
  messagingSenderId: "880062110085",
  appId: "1:880062110085:web:cd0f8ecd7d7c9ddde5ccec",
};

export const firebaseConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const db = getFirestore(app);
