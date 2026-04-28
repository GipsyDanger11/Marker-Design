/**
 * useMarkerDetection.ts
 * Throttled frame-processing hook.
 * - Processes one frame every INTERVAL_MS (500 ms by default)
 * - Uses a mutex flag so frames never overlap
 * - Calls onDetected only for genuinely decoded markers
 */

import { useRef, useCallback } from 'react';
import { detectMarker, DetectionResult } from '../native/MarkerDetector';

const INTERVAL_MS = 500; // max 2 detection attempts per second

export function useMarkerDetection(
  onDetected: (result: DetectionResult) => void,
) {
  const lastAt = useRef<number>(0);
  const busy = useRef<boolean>(false);

  const processFrame = useCallback(
    async (base64: string) => {
      const now = Date.now();

      // Throttle: skip if called too soon
      if (now - lastAt.current < INTERVAL_MS) return;
      // Mutex: skip if a detection is already running
      if (busy.current) return;

      busy.current = true;
      lastAt.current = now;

      try {
        const result = await detectMarker(base64);
        if (result !== null) {
          onDetected(result);
        }
      } finally {
        busy.current = false;
      }
    },
    [onDetected],
  );

  return processFrame;
}
