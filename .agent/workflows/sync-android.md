---
description: Build webapp and sync to Android project
---

When making changes to the web application (in `src` folder or configuration files like `tailwind.config.ts`, `vite.config.ts`), you must run the following steps to apply the changes to the Android native project:

1. Build the webapp and sync using Capacitor via `cmd.exe /c` (to avoid PowerShell execution policy issues):
// turbo

```bash
cmd.exe /c "npm run build && npx cap sync android"
```

1. Notify the user that the changes have been synced to the Android Studio project, and they can click "Run" to test on their device.
