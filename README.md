<div align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=lucasalvcoutinho.blacksmith">
    <img alt="Blacksmith" src="./icon.png" height="128">
  </a>
  <h1>Blacksmith</h1>

  <p>Read Callgrind and Cachegrind profiles without leaving VS Code.</p>

<a href="https://marketplace.visualstudio.com/items?itemName=lucasalvcoutinho.blacksmith"><img alt="Install Blacksmith from the VS Code Marketplace" src="https://img.shields.io/badge/VS_Code_Marketplace-install-007ACC?style=for-the-badge&labelColor=000000"></a>
<a href="https://open-vsx.org/extension/lucasalvcoutinho/blacksmith"><img alt="Open VSX version" src="https://img.shields.io/open-vsx/v/lucasalvcoutinho/blacksmith?style=for-the-badge&labelColor=000000"></a>
<a href="./LICENSE"><img alt="MIT license" src="https://img.shields.io/github/license/lucasacoutinho/blacksmith.svg?style=for-the-badge&labelColor=000000"></a>
</div>

## Getting started

Install Blacksmith from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=lucasalvcoutinho.blacksmith), from [Open VSX](https://open-vsx.org/extension/lucasalvcoutinho/blacksmith), or from the command line:

```bash
code --install-extension lucasalvcoutinho.blacksmith
```

Open the Command Palette and run `Blacksmith: Open Profiling File`. Blacksmith also opens files matching these names as a custom editor:

- `*.callgrind`
- `*.cachegrind`
- `callgrind.out*`
- `cachegrind.out*`

Blacksmith requires VS Code 1.85 or newer.

## What it shows

- **Flat profile.** Sort and search functions by self cost, total cost, call count, or percentage.
- **Call graph.** Follow callers and callees, focus a subtree, and jump to the corresponding source.
- **Caller map.** Scan cost distribution as a treemap.
- **Flame graph.** Zoom through the active call tree on a canvas view.
- **Line view.** Add inline costs, heat backgrounds, overview-ruler marks, and the hottest call chain to source files.
- **Profile comparison.** Compare two runs, inspect regressions and improvements, then export data as CSV or JSON.
- **Multiple metrics.** Switch between Time, Memory, Instructions, and any other events present in the profile.
- **Profile cache.** Reopen unchanged profiles without parsing them again.

The parser accepts Callgrind output from Valgrind, Cachegrind output from Xdebug, `pyprof2calltree`, and other tools that write the same format. Blacksmith takes its visual cues from [KCachegrind](https://github.com/KDE/kcachegrind).

## Commands

| Command                               | What it does                                | Default key      |
| ------------------------------------- | ------------------------------------------- | ---------------- |
| `Blacksmith: Open Profiling File`     | Select and open a profile                   |                  |
| `Blacksmith: Compare with Profile...` | Compare the active profile with another run |                  |
| `Blacksmith: Toggle Line View`        | Show or hide source annotations             |                  |
| `Blacksmith: Toggle Hot Path Overlay` | Show or hide the hottest call chain         |                  |
| `Blacksmith: Next Hotspot`            | Open the next expensive function            | `Alt+Shift+Down` |
| `Blacksmith: Previous Hotspot`        | Open the previous expensive function        | `Alt+Shift+Up`   |
| `Blacksmith: List Hotspots`           | Pick from the most expensive functions      |                  |
| `Blacksmith: Clear Profile Cache`     | Remove cached profiles                      |                  |

## Creating a profile

### PHP with Xdebug

```ini
xdebug.mode = profile
xdebug.output_dir = /tmp
xdebug.profiler_output_name = cachegrind.out.%p
```

### C and C++ with Valgrind

```bash
valgrind --tool=callgrind ./my-program
```

### Python

```bash
python -m cProfile -o profile.out script.py
pyprof2calltree -i profile.out -o profile.callgrind
```

## Development

Blacksmith uses TypeScript for the extension host, React for the webview, and an OCaml parser compiled to JavaScript by Melange.

You need Node.js 22.22.2 or newer, npm, and opam. The repository and CI use OCaml 5.2.

```bash
opam switch create . 5.2.1
opam install dune.3.21.0 melange.6.0.1-52

npm ci
npm run build
npm run check
npm run test:integration
```

`npm run check` enforces source policy, runs Oxfmt and Oxlint, checks TypeScript, and executes the test suite. TypeScript modules use kebab-case filenames. React components use PascalCase `.tsx` filenames. React effect hooks are prohibited. Run `npm run fmt` to format the repository, `npm run watch` while developing, and `npm run package` to create a VSIX. Press `F5` in VS Code to open an Extension Development Host.

## Contributing

Bug reports and focused pull requests are welcome. Run `npm run build` and `npm run check` before opening a pull request.

## License

[MIT](./LICENSE)
