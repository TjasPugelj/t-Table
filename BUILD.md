# Building the beta APK

The app currently runs inside Expo Go. To get a real installable app — its own
icon, its own name, notifications that behave properly — build it with EAS
(Expo's cloud build service, free tier is enough).

## One time

```
npm install -g eas-cli
eas login
```

`eas login` asks for an Expo account. Create one at expo.dev first if you don't
have one — email + password, nothing else needed.

## Build

```
cd /d D:\Untis-App
eas build --profile preview --platform android
```

Answer the prompts:

| Prompt | Answer |
|---|---|
| "Would you like to automatically create an EAS project?" | **yes** |
| "Generate a new Android Keystore?" | **yes** (EAS stores it for you) |

It uploads the project and builds in the cloud — usually 5–15 minutes including
queue time. When it finishes the terminal prints a URL and a QR code. Open that
URL on the phone, download the `.apk` and install it (Android will ask you to
allow installs from the browser once).

## What "preview" means here

`eas.json` defines three profiles:

- **preview** — a plain APK you can sideload. This is the beta build.
- **development** — an APK with the dev client, so `npx expo start` connects to
  it like Expo Go but with full native modules. Use this if you want live
  reloading *and* working notifications.
- **production** — an `.aab` bundle, only needed for the Play Store.

## Next builds

Bump `expo.version` and `expo.android.versionCode` in `app.json`, then run the
same build command. The keystore is reused automatically, so the new APK
installs over the old one and keeps its data.

## Notes

- Local scheduled notifications work in the APK without the Expo Go warnings.
- The app id is `com.tjas.urnik`; changing it later means a fresh install.
- Nothing in the app talks to a server of ours — it only calls WebUntis
  directly, and everything you configure lives in the phone's own storage.
