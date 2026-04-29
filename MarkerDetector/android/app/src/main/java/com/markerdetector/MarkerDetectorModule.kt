package com.markerdetector

import android.util.Base64
import android.util.Log
import com.facebook.react.bridge.*
import org.opencv.core.*
import org.opencv.imgcodecs.Imgcodecs
import org.opencv.imgproc.Imgproc
import java.util.ArrayList

class MarkerDetectorModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        private const val TAG       = "MarkerDetector"
        private const val GRID_SIZE = 5
        private const val WARP_SIZE = 300
        private const val CELL      = WARP_SIZE / GRID_SIZE   // 60 px per cell
        private const val MIN_AREA  = 500.0
    }

    override fun getName(): String = "MarkerDetector"

    @ReactMethod
    fun detectMarker(base64Image: String, promise: Promise) {
        try {
            val bytes = Base64.decode(base64Image, Base64.DEFAULT)
            val raw   = Mat(1, bytes.size, CvType.CV_8UC1).apply { put(0, 0, bytes) }
            val frame = Imgcodecs.imdecode(raw, Imgcodecs.IMREAD_COLOR)
            if (frame.empty()) { promise.resolve(null); return }

            Log.d(TAG, "frame ${frame.width()}x${frame.height()}")

            val gray = Mat()
            Imgproc.cvtColor(frame, gray, Imgproc.COLOR_BGR2GRAY)
            val blurred = Mat()
            Imgproc.GaussianBlur(gray, blurred, Size(5.0, 5.0), 0.0)

            // Try multiple threshold configs
            val configs = listOf(
                Triple(11, 2.0, 3),
                Triple(15, 4.0, 5),
                Triple(21, 6.0, 5),
                Triple(7,  2.0, 3),
            )

            for ((block, c, kern) in configs) {
                val result = tryDetect(blurred, gray, block, c, kern)
                if (result != null) {
                    promise.resolve(result); return
                }
            }
            promise.resolve(null)
        } catch (e: Exception) {
            Log.e(TAG, "Exception: ${e.message}")
            promise.reject("DETECT_ERROR", e.message ?: "unknown")
        }
    }

    private fun tryDetect(
        blurred: Mat, gray: Mat,
        blockSize: Int, constant: Double, kernSize: Int
    ): WritableMap? {

        val binary = Mat()
        Imgproc.adaptiveThreshold(
            blurred, binary, 255.0,
            Imgproc.ADAPTIVE_THRESH_GAUSSIAN_C,
            Imgproc.THRESH_BINARY_INV,
            blockSize, constant
        )

        val kernel = Imgproc.getStructuringElement(
            Imgproc.MORPH_RECT, Size(kernSize.toDouble(), kernSize.toDouble())
        )
        Imgproc.morphologyEx(binary, binary, Imgproc.MORPH_CLOSE, kernel)

        // Try both contour retrieval modes
        for (mode in intArrayOf(Imgproc.RETR_EXTERNAL, Imgproc.RETR_LIST)) {
            val contours = ArrayList<MatOfPoint>()
            Imgproc.findContours(binary, contours, Mat(), mode, Imgproc.CHAIN_APPROX_SIMPLE)

            val squares = findAllSquares(contours)
            for (square in squares) {
                val result = tryDecodeSquare(gray, square)
                if (result != null) return result
            }
        }
        return null
    }

    /**
     * Warp the detected square region, then try to decode the marker.
     * The key insight: the detected contour is the OUTER BORDER of the marker.
     * We need to INSET the corners to skip the thick black border and only
     * capture the inner 5x5 grid area.
     */
    private fun tryDecodeSquare(gray: Mat, square: MatOfPoint2f): WritableMap? {
        val corners = orderCorners(square.toArray())

        // Inset corners by ~15% toward centroid to skip the thick border
        val inset = insetCorners(corners, 0.15)

        val dstPts = MatOfPoint2f(
            Point(0.0, 0.0),
            Point(WARP_SIZE.toDouble(), 0.0),
            Point(WARP_SIZE.toDouble(), WARP_SIZE.toDouble()),
            Point(0.0, WARP_SIZE.toDouble())
        )
        val M = Imgproc.getPerspectiveTransform(MatOfPoint2f(*inset), dstPts)
        val warped = Mat()
        Imgproc.warpPerspective(gray, warped, M,
            Size(WARP_SIZE.toDouble(), WARP_SIZE.toDouble()))

        // Otsu threshold
        val warpBin = Mat()
        Imgproc.threshold(warped, warpBin, 0.0, 255.0,
            Imgproc.THRESH_BINARY + Imgproc.THRESH_OTSU)

        // Try all 4 orientations, pick best
        val rotation = detectOrientation(warpBin)
        if (rotation < 0) return null

        val aligned = rotateMat(warpBin, rotation)

        // Decode grid
        val (markerId, conf) = decodeGrid(aligned)
        Log.d(TAG, "id=$markerId conf=${"%.2f".format(conf)}")
        if (markerId <= 0 || markerId > 20) return null
        if (conf < 0.60) { Log.d(TAG, "low confidence ${"%.2f".format(conf)}, skipped"); return null }

        // Encode 300x300 result PNG
        val out = Mat()
        Imgproc.resize(aligned, out, Size(300.0, 300.0), 0.0, 0.0, Imgproc.INTER_NEAREST)
        val buf = MatOfByte()
        Imgcodecs.imencode(".png", out, buf)
        val b64 = Base64.encodeToString(buf.toArray(), Base64.NO_WRAP)

        Log.d(TAG, "✓ DETECTED ID=$markerId conf=${"%.2f".format(conf)}")
        return Arguments.createMap().apply {
            putInt("id", markerId)
            putString("image", b64)
            putDouble("confidence", conf)
        }
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    /**
     * Find ALL valid square candidates (not just the best one).
     * Returns sorted by area descending.
     */
    private fun findAllSquares(contours: List<MatOfPoint>): List<MatOfPoint2f> {
        val result = mutableListOf<MatOfPoint2f>()

        for (contour in contours) {
            val area = Imgproc.contourArea(contour)
            if (area < MIN_AREA) continue

            val c2f = MatOfPoint2f(*contour.toArray())
            val peri = Imgproc.arcLength(c2f, true)
            val approx = MatOfPoint2f()
            Imgproc.approxPolyDP(c2f, approx, 0.04 * peri, true)
            if (approx.rows() != 4) continue

            val rect = Imgproc.minAreaRect(approx)
            val long_ = maxOf(rect.size.width, rect.size.height)
            val short_ = minOf(rect.size.width, rect.size.height)
            if (short_ < 1.0) continue
            if ((long_ / short_) > 1.5) continue

            result.add(approx)
        }

        // Sort by area descending — try largest squares first
        return result.sortedByDescending { Imgproc.contourArea(MatOfPoint(*it.toArray())) }
    }

    /** TL → TR → BR → BL */
    private fun orderCorners(pts: Array<Point>): Array<Point> {
        val sorted = pts.sortedBy { it.x }
        val left  = sorted.take(2).sortedBy { it.y }
        val right = sorted.drop(2).sortedBy { it.y }
        return arrayOf(left[0], right[0], right[1], left[1])
    }

    /**
     * Move each corner toward the centroid by a fraction.
     * fraction=0.15 means each corner moves 15% of the way to center.
     * This skips the thick black outer border of the marker.
     */
    private fun insetCorners(corners: Array<Point>, fraction: Double): Array<Point> {
        val cx = corners.map { it.x }.average()
        val cy = corners.map { it.y }.average()
        return corners.map { pt ->
            Point(
                pt.x + (cx - pt.x) * fraction,
                pt.y + (cy - pt.y) * fraction
            )
        }.toTypedArray()
    }

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
     * Detect orientation by checking the top-left cell [0,0] in each rotation.
     *
     * The orientation triangle has: j > i → BLACK (0), j <= i → WHITE (255)
     * So top-right quadrant should be dark, bottom-left should be bright.
     *
     * We use the SAME sampling regions as the Python reference:
     *   TR region: rows [h/4 .. 3h/4], cols [3w/4 .. w]    → should be BLACK (low mean)
     *   BL region: rows [3h/4 .. h],    cols [0 .. w/4]     → should be WHITE (high mean)
     *
     * Pick the rotation with the LARGEST (blMean - trMean) difference.
     */
    private fun detectOrientation(bin: Mat): Int {
        var bestRot = -1
        var bestDiff = 30.0  // minimum threshold

        for (rot in 0..3) {
            val rotated = rotateMat(bin, rot)
            val cell = rotated.submat(0, CELL, 0, CELL)
            val h = CELL
            val w = CELL

            // Match Python reference sampling regions exactly
            val hQ = h / 4
            val wQ = w / 4

            // Top-right region (center-right strip) → should be BLACK
            val trMean = regionMean(cell, hQ, 3 * hQ, 3 * wQ, w)
            // Bottom-left corner → should be WHITE
            val blMean = regionMean(cell, 3 * hQ, h, 0, wQ)

            val diff = blMean - trMean

            Log.d(TAG, "rot=$rot tr=${"%.0f".format(trMean)} bl=${"%.0f".format(blMean)} diff=${"%.0f".format(diff)}")

            if (diff > bestDiff) {
                bestDiff = diff
                bestRot = rot
            }
        }

        if (bestRot >= 0) {
            Log.d(TAG, "orientation: rot=$bestRot diff=${"%.0f".format(bestDiff)}")
        }
        return bestRot
    }

    private fun regionMean(mat: Mat, r0: Int, r1: Int, c0: Int, c1: Int): Double =
        Core.mean(mat.submat(r0, r1, c0, c1)).`val`[0]

    /**
     * Decode 24 data bits from the 5x5 grid (skip [0,0]).
     * Matches generator: black cell (mean < 127) = bit "1", white = "0"
     * Samples center 50% of each cell to avoid grid-line contamination.
     */
    private fun decodeGrid(bin: Mat): Pair<Int, Double> {
        val margin   = CELL / 4
        val sampleSz = CELL - 2 * margin
        val bits     = StringBuilder()
        var totalConf = 0.0

        for (row in 0 until GRID_SIZE) {
            for (col in 0 until GRID_SIZE) {
                if (row == 0 && col == 0) continue

                val y = row * CELL + margin
                val x = col * CELL + margin
                val cell = bin.submat(y, y + sampleSz, x, x + sampleSz)
                val mean = Core.mean(cell).`val`[0]

                totalConf += Math.abs(mean - 127.0) / 127.0
                bits.append(if (mean < 127.0) "1" else "0")
            }
        }

        val binaryStr = bits.toString()
        val blackBits = binaryStr.count { it == '1' }

        if (blackBits > 9)  return Pair(-1, 0.0)  // violates 60% white rule
        if (blackBits == 0) return Pair(-1, 0.0)  // blank frame

        return Pair(binaryStr.toInt(2), totalConf / 24.0)
    }
}
