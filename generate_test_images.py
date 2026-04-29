"""
Generate test images of markers in different orientations.
Creates rotated versions (0°, 90°, 180°, 270°) for a few markers.
"""
import cv2
import numpy as np
from pathlib import Path

def generate_test_images():
    output_dir = Path("test_images")
    output_dir.mkdir(exist_ok=True)

    # Use markers 1, 5, 10, 15, 20 as test samples
    test_ids = [1, 5, 10, 15, 20]
    rotations = [0, 90, 180, 270]

    for mid in test_ids:
        marker_path = f"markers/marker_{mid:06d}.png"
        marker = cv2.imread(marker_path, cv2.IMREAD_GRAYSCALE)
        if marker is None:
            print(f"Skipping {marker_path} — not found")
            continue

        for angle in rotations:
            if angle == 0:
                rotated = marker
            elif angle == 90:
                rotated = cv2.rotate(marker, cv2.ROTATE_90_CLOCKWISE)
            elif angle == 180:
                rotated = cv2.rotate(marker, cv2.ROTATE_180)
            else:
                rotated = cv2.rotate(marker, cv2.ROTATE_90_COUNTERCLOCKWISE)

            filename = f"marker_{mid:06d}_rot{angle}.png"
            cv2.imwrite(str(output_dir / filename), rotated)
            print(f"Created {filename}")

    # Also create a perspective-warped test image
    for mid in [1, 10]:
        marker_path = f"markers/marker_{mid:06d}.png"
        marker = cv2.imread(marker_path, cv2.IMREAD_GRAYSCALE)
        if marker is None:
            continue

        h, w = marker.shape
        # Slight perspective tilt
        src_pts = np.float32([[0, 0], [w, 0], [w, h], [0, h]])
        dst_pts = np.float32([[30, 20], [w - 10, 30], [w - 20, h - 10], [15, h - 25]])
        M = cv2.getPerspectiveTransform(src_pts, dst_pts)
        warped = cv2.warpPerspective(marker, M, (w, h), borderValue=255)

        filename = f"marker_{mid:06d}_perspective.png"
        cv2.imwrite(str(output_dir / filename), warped)
        print(f"Created {filename}")

    print(f"\nAll test images saved to {output_dir}/")

if __name__ == "__main__":
    generate_test_images()
