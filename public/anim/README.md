# InfinityCoder animated icon pack

Place the WebM files from the supplied InfinityCoder animation pack in this directory.

Expected files:
- chat.webm
- computer.webm
- document.webm
- home.webm
- hourglass.webm
- profile.webm
- right-arrow.webm
- settings.webm
- share.webm
- verified.webm

The UI will use these animations automatically through `AnimatedIcon`.
When an asset is unavailable, InfinityCoder falls back to a built-in vector icon so the interface never shows a broken media element.

Animation preferences are stored locally:
- `infinitycoder.animations`
- `infinitycoder.reduce-motion`
- `infinitycoder.animation-speed`
