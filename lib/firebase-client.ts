import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "AIzaSyBnXQEg0pP0r1f3eTeekMRsvFzWhGYNR5I",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "academyfind-206ce.firebaseapp.com",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "academyfind-206ce",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "academyfind-206ce.firebasestorage.app",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "820161441990",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "1:820161441990:web:668c66300726f3c70267c7",
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID || "G-NW319CRM7K",
};

// Singleton initialization to prevent duplicate app errors on hot reloads
const firebaseApp = !getApps().length ? initializeApp(firebaseConfig) : getApp();
export const firebaseClientAuth = getAuth(firebaseApp);
