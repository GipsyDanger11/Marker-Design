/**
 * App.tsx — Marker Scanner UI
 *
 * Features:
 *  • Full-screen live camera feed (back camera, highest available resolution)
 *  • Scanning overlay with animated corner brackets
 *  • Auto-deduplication via Set<number>
 *  • Auto-stops after 20 unique markers are collected
 *  • Results screen: 4-column grid, each card 300×300px marker image + ID badge
 *  • Dark, premium design with green accent colour
 */

import React, {
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
} from 'react';
import {
  View,
  Text,
  FlatList,
  Image,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  Alert,
  Animated,
  Dimensions,
  ActivityIndicator,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useCameraFormat,
} from 'react-native-vision-camera';
import RNFS from 'react-native-fs';
import { useMarkerDetection } from './src/hooks/useMarkerDetection';
import type { DetectionResult } from './src/native/MarkerDetector';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────
const MAX_MARKERS = 20;
const CAPTURE_INTERVAL_MS = 400; // faster capture = more detection attempts
const { width: SCREEN_W } = Dimensions.get('window');
const CARD_SIZE = (SCREEN_W - 40) / 4;

interface MarkerRecord extends DetectionResult {
  timestamp: number;
  index: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Animated scan-line component
// ─────────────────────────────────────────────────────────────────────────────
function ScanLine() {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 1800, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0, duration: 1800, useNativeDriver: true }),
      ]),
    ).start();
  }, [anim]);

  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [-110, 110] });
  return (
    <Animated.View style={[styles.scanLine, { transform: [{ translateY }] }]} />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Corner bracket SVG-like corners using Views
// ─────────────────────────────────────────────────────────────────────────────
function CornerBrackets() {
  const corners = [
    { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 8 },
    { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 8 },
    { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 8 },
    { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 8 },
  ];
  return (
    <>
      {corners.map((style, i) => (
        <View key={i} style={[styles.corner, style]} />
      ))}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Marker detail modal
// ─────────────────────────────────────────────────────────────────────────────
function MarkerDetailModal({
  item,
  onClose,
}: {
  item: MarkerRecord | null;
  onClose: () => void;
}) {
  if (!item) return null;
  const binary = item.id.toString(2).padStart(24, '0');
  const time   = new Date(item.timestamp).toLocaleTimeString();
  return (
    <Modal visible animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Marker #{item.index} — ID {item.id}</Text>
          <Image
            source={{ uri: `data:image/png;base64,${item.image}` }}
            style={styles.modalImage}
            resizeMode="contain"
          />
          <View style={styles.modalMeta}>
            <Text style={styles.modalLabel}>Binary (24-bit)</Text>
            <Text style={styles.modalBinary}>
              {binary.match(/.{1,6}/g)?.join('  ')}
            </Text>
            <Text style={styles.modalLabel}>Decimal ID</Text>
            <Text style={styles.modalValue}>{item.id}</Text>
            <Text style={styles.modalLabel}>Detected at</Text>
            <Text style={styles.modalValue}>{time}</Text>
          </View>
          <TouchableOpacity style={styles.modalClose} onPress={onClose}>
            <Text style={styles.modalCloseText}>✕  Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function MarkerCard({
  item,
  onPress,
}: {
  item: MarkerRecord;
  onPress: (item: MarkerRecord) => void;
}) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }).start();
  }, [fadeAnim]);

  return (
    <Animated.View style={[styles.card, { opacity: fadeAnim }]}>
      <TouchableOpacity onPress={() => onPress(item)} activeOpacity={0.75}>
        <Image
          source={{ uri: `data:image/png;base64,${item.image}` }}
          style={styles.cardImage}
          resizeMode="contain"
        />
        <View style={styles.cardBadge}>
          <Text style={styles.cardIndex}>#{item.index}</Text>
        </View>
        <Text style={styles.cardId}>ID {item.id}</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main App
// ─────────────────────────────────────────────────────────────────────────────
export default function App() {
  const [markers,    setMarkers]    = useState<MarkerRecord[]>([]);
  const [isScanning, setIsScanning] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [frameCount, setFrameCount] = useState(0);
  const [lastStatus, setLastStatus] = useState('Waiting...');
  const [selectedMarker, setSelectedMarker] = useState<MarkerRecord | null>(null);

  const detectedIds = useRef(new Set<number>());
  const cameraRef = useRef<InstanceType<typeof Camera>>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Camera setup ────────────────────────────────────────────────────────
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('back');

  // Select a format with photo resolution between 2000-3000px (assignment requirement)
  const format = useCameraFormat(device, [
    { photoResolution: { width: 2500, height: 2500 } },
  ]);

  useEffect(() => {
    if (!hasPermission) requestPermission();
  }, [hasPermission, requestPermission]);

  // ── Detection callback (memoised, deduplication inside) ─────────────────
  const handleDetection = useCallback(
    (result: DetectionResult) => {
      if (detectedIds.current.has(result.id)) {
        setLastStatus(`Duplicate ID ${result.id} skipped`);
        return;
      }
      if (detectedIds.current.size >= MAX_MARKERS) return;

      const index = detectedIds.current.size + 1;
      detectedIds.current.add(result.id);
      setLastStatus(`✅ Detected ID: ${result.id}`);

      const record: MarkerRecord = { ...result, timestamp: Date.now(), index };
      setMarkers(prev => [...prev, record]);

      if (detectedIds.current.size >= MAX_MARKERS) {
        setIsScanning(false);
        Alert.alert(
          '🎉 Scan Complete!',
          `All ${MAX_MARKERS} unique markers detected.`,
          [{ text: 'View Results', style: 'default' }],
        );
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const processFrame = useMarkerDetection(handleDetection);

  // ── Periodic capture loop ────────────────────────────────────────────────
  useEffect(() => {
    if (!isScanning) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }

    intervalRef.current = setInterval(async () => {
      if (!cameraRef.current) return;
      try {
        setIsProcessing(true);
        const photo = await cameraRef.current.takePhoto({
          flash: 'off',
        });
        const base64 = await RNFS.readFile(photo.path, 'base64');
        setFrameCount(c => c + 1);
        setLastStatus('Processing frame...');
        console.log('[MarkerScanner] Frame captured, sending to detector');
        processFrame(base64);
        RNFS.unlink(photo.path).catch(() => {});
      } catch (e: any) {
        console.log('[MarkerScanner] Frame error:', e?.message);
        setLastStatus('Frame error: ' + (e?.message ?? 'unknown'));
      } finally {
        setIsProcessing(false);
      }
    }, CAPTURE_INTERVAL_MS);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isScanning, processFrame]);

  // ── Progress bar width ───────────────────────────────────────────────────
  const progressWidth = useMemo(
    () => `${(markers.length / MAX_MARKERS) * 100}%`,
    [markers.length],
  );

  // ── Render: permission not granted ──────────────────────────────────────
  if (!hasPermission) {
    return (
      <SafeAreaView style={styles.centered} edges={['top','bottom']}>
        <Text style={styles.permText}>Camera permission is required.</Text>
        <TouchableOpacity style={styles.permBtn} onPress={requestPermission}>
          <Text style={styles.permBtnText}>Grant Permission</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  // ── Render: no camera device ─────────────────────────────────────────────
  if (!device) {
    return (
      <SafeAreaView style={styles.centered} edges={['top','bottom']}>
        <ActivityIndicator color="#4ade80" size="large" />
        <Text style={styles.permText}>Initialising camera…</Text>
      </SafeAreaView>
    );
  }

  // ── Main render ──────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <StatusBar barStyle="light-content" backgroundColor="#0a0a0a" translucent={false} />

      {/* ── Header ── */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Marker Scanner</Text>
          <Text style={styles.headerSub}>
            {isScanning
              ? `Scanning… ${markers.length}/${MAX_MARKERS}`
              : `Complete — ${markers.length} markers collected`}
          </Text>
        </View>
        <View style={styles.counterPill}>
          <Text style={styles.counterText}>
            {markers.length}/{MAX_MARKERS}
          </Text>
        </View>
      </View>

      {/* ── Progress bar ── */}
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: progressWidth as any }]} />
      </View>

      {/* ── Camera / Results ── */}
      {isScanning ? (
        <View style={styles.cameraWrapper}>
          <Camera
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            device={device}
            isActive={isScanning}
            photo
            format={format}
          />

          {/* Dark vignette overlay */}
          <View style={styles.vignette} pointerEvents="none" />

          {/* Scan box */}
          <View style={styles.scanFrame}>
            <CornerBrackets />
            <ScanLine />
            {isProcessing && (
              <View style={styles.processingDot} />
            )}
          </View>

          {/* Debug overlay */}
          <View style={styles.debugOverlay}>
            <Text style={styles.debugText}>📷 Frames: {frameCount}</Text>
            <Text style={styles.debugText}>🔍 {lastStatus}</Text>
            <Text style={styles.debugText}>✅ Found: {markers.length}/{MAX_MARKERS}</Text>
          </View>

          {/* Hint text */}
          <Text style={styles.hintText}>
            Point camera at a printed marker — hold steady 20cm away
          </Text>
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          {markers.length === 0 ? (
            <View style={styles.centered}>
              <Text style={{ color: '#666', fontSize: 16, textAlign: 'center', paddingHorizontal: 30 }}>
                No markers detected yet.{'\n'}Resume scanning to find markers.
              </Text>
            </View>
          ) : (
            <FlatList
              data={markers}
              keyExtractor={item => item.id.toString()}
              numColumns={4}
              contentContainerStyle={styles.grid}
              showsVerticalScrollIndicator={false}
              renderItem={({ item }) => (
                <MarkerCard item={item} onPress={setSelectedMarker} />
              )}
            />
          )}
        </View>
      )}


      {/* ── Marker detail modal ── */}
      <MarkerDetailModal
        item={selectedMarker}
        onClose={() => setSelectedMarker(null)}
      />

      {/* ── Bottom controls ── */}
      <View style={styles.controls}>
        <TouchableOpacity
          style={[styles.btn, isScanning ? styles.btnStop : styles.btnScan]}
          onPress={() => setIsScanning(s => !s)}
          activeOpacity={0.85}
        >
          <Text style={styles.btnText}>
            {isScanning ? '⏹  Stop & View Results' : '▶  Resume Scanning'}
          </Text>
        </TouchableOpacity>

        {!isScanning && markers.length > 0 && (
          <TouchableOpacity
            style={styles.btnReset}
            onPress={() => {
              detectedIds.current.clear();
              setMarkers([]);
              setIsScanning(true);
            }}
            activeOpacity={0.85}
          >
            <Text style={styles.btnText}>↺  Reset</Text>
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────
const GREEN = '#4ade80';
const BG = '#0a0a0a';
const SURFACE = '#151515';
const BORDER = '#252525';

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  centered: { flex: 1, backgroundColor: BG, justifyContent: 'center', alignItems: 'center', gap: 16 },

  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 14,
    backgroundColor: SURFACE,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  headerTitle: { fontSize: 20, fontWeight: '700', color: '#ffffff', letterSpacing: 0.3 },
  headerSub: { fontSize: 12, color: '#888', marginTop: 2 },
  counterPill: {
    backgroundColor: '#162a1e',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#2d5c3f',
  },
  counterText: { fontSize: 14, color: GREEN, fontWeight: '700' },

  // Progress
  progressTrack: { height: 3, backgroundColor: BORDER },
  progressFill: { height: 3, backgroundColor: GREEN },

  // Camera
  cameraWrapper: { flex: 1, overflow: 'hidden' },
  vignette: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'transparent',
    borderWidth: 50,
    borderColor: 'rgba(0,0,0,0.55)',
  },
  scanFrame: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: 230,
    height: 230,
    marginTop: -115,
    marginLeft: -115,
    justifyContent: 'center',
    alignItems: 'center',
  },
  corner: {
    position: 'absolute',
    width: 28,
    height: 28,
    borderColor: GREEN,
  },
  scanLine: {
    width: '90%',
    height: 2,
    backgroundColor: GREEN,
    opacity: 0.75,
    borderRadius: 1,
  },
  processingDot: {
    position: 'absolute',
    top: -28,
    right: -28,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: GREEN,
  },
  hintText: {
    position: 'absolute',
    bottom: 40,
    left: 0,
    right: 0,
    textAlign: 'center',
    color: 'rgba(255,255,255,0.55)',
    fontSize: 13,
  },

  // Results grid
  grid: { padding: 10, paddingBottom: 20 },
  card: {
    width: CARD_SIZE,
    margin: 5,
    backgroundColor: SURFACE,
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
  },
  cardImage: { width: CARD_SIZE, height: CARD_SIZE },
  cardBadge: {
    position: 'absolute',
    top: 4,
    left: 4,
    backgroundColor: 'rgba(0,0,0,0.65)',
    borderRadius: 6,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  cardIndex: { fontSize: 10, color: GREEN, fontWeight: '700' },
  cardId: { fontSize: 10, color: '#888', paddingVertical: 5 },

  // Controls
  controls: {
    padding: 14,
    gap: 10,
    backgroundColor: SURFACE,
    borderTopWidth: 1,
    borderTopColor: BORDER,
  },
  btn: { paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  btnStop: { backgroundColor: '#7f1d1d' },
  btnScan: { backgroundColor: '#14532d' },
  btnReset: {
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    backgroundColor: '#1c1c1c',
    borderWidth: 1,
    borderColor: BORDER,
  },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 15 },

  // Debug overlay
  debugOverlay: {
    position: 'absolute',
    top: 16,
    left: 16,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 8,
    padding: 8,
    gap: 2,
  },
  debugText: {
    color: '#0f0',
    fontSize: 11,
    fontFamily: 'monospace',
  },

  // Permission
  permText: { color: '#888', fontSize: 15, textAlign: 'center', paddingHorizontal: 32 },
  permBtn: {
    backgroundColor: GREEN,
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 10,
  },
  permBtnText: { color: '#000', fontWeight: '700', fontSize: 15 },

  // Modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    backgroundColor: '#151515',
    borderRadius: 18,
    width: '100%',
    maxWidth: 360,
    padding: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#252525',
    gap: 14,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: 0.3,
  },
  modalImage: {
    width: 260,
    height: 260,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#252525',
  },
  modalMeta: {
    width: '100%',
    gap: 4,
  },
  modalLabel: {
    fontSize: 11,
    color: '#555',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: 8,
  },
  modalBinary: {
    fontSize: 13,
    color: GREEN,
    fontFamily: 'monospace',
    letterSpacing: 1,
  },
  modalValue: {
    fontSize: 16,
    color: '#fff',
    fontWeight: '600',
  },
  modalClose: {
    width: '100%',
    paddingVertical: 13,
    borderRadius: 12,
    backgroundColor: '#1c1c1c',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#333',
    marginTop: 4,
  },
  modalCloseText: {
    color: '#aaa',
    fontSize: 15,
    fontWeight: '600',
  },
});
