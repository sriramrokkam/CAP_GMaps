# Quick Destination Setup Guide

## 📋 Local Development Setup

### 1. Configure Environment Variables
```bash
# Copy example file
cp .env.example .env

# Edit .env and add your Google Maps API key
# GOOGLE_MAPS_API_KEY=your-actual-api-key
```

### 2. Run Locally
```bash
cds watch
```

---

## TL;DR - Deploy to Cloud Foundry

### 1. Create Destination in BTP Cockpit
- Navigate: **Subaccount → Connectivity → Destinations → New Destination**
- Name: `GoogleAPI-SR`
- Type: `HTTP`
- URL: `https://maps.googleapis.com`
- Authentication: `NoAuthentication`
- Add Property: `URL.queries.key` = `YOUR_GOOGLE_MAPS_API_KEY`

### 2. Deploy Your App
```bash
npm run build
npm run deploy
```

### 3. Verify
```bash
cf services              # Check destination binding
cf logs gmaps-app-srv    # View logs
```

## How It Works

- **Local:** Uses direct URL from `package.json`
- **Production:** Uses destination `GoogleAPI-SR` automatically
- **API Key:** Stored securely in BTP, injected as query parameter

## Update API Key (No Redeployment!)
1. Edit destination in BTP Cockpit
2. Update `URL.queries.key` property
3. Restart app: `cf restart gmaps-app-srv`

---
See **README.md** for complete documentation.
