/**
 * MarkerDetector.ts
 * Type-safe JavaScript bridge to the native Kotlin MarkerDetectorModule.
 */

import { NativeModules, Platform } from 'react-native';

export interface DetectionResult {
  /** Decoded integer marker ID (0 – 16,777,215) */
  id: number;
  /** 300×300 PNG of the detected marker, base64-encoded */
  image: string;
}

const LINKING_ERROR =
  `MarkerDetector native module is not linked.\n` +
  `On Android: ensure MarkerDetectorPackage is added in MainApplication.kt.\n` +
  `Then run: npx react-native run-android`;

const { MarkerDetector: _native } = NativeModules;

if (!_native && Platform.OS === 'android') {
  console.warn(LINKING_ERROR);
}

/**
 * Sends a Base64-encoded JPEG/PNG frame to the native OpenCV detector.
 * Returns null if no valid marker was found or an error occurred.
 */
export async function detectMarker(
  base64Frame: string,
): Promise<DetectionResult | null> {
  if (!_native) return null;
  try {
    const result: DetectionResult | null = await _native.detectMarker(base64Frame);
    return result;
  } catch (err) {
    // Silently swallow detection errors (bad frame, corrupted image, etc.)
    return null;
  }
}
