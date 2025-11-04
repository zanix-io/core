# Zanix - Core

[![Version](https://img.shields.io/jsr/v/@zanix/core?color=blue\&label=jsr)](https://jsr.io/@zanix/core/versions)
[![Release](https://img.shields.io/github/v/release/zanix-io/core?color=blue\&label=git)](https://github.com/zanix-io/core/releases)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](https://opensource.org/licenses/MIT)

---

## 🧭 Table of Contents

- [Description](#🧩-description)
- [Features](#⚙️-features)
- [Installation](#📦-installation)
- [Basic Usage](#🚀-basic-usage)
- [Documentation](#📚-documentation)
- [Contributing](#🤝-contributing)
- [Changelog](#🕒-changelog)
- [License](#⚖️-license)
- [Resources](#🔗-resources)

---

## 🧩 Description

**Zanix Core** is the foundational library of the **Zanix** ecosystem — a modular toolkit designed
to power Zanix applications and provide the core configuration layer for all Zanix-based projects.

It serves as the entry point for initializing, configuring, and managing core application services
within the Zanix framework.

---

## ⚙️ Features

- Core utilities to initialize and manage Zanix projects
- Built-in support for REST, GraphQL, and WebSocket servers
- Simple and scalable project bootstrapping

---

## 📦 Installation

Install **Zanix Core** in your project using [Deno](https://deno.com/):

```ts
import core from 'jsr:@zanix/core@[version]'
```

---

**Important Setup Notes:**

1. **Install Deno** Ensure Deno is installed on your system. Follow the official guide:
   [Deno Installation Guide](https://docs.deno.com/runtime/getting_started/installation)

2. **VSCode Extension (Recommended)** For syntax highlighting, IntelliSense, and linting, install
   the **Deno extension** from the
   [Visual Studio Code Marketplace](https://marketplace.visualstudio.com/items?itemName=denoland.vscode-deno).

3. **Add Deno to PATH** Make sure Deno is accessible from your system’s terminal:

   - **macOS/Linux**: Add to your shell configuration file (e.g., `.bashrc`, `.zshrc`):

     ```bash
     export PATH="$PATH:/path/to/deno"
     ```
   - **Windows**: Add the Deno folder to your `PATH` via Environment Variables.

---

## 🚀 Basic Usage

Example of how to bootstrap a Zanix project:

```typescript
import Zanix from 'jsr:@zanix/core@[version]'

// Initialize your project
await Zanix.bootstrap({
  server: {
    rest: { onCreate, ...options },
    graphql: { onCreate, ...options },
    socket: { onCreate, ...options },
  },
})
```

For more advanced examples and configuration options, refer to the full documentation.

---

## 📚 Documentation

Find detailed documentation, guides, and examples at: 🔗
[https://github.com/zanix-io](https://github.com/zanix-io)

---

## 🤝 Contributing

Contributions are always welcome! To get started:

1. Open an issue for bug reports or feature requests.
2. Fork the repository and create a feature branch.
3. Implement your changes following the project’s guidelines.
4. Add or update tests as needed.
5. Submit a pull request with a clear and descriptive summary.

---

## 🕒 Changelog

Check the [`CHANGELOG`](./docs/CHANGELOG.md) for a complete version history and release notes.

---

## ⚖️ License

This project is licensed under the **MIT License**. See [`LICENSE`](./docs/LICENSE) for more
information.

---

## 🔗 Resources

- [Deno Documentation](https://docs.deno.com/)
- [Zanix Framework](https://github.com/zanix-io)

---

_Developed with ❤️ by **Ismael Calle** | [@iscam2216](https://github.com/iscam2216)_
