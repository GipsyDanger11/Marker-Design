package com.markerdetector

import android.util.Base64
import com.facebook.react.bridge.*
import org.opencv.core.*
import org.opencv.imgcodecs.Imgcodecs
import org.opencv.imgproc.Imgproc
import java.util.ArrayList

class MarkerDetectorModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        private const val GRID_SIZE = 5
        private const val MIN_AREA = 800.0       // was 2000 — now more lenient
        private const val WARP_SIZE = 300
        private const val MAX_ASPECT_RATIO = 1.5  // was 1.35 — allows more perspective
    }

    override fun getName(): String = "MarkerDetector"

    // ─────────────────────────────────────────────────────────────────────────
    // Public API exposed to JavaScript
    // ─────────────────────────────────────────────────────────────────────────
    @ReactMethod
    fun detectMarker(base64Image: String, promise: Promise) {
        try {
            // 1. Decode Base64 → OpenCV Mat
            val bytes = Base64.decode(base64Image, Base64.DEFAULT)
            val raw = Mat(1, bytes.size, CvType.CV_8UC1).apply { put(0, 0, bytes) }
            val frame = Imgcodecs.imdecode(raw, Imgcodecs.IMREAD_COLOR)
            if (frame.empty()) { promise.resolve(null); return }

            // 2. Grayscale
            val gray = Mat()
            Imgproc.cvtColor(frame, gray, Imgproc.COLOR_BGR2GRAY)

            // 3. Adaptive threshold (handles uneven lighting)
            val binary = Mat()
            Imgproc.adaptiveThreshold(
                gray, binary, 255.0,
                Imgproc.ADAPTIVE_THRESH_GAUSSIAN_C,
                Imgproc.THRESH_BINARY_INV, 11, 2.0
            )

            // 4. Morphological closing to seal broken borders
            val kernel = Imgproc.getStructuringElement(Imgproc.MORPH_RECT, Size(3.0, 3.0))
            Imgproc.morphologyEx(binary, binary, Imgproc.MORPH_CLOSE, kernel)

            // 5. Find contours
            val contours = ArrayList<MatOfPoint>()
            Imgproc.findContours(binary, contours, Mat(), Imgproc.RETR_EXTERNAL, Imgproc.CHAIN_APPROX_SIMPLE)

            // 6. Filter for square candidates
            var bestSquare: MatOfPoint2f? = null
            var bestArea = 0.0

            for (contour in contours) {
                val area = Imgproc.contourArea(contour)
                if (area < MIN_AREA) continue

                val c2f = MatOfPoint2f(*contour.toArray())
                val peri = Imgproc.arcLength(c2f, true)
                val approx = MatOfPoint2f()
                Imgproc.approxPolyDP(c2f, approx, 0.02 * peri, true)
                if (approx.rows() != 4) continue

                val rect = Imgproc.minAreaRect(c2f)
                val ratio = maxOf(rect.size.width, rect.size.height) /
                            minOf(rect.size.width, rect.size.height)
                if (ratio > MAX_ASPECT_RATIO) continue

                if (area > bestArea) { bestArea = area; bestSquare = approx }
            }

            if (bestSquare == null) { promise.resolve(null); return }

            // 7. Perspective warp → top-down WARP_SIZE × WARP_SIZE view
            val corners = orderCorners(bestSquare.toArray())
            val dst = MatOfPoint2f(
                Point(0.0, 0.0), Point(WARP_SIZE.toDouble(), 0.0),
                Point(WARP_SIZE.toDouble(), WARP_SIZE.toDouble()), Point(0.0, WARP_SIZE.toDouble())
            )
            val M = Imgproc.getPerspectiveTransform(MatOfPoint2f(*corners), dst)
            val warped = Mat()
            Imgproc.warpPerspective(gray, warped, M, Size(WARP_SIZE.toDouble(), WARP_SIZE.toDouble()))

            // 8. Otsu threshold the warped marker
            val warpBin = Mat()
            Imgproc.threshold(warped, warpBin, 0.0, 255.0, Imgproc.THRESH_BINARY + Imgproc.THRESH_OTSU)

            // 9. Detect orientation (check all 4 rotations)
            val rotation = detectOrientation(warpBin)
            if (rotation < 0) { promise.resolve(null); return }

            // 10. Rotate the warped binary to canonical orientation
            val aligned = rotateMat(warpBin, rotation)

            // 11. Decode 24 data bits
            val markerId = decodeGrid(aligned)
            if (markerId < 0) { promise.resolve(null); return }

            // 12. Return 300×300 crop as Base64 PNG
            val resized = Mat()
            Imgproc.resize(aligned, resized, Size(300.0, 300.0))
            val buf = MatOfByte()
            Imgcodecs.imencode(".png", resized, buf)
            val croppedB64 = Base64.encodeToString(buf.toArray(), Base64.NO_WRAP)

            val result = Arguments.createMap().apply {
                putInt("id", markerId)
                putString("image", croppedB64)
            }
            promise.resolve(result)

        } catch (e: Exception) {
            promise.reject("DETECT_ERROR", e.message)
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────────────

    /** Order 4 corners: TL, TR, BR, BL */
    private fun orderCorners(pts: Array<Point>): Array<Point> {
        val byX = pts.sortedBy { it.x }
        val left  = byX.take(2).sortedBy { it.y }
        val right = byX.drop(2).sortedBy { it.y }
        return arrayOf(left[0], right[0], right[1], left[1])
    }

    /**
     * Rotate OpenCV Mat by 0/90/180/270 degrees.
     * rotation: 0=0°, 1=90°CW, 2=180°, 3=270°CW
     */
    private fun rotateMat(src: Mat, rotation: Int): Mat {
        if (rotation == 0) return src
        val dst = Mat()
        val code = when (rotation) {
            1 -> Core.ROTATE_90_CLOCKWISE
            2 -> Core.ROTATE_180
            else -> Core.ROTATE_90_COUNTERCLOCKWISE
        }
        Core.rotate(src, dst, code)
        return dst
    }

    /**
     * Try all 4 rotations and return the one whose TL cell
     * has black in the top-right triangle and white in the bottom-left triangle.
     * Returns -1 if no valid orientation is found.
     */
    private fun detectOrientation(bin: Mat): Int {
        val cellSize = WARP_SIZE / GRID_SIZE
        for (rot in 0..3) {
            val rotated = rotateMat(bin, rot)
            val cell = rotated.submat(0, cellSize, 0, cellSize)

            // Top-right quadrant → should be BLACK (0 mean in BINARY_INV image means dark)
            val trMean = regionMean(cell, 0, cellSize / 2, cellSize / 2, cellSize)
            // Bottom-left quadrant → should be WHITE
            val blMean = regionMean(cell, cellSize / 2, cellSize, 0, cellSize / 2)

            // In an inverted binary: black marker = high pixel value (255), white = 0
            // After Otsu (non-inverted): black=0, white=255
            if (trMean < 80.0 && blMean > 170.0) return rot
        }
        return -1
    }

    private fun regionMean(mat: Mat, rowStart: Int, rowEnd: Int, colStart: Int, colEnd: Int): Double {
        val roi = mat.submat(rowStart, rowEnd, colStart, colEnd)
        return Core.mean(roi).`val`[0]
    }

    /**
     * Read 24 data bits from the 5×5 grid (skip [0,0] = orientation cell).
     * Black cell (mean < 127) = 1, White cell (mean >= 127) = 0.
     * Returns decoded integer ID, or -1 if 60% white rule is violated.
     */
    private fun decodeGrid(bin: Mat): Int {
        val cellSize = WARP_SIZE / GRID_SIZE
        val bits = StringBuilder()

        for (row in 0 until GRID_SIZE) {
            for (col in 0 until GRID_SIZE) {
                if (row == 0 && col == 0) continue   // skip orientation cell

                val margin = cellSize / 4
                val y = row * cellSize + margin
                val x = col * cellSize + margin
                val s = cellSize - 2 * margin

                val cell = bin.submat(y, y + s, x, x + s)
                val mean = Core.mean(cell).`val`[0]
                bits.append(if (mean < 127.0) "1" else "0")
            }
        }

        val binaryStr = bits.toString()

        // Enforce 60% white (≤ 9 black bits out of 24)
        val blackBits = binaryStr.count { it == '1' }
        if (blackBits > 9) return -1

        return binaryStr.toInt(2)
    }
}
