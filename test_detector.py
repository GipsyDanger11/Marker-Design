"""
Test the MarkerDetector against all 20 generated markers.
Prints pass/fail for each and a final summary.
"""

import cv2
import glob
from marker_detector import MarkerDetector

detector = MarkerDetector(debug=False)
marker_files = sorted(glob.glob('markers/*.png'))

success = 0
fail = 0

print("=" * 60)
print("MARKER DETECTION TEST")
print("=" * 60)

for f in marker_files:
    img = cv2.imread(f)
    result = detector.detect_marker(img)

    # Extract expected ID from filename  e.g. marker_000005.png -> 5
    expected_id = int(f.replace('\\', '/').split('/')[-1].split('_')[-1].split('.')[0])

    if result is not None:
        detected_id = result['id']
        conf = result['confidence']
        if detected_id == expected_id:
            status = 'PASS'
            success += 1
        else:
            status = 'FAIL (got ID=' + str(detected_id) + ')'
            fail += 1
        print(f"  {f}: Expected={expected_id:3d}  Got={detected_id:3d}  Conf={conf:.2f}  {status}")
    else:
        fail += 1
        print(f"  {f}: Expected={expected_id:3d}  NOT DETECTED")

print("=" * 60)
print(f"Passed: {success}/{len(marker_files)}   Failed: {fail}/{len(marker_files)}")
print("=" * 60)
