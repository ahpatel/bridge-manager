# Beeper Bridge Manager on Cloudflare

This project allows you to host [Beeper Bridge Manager](https://github.com/beeper/bridge-manager) (`bbctl`) and its bridges on [Cloudflare Containers (Beta)](https://developers.cloudflare.com/containers/).

## Features
- **Serverless Hosting:** No need for a 24/7 home server or Raspberry Pi.
- **Easy Management:** Simple web UI to login and manage bridges.
- **Persistence:** Uses Cloudflare Durable Objects for persistent session storage.
- **Auto-Installation:** Bridges are automatically installed and configured.

## Step-by-Step Guide

### 1. Prerequisites
- A Cloudflare account with Workers and Containers (Beta) enabled.
- Node.js and `npm` installed locally.
- A Beeper account.

### 2. Deployment
Clone this repository and run:
```bash
npm install
npm run deploy
```
After deployment, Wrangler will provide a URL (e.g., `https://beeper-bridge-manager.your-subdomain.workers.dev`).

### 3. Login to Beeper
1. Open the deployed URL in your browser.
2. You need a **Beeper Login Token**. 
   - If you have `bbctl` locally: Run `bbctl login` and copy the token.
   - Alternatively, you can obtain a token via the Beeper desktop app or by asking in the `#self-hosting:beeper.com` Matrix room.
3. Paste the token into the **Beeper Login Token** field and click **Login to Beeper**.

### 4. Start a Bridge
1. Select a bridge (e.g., **WhatsApp**) from the dropdown.
2. Click **Start Bridge in Background**.
3. The container will download and install the bridge dependencies (this may take a minute for the first run).
4. Click **Refresh List** to verify the bridge is running.

### 5. Configure the Bridge in Beeper
Once the bridge is running on Cloudflare:
1. Open your Beeper app.
2. You should see a new bot for the bridge (e.g., `@sh-whatsappbot:beeper.local`).
3. Send a message to the bot to start the login process for that specific service (e.g., scan the QR code for WhatsApp).

## How it Works
- **Worker:** A Cloudflare Worker (`src/index.ts`) provides the web UI and routes requests to the container.
- **Container:** A Docker container (`Dockerfile`) builds `bbctl` and runs a Go-based API server (`container_src/main.go`).
- **Persistence:** All data is stored in `/data` inside the container, which is backed by a Cloudflare Durable Object, ensuring your login stays active even if the container restarts.

## Maintenance
- Use the **Check Login Status** button to verify you are still logged into Beeper.
- Use **List Running Bridges** to see which bridges are currently active in the background.

## Troubleshooting
- **Container Timeout:** If the container goes to sleep, visiting the Worker URL will wake it up.
- **Memory/CPU:** Official bridges vary in resource usage. Cloudflare Containers (Beta) has specific limits during the preview period.
