# 📖 AppReader

Ứng dụng đọc truyện/sách offline trên Android với tính năng **Text-to-Speech** chạy nền.

> Import file PDF/TXT → tự chia chương → đọc truyện với TTS tiếng Việt → nghe nền khi tắt màn hình

## ✨ Tính năng

- **Import sách** — hỗ trợ PDF và TXT, tự động nhận diện & chia chương
- **Đọc sách** — dark mode, sepia, tuỳ chỉnh font size, line spacing
- **Text-to-Speech** — giọng đọc tiếng Việt, chọn voice, tuỳ tốc độ
- **Nghe nền** — tắt màn hình vẫn đọc, điều khiển từ notification Android
- **Tự chuyển chương** — đọc xong chương tự chuyển chương tiếp
- **Lưu tiến độ** — ghi nhớ vị trí đọc cuối, mở lại đúng chỗ

## 🛠 Tech Stack

| Layer | Công nghệ |
|-------|-----------|
| Frontend | React 19 + TypeScript + TailwindCSS |
| Build | Vite 6 |
| Native | Capacitor 8 (Android) |
| Database | IndexedDB (via `idb`) |
| PDF | pdf.js |
| TTS | `@capacitor-community/text-to-speech` |
| Background | Android Foreground Service + MediaSession |

## 📦 Cài đặt

### Yêu cầu

- Node.js 18+
- Android Studio (để build APK)
- JDK 17+

### Setup

```bash
# Clone
git clone https://github.com/nghia-peirth/peirth.git
cd peirth

# Cài dependencies
npm install

# Dev server (browser)
npm run dev

# Build & sync Android
npm run build
npx cap sync android

# Mở Android Studio
npx cap open android
```

### Build APK

Mở project trong Android Studio → **Build** → **Build Bundle(s) / APK(s)** → **Build APK(s)**

## 📁 Cấu trúc dự án

```
src/
├── App.tsx           # Router chính (Home ↔ Reader)
├── main.tsx          # Entry point
├── db.ts             # IndexedDB CRUD (books, chapters)
├── parser.ts         # Parser PDF/TXT + chia chương
├── index.css         # Global styles (TailwindCSS)
└── screens/
    ├── Home.tsx      # Trang chủ - danh sách sách
    └── Reader.tsx    # Đọc sách + TTS + settings

android/app/src/main/java/com/virus/appreader/
├── MainActivity.java            # Capacitor bridge
├── TtsBackgroundService.java    # Foreground Service + MediaSession
└── TtsBackgroundPlugin.java     # JS ↔ Native bridge
```

## 🔒 Security

- Không sử dụng backend/API — toàn bộ xử lý offline trên thiết bị
- Dữ liệu sách lưu trong IndexedDB (sandbox của browser/WebView)
- Không thu thập hay gửi dữ liệu người dùng
- Không yêu cầu quyền internet (trừ cài giọng TTS online)

## 📄 License

Apache-2.0

## 🤝 Contributing

Pull requests are welcome! Với thay đổi lớn, hãy mở issue để thảo luận trước.
