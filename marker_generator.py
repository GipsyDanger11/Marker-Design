"""
Custom Visual Marker Generator
Generates 5x5 grid markers with orientation detection
"""

import cv2
import numpy as np
from pathlib import Path


class MarkerGenerator:
    def __init__(self, cell_size=100, border_thickness=20, margin=50):
        """
        Initialize marker generator

        Args:
            cell_size: Size of each grid cell in pixels
            border_thickness: Thickness of outer black border
            margin: White margin around the marker
        """
        self.cell_size = cell_size
        self.border_thickness = border_thickness
        self.margin = margin
        self.grid_size = 5

        # Calculate total image size
        self.grid_width = self.grid_size * cell_size
        self.total_size = self.grid_width + 2 * border_thickness + 2 * margin

    def id_to_binary(self, marker_id, bits=24):
        """Convert integer ID to binary string"""
        return format(marker_id, f'0{bits}b')

    def binary_to_id(self, binary_str):
        """Convert binary string to integer ID"""
        return int(binary_str, 2)

    def create_marker(self, marker_id):
        """
        Create a marker image for given ID

        Args:
            marker_id: Integer ID (0 to 2^24 - 1)

        Returns:
            numpy array: Marker image (grayscale)
        """
        # Convert ID to binary
        binary = self.id_to_binary(marker_id)

        # Create white canvas
        img = np.ones((self.total_size, self.total_size), dtype=np.uint8) * 255

        # Draw black border
        border_start = self.margin
        border_end = self.total_size - self.margin
        cv2.rectangle(img, (border_start, border_start),
                     (border_end - 1, border_end - 1), 0, self.border_thickness)

        # Grid start position
        grid_start = self.margin + self.border_thickness

        # Fill grid cells
        bit_index = 0

        for row in range(self.grid_size):
            for col in range(self.grid_size):
                # Skip orientation marker (top-left cell)
                if row == 0 and col == 0:
                    self._draw_orientation_marker(img, grid_start, row, col)
                    continue

                # Get bit value
                if bit_index < len(binary):
                    bit = int(binary[bit_index])
                    bit_index += 1
                else:
                    bit = 0

                # Draw cell (black=1, white=0)
                cell_color = 0 if bit == 1 else 255
                x = grid_start + col * self.cell_size
                y = grid_start + row * self.cell_size
                cv2.rectangle(img, (x, y),
                             (x + self.cell_size - 1, y + self.cell_size - 1),
                             cell_color, -1)

        return img

    def _draw_orientation_marker(self, img, grid_start, row, col):
        """Draw diagonal triangle in top-left cell"""
        x = grid_start + col * self.cell_size
        y = grid_start + row * self.cell_size

        # Create triangle mask (top-right black, bottom-left white)
        for i in range(self.cell_size):
            for j in range(self.cell_size):
                # Diagonal line: if j > i, it's top-right (black)
                if j > i:
                    img[y + i, x + j] = 0  # Black
                else:
                    img[y + i, x + j] = 255  # White

    def count_white_cells(self, marker_id):
        """Count white cells in a marker (excluding orientation)"""
        binary = self.id_to_binary(marker_id)
        white_count = binary.count('0')
        return white_count

    def generate_markers(self, count=20, output_dir='markers'):
        """
        Generate multiple markers

        Args:
            count: Number of markers to generate
            output_dir: Directory to save markers
        """
        output_path = Path(output_dir)
        output_path.mkdir(exist_ok=True)

        generated = []
        marker_id = 1

        while len(generated) < count and marker_id < (1 << 24):
            # Check 60% white requirement (at least 14.4 white cells)
            white_count = self.count_white_cells(marker_id)
            if white_count >= 15:  # At least 15 white cells (62.5%)
                # Generate marker
                img = self.create_marker(marker_id)

                # Save marker
                filename = f"marker_{marker_id:06d}.png"
                filepath = output_path / filename
                cv2.imwrite(str(filepath), img)

                generated.append({
                    'id': marker_id,
                    'filename': filename,
                    'white_cells': white_count,
                    'binary': self.id_to_binary(marker_id)
                })

                print(f"Generated: {filename} (ID: {marker_id}, White cells: {white_count}/24)")

            marker_id += 1

        print(f"\nGenerated {len(generated)} markers in '{output_dir}/'")
        return generated


def main():
    """Main function to generate markers"""
    # Create generator with high resolution
    generator = MarkerGenerator(
        cell_size=100,      # 100px per cell
        border_thickness=20, # 20px border
        margin=50           # 50px margin
    )

    # Generate 20 markers
    markers = generator.generate_markers(count=20)

    # Print summary
    print("\n" + "="*60)
    print("MARKER GENERATION SUMMARY")
    print("="*60)
    print(f"Total markers generated: {len(markers)}")
    print(f"Image size: {generator.total_size}x{generator.total_size} pixels")
    print(f"Cell size: {generator.cell_size}x{generator.cell_size} pixels")
    print(f"Grid size: {generator.grid_size}x{generator.grid_size}")
    print(f"Data bits: 24")
    print(f"Possible unique markers: {1 << 24:,}")
    print("="*60)

    # Print marker details
    print("\nMarker Details:")
    for i, marker in enumerate(markers, 1):
        print(f"{i:2d}. ID: {marker['id']:6d} | White: {marker['white_cells']:2d}/24 | {marker['binary']}")


if __name__ == "__main__":
    main()
