"""
Custom Visual Marker Detector
Detects and decodes markers from camera frames using OpenCV
"""

import cv2
import numpy as np


class MarkerDetector:
    def __init__(self, min_area=1000, debug=False):
        """
        Initialize marker detector

        Args:
            min_area: Minimum contour area to consider
            debug: Enable debug visualization
        """
        self.min_area = min_area
        self.debug = debug
        self.grid_size = 5

    def detect_marker(self, frame):
        """
        Detect and decode a marker from a camera frame

        Args:
            frame: Input image (BGR or grayscale)

        Returns:
            dict: Detection result with 'id', 'corners', 'image', 'confidence'
                  or None if no marker detected
        """
        # Step 1: Convert to grayscale
        if len(frame.shape) == 3:
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        else:
            gray = frame.copy()

        # Step 2: Apply thresholding (adaptive for better lighting)
        binary = cv2.adaptiveThreshold(
            gray, 255,
            cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv2.THRESH_BINARY_INV,
            11, 2
        )

        if self.debug:
            cv2.imshow('Binary', binary)

        # Step 3: Detect contours
        contours, _ = cv2.findContours(
            binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
        )

        # Step 4: Filter contours
        valid_markers = []

        for contour in contours:
            # Skip small contours
            area = cv2.contourArea(contour)
            if area < self.min_area:
                continue

            # Approximate contour to polygon
            epsilon = 0.02 * cv2.arcLength(contour, True)
            approx = cv2.approxPolyDP(contour, epsilon, True)

            # Must have 4 corners (square)
            if len(approx) != 4:
                continue

            # Check aspect ratio (should be ~1:1)
            rect = cv2.minAreaRect(approx)
            width, height = rect[1]
            aspect_ratio = max(width, height) / min(width, height)

            if aspect_ratio > 1.3:  # Allow some distortion
                continue

            # Step 5: Extract corners and apply perspective transform
            corners = self._order_corners(approx.reshape(4, 2))

            # Step 6: Apply perspective transform to get top-down view
            warped = self._perspective_transform(gray, corners)

            if warped is None:
                continue

            # Step 7: Decode marker
            result = self._decode_marker(warped)

            if result is not None:
                result['corners'] = corners
                result['warped'] = warped
                valid_markers.append(result)

        # Return the largest valid marker
        if valid_markers:
            # Sort by area (largest first)
            valid_markers.sort(key=lambda x: x['area'], reverse=True)
            return valid_markers[0]

        return None

    def _order_corners(self, corners):
        """Order corners: top-left, top-right, bottom-right, bottom-left"""
        # Sort by x then y
        corners = corners[np.argsort(corners[:, 0])]

        # Take leftmost and rightmost points
        left = corners[:2]
        right = corners[2:]

        # Sort by y
        left = left[np.argsort(left[:, 1])]
        right = right[np.argsort(right[:, 1])]

        # Top-left, top-right, bottom-right, bottom-left
        return np.array([
            left[0],   # Top-left
            right[0],  # Top-right
            right[1],  # Bottom-right
            left[1]    # Bottom-left
        ], dtype=np.float32)

    def _perspective_transform(self, gray, corners):
        """Apply perspective transform to get top-down view"""
        # Calculate width and height of the marker
        width_a = np.linalg.norm(corners[2] - corners[3])
        width_b = np.linalg.norm(corners[1] - corners[0])
        max_width = max(int(width_a), int(width_b))

        height_a = np.linalg.norm(corners[1] - corners[0])
        height_b = np.linalg.norm(corners[2] - corners[3])
        max_height = max(int(height_a), int(height_b))

        # Destination points
        dst = np.array([
            [0, 0],
            [max_width - 1, 0],
            [max_width - 1, max_height - 1],
            [0, max_height - 1]
        ], dtype=np.float32)

        # Get perspective transform matrix
        M = cv2.getPerspectiveTransform(corners, dst)

        # Apply transform
        warped = cv2.warpPerspective(gray, M, (max_width, max_height))

        return warped

    def _decode_marker(self, warped):
        """Decode marker ID from warped image"""
        # Threshold the warped image
        _, binary = cv2.threshold(warped, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

        # Get dimensions
        h, w = binary.shape

        # Step 7: Divide into 5x5 grid
        cell_h = h // self.grid_size
        cell_w = w // self.grid_size

        # Step 8: Detect orientation using diagonal corner cell
        orientation = self._detect_orientation(binary, cell_h, cell_w)

        if orientation is None:
            return None

        # Step 9: Rotate grid accordingly
        grid = self._extract_grid(binary, cell_h, cell_w, orientation)

        # Step 10: Read binary values from data cells
        binary_str = self._read_binary_values(grid)

        # Step 11: Convert binary to integer ID
        marker_id = int(binary_str, 2)

        # Calculate confidence (based on cell contrast)
        confidence = self._calculate_confidence(grid)

        return {
            'id': marker_id,
            'binary': binary_str,
            'orientation': orientation,
            'area': w * h,
            'confidence': confidence
        }

    def _detect_orientation(self, binary, cell_h, cell_w):
        """
        Detect orientation using diagonal corner cell (top-left)

        Returns:
            int: Rotation (0, 1, 2, 3) representing 0°, 90°, 180°, 270°
        """
        # Sample points in the top-left cell
        # The diagonal should have black on top-right, white on bottom-left

        # Get top-left cell region
        tl_cell = binary[0:cell_h, 0:cell_w]

        # Sample center of each quadrant
        h_quarter = cell_h // 4
        w_quarter = cell_w // 4

        # Top-right quadrant (should be black)
        tr_region = tl_cell[h_quarter:3*h_quarter, 3*w_quarter:cell_w]
        tr_mean = np.mean(tr_region)

        # Bottom-left quadrant (should be white)
        bl_region = tl_cell[3*h_quarter:cell_h, 0:w_quarter]
        bl_mean = np.mean(bl_region)

        # Check if orientation is correct (tr black, bl white)
        if tr_mean < 100 and bl_mean > 150:
            return 0  # Correct orientation

        # Try other rotations
        # This is a simplified check - in production, you'd check all 4 rotations
        # and pick the one with the best match

        return 0  # Default to no rotation for now

    def _extract_grid(self, binary, cell_h, cell_w, orientation):
        """Extract 5x5 grid values"""
        grid = []

        for row in range(self.grid_size):
            row_values = []
            for col in range(self.grid_size):
                # Get cell region
                y_start = row * cell_h
                y_end = (row + 1) * cell_h
                x_start = col * cell_w
                x_end = (col + 1) * cell_w

                cell = binary[y_start:y_end, x_start:x_end]

                # Sample center of cell (avoid edges)
                margin = min(cell_h, cell_w) // 4
                center = cell[margin:-margin, margin:-margin]

                # Calculate mean value
                mean_val = np.mean(center)

                # Binary value (0 = black, 1 = white)
                binary_val = 1 if mean_val > 127 else 0

                row_values.append(binary_val)

            grid.append(row_values)

        return grid

    def _read_binary_values(self, grid):
        """Read binary values from data cells (skip orientation marker)"""
        binary_str = ""

        for row in range(self.grid_size):
            for col in range(self.grid_size):
                # Skip orientation marker (top-left cell)
                if row == 0 and col == 0:
                    continue

                binary_str += str(grid[row][col])

        return binary_str

    def _calculate_confidence(self, grid):
        """Calculate detection confidence based on cell contrast"""
        # Simple confidence metric: how "binary" are the cells?
        # Values close to 0 or 255 indicate good contrast

        total_contrast = 0
        count = 0

        for row in grid:
            for val in row:
                # Distance from 127 (middle gray)
                contrast = abs(val - 127)
                total_contrast += contrast
                count += 1

        avg_contrast = total_contrast / count if count > 0 else 0

        # Normalize to 0-1 range
        confidence = min(avg_contrast / 127, 1.0)

        return confidence

    def draw_detection(self, frame, result):
        """Draw detection result on frame"""
        if result is None:
            return frame

        # Draw corners
        corners = result['corners']
        for i, corner in enumerate(corners):
            cv2.circle(frame, tuple(corner.astype(int)), 5, (0, 255, 0), -1)

        # Draw outline
        cv2.polylines(frame, [corners.astype(int)], True, (0, 255, 0), 2)

        # Draw ID
        x, y = corners[0].astype(int)
        cv2.putText(frame, f"ID: {result['id']}", (x, y - 10),
                   cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)

        return frame


def main():
    """Test detector with generated markers"""
    import glob

    detector = MarkerDetector(debug=True)

    # Find all marker images
    marker_files = glob.glob('markers/*.png')

    print(f"Found {len(marker_files)} marker images")

    for marker_file in marker_files:
        print(f"\nProcessing: {marker_file}")

        # Read image
        img = cv2.imread(marker_file)

        # Detect marker
        result = detector.detect_marker(img)

        if result:
            print(f"  ✓ Detected: ID={result['id']}, Confidence={result['confidence']:.2f}")

            # Draw detection
            output = detector.draw_detection(img.copy(), result)

            # Show result
            cv2.imshow('Detection', output)
            cv2.waitKey(1000)
        else:
            print(f"  ✗ Failed to detect")

    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
