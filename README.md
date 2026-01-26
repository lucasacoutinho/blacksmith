# Blacksmith

A VS Code extension for visualizing callgrind/cachegrind profiles with Flat Profile, Call Graph, Caller Map, and Flame Graph views.

## Supported Profilers

- **Valgrind** (C/C++) - callgrind output with instruction counts
- **Xdebug** (PHP) - cachegrind output with time metrics
- **pyprof2calltree** (Python) - cProfile output converted to callgrind
- Any profiler using the callgrind format

## Features

- **Flat Profile**: Sortable table showing all functions with self cost, total cost, call count, and percentage
- **Call Graph**: Interactive SVG graph with pan/zoom, click to focus on function subtrees
- **Caller Map**: Treemap visualization showing cost distribution across functions
- **Flame Graph**: Canvas visualization with zoom, hover tooltips, and heat-map coloring
- **Multi-metric support**: Switch between different cost metrics (Time, Memory, Instructions, etc.)
- **Profile caching**: Parsed profiles are cached for fast reopening

## Installation

```bash
npm install
npm run build
```

Press F5 in VS Code to launch the extension in development mode.

## Usage

1. Open the Command Palette (Ctrl+Shift+P / Cmd+Shift+P)
2. Run "Blacksmith: Open Profiling File"
3. Select a callgrind/cachegrind file

The extension recognizes files matching `*.callgrind`, `*.cachegrind`, `callgrind.out*`, or `cachegrind.out*`.

## Generating Profile Data

### PHP (Xdebug)

```ini
xdebug.mode = profile
xdebug.output_dir = /tmp
xdebug.profiler_output_name = cachegrind.out.%p
```

### C/C++ (Valgrind)

```bash
valgrind --tool=callgrind ./myprogram
```

### Python

```bash
python -m cProfile -o profile.out script.py
pyprof2calltree -i profile.out -o profile.callgrind
```

## Development

```bash
npm run watch    # Watch mode
npm test         # Run tests
npm run build    # Production build
```

## Project Structure

```
src/
  extension.ts           # VS Code extension entry point
  types.ts               # Shared TypeScript types with Effect Brand
  cache.ts               # Profile caching with Effect patterns
  parser/
    callgrind.ts         # Streaming callgrind format parser
  views/
    ProfileEditorProvider.ts  # Custom editor provider
  webview/
    index.tsx            # React entry point
    store.ts             # Zustand store with Effect Match
    components/          # React components
    hooks/               # Custom React hooks
    utils/               # Formatting and color utilities
```

## License

MIT
