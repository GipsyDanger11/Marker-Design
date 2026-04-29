# Custom Marker Detection — Android App

React Native Android app that detects custom visual markers in real-time using OpenCV.

## Requirements
- Android device with camera (Android 8+)
- Node.js 20+, JDK 17+, Android SDK

## Setup

```bash
# 1. Clone
git clone <repo-url>
cd "Marker Design"

# 2. Install JS deps
cd MarkerDetector
npm install

# 3. Start Metro
npx react-native start --reset-cache

# 4. Build & install (device connected via USB with USB debugging on)
adb reverse tcp:8081 tcp:8081
npx react-native run-android
```

## Project Structure
```
Marker Design/
├── marker_generator.py      # Generates 20 marker PNG files
├── marker_detector.py       # Python reference detector
├── markers/                 # 20 generated marker images
├── APPROACH.md              # Technical approach document
└── MarkerDetector/          # React Native Android app
    ├── App.tsx              # Main UI
    ├── src/
    │   ├── hooks/useMarkerDetection.ts
    │   └── native/MarkerDetector.ts
    └── android/app/src/main/java/com/markerdetector/
        ├── MarkerDetectorModule.kt   # OpenCV detection pipeline
        └── MarkerDetectorPackage.kt
```

## Generating Markers

```bash
pip install opencv-python numpy
python marker_generator.py
# Creates markers/marker_000001.png through marker_000020.png
```

## Marker Design

5×5 grid, black border, diagonal orientation triangle in top-left cell.
24 data bits (≥ 62.5% white area). See `APPROACH.md` for full specification.

## Building APK

```bash
cd MarkerDetector/android
.\gradlew assembleRelease
# APK → android/app/build/outputs/apk/release/app-release-unsigned.apk
```
