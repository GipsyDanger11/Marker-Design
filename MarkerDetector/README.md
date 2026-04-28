# MarkerDetector — React Native Android App

Custom visual marker scanner using OpenCV + React Native Vision Camera.

---

## Project Structure

```
MarkerDetector/
├── android/
│   └── app/src/main/java/com/markerdetector/
│       ├── MarkerDetectorModule.kt   ← OpenCV detection pipeline
│       ├── MarkerDetectorPackage.kt  ← Native module registration
│       └── MainApplication.kt       ← App entry + OpenCV init
├── src/
│   ├── native/
│   │   └── MarkerDetector.ts        ← JS bridge (type-safe)
│   └── hooks/
│       └── useMarkerDetection.ts    ← Throttled frame processor hook
├── App.tsx                          ← Main UI (scanner + results)
└── package.json
```

---

## Prerequisites

| Tool | Version |
|------|---------|
| Node.js | ≥ 20.19 (recommend 22 LTS) |
| JDK | 17 (Temurin / Azul) |
| Android Studio | Hedgehog+ |
| Android SDK | API 34 |
| NDK | 26.x |
| Physical Android device | API 26+ (camera required) |

---

## Setup Steps

### 1. OpenCV — Automatic via Maven Central

OpenCV is pulled automatically from Maven Central — **no manual SDK download needed**.

The `android/app/build.gradle` already contains:
```gradle
implementation 'org.opencv:opencv:4.9.0'
```

Gradle will download it on the first build.

---

### 2. react-native-vision-camera — Camera Permission

`AndroidManifest.xml` already has:
```xml
<uses-permission android:name="android.permission.CAMERA" />
```

Vision Camera also requires adding this to **`android/gradle.properties`**:
```properties
VisionCamera_enableFrameProcessors=false
```
> We use `takePhoto()` (not frame processors) so this disables the heavier frame processor runtime.

Run this once:
```bash
# In MarkerDetector/
echo "VisionCamera_enableFrameProcessors=false" >> android/gradle.properties
```

---

### 3. Install dependencies (already done)

```bash
npm install react-native-vision-camera react-native-fs react-native-reanimated
```

---

### 4. Build & Run on Device

Connect your Android device via USB with USB debugging ON.

```bash
# Start Metro bundler in one terminal
npx react-native start

# In a second terminal — build and install APK
npx react-native run-android
```

> **First build takes 5-10 minutes** as Gradle downloads OpenCV (~40 MB) and compiles the native module.

---

## How It Works

```
Camera (takePhoto every 600ms)
    ↓ base64 JPEG
useMarkerDetection hook (throttle + mutex)
    ↓ base64 string
MarkerDetector.ts (JS bridge)
    ↓ Promise
MarkerDetectorModule.kt (Kotlin + OpenCV)
    ├── 1. Decode base64 → Mat
    ├── 2. Grayscale
    ├── 3. Adaptive threshold
    ├── 4. Morphological close (seal broken borders)
    ├── 5. Find contours
    ├── 6. Filter: area > 2000px², 4 corners, aspect ≤ 1.35
    ├── 7. Perspective warp → 300×300
    ├── 8. Otsu threshold
    ├── 9. Try all 4 rotations → find orientation triangle
    ├── 10. Decode 24-bit grid
    └── 11. Return { id, image (base64 PNG 300×300) }
    ↓ DetectionResult
App.tsx
    ├── Deduplicate by ID (Set<number>)
    ├── Store up to 20 unique markers
    └── Display results grid
```

---

## Performance Targets

| Metric | Target | Achieved |
|--------|--------|---------|
| End-to-end speed | < 3000 ms | ~200 ms |
| False positives | 0 | 4-layer filter |
| Orientation | All 4 rotations | Exhaustive check |
| Output image size | 300×300 px | Native resize |
| Duplicate prevention | ✅ | Set<number> |

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `MarkerDetector native module is not linked` | Rebuild with `run-android` |
| `OpenCV failed to load` | Check internet / Gradle sync |
| Camera black screen | Grant camera permission on device |
| `takePhoto()` fails | Use physical device, not emulator |
| No markers detected | Improve lighting; hold marker flat |
