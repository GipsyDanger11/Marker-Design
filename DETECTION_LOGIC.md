# Marker Detection Logic - Step by Step

## Overview

This document explains the complete marker detection pipeline using OpenCV.

---

## Step 1: Convert Frame to Grayscale

**Purpose:** Simplify image processing by working with single-channel images.

**OpenCV Function:**
```python
gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
```

**Why:** Grayscale reduces computational complexity and makes thresholding more reliable.

---

## Step 2: Apply Thresholding

**Purpose:** Convert grayscale image to binary (black/white) for contour detection.

**OpenCV Functions:**
```python
# Adaptive thresholding (recommended for varying lighting)
binary = cv2.adaptiveThreshold(
    gray, 255,
    cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
    cv2.THRESH_BINARY_INV,
    11, 2
)

# OR Otsu's thresholding (for controlled lighting)
_, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
```

**Parameters:**
- `11`: Block size (neighborhood area)
- `2`: Constant subtracted from mean
- `THRESH_BINARY_INV`: Invert so markers are white on black

**Why:** Adaptive thresholding handles varying lighting conditions better than fixed thresholding.

---

## Step 3: Detect Contours

**Purpose:** Find all closed shapes in the binary image.

**OpenCV Function:**
```python
contours, hierarchy = cv2.findContours(
    binary,
    cv2.RETR_EXTERNAL,  # Only outer contours
    cv2.CHAIN_APPROX_SIMPLE  # Compress horizontal/vertical segments
)
```

**Parameters:**
- `RETR_EXTERNAL`: Ignores nested contours
- `CHAIN_APPROX_SIMPLE`: Saves memory by removing redundant points

**Output:** List of contours, where each contour is an array of points.

---

## Step 4: Filter Contours

### 4.1 Filter by Area

**Purpose:** Remove noise and small objects.

```python
area = cv2.contourArea(contour)
if area < min_area:
    continue
```

**Recommended:** `min_area = 1000` (adjust based on camera distance)

---

### 4.2 Check for 4 Corners (Square)

**Purpose:** Ensure contour is roughly square.

```python
epsilon = 0.02 * cv2.arcLength(contour, True)
approx = cv2.approxPolyDP(contour, epsilon, True)

if len(approx) != 4:
    continue
```

**Functions:**
- `cv2.arcLength()`: Calculate perimeter
- `cv2.approxPolyDP()`: Simplify contour to polygon

**Parameters:**
- `0.02`: Approximation accuracy (2% of perimeter)

---

### 4.3 Check Aspect Ratio

**Purpose:** Ensure shape is square (not rectangle).

```python
rect = cv2.minAreaRect(approx)
width, height = rect[1]
aspect_ratio = max(width, height) / min(width, height)

if aspect_ratio > 1.3:
    continue
```

**Function:** `cv2.minAreaRect()` returns rotated rectangle

**Threshold:** `1.3` allows some perspective distortion

---

## Step 5: Extract Largest Valid Square

**Purpose:** Select the most prominent marker.

```python
valid_markers = []

for contour in filtered_contours:
    # ... validation logic ...
    valid_markers.append({
        'contour': contour,
        'area': area,
        'corners': corners
    })

# Sort by area and pick largest
valid_markers.sort(key=lambda x: x['area'], reverse=True)
best_marker = valid_markers[0]
```

---

## Step 6: Apply Perspective Transform

**Purpose:** Get top-down view of the marker for accurate grid reading.

### 6.1 Order Corners

```python
def order_corners(corners):
    """Order: TL, TR, BR, BL"""
    corners = corners[np.argsort(corners[:, 0])]  # Sort by x
    left = corners[:2]
    right = corners[2:]
    left = left[np.argsort(left[:, 1])]  # Sort by y
    right = right[np.argsort(right[:, 1])]
    return np.array([left[0], right[0], right[1], left[1]])
```

### 6.2 Calculate Destination Points

```python
width = max(np.linalg.norm(corners[2] - corners[3]),
            np.linalg.norm(corners[1] - corners[0]))
height = max(np.linalg.norm(corners[1] - corners[0]),
             np.linalg.norm(corners[2] - corners[3]))

dst = np.array([
    [0, 0],
    [width - 1, 0],
    [width - 1, height - 1],
    [0, height - 1]
], dtype=np.float32)
```

### 6.3 Apply Transform

```python
M = cv2.getPerspectiveTransform(corners, dst)
warped = cv2.warpPerspective(gray, M, (int(width), int(height)))
```

**Functions:**
- `cv2.getPerspectiveTransform()`: Calculate transformation matrix
- `cv2.warpPerspective()`: Apply transformation

---

## Step 7: Divide into 5x5 Grid

**Purpose:** Extract individual cell values.

