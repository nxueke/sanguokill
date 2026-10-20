# Sanguokill Online

An original, extensible multiplayer Chinese-style card game project. The current build is an early development version; it is not yet a full implementation of all requested game rules.

## Current project status

- Android native starter client with a local card-play loop.
- Android Debug APK GitHub Actions workflow.
- Node.js authoritative rules core and automated tests.
- WebSocket server protocol for room creation, joining, leaving, reconnecting, game start, and basic actions.
- Per-player snapshots hide opponents' hands.

## Architecture

- `android/`: native Android application.
- `server/engine.mjs`: core state and rule validation.
- `server/rooms.mjs`: room lifecycle, sessions, reconnect grace period, and player-specific snapshots.
- `server/index.mjs`: HTTP health endpoint and WebSocket protocol at `/ws`.
- `test/`: Node.js built-in test suite.
- `.github/workflows/server-tests.yml`: server tests.
- `.github/workflows/android-apk.yml`: builds and uploads a Debug APK.

The server is authoritative: clients submit actions, never dictate game state. The WebSocket prototype still needs security hardening, deployed hosting, protocol integration in the Android client, and more complete rule handling before public multiplayer release.

## Run server tests

Requires Node.js 22 or newer.

```bash
npm test
```

## Run the server

```bash
npm install
npm start
```

Health endpoint: `http://localhost:3000/health`

WebSocket endpoint: `ws://localhost:3000/ws`

Initial JSON messages:
- Create: `{"type":"create_room","name":"Player","mode":"standard","maxPlayers":8}`
- Join: `{"type":"join_room","code":"ROOMCODE","name":"Player"}`
- Start (host): `{"type":"start_game"}`
- Action: `{"type":"action","action":{"type":"end_turn"}}`
- Reconnect: `{"type":"reconnect","token":"SESSION_TOKEN"}`
- Leave: `{"type":"leave_room"}`

The current protocol is an early implementation and should not be exposed publicly without rate limits, stronger session management, deployment configuration, and additional adversarial tests.

## Android APK

A push that changes `android/**` triggers the Android build workflow. To get the APK:
1. Open the repository's **Actions** tab.
2. Open the latest **Android APK** workflow run.
3. Wait until the build finishes successfully.
4. Download the `sanguokill-debug-apk` artifact and extract `app-debug.apk`.

This is a debug APK, not a signed Play Store release. Install only builds you trust.

## Implemented gameplay foundation

- State model supports 3–10 players.
- Mode identifiers for standard, landlord duel, and double-general.
- Start validation, drawing, basic card play, damage, turn advancement, and simple last-player-standing victory.
- Room create/join/leave, host start, reconnect token handling, and per-player hand visibility.

## Remaining work

- Full card catalogue and individual card effects for the base and war expansion sets.
- Complete role-based victory rules, landlord rules, double-general selection and skill combinations.
- Response windows, dodge resolution, dying/rescue, equipment, delayed tricks, and skill triggers.
- Android integration with WebSocket rooms and online gameplay.
- Reconnection and security edge-case tests; deployment and persistence.
- End-to-end device tests and a release-signed APK.

## Asset and licensing policy

Use original assets, public-domain material, or assets with documented redistribution rights. Do not bundle proprietary character art, logos, voice lines, or card scans without permission.
