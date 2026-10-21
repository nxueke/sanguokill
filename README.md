# Sanguokill Online

An original, extensible multiplayer Chinese-style card game project. The current build is an early development version; it is not yet a full implementation of all requested game rules.

## Current project status

- Android native client with a local card-play loop and an initial WebSocket online-room interface.
- Android Debug APK GitHub Actions workflow.
- Node.js authoritative rules core and automated tests.
- WebSocket server protocol for room creation, joining, reconnecting, host start, basic card actions, target selection, dodge response, Peach rescue, and per-player snapshots.
- Dockerfile and Render Blueprint template for deploying the WebSocket server.
- Per-player snapshots hide opponents' hands.

## Architecture

- `android/`: native Android application.
- `server/engine.mjs`: core state and rule validation.
- `server/rooms.mjs`: room lifecycle, sessions, reconnect grace period, and player-specific snapshots.
- `server/index.mjs`: HTTP health endpoint and WebSocket protocol at `/ws`.
- `Dockerfile`, `render.yaml`, `docs/ONLINE_SERVER.md`: hosting setup and Android connection guide.
- `test/`: Node.js built-in test suite.
- `.github/workflows/server-tests.yml`: server tests.
- `.github/workflows/android-apk.yml`: builds and uploads a Debug APK.

The server is authoritative: clients submit actions, never dictate game state. The Android client has an initial WebSocket room UI. A server must still be deployed and its `wss://.../ws` URL entered in the app before remote play works. The prototype still needs deeper security hardening, full rule handling, and deployment before public multiplayer release. Dodge and rescue response windows auto-pass after 30 seconds by default (configurable with RESPONSE_TIMEOUT_MS).

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

## Android APK and releases

A push that changes `android/**` triggers the Debug APK workflow. This is for testing only.

A production release is built by the `Android Release` workflow. It requires a persistent signing keystore owned and backed up by the project owner. Configure these repository Actions secrets before releasing: `ANDROID_KEYSTORE_BASE64` (base64-encoded `.jks`/`.keystore`), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, and `ANDROID_KEY_PASSWORD`. Never commit the keystore or passwords to the repository. Then run the workflow manually with a tag such as `v0.6.0`, or push a version tag. The workflow runs server tests, builds a signed release APK, calculates SHA-256, and publishes a GitHub Release. To get the APK:
1. Open the repository's **Actions** tab.
2. Open the latest **Android APK** workflow run.
3. Wait until the build finishes successfully.
4. Download the `sanguokill-debug-apk` artifact and extract `app-debug.apk`.

This is a debug APK, not a signed Play Store release. Install only builds you trust.

## Release status

The project is not yet a complete, production-ready recreation of the full base and War expansion rules. The current version is an early prototype. A production release additionally requires owner-controlled signing secrets, a publicly deployed WebSocket server, real-device/multi-client testing, and the rule/security work listed below. Do not describe this prototype as a finished full-featured game.

## Implemented gameplay foundation

- State model supports 3–10 players; the current three-player landlord mode assigns one landlord versus two peasants and checks team victory.
- Mode identifiers and client selection for identity, three-player landlord, and double-general selection from an original six-general roster with initial HP and passive-skill effects.
- Start validation, drawing with discard-pile reshuffle, basic card play, server-side damage, once-per-turn attack limit, dodge response windows, Peach rescue, draw-two, steal, Wine attack-boost card, one-hit armor equipment, standard identity role distribution for 3–10 players, and initial role-based victory checks.
- Room create/join/leave, host start, reconnect token handling, and per-player hand visibility.

## Remaining work

- Full original card catalogue and individual card effects for the base and war expansion sets; current starter deck contains a small prototype subset (attack, dodge, Peach, draw-two, steal, armor, and original Wine boost).
- Full official role edge cases, official landlord rules beyond the prototype bidding flow, and full card rules; the current original dual-general skills are a prototype and need balance/testing.
- Equipment beyond one-hit armor, delayed tricks, and more skill triggers; current response/rescue rules are an initial implementation, not a full official rules engine.
- Deploy the server and run real-device, multi-client online tests.
- Reconnection and security edge-case tests; deployment and persistence.
- End-to-end device tests and a release-signed APK.

## Asset and licensing policy

Use original assets, public-domain material, or assets with documented redistribution rights. Do not bundle proprietary character art, logos, voice lines, or card scans without permission.