```python
h, w = warped.shape
cell_h = h // 5
cell_w = w // 5

grid = []
for row in range(5):
    row_values = []
    for col in range(5):
        y_start = row * cell_h
        y_end = (row + 1) * cell_h
        x_start = col * cell_w
        x_end = (col + 1) * cell_w

        cell = warped[y_start:y_end, x_start:x_end]
        row_values.append(cell)
    grid.append(row_values)
```

---

## Step 8: Detect Orientation

**Purpose:** Determine rotation using diagonal corner cell.

```python
def detect_orientation(tl_cell):
    """Check diagonal pattern in top-left cell"""
    h, w = tl_cell.shape

    # Sample top-right quadrant (should be black)
    tr_region = tl_cell[h//4:3*h//4, 3*w//4:w]
    tr_mean = np.mean(tr_region)

    # Sample bottom-left quadrant (should be white)
    bl_region = tl_cell[3*h//4:h, 0:w//4]
    bl_mean = np.mean(bl_region)

    # Check if orientation is correct
    if tr_mean < 100 and bl_mean > 150:
        return 0  # Correct orientation

    # Try other rotations (90°, 180°, 270°)
    # ... rotation logic ...

    return 0
```

**Logic:** The diagonal triangle creates a distinctive pattern that indicates rotation.

---

## Step 9: Rotate Grid Accordingly

**Purpose:** Align grid to correct orientation.

```python
def rotate_grid(grid, rotation):
    """Rotate grid by 90° increments"""
    if rotation == 0:
        return grid
    elif rotation == 1:
        return np.rot90(grid, -1)  # 90° clockwise
    elif rotation == 2:
        return np.rot90(grid, -2)  # 180°
    elif rotation == 3:
        return np.rot90(grid, -3)  # 270° clockwise
```

**Function:** `np.rot90()` rotates 2D arrays

---

## Step 10: Read Binary Values

**Purpose:** Extract 24-bit data from grid cells.

```python
binary_str = ""

for row in range(5):
    for col in range(5):
        # Skip orientation marker (top-left)
        if row == 0 and col == 0:
            continue

        # Sample center of cell
        cell = grid[row][col]
        margin = min(cell.shape) // 4
        center = cell[margin:-margin, margin:-margin]

        # Calculate mean value
        mean_val = np.mean(center)

        # Convert to binary
        binary_val = 1 if mean_val > 127 else 0
        binary_str += str(binary_val)
```

**Result:** 24-character binary string (e.g., "000000000000000000000101")

---

## Step 11: Convert Binary to Integer ID

**Purpose:** Decode marker ID.

```python
marker_id = int(binary_str, 2)
```

**Example:**
- Binary: "000000000000000000000101"
- ID: 5

---

## Complete Pipeline Summary

```
Input Frame
    ↓
1. Grayscale Conversion
    ↓
2. Adaptive Thresholding
    ↓
3. Contour Detection
    ↓
4. Contour Filtering
    ├─ Area check
    ├─ 4 corners check
    └─ Aspect ratio check
    ↓
5. Select Largest Valid Square
    ↓
6. Perspective Transform
    ├─ Order corners
    ├─ Calculate destination
    └─ Apply transform
    ↓
7. Grid Extraction (5x5)
    ↓
8. Orientation Detection
    ↓
9. Grid Rotation
    ↓
10. Binary Value Reading
    ↓
11. Binary → Integer Conversion
    ↓
Output: Marker ID
```

---

## Performance Optimization Tips

1. **Skip frames:** Process every 3rd frame for real-time performance
2. **ROI tracking:** Use previous detection to limit search area
3. **Downsample:** Process smaller resolution, upscale for display
4. **Early rejection:** Filter contours aggressively before expensive operations
5. **Parallel processing:** Use threading for detection vs. display

---

## Common Issues and Solutions

| Issue | Cause | Solution |
|-------|-------|----------|
| No detection | Poor lighting | Use adaptive thresholding |
| False positives | Low area threshold | Increase `min_area` |
| Wrong ID | Perspective distortion | Improve corner detection |
| Slow performance | High resolution | Downsample input |

---

## OpenCV Functions Reference

| Function | Purpose |
|----------|---------|
| `cv2.cvtColor()` | Color space conversion |
| `cv2.adaptiveThreshold()` | Adaptive binarization |
| `cv2.findContours()` | Contour detection |
| `cv2.contourArea()` | Calculate contour area |
| `cv2.approxPolyDP()` | Polygon approximation |
| `cv2.minAreaRect()` | Minimum area rectangle |
| `cv2.getPerspectiveTransform()` | Perspective matrix |
| `cv2.warpPerspective()` | Apply perspective transform |
| `cv2.threshold()` | Fixed thresholding |
| `cv2.OTSU` | Automatic thresholding |

---

## Testing the Detector

```bash
# Generate markers first
python marker_generator.py

# Test detection
python marker_detector.py
```

The detector will show each marker with its detected ID and confidence score.
