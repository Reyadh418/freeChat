# 🔒 freeChat • Zero-Knowledge E2EE Private Messenger

A private, Zero-Knowledge End-to-End Encrypted (E2EE) messaging web application with an authentic **Apple iMessage Liquid Glass** user interface. Built with pure Vanilla JavaScript (ES Modules), modern CSS3 glassmorphism, Node.js, and Supabase PostgreSQL.

Designed for complete data privacy: **the server and database only ever see ciphertext, public keys, and cryptographic vectors**.

---

## ✨ Features

- 🛡️ **Zero-Knowledge Architecture**: The server and database never receive passwords or unencrypted messages.
- 🔑 **Hardware-Grade Web Crypto**: Native browser `ECDH (P-256)` shared key derivation + `AES-256-GCM` message encryption.
- 📱 **Apple iMessage Liquid Glass UI**: Frosted glassmorphic panels (`backdrop-filter: blur`), vibrant iOS blue sender bubbles, springy animations, and responsive mobile layout.
- ⚡ **Realtime Messaging**: Socket.io live message delivery, active typing indicator capsule (`...`), and online/offline presence.
- ☁️ **100% Free Cloud Deployment**: Runs forever on **Render Free Tier** (Node.js backend) + **Supabase Free Tier** (PostgreSQL & Storage).
- 📲 **Installable PWA**: Add to iOS or Android Home Screen directly from Safari/Chrome without App Store fees.
- 🔄 **Local Development Fallback**: Zero-configuration local database adapter allows running offline immediately before linking Supabase credentials.

---

## 🚀 Quick Start (Local)

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Start the server**:
   ```bash
   npm start
   ```

3. Open **`http://localhost:3000`** in your browser.

---

## ☁️ Connecting Supabase (Cloud Persistence)

1. Create a free project at [Supabase.com](https://supabase.com).
2. In Supabase Dashboard, open the **SQL Editor** and run the contents of [`database/schema.sql`](file:///c:/Code/freeChat/database/schema.sql).
3. Copy your **Project URL** and **anon/public API key** from *Project Settings $\rightarrow$ API*.
4. Create a `.env` file in the root directory:
   ```env
   PORT=3000
   SUPABASE_URL=https://your-project-id.supabase.co
   SUPABASE_KEY=your-supabase-anon-key
   ```
5. Restart your server (`npm start`). The app will automatically connect to Supabase PostgreSQL.

---

## 🌐 Deploying to Render.com (100% Free Hosting)

1. Push your repository to GitHub:
   ```bash
   git add .
   git commit -m "Initial freeChat commit"
   git push origin main
   ```
2. Log into [Render.com](https://render.com) and click **New + $\rightarrow$ Web Service**.
3. Connect your GitHub repository.
4. Set the following settings:
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
5. Under **Environment Variables**, add:
   - `SUPABASE_URL`: *(Your Supabase URL)*
   - `SUPABASE_KEY`: *(Your Supabase anon key)*
   - `NODE_ENV`: `production`
6. Click **Create Web Service**. Your private encrypted messenger is now live on the web!

---

## 📲 How to Install as an iOS / Android App

1. Open your hosted URL in **Safari on iPhone** (or Chrome on Android).
2. Tap the **Share** button (the square with an arrow pointing up).
3. Scroll down and tap **"Add to Home Screen"**.
4. You now have a standalone, full-screen private messenger with native glass fluid animations on your phone.

---

## 🔐 Cryptographic Specification

| Component | Standard / Algorithm | Role |
| :--- | :--- | :--- |
| **Key Exchange** | ECDH P-256 (NIST P-256) | Generates ephemeral/session shared keys between users |
| **Message Cipher** | AES-256-GCM (12-byte random IV) | Authenticated encryption for all chat payloads |
| **Passphrase Derivation** | PBKDF2 (100,000 iterations, SHA-256) | Derives master key encryption key (KEK) for private key backup |
| **Local Key Storage** | IndexedDB | Secure browser device key vault |
| **Auth Verifier** | SHA-256 Zero-Knowledge Token | Authenticates user without sending raw passphrase |

