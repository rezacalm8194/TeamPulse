# Vazirmatn

Static WOFF2 files based on the official [v33.003 release](https://github.com/rastikerdar/vazirmatn/releases/tag/v33.003), subset for TeamPulse Persian/Latin UI.

`@font-face` rules live in `app.css` on the critical path. This CSS file is a mirror for reference.

- Preload only Regular (400) on first paint so SemiBold does not compete on the critical path
- SemiBold (600) still loads via CSS with `font-display: swap` (same final look)

Copyright and SIL Open Font License are preserved in `OFL.txt`.
