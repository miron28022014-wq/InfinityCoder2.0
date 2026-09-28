# InfinityCoder 2.0

**InfinityCoder** — локальная Windows IDE с AI-ядром для разработки. Проект объединяет React/TypeScript интерфейс, Tauri 2 + Rust backend и локальный inference через **llama.cpp + Qwen Coder**.

> **Статус:** проект настроен на автоматическую сборку Windows NSIS installer через GitHub Actions. Успешный CI-билд означает, что автоматизированные шаги сборки прошли; перед релизом конкретного установщика его всё равно нужно проверить на реальном Windows-ПК.

## Возможности

- 🖥️ Windows desktop-приложение на Tauri 2
- ⚛️ React + TypeScript + Vite
- 🦀 Rust backend
- 📝 Monaco Editor
- 🤖 локальное AI-ядро через llama.cpp
- 🧠 Qwen Coder в формате GGUF
- 📚 Ledger для внешнего состояния и памяти проекта
- 🔎 поиск релевантных данных Ledger
- 📦 Windows NSIS installer
- 🎮 Vulkan runtime llama.cpp для совместимого GPU

## Архитектура

```text
InfinityCoder
├── React / TypeScript UI
│   ├── Chat
│   ├── Editor
│   ├── File Tree
│   └── AI tools
├── Tauri 2
│   └── Rust backend
│       ├── AI engine
│       ├── Ledger
│       └── tool handlers
├── llama.cpp
│   └── llama-server (Vulkan)
└── Qwen Coder
    └── GGUF model
```

## Сборка Windows

Автоматический workflow:

```text
.github/workflows/build-windows.yml
```

Он:

1. Проверяет структуру проекта.
2. Устанавливает Node.js 22 и Rust.
3. Устанавливает frontend-зависимости.
4. Собирает production frontend.
5. Загружает официальный Windows Vulkan runtime llama.cpp.
6. Проверяет release asset и его SHA-256, если digest предоставлен.
7. Проверяет `llama-server.exe` как Windows PE.
8. Копирует необходимые runtime DLL.
9. Генерирует Tauri icons.
10. Выполняет `cargo check`.
11. Собирает Tauri NSIS installer.
12. Проверяет созданный установщик.
13. Считает SHA-256 установщика.
14. Загружает installer как GitHub Actions Artifact.

### Запуск

На GitHub:

```text
Actions
→ Build InfinityCoder Windows
→ Run workflow
```

После успешной сборки:

```text
Artifacts
→ InfinityCoder-Windows-Installer
```

Скачанный ZIP содержит Windows `.exe` установщик.

## Qwen Coder

Большой GGUF-файл **не хранится в Git**.

При установке используется:

```text
src-tauri/resources/download-qwen.ps1
```

Скрипт:

- создаёт каталог модели;
- скачивает Qwen Coder;
- умеет использовать уже установленную корректную модель;
- проверяет SHA-256;
- удаляет повреждённый/неполный файл;
- завершает установку с ошибкой при несовпадении контрольной суммы.

Каталог модели:

```text
%APPDATA%\\com.miron.infinitycoder\\models
```

## llama.cpp

Windows Vulkan runtime подготавливается непосредственно в GitHub Actions из официального release llama.cpp.

Workflow проверяет:

- tag release;
- наличие Vulkan x64 asset;
- SHA-256 release asset, когда digest доступен;
- наличие `llama-server.exe`;
- PE-заголовок executable;
- наличие runtime DLL.

Исходные бинарники llama.cpp поэтому не нужно хранить в Git-репозитории.

## Требования

### Для разработки

- Windows 10/11 x64
- Node.js
- npm
- Rust toolchain
- WebView2
- Tauri CLI

### Для локального AI

- совместимый Vulkan GPU;
- достаточно свободного места для Qwen GGUF;
- актуальный драйвер GPU.

Целевая конфигурация проекта включает AMD Radeon RX 7600 8 GB.

## Локальная сборка

После установки зависимостей:

```powershell
npm install
npm run build
npm run tauri:build
```

Установщик появится в:

```text
src-tauri/target/release/bundle/nsis/
```

Для разработки:

```powershell
npm run tauri:dev
```

## Структура проекта

```text
.
├── .github/
│   └── workflows/
│       └── build-windows.yml
├── src/
│   ├── App.tsx
│   ├── Chat.tsx
│   ├── Editor.tsx
│   ├── FileTree.tsx
│   ├── main.tsx
│   └── ...
├── src-tauri/
│   ├── src/
│   │   ├── main.rs
│   │   ├── ai_engine.rs
│   │   ├── ledger.rs
│   │   └── tool_handler.rs
│   ├── resources/
│   │   └── download-qwen.ps1
│   ├── windows/
│   │   └── hooks.nsh
│   ├── Cargo.toml
│   └── tauri.conf.json
├── package.json
├── tsconfig.json
├── vite.config.ts
└── README.md
```

## «Бесконечный контекст»

InfinityCoder использует внешний Ledger для практической работы с большими проектами, но это **не физически бесконечный context window модели**.

Модель всё равно имеет конечный контекст.

Ledger позволяет:

1. сохранять сведения проекта вне текущего контекста;
2. находить релевантные записи;
3. возвращать модели только нужную информацию;
4. уменьшать необходимость передавать всю историю разговора целиком.

Таким образом, рабочее состояние проекта может масштабироваться значительно дальше одного окна контекста модели, но ограничение самой модели никуда не исчезает.

## Безопасность

- Qwen GGUF проверяется по SHA-256.
- llama.cpp release проверяется перед использованием.
- GitHub Actions использует минимальное разрешение `contents: read`.
- Большая модель не коммитится в Git.
- Обычная сборка не требует Datadog API/App keys.
- Установщик не должен содержать секреты репозитория.

## Проверка релизного билда

Перед распространением конкретного `.exe` рекомендуется проверить:

- успешность всех шагов GitHub Actions;
- наличие artifact `InfinityCoder-Windows-Installer`;
- установку на чистую Windows;
- запуск приложения после установки;
- загрузку Qwen;
- проверку SHA-256 модели;
- запуск llama-server;
- работу Vulkan;
- работу чата;
- чтение и запись файлов;
- Ledger;
- повторный запуск после перезагрузки Windows.

**CI не заменяет тестирование установленного приложения на реальном ПК.**

## Лицензии

InfinityCoder использует сторонние компоненты, включая Tauri, React, Monaco Editor, llama.cpp и Qwen.

Перед распространением установщика необходимо проверить лицензии и условия распространения каждого компонента и конкретной модели.

## Версия

Версия приложения в конфигурации Tauri:

```text
2.0.0
```
