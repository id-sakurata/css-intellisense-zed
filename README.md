# CSS Intellisense for Zed

CSS Intellisense is a language server protocol (LSP) extension for the Zed editor designed to provide CSS class name completion from your project's CSS files. It extracts class names from your stylesheets and offers them as suggestions when you are writing HTML, JSX, Vue, or other supported languages.

## Features

- **Class Name Completion**: Automatically suggests CSS classes when you are inside `class`, `className`, or `class:` attributes.
- **Source Information**: Shows which CSS file a specific class belongs to in the completion details.
- **Dynamic Updates**: Watches for changes in your CSS files and updates the completion cache in real-time.
- **Configurable Scanning**: Choose specific folders or files to scan, or enable automatic workspace-wide scanning.
- **Multi-language Support**: Works with HTML, PHP, Vue, React (JSX/TSX), Blade, Edge, Handlebars, EJS, and more.

## Installation

This extension requires Node.js to be installed on your system as the language server runs on Node.js.

1. Open Zed.
2. Open the extensions view.
3. Search for "CSS Intellisense".
4. Click Install.

## Configuration

You can configure the extension by modifying your `settings.json` in Zed. Add an entry for `css-intellisense` under the `lsp` section.

### Example Configuration

```json
{
  "lsp": {
    "css-intellisense": {
      "settings": {
        "auto_search": true,
        "node_path": "/usr/local/bin/node",
        "server_path": "/path/to/extension/index.js",
        "css_folders": ["src/styles", "assets/css"],
        "css_files": ["public/global.css"],
        "supported_languages": ["html", "php", "vue"]
      }
    }
  }
}
```

### Settings Reference

- `auto_search` (boolean): When set to `true`, the extension will scan the entire workspace for `.css` files. Default is `false`.
- `node_path` (string): Custom path to the Node.js binary. Useful if `node` is not in your system PATH.
- `server_path` (string): Custom path to the `index.js` file of the language server.
- `css_folders` (array of strings): A list of directory paths relative to the workspace root that should be scanned for CSS files.

- `css_files` (array of strings): A list of specific CSS file paths relative to the workspace root to be included.
- `supported_languages` (array of strings): A list of language IDs where the extension should provide completions. Default includes `html`, `php`, `vue`, `javascriptreact`, `blade`, `edge`, `hbs`, `handlebars`, `ejs`, `twig`, and `nunjucks`.

## Development and Building

If you are developing the extension or want to build it from source:

### Prerequisites

- [Rust](https://www.rust-lang.org/) (latest stable)
- [Node.js](https://nodejs.org/) (latest LTS)

### Build Steps

1. **Add the WebAssembly target**:
   ```bash
   rustup target add wasm32-wasip1
   ```

2. **Build the extension binary**:
   ```bash
   cargo build --release --target wasm32-wasip1
   ```

3. **Deploy the binary**:
   Zed expects the compiled WASM to be named `extension.wasm` in the root directory.
   ```bash
   cp target/wasm32-wasip1/release/css_intellisense.wasm extension.wasm
   ```

4. **Install Node.js dependencies**:
   ```bash
   npm install
   ```

### Running Locally

To test your local version in Zed:
1. Open Zed.
2. Go to `Extensions` menu.
3. Choose `Install Dev Extension...`.
4. Select your `css-intellisense` project folder.

## How it Works

The extension consists of two main parts:
1. **Rust Extension Bridge**: A thin wrapper that manages the lifecycle of the language server within Zed.
2. **Node.js Language Server**: The core logic that parses CSS files using regular expressions to build a cache of available class names and provides them via LSP.

## Requirements

- Zed Editor
- Node.js (latest LTS recommended)
