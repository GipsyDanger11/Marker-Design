# Custom Visual Marker System

A custom square marker system for computer vision detection with React Native Android app.

## Features

- **5x5 grid** with 24 data bits
- **Orientation detection** via diagonal triangle
- **60% white cells** for better detection
- **16,777,216** possible unique markers
- **High resolution** output (600x600 pixels)

## Quick Start

### Generate Markers

```bash
python marker_generator.py
```

This creates 20 unique markers in the `markers/` directory.

### Marker Structure

```
┌─────────────────────────────────┐
│  ┌───┬───┬───┬───┬───┐         │
│  │ O │ D1│ D2│ D3│ D4│         │
│  ├───┼───┼───┼───┼───┤         │
│  │ D5│ D6│ D7│ D8│ D9│         │
│  ├───┼───┼───┼───┼───┤         │
│  │D10│D11│D12│D13│D14│         │
│  ├───┼───┼───┼───┼───┤         │
│  │D15│D16│D17│D18│D19│         │
│  ├───┼───┼───┼───┼───┤         │
│  │D20│D21│D22│D23│D24│         │
│  └───┴───┴───┴───┴───┘         │
└─────────────────────────────────┘
```

- **O**: Orientation marker (diagonal triangle)
- **D1-D24**: Data cells (24 bits)

## Requirements

- Python 3.7+
- OpenCV (`pip install opencv-python numpy`)

## React Native App

See `react_native_app/` directory for the Android app implementation.

## License

MIT
