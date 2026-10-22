# Bamboozle Deployment Guide

Status: legacy — Railway deployment; phase 1 replaces it per docs/CLOUDFLARE_MIGRATION_PLAN.md.

## Railway Deployment (Recommended)

Bamboozle uses a **Node.js + Socket.IO** backend and a **Vite + React** frontend. It is designed to be deployed as a single service or dual services on Railway.

### Environment Variables

You **MUST** add these variables to your Railway project settings:

| Variable | Description | Example |
| :--- | :--- | :--- |
| `NODE_ENV` | Environment mode | `production` |
| `PORT` | Port for the server to listen on | `3001` or `8080` (Railway sets this automatically) |
| `GCS_BUCKET_NAME` | **Required**. The name of your Google Cloud Storage bucket for audio. | `bamboozle-audio-assets` |
| `GOOGLE_APPLICATION_CREDENTIALS_JSON` | **Required**. The full JSON content of your Google Service Account Key. | `{"type": "service_account", ...}` |
| `VITE_SERVER_URL` | **Frontend Only**. The URL of your deployed backend. | `https://bamboozle-backend.up.railway.app` |

### Deployment Steps

1. **Connect GitHub**: Link your Bamboozle repository to Railway.
2. **Add Service (Server)**:
   - Root Directory: `/server`
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Add variables: `GCS_BUCKET_NAME`, `GOOGLE_APPLICATION_CREDENTIALS_JSON`
3. **Add Service (Client/Frontend)**:
   - Root Directory: `/` (Root)
   - Build Command: `npm install && npm run build`
   - Start Command: `npm run preview -- --host --port $PORT`
   - Add variable: `VITE_SERVER_URL` (Pointing to your Server URL)

### Google Cloud Setup

1. **Create Bucket**: Go to Google Cloud Console > Cloud Storage > Create Bucket.
   - Name: `bamboozle-audio-assets` (or similar)
   - Access Control: **Uniform**
   - **IMPORTANT**: Make the bucket **Public**.
     - Permissions > Add Principal > `allUsers` > Role: `Storage Object Viewer`
2. **Create Service Account**:
   - Go to IAM & Admin > Service Accounts.
   - Create new account > Role: `Storage Object Admin` + `Cloud Text-to-Speech API User`.
   - Keys > Add Key > JSON.
   - Copy the contents of this JSON file into the `GOOGLE_APPLICATION_CREDENTIALS_JSON` variable in Railway.

### Verification

After deployment:
1. Go to your **Admin Dashboard** (e.g., `https://your-frontend.railway.app/admin`).
2. Check **Server Status**: Should be "Online".
3. Try **Generate Phrases (EN)**: Logs should show `[TTS] CACHE HIT` or `[TTS] GENERATING`.
4. If successful, your audio pipeline is live!
