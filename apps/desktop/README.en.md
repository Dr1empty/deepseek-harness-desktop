# DeepSeek Harness Desktop

[中文](README.md) | English

[![Desktop test](https://github.com/Dr1empty/deepseek-harness-desktop/actions/workflows/desktop-test.yml/badge.svg)](https://github.com/Dr1empty/deepseek-harness-desktop/actions/workflows/desktop-test.yml)
[![Release](https://img.shields.io/github/v/release/Dr1empty/deepseek-harness-desktop?include_prereleases&label=Desktop)](https://github.com/Dr1empty/deepseek-harness-desktop/releases)
[![Platform](https://img.shields.io/badge/platform-Windows%20x64-0078d4)](#system-requirements)

DeepSeek Harness Desktop is an unofficial Windows distribution integrated into a fork of [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness). It preserves the upstream Harness Web UI, agents, sessions, tools, and plugin architecture while adding one-click installation, local-service lifecycle management, Desktop and kernel updates, usage and balance reporting, native QR-code top-up, a single-instance desktop window, startup optimization, and reproducible releases.

This project is not an official DeepSeek product and is not maintained or endorsed by DeepSeek.

## Download

| Platform | Download | Notes |
| --- | --- | --- |
| Windows 10/11 x64 | [DeepSeek Harness Desktop 1.1.5](https://github.com/Dr1empty/deepseek-harness-desktop/releases) | NSIS Setup with Node.js and Harness included; no development environment required |

The installer is not commercially code-signed, so Windows may display an “Unknown publisher” warning. Download `SHA256SUMS.txt` from the same Release or verify the 1.1.5 Setup hash:

```text
85EB523F520D772A91823AA421A1DC3318C1C4873A6F5C179C33D4A614E1DF81
```

## Why this Desktop exists

Upstream Harness provides the core agent platform and Web UI. Running it from source or the CLI on Windows still requires users to prepare Node.js, manage a background process and local port, handle updates, and move between a terminal and a browser.

This project focuses on running upstream Harness reliably as a Windows application:

- Install from one Setup without configuring Node.js, npm, or pnpm.
- Start Harness from a shortcut and open the upstream Web UI as soon as the local service is ready.
- Reclaim the backend process when the app exits and show recent logs when startup fails.
- Add Desktop-specific controls to the existing Harness settings instead of introducing a separate landing page.
- Keep kernel updates, usage, balance, and top-up inside one desktop window.

## What this Desktop adds beyond upstream

| Area | Upstream Harness | Additional Desktop implementation |
| --- | --- | --- |
| Windows distribution | Primarily a CLI/npm package and Web application | NSIS Setup, desktop and Start Menu shortcuts, and bundled portable Node.js 24 |
| Local service | Started and stopped by the user through the CLI | Electron-managed child process, readiness detection, port fallback, shutdown cleanup, and failure reporting |
| Window lifecycle | Runs in a browser tab | Single-instance desktop window; repeated shortcut launches focus the existing window |
| Startup experience | Depends on CLI and browser startup | Local loading surface, parallel backend/Chromium initialization, and stage timings |
| Software updates | Package-manager workflow | Separate in-app updates for the Desktop shell and Harness npm kernel, preserving the working version on failure |
| Usage and balance | Not a Desktop function in the core Web UI | Local session-token aggregation, official DeepSeek balance query, and low-balance warning |
| Top-up | Opens the platform website | Native amount/payment-method UI with official Alipay or WeChat payment QR generation |
| Release verification | Upstream tests target Harness itself | Desktop unit tests, real NSIS build, packaged smoke test, SHA-256 checksums, and release manifest |

“Additional” refers only to the Desktop shell and integration layer. Model calls, agent execution, session formats, tools, the official Web UI, and official core bundles still come from upstream Harness.

## Features

### One-click installation and zero-environment startup

- Bundles Node.js `24.18.0` and pins `@deepseek-ai/dsh@0.1.1-rc.2`.
- Runs the backend as a hidden child process without an extra CMD or PowerShell window.
- Prefers fixed port `64788`, allowing origin-scoped Web data to persist between restarts.
- Falls back to an operating-system-assigned local port if the preferred port is occupied.
- Loads the service on `127.0.0.1`; it is not intentionally exposed as a LAN service.

### Single instance and reliable shutdown

- Only one instance of the same Desktop distribution may run.
- Repeated shortcut launches restore, show, and focus the existing window.
- Normal app exit synchronously cleans up the Harness child-process tree.
- Startup failures retain the tail of stdout/stderr and report a specific backend error.

### Startup performance

- Starts the Harness backend in parallel with Electron/Chromium initialization.
- Delays payment-session initialization until the user first uses top-up.
- Caches the profile-junction compatibility audit using kernel, dependency-manifest, and directory-state fingerprints.
- Adds ISO timestamps and relative timings for window creation, backend readiness, and page loading.
- Does not enable `NODE_COMPILE_CACHE`: benchmarks with Node 24 and Harness rc.2 showed no gain and a small regression.

In one maintainer-machine verification, the repeated profile audit fell from approximately `478 ms` to `14–16 ms`. A packaged smoke test without external plugins reached backend readiness in approximately `3.69 s` and completed page loading in `4.32 s`. Actual results depend on storage, antivirus software, kernel version, and installed plugins.

### Two independent update channels in Settings

- “Desktop application version” checks GitHub Releases, reports download progress, and runs the NSIS update before restarting.
- “Harness kernel version” checks npm Registry for `@deepseek-ai/dsh`, prepares the new kernel under user data, and switches only after verification.
- The app checks for Desktop releases in the background after startup; downloading and installation still require user confirmation in Settings.
- Each channel has its own version, status, and controls, and a failed update leaves the working version intact.

> Version 1.1.4 has neither the Desktop update client nor `latest.yml`, so moving to 1.1.5 requires one final manual Setup installation. Starting with 1.1.5, later releases can be installed in-app.

### Usage, balance, and low-balance warnings

- Aggregates requests and tokens for today, the current month, and all retained history from local session events.
- Tracks input, output, cache-read, cache-write, and reasoning tokens.
- Deduplicates forked-session request records to avoid double counting.
- Queries the official DeepSeek balance using the current DeepSeek credential.
- Shows a low-balance warning and clears the stale warning after a successful balance refresh.
- Treats local usage as an estimate over sessions still present on the machine, not as an official bill.

### Native QR-code top-up

- Places top-up directly under “Settings → Usage” instead of embedding the full platform website.
- Supports a CNY amount and either Alipay or WeChat Pay.
- Creates the QR code locally from the official DeepSeek payment-order URL; no third-party QR service is used.
- Polls payment status in the background and refreshes the balance after payment succeeds.
- Shows a controlled login window only when authentication is actually required and keeps top-up-page redirects hidden.

Orders, balances, and pricing are determined by the DeepSeek Open Platform response. This project does not collect payments, store bank-card information, or provide a third-party top-up channel.

### Images and vision-model boundaries

- Selects the experimental catalog entry `deepseek-v4-flash-vision-exp` on first launch.
- Whether `deepseek-v4-flash` or `deepseek-v4-pro` can process an image depends on the active Harness model catalog, attachment pipeline, or vision-tool routing.
- An image capability shown in a model catalog is not proof that a remote model API natively accepts images.
- The public Setup does not bundle Vision Router. Users may install a compatible plugin or configure their own vision provider.

## Plugin boundary

Desktop 1.1.5 does not preinstall third-party add-on plugins. The following components are not included in the Git repository, Setup, or isolated Desktop profile:

- `dsh-client-liang-intensity-skin`
- `@dsh-external/dsh-super-injector` / routing-suite
- `dsh-vision-router`
- iMessage integration
- mass-spectrometry integration

Harness itself uses a plugin architecture; official core bundles required for normal Harness operation are not “add-on plugins” in this document. A developer may install plugins in a local DSH profile without adding them to the public distribution.

## Runtime architecture

```text
Windows shortcut
      │
      ▼
Electron main process ── single-instance lock / logs / updates / usage / payments
      │
      ├── loading surface and sandboxed BrowserWindow
      │
      └── portable Node.js
              │
              ▼
       @deepseek-ai/dsh web
              │
              ├── upstream Harness Web UI
              ├── upstream agents / sessions / tools
              └── the user's DSH profile and credentials
```

The main window enables `contextIsolation` and Renderer sandboxing and disables Node.js integration in the Renderer. The backend receives only the environment required to run; Desktop does not expose the complete credential list to the Renderer.

## Data and network behavior

| Data | Location or behavior |
| --- | --- |
| Desktop window state and kernel pointer | Electron user-data directory |
| Distribution settings and sessions | Isolated Desktop DSH Home |
| Updatable Harness runtimes | `runtime/` below the Desktop user-data directory |
| Startup log | `%TEMP%\dsh-desktop.log` |
| API keys and sessions | Stored locally by Harness/credential storage |

Model requests and balance queries contact DeepSeek services. Kernel checks contact npm Registry. User-initiated login and top-up contact the DeepSeek Open Platform. Desktop Setup downloads come from GitHub Releases. See [PRIVACY.md](PRIVACY.md) for details.

## System requirements

- Windows 10 or Windows 11, x64.
- Network access to the configured model provider.
- Approximately 600 MB or more of free disk space for installation, runtime updates, and cache.
- No system-wide Node.js, npm, pnpm, or Harness CLI installation is required.

macOS, Linux, and Windows ARM64 installers are not currently provided.

## Development

Desktop source lives under `apps/desktop` in the fork:

```powershell
git clone https://github.com/Dr1empty/deepseek-harness-desktop.git
cd deepseek-harness-desktop\apps\desktop
npm ci
npm test
npm start
```

When developed inside the fork, Desktop automatically discovers the Harness source at the repository root. A standalone checkout may set `DSH_SOURCE_ROOT` to a Harness source directory.

### Build the Windows Setup

```powershell
npm run release:desktop
```

The build:

1. Downloads and verifies the Node.js 24.18.0 Windows x64 runtime.
2. Installs Harness 0.1.1-rc.2 from the lockfile.
3. Verifies that distribution configuration contains no third-party add-on plugins.
4. Builds `win-unpacked` and the NSIS Setup.
5. Generates `latest.yml` for electron-updater, plus `SHA256SUMS.txt` and `release-manifest.json`.

Generated directories are ignored by Git:

- `build/desktop-harness/`
- `vendor/node/`
- `dist-desktop/`
- `dist-desktop-installer/`

## Project structure

```text
src/main.js                     Electron lifecycle, window, and IPC
src/backend.js                  Harness process, port, readiness, and link maintenance
src/preload.js                  Settings UI for updates, usage, and top-up
src/desktop-updater.js          GitHub release checks, download progress, and Desktop installation
src/updater.js                  Verified installation and switching of npm kernels
src/usage.js                    Local usage aggregation and official balance query
src/payment.js                  Official orders, controlled login, and QR payments
tests/                          Desktop unit tests
build/prepare-desktop.cjs       Reproducible runtime preparation
build/make-release-metadata.cjs Release checksums and manifest
electron-builder-desktop*.yml   Windows directory and NSIS build configuration
```

## Validation status

Desktop 1.1.5 has passed:

- 23 Node unit tests;
- a real Windows x64 NSIS Setup build;
- packaged backend-start and page-load smoke testing;
- a local startup regression with four external plugins in the maintainer profile;
- GitHub Actions dependency installation, tests, Setup build, verification, and artifact upload from a clean runner;
- Release Setup, blockmap, `latest.yml`, SHA-256, and machine-readable manifest verification.

## Current limitations

- The Desktop Setup is not commercially code-signed.
- Local usage may be lower than official billing after sessions are deleted, moved, or recorded by an older runtime.
- Changes to DeepSeek Open Platform login, balance, or payment APIs may affect top-up.
- Compatibility of user-installed plugins is controlled by the plugin and local profile, not guaranteed by the plugin-free distribution.

## Relationship to upstream

- Upstream: [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)
- This fork: [Dr1empty/deepseek-harness-desktop](https://github.com/Dr1empty/deepseek-harness-desktop)
- Desktop source: [apps/desktop](https://github.com/Dr1empty/deepseek-harness-desktop/tree/master/apps/desktop)
- Desktop Release: [v1.1.5-desktop](https://github.com/Dr1empty/deepseek-harness-desktop/releases/tag/v1.1.5-desktop)

Upstream Harness code and trademarks remain subject to upstream licenses and policies. Desktop-owned code is released under the [MIT License](LICENSE). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for third-party notices and [CHANGELOG.md](CHANGELOG.md) for version history.
