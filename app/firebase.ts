import { initializeApp, getApps, getApp } from "firebase/app"
import { getFirestore } from "firebase/firestore"

const firebaseConfig = {
  apiKey: "AIzaSyBPzwIgNdFVgzxbmBBzl7a1uWCEUGrcR1A",
  authDomain: "tracker-370f1.firebaseapp.com",
  projectId: "tracker-370f1",
  storageBucket: "tracker-370f1.firebasestorage.app",
  messagingSenderId: "188560245686",
  appId: "1:188560245686:web:4efbe3e9a87d77ba427717",
  measurementId: "G-7VPTSF1YXJ"
}

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp()
const db = getFirestore(app)

export { db }