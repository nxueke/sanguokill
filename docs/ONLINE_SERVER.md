# Online server setup

The Android client now contains a WebSocket room UI, but it cannot connect to other players until the server is running on a reachable host.

## Deploy with Render

1. Sign in to Render and create a new Blueprint from this GitHub repository.
2. Review the service settings from `render.yaml` and create the service.
3. Wait for the deployment to become healthy.
4. Open `https://YOUR-SERVICE.onrender.com/health`; a healthy server responds with JSON containing `"status":"ok"`.
5. In the Android app, open **多人在线房间** and enter `wss://YOUR-SERVICE.onrender.com/ws` as the server address.

Replace `YOUR-SERVICE` with the real service hostname assigned by the hosting provider. Do not use the example hostname literally.

Free hosting plans may sleep when idle and can have cold-start delays. Do not use an unprotected development server for sensitive data.

## Local server

Requires Node.js 22 or newer.

```bash
npm install
npm start
```

The server listens on port 3000 by default. The Android emulator can usually reach a server on the host computer at `ws://10.0.2.2:3000/ws`. A physical phone must use a LAN IP reachable from the phone or a publicly deployed `wss://` endpoint. Firewalls must permit the connection.

## Current limitations

This is a prototype. It has basic identity victory checks, a three-player landlord role variant, attack/dodge response, Peach rescue, draw-two and steal cards, and one-hit armor. It does not yet implement the full official card catalogue, landlord bidding and general selection, double-general selection/skills, response timeouts, persistent rooms, rate limiting, or comprehensive abuse protection.
