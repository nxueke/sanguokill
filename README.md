# Sanguokill Online

An original, extensible multiplayer Chinese-style card game project. This repository is being built in stages; it is not yet a complete commercial game or a released APK.

## Architecture

- `server/engine.mjs`: authoritative, framework-free rules core.
- `server/index.mjs`: HTTP health endpoint and initial server entry point.
- `test/`: Node.js built-in test suite.
- `android/` (planned): native Android client.
- `.github/workflows/`: automated tests and later Android build.

The server is authoritative: clients must submit actions, never dictate game state. Later network work will add authenticated room membership, WebSocket action messages, reconnection snapshots, and per-player visibility filtering.

## Current implementation

- Game state supports 3–10 players.
- Initial mode identifiers: standard, landlord duel, and double-general.
- Start-game validation, draw, basic card-play validation, damage, turn advancement, and simple last-player-standing victory.
- Automated tests for core invariants.

This is a foundation, not a complete implementation of the official rules. Card effects, role-specific victory, dying/rescue, equipment, delayed tricks, full landlord rules, and double-general skill interactions remain future work.

## Requirements

- Node.js 22 or newer.
- Java 21 for Android tooling when the Android client is added.
- Android SDK and Gradle/Gradle Wrapper for APK builds.

## Run tests

```bash
npm test
```

## Run the initial server

```bash
npm start
```

Then open `http://localhost:3000/health`.

## Staged roadmap

1. Establish repository structure and tested rules core.
2. Implement card definitions, complete turn/response rules, and game modes.
3. Add authoritative WebSocket rooms, disconnect/reconnect, and protocol tests.
4. Build the Android lobby, room, selection, and gameplay screens.
5. Run end-to-end checks and configure Android APK CI.

## Asset and licensing policy

Use original assets, public-domain material, or assets with documented redistribution rights. Do not bundle proprietary character art, logos, voice lines, or card scans without permission.
