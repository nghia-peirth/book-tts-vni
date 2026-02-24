import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Book, Chapter, getBook, getChaptersMetadata, getChapter, updateBookProgress } from '../db';
import { ArrowLeft, Settings, List, ChevronLeft, ChevronRight, Moon, Sun, Type, Book as BookIcon, X, Loader2, AlignJustify, MoveVertical, Volume2, Pause, Play, Square, Gauge } from 'lucide-react';
import { TextToSpeech, SpeechSynthesisVoice } from '@capacitor-community/text-to-speech';
import { registerPlugin } from '@capacitor/core';

// Register native TtsBackground plugin (handles TTS natively in Foreground Service)
const TtsBackground: any = registerPlugin('TtsBackground');

type ChapterMetadata = Omit<Chapter, 'content'>;

interface ReaderSettings {
  fontSize: number;
  fontFamily: string;
  theme: 'light' | 'dark' | 'sepia';
  lineHeight: number;
  paragraphSpacing: number;
}

const DEFAULT_SETTINGS: ReaderSettings = {
  fontSize: 18,
  fontFamily: 'sans-serif',
  theme: 'light',
  lineHeight: 1.6,
  paragraphSpacing: 1,
};

const processContent = (text: string) => {
  if (!text) return [];
  const normalized = text.replace(/\r\n/g, '\n');

  // Decide what delimiter was primarily used for paragraphs
  const doubleNewlineCount = (normalized.match(/\n\s*\n/g) || []).length;
  // If there are a decent amount of double newlines, assume they signify paragraph breaks
  if (doubleNewlineCount > 3) {
    return normalized.split(/\n\s*\n/).map(p => p.replace(/\n/g, ' ').trim()).filter(Boolean);
  } else {
    // Single newline document (TXT usually, or badly parsed PDF)
    const lines = normalized.split('\n');
    const paragraphs: string[] = [];
    let currentParagraph = '';

    // Regex tests for Vietnamese and common characters
    const startsWithLower = /^[a-zàáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/;
    // Endings that strongly suggest the end of a sentence
    const prevEndsWithPunc = /[.!?:"'”’\]\}>»]$/;
    const currStartsWithDash = /^[-–—]/;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      if (!currentParagraph) {
        currentParagraph = line;
      } else {
        const isPuncEnd = prevEndsWithPunc.test(currentParagraph) || currentParagraph.endsWith('"');
        const isDashStart = currStartsWithDash.test(line);
        const isLowerStart = startsWithLower.test(line);

        // We should continue the paragraph if:
        // 1. The next line clearly starts with a lowercase letter (continuation of sentence)
        // 2. OR the previous line didn't end with a sentence-ending punctuation AND this isn't a new dialogue
        if (isLowerStart || (!isPuncEnd && !isDashStart)) {
          currentParagraph += ' ' + line;
        } else {
          paragraphs.push(currentParagraph);
          currentParagraph = line;
        }
      }
    }
    if (currentParagraph) paragraphs.push(currentParagraph);
    return paragraphs;
  }
};

export function Reader({ bookId, onBack }: { bookId: string; onBack: () => void }) {
  const [book, setBook] = useState<Book | null>(null);
  const [chapters, setChapters] = useState<ChapterMetadata[]>([]);
  const [loadedChapters, setLoadedChapters] = useState<Record<string, string>>({});
  const loadingChaptersRef = useRef<Set<string>>(new Set());
  const [loadingContent, setLoadingContent] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState('Đang kết nối cơ sở dữ liệu...');
  const [error, setError] = useState<string | null>(null);
  const [showRetry, setShowRetry] = useState(false);
  const [currentChapterIndex, setCurrentChapterIndex] = useState(0);
  const [settings, setSettings] = useState<ReaderSettings>(() => {
    const saved = localStorage.getItem('reader-settings');
    return saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS;
  });

  const [showSettings, setShowSettings] = useState(false);
  const [showTOC, setShowTOC] = useState(false);
  const [showBars, setShowBars] = useState(true);

  // TTS State
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [currentParagraphIndex, setCurrentParagraphIndex] = useState(-1);
  const [speechRate, setSpeechRate] = useState(() => {
    const saved = localStorage.getItem('tts-rate');
    return saved ? Number(saved) : 1.0;
  });
  const [allVoices, setAllVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [viVoices, setViVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceIndex, setSelectedVoiceIndex] = useState<number | undefined>(() => {
    const saved = localStorage.getItem('tts-voice-index');
    return saved ? Number(saved) : undefined;
  });
  const [showVoiceSelector, setShowVoiceSelector] = useState(false);
  const ttsStoppedRef = useRef(false);
  const autoAdvanceRef = useRef(false);
  const paragraphRefs = useRef<(HTMLParagraphElement | null)[]>([]);

  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    loadBookData(controller.signal);

    const timer = setTimeout(() => {
      setShowRetry(true);
    }, 10000); // Show retry after 10 seconds

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [bookId]);

  useEffect(() => {
    localStorage.setItem('reader-settings', JSON.stringify(settings));
  }, [settings]);

  const loadChapterContent = useCallback(async (index: number, signal?: AbortSignal) => {
    if (index < 0 || index >= chapters.length) return;
    const chapter = chapters[index];
    if (loadedChapters[chapter.id] || loadingChaptersRef.current.has(chapter.id)) return;

    try {
      loadingChaptersRef.current.add(chapter.id);
      const fullChapter = await getChapter(chapter.id);
      if (fullChapter && !signal?.aborted) {
        setLoadedChapters(prev => ({ ...prev, [chapter.id]: fullChapter.content }));
      }
    } catch (err) {
      console.error('Error loading chapter content:', err);
    } finally {
      loadingChaptersRef.current.delete(chapter.id);
    }
  }, [chapters, loadedChapters]);

  const loadBookData = async (signal?: AbortSignal) => {
    try {
      setLoadingStatus('Đang tìm thông tin truyện...');
      const b = await getBook(bookId);
      if (signal?.aborted) return;

      if (!b) {
        setError('Không tìm thấy thông tin truyện.');
        return;
      }
      setBook(b);

      setLoadingStatus('Đang tải danh sách chương...');
      const meta = await getChaptersMetadata(bookId);
      if (signal?.aborted) return;

      if (meta.length === 0) {
        setError('Truyện này không có nội dung hoặc lỗi khi lưu.');
        return;
      }

      setChapters(meta);
      setLoadingStatus('Đang tải nội dung chương...');

      let initialIdx = 0;
      if (b.lastReadChapterId) {
        const idx = meta.findIndex(c => c.id === b.lastReadChapterId);
        if (idx !== -1) {
          initialIdx = idx;
        }
      }

      setCurrentChapterIndex(initialIdx);

      // Load current chapter content immediately
      const firstChapter = await getChapter(meta[initialIdx].id);
      if (firstChapter && !signal?.aborted) {
        setLoadedChapters({ [firstChapter.id]: firstChapter.content });
      }
    } catch (err: any) {
      if (err.name === 'AbortError' || err.message === 'Aborted') return;
      console.error('Error loading book data:', err);
      setError('Có lỗi xảy ra khi tải dữ liệu. Vui lòng thử lại.');
    }
  };

  useEffect(() => {
    if (book && chapters.length > 0) {
      // Load current chapter and adjacent chapters
      const loadContent = async () => {
        // Always ensure current chapter is loaded first
        await loadChapterContent(currentChapterIndex);

        // Then background load previous and next chapters
        if (currentChapterIndex > 0) {
          loadChapterContent(currentChapterIndex - 1);
        }
        if (currentChapterIndex < chapters.length - 1) {
          loadChapterContent(currentChapterIndex + 1);
        }
      };
      loadContent();
    }
  }, [currentChapterIndex, book, chapters, loadChapterContent]);

  // Handle scroll progress
  useEffect(() => {
    if (!book || chapters.length === 0) return;

    const handleScroll = () => {
      const windowHeight = window.innerHeight;
      const documentHeight = document.documentElement.scrollHeight;
      const scrollTop = window.scrollY;

      let scrollPercent = 0;
      if (documentHeight > windowHeight) {
        scrollPercent = scrollTop / (documentHeight - windowHeight);
      } else {
        scrollPercent = 1; // If content is smaller than screen, it's 100% read
      }

      // Calculate overall progress combining chapter index and scroll position within chapter
      const chapterWeight = 1 / chapters.length;
      const baseProgress = (currentChapterIndex / chapters.length) * 100;
      const scrollProgress = (scrollPercent * chapterWeight) * 100;

      const totalProgress = Math.min(100, Math.round(baseProgress + scrollProgress));
      const currentChapter = chapters[currentChapterIndex];

      updateBookProgress(book.id, currentChapter.id, totalProgress);
    };

    // Run once on mount to set initial progress (especially for chapter 1)
    handleScroll();

    // Throttle scroll events to avoid performance issues
    let ticking = false;
    const scrollListener = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          handleScroll();
          ticking = false;
        });
        ticking = true;
      }
    };

    window.addEventListener('scroll', scrollListener);
    return () => window.removeEventListener('scroll', scrollListener);
  }, [currentChapterIndex, book, chapters]);

  const handleNextChapter = () => {
    if (currentChapterIndex < chapters.length - 1) {
      setCurrentChapterIndex(prev => prev + 1);
      window.scrollTo(0, 0);
    }
  };

  const handlePrevChapter = () => {
    if (currentChapterIndex > 0) {
      setCurrentChapterIndex(prev => prev - 1);
      window.scrollTo(0, 0);
    }
  };

  const toggleBars = () => {
    if (isSpeaking) return; // Don't toggle bars while TTS controls are showing
    setShowBars(prev => !prev);
    setShowSettings(false);
    setShowTOC(false);
  };

  // === TTS Logic ===
  const SPEED_OPTIONS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];

  // Load available voices
  useEffect(() => {
    TextToSpeech.getSupportedVoices().then(({ voices }) => {
      setAllVoices(voices);
      const viOnly = voices.filter(v => v.lang.startsWith('vi'));
      setViVoices(viOnly);
      // If saved voice is out of range, reset
      const saved = localStorage.getItem('tts-voice-index');
      if (saved) {
        const idx = Number(saved);
        // Verify the saved index is a Vietnamese voice
        const voiceAtIdx = voices[idx];
        if (!voiceAtIdx || !voiceAtIdx.lang.startsWith('vi')) {
          setSelectedVoiceIndex(viOnly.length > 0 ? voices.indexOf(viOnly[0]) : undefined);
        }
      }
    }).catch(err => console.warn('Cannot load TTS voices:', err));
  }, []);

  const selectVoice = (globalIndex: number) => {
    setSelectedVoiceIndex(globalIndex);
    localStorage.setItem('tts-voice-index', String(globalIndex));
    setShowVoiceSelector(false);
  };

  const getSelectedVoiceName = () => {
    if (selectedVoiceIndex === undefined) return 'Mặc định';
    const voice = allVoices[selectedVoiceIndex];
    if (!voice) return 'Mặc định';
    // Shorten the name: "vi-VN-language" → just show the distinguishing part
    return voice.name.replace(/^Vietnamese\s*/i, '').replace(/^vi[-_]VN[-_]?/i, '') || voice.name;
  };

  const cycleSpeed = () => {
    setSpeechRate(prev => {
      const currentIdx = SPEED_OPTIONS.indexOf(prev);
      const nextIdx = (currentIdx + 1) % SPEED_OPTIONS.length;
      const newRate = SPEED_OPTIONS[nextIdx];
      localStorage.setItem('tts-rate', String(newRate));
      return newRate;
    });
  };

  // ── Native TTS: gửi paragraphs tới Foreground Service, service tự đọc ──

  const startSpeaking = useCallback(async () => {
    const chapter = chapters[currentChapterIndex];
    const content = loadedChapters[chapter?.id];
    if (!content) return;

    const paragraphs = processContent(content);
    if (paragraphs.length === 0) return;

    const startFrom = currentParagraphIndex >= 0 ? currentParagraphIndex : 0;

    try {
      // Start foreground service first
      await TtsBackground.startService({
        bookTitle: book?.title || 'AppReader',
        chapterTitle: chapter?.title || `Chương ${currentChapterIndex + 1}`,
      });

      // Set speech rate
      await TtsBackground.setRate({ rate: speechRate });

      // Send paragraphs to native service → service handles the TTS loop
      await TtsBackground.setParagraphs({
        paragraphs,
        startIndex: startFrom,
      });
    } catch (e) {
      console.warn('TtsBackground start failed:', e);
      return;
    }

    setIsSpeaking(true);
    setShowBars(true);
  }, [chapters, currentChapterIndex, loadedChapters, currentParagraphIndex, book, speechRate]);

  const pauseSpeaking = useCallback(async () => {
    autoAdvanceRef.current = false;
    try { await TtsBackground.pause(); } catch (e) { /* ignore */ }
    setIsSpeaking(false);
  }, []);

  const fullStopSpeaking = useCallback(async () => {
    autoAdvanceRef.current = false;
    try { await TtsBackground.stopService(); } catch (e) { /* ignore */ }
    setIsSpeaking(false);
    setCurrentParagraphIndex(-1);
  }, []);

  const toggleSpeaking = useCallback(() => {
    if (isSpeaking) {
      pauseSpeaking();
    } else {
      startSpeaking();
    }
  }, [isSpeaking, pauseSpeaking, startSpeaking]);

  // Sync speech rate to native service when it changes
  useEffect(() => {
    if (isSpeaking) {
      TtsBackground.setRate({ rate: speechRate }).catch(() => { });
    }
  }, [speechRate, isSpeaking]);

  // When chapter changes manually: stop speaking
  useEffect(() => {
    if (autoAdvanceRef.current) {
      setCurrentParagraphIndex(-1);
      return;
    }
    if (isSpeaking) {
      fullStopSpeaking();
    }
    setCurrentParagraphIndex(-1);
  }, [currentChapterIndex]);

  // Auto-advance: when new chapter content loads, send to native service
  useEffect(() => {
    if (!autoAdvanceRef.current) return;
    const chapter = chapters[currentChapterIndex];
    if (!chapter) return;
    const content = loadedChapters[chapter.id];
    if (!content) return;

    autoAdvanceRef.current = false;
    const paragraphs = processContent(content);
    if (paragraphs.length === 0) return;

    // Send new chapter paragraphs to native service
    (async () => {
      try {
        await TtsBackground.updateNotification({
          chapterTitle: chapter.title || `Chương ${currentChapterIndex + 1}`,
        });
        await TtsBackground.setRate({ rate: speechRate });
        await TtsBackground.setParagraphs({ paragraphs, startIndex: 0 });
        setIsSpeaking(true);
      } catch (e) {
        console.warn('Auto-advance failed:', e);
      }
    })();
  }, [chapters, currentChapterIndex, loadedChapters, speechRate]);

  // Listen for native service events: commands + paragraph progress
  useEffect(() => {
    let cmdListener: any;
    let progressListener: any;

    // Command events: chapter_finished, paused, resumed, stop, play, next, prev
    TtsBackground.addListener('ttsCommand', (data: { command: string }) => {
      switch (data.command) {
        case 'chapter_finished':
          // Native service finished all paragraphs → auto-advance
          setCurrentParagraphIndex(-1);
          setIsSpeaking(false);
          autoAdvanceRef.current = true;
          handleNextChapter();
          break;
        case 'paused':
          setIsSpeaking(false);
          break;
        case 'resumed':
          setIsSpeaking(true);
          break;
        case 'play':
          // User tapped play on notification when not playing
          startSpeaking();
          break;
        case 'stop':
          setIsSpeaking(false);
          setCurrentParagraphIndex(-1);
          break;
        case 'next':
          handleNextChapter();
          break;
        case 'prev':
          handlePrevChapter();
          break;
      }
    }).then((l: any) => { cmdListener = l; });

    // Progress events: paragraph index updates for auto-scroll
    TtsBackground.addListener('ttsProgress', (data: { index: number }) => {
      setCurrentParagraphIndex(data.index);
      // Auto-scroll to current paragraph
      setTimeout(() => {
        paragraphRefs.current[data.index]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
    }).then((l: any) => { progressListener = l; });

    return () => {
      if (cmdListener) cmdListener.remove();
      if (progressListener) progressListener.remove();
    };
  }, [startSpeaking]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      autoAdvanceRef.current = false;
      TtsBackground.stopService().catch(() => { });
    };
  }, []);

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-white dark:bg-gray-900 p-6 text-center">
        <div className="w-20 h-20 bg-red-50 dark:bg-red-900/20 rounded-full flex items-center justify-center mb-6">
          <X className="w-10 h-10 text-red-500" />
        </div>
        <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">Lỗi tải truyện</h3>
        <p className="text-gray-500 dark:text-gray-400 mb-8 max-w-xs">
          {error}
        </p>
        <button
          onClick={onBack}
          className="flex items-center justify-center gap-2 w-full max-w-xs py-3 px-6 rounded-xl bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors font-medium"
        >
          <ArrowLeft className="w-5 h-5" />
          Quay lại tủ sách
        </button>
      </div>
    );
  }

  if (!book || chapters.length === 0) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-white dark:bg-gray-900 animate-in fade-in duration-500 p-6">
        <div className="text-center max-w-xs w-full">
          <div className="relative w-20 h-20 mx-auto mb-8">
            <div className="absolute inset-0 rounded-full border-4 border-indigo-100 dark:border-indigo-900/30"></div>
            <div className="absolute inset-0 rounded-full border-4 border-indigo-600 border-t-transparent animate-spin"></div>
            <div className="absolute inset-0 flex items-center justify-center">
              <BookIcon className="w-8 h-8 text-indigo-600" />
            </div>
          </div>
          <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">Đang mở truyện</h3>
          <p className="text-indigo-600 dark:text-indigo-400 font-medium mb-2 animate-pulse">
            {loadingStatus}
          </p>
          <p className="text-gray-500 dark:text-gray-400 mb-8 text-sm">
            Với các bộ truyện lớn (20MB+), trình duyệt cần thời gian để trích xuất hàng ngàn chương từ bộ nhớ đệm.
          </p>

          {showRetry && (
            <div className="mb-6 p-4 bg-amber-50 dark:bg-amber-900/20 rounded-xl border border-amber-200 dark:border-amber-800 text-sm text-amber-800 dark:text-amber-200 animate-in fade-in">
              <p className="font-bold mb-1">Mất quá nhiều thời gian?</p>
              <p>Có thể do dữ liệu quá lớn hoặc trình duyệt bị treo. Bạn có thể thử tải lại trang hoặc quay lại sau.</p>
              <button
                onClick={() => {
                  setError(null);
                  setShowRetry(false);
                  const controller = new AbortController();
                  loadBookData(controller.signal);
                }}
                className="mt-3 text-indigo-600 dark:text-indigo-400 font-bold hover:underline"
              >
                Thử tải lại ngay
              </button>
            </div>
          )}

          <button
            onClick={onBack}
            className="flex items-center justify-center gap-2 w-full py-3 px-6 rounded-xl border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors font-medium"
          >
            <ArrowLeft className="w-5 h-5" />
            Quay lại tủ sách
          </button>
        </div>
      </div>
    );
  }

  const currentChapter = chapters[currentChapterIndex];

  const themeClasses = {
    light: 'bg-[#FDFBF7] text-[#1C1C1C]',
    dark: 'bg-[#121212] text-[#E0E0E0]',
    sepia: 'bg-[#f4ecd8] text-[#5b4636]',
  };

  const navClasses = {
    light: 'bg-[#FDFBF7]/95 text-[#1C1C1C] border-b border-[#E8E6E1]',
    dark: 'bg-[#121212]/95 text-[#E0E0E0] border-b border-[#2A2A2A]',
    sepia: 'bg-[#f4ecd8]/95 text-[#5b4636] border-b border-[#e4dcc8]',
  };

  const modalClasses = {
    light: 'bg-[#FDFBF7] text-[#1C1C1C]',
    dark: 'bg-[#1C1C1E] text-[#E0E0E0]',
    sepia: 'bg-[#f4ecd8] text-[#5b4636]',
  };

  return (
    <div className={`min-h-screen transition-colors duration-300 ${themeClasses[settings.theme]}`}>
      {/* Top Bar */}
      <div
        className={`fixed top-0 left-0 right-0 backdrop-blur-md shadow-sm transition-transform duration-300 z-40 flex items-center justify-between px-4 pb-3 ${navClasses[settings.theme]} ${showBars ? 'translate-y-0' : '-translate-y-full'}`}
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.75rem)' }}
      >
        <button onClick={onBack} className="p-2 -ml-2 rounded-full hover:bg-black/5 dark:hover:bg-white/10">
          <ArrowLeft className="w-6 h-6" />
        </button>
        <div className="flex-1 flex flex-col items-center px-4 overflow-hidden">
          <h1 className="font-semibold text-sm sm:text-base truncate w-full text-center">{book.title}</h1>
          <span className={`text-[10px] sm:text-xs font-medium opacity-70`}>
            Chương {currentChapterIndex + 1} / {chapters.length}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={toggleSpeaking} className={`p-2 rounded-full hover:bg-black/5 dark:hover:bg-white/10 ${isSpeaking ? 'text-indigo-500' : ''}`} title="Nghe truyện">
            <Volume2 className="w-6 h-6" />
          </button>
          <button onClick={() => { setShowTOC(!showTOC); setShowSettings(false); }} className="p-2 rounded-full hover:bg-black/5 dark:hover:bg-white/10">
            <List className="w-6 h-6" />
          </button>
          <button onClick={() => { setShowSettings(!showSettings); setShowTOC(false); }} className="p-2 -mr-2 rounded-full hover:bg-black/5 dark:hover:bg-white/10">
            <Settings className="w-6 h-6" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div
        className="px-4 sm:px-8 md:px-16 lg:px-32 pt-20 pb-32 min-h-screen cursor-pointer"
        onClick={toggleBars}
      >
        <div
          ref={contentRef}
          className="max-w-3xl mx-auto"
          style={{
            fontSize: `${settings.fontSize}px`,
            fontFamily: settings.fontFamily === 'sans-serif' ? 'ui-sans-serif, system-ui, sans-serif' :
              settings.fontFamily === 'serif' ? 'ui-serif, Georgia, serif' : 'ui-monospace, monospace',
            lineHeight: settings.lineHeight,
          }}
        >
          <h2 className="text-2xl sm:text-3xl font-bold mb-8 text-center">{currentChapter.title}</h2>
          <div className="break-words text-justify">
            {loadedChapters[currentChapter.id] ? (
              processContent(loadedChapters[currentChapter.id]).map((paragraph, idx) => (
                <p
                  key={idx}
                  ref={el => { paragraphRefs.current[idx] = el; }}
                  style={{
                    marginBottom: `${settings.paragraphSpacing}em`,
                    ...(isSpeaking && currentParagraphIndex === idx ? {
                      backgroundColor: settings.theme === 'dark' ? 'rgba(99,102,241,0.15)' :
                        settings.theme === 'sepia' ? 'rgba(180,140,80,0.15)' : 'rgba(99,102,241,0.1)',
                      borderRadius: '6px',
                      padding: '4px 8px',
                      margin: '-4px -8px',
                      marginBottom: `${settings.paragraphSpacing}em`,
                      transition: 'background-color 0.3s ease',
                    } : {}),
                  }}
                >
                  {paragraph}
                </p>
              ))
            ) : (
              <div className="flex flex-col items-center justify-center py-20 gap-4">
                <Loader2 className="w-10 h-10 text-indigo-600 animate-spin" />
                <p className="text-gray-500 animate-pulse">Đang tải nội dung chương...</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Bar */}
      <div
        className={`fixed bottom-0 left-0 right-0 backdrop-blur-md shadow-[0_-1px_3px_rgba(0,0,0,0.1)] transition-transform duration-300 z-40 px-4 pt-3 flex items-center justify-between ${navClasses[settings.theme]} ${showBars ? 'translate-y-0' : 'translate-y-full'}`}
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.75rem)' }}
      >
        {isSpeaking ? (
          /* TTS Control Bar */
          <>
            <button
              onClick={fullStopSpeaking}
              className="flex items-center gap-1 px-3 py-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 text-red-500"
              title="Dừng đọc"
            >
              <Square className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2 flex-1 justify-center">
              <button
                onClick={cycleSpeed}
                className="flex items-center px-2 py-1 rounded-lg bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-300 text-xs font-bold min-w-[40px] justify-center"
                title="Tốc độ đọc"
              >
                {speechRate}x
              </button>
              <button
                onClick={() => setShowVoiceSelector(true)}
                className="flex items-center px-2 py-1 rounded-lg bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-300 text-xs font-medium max-w-[100px] truncate"
                title="Chọn giọng đọc"
              >
                🎙 {getSelectedVoiceName()}
              </button>
              <span className="text-xs opacity-60 hidden sm:inline">
                Đoạn {currentParagraphIndex + 1}
              </span>
            </div>

            <button
              onClick={toggleSpeaking}
              className="flex items-center gap-1 px-3 py-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 text-indigo-500"
              title="Tạm dừng"
            >
              <Pause className="w-5 h-5" />
            </button>
          </>
        ) : showVoiceSelector ? (
          /* Voice Selector - shown in bottom bar area when not speaking */
          <></>
        ) : (
          /* Normal Navigation Bar */
          <>
            <button
              onClick={handlePrevChapter}
              disabled={currentChapterIndex === 0}
              className="flex items-center gap-1 px-3 py-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-30"
            >
              <ChevronLeft className="w-5 h-5" />
              <span className="hidden sm:inline">Chương trước</span>
            </button>

            <div className="text-sm font-medium text-center flex-1 px-2 truncate">
              {currentChapterIndex + 1} / {chapters.length}
            </div>

            <button
              onClick={handleNextChapter}
              disabled={currentChapterIndex === chapters.length - 1}
              className="flex items-center gap-1 px-3 py-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-30"
            >
              <span className="hidden sm:inline">Chương sau</span>
              <ChevronRight className="w-5 h-5" />
            </button>
          </>
        )}
      </div>

      {/* Voice Selector Modal */}
      {showVoiceSelector && (
        <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={() => setShowVoiceSelector(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div
            className={`relative w-full max-w-md rounded-t-2xl shadow-2xl p-5 animate-in slide-in-from-bottom-10 border max-h-[70vh] flex flex-col ${settings.theme === 'dark' ? 'border-gray-700 bg-[#1C1C1E] text-[#E0E0E0]' : settings.theme === 'sepia' ? 'border-[#e4dcc8] bg-[#f4ecd8] text-[#5b4636]' : 'border-gray-100 bg-white text-[#1C1C1C]'}`}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-base">🎙 Chọn giọng đọc tiếng Việt</h3>
              <button onClick={() => setShowVoiceSelector(false)} className="p-1 rounded-full hover:bg-black/5 dark:hover:bg-white/10">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 -mx-2 px-2 space-y-1">
              {/* Default option */}
              <button
                onClick={() => { setSelectedVoiceIndex(undefined); localStorage.removeItem('tts-voice-index'); setShowVoiceSelector(false); }}
                className={`w-full text-left px-3 py-2.5 rounded-xl flex items-center justify-between transition-colors ${selectedVoiceIndex === undefined ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300' : 'hover:bg-black/5 dark:hover:bg-white/5'}`}
              >
                <div>
                  <div className="font-medium text-sm">Mặc định</div>
                  <div className="text-xs opacity-60">Giọng mặc định của hệ thống</div>
                </div>
                {selectedVoiceIndex === undefined && <span className="text-indigo-500 text-lg">✓</span>}
              </button>

              {viVoices.length === 0 && (
                <div className="text-center py-6 opacity-60 text-sm">
                  <p>Đang tải danh sách giọng...</p>
                  <p className="text-xs mt-1">Nếu không hiện, thiết bị có thể chưa cài voice tiếng Việt</p>
                </div>
              )}

              {viVoices.map((voice, i) => {
                const globalIdx = allVoices.indexOf(voice);
                const isSelected = selectedVoiceIndex === globalIdx;
                // Clean up voice name for display
                const displayName = voice.name
                  .replace(/^Vietnamese\s*/i, '')
                  .replace(/Google\s*/i, '')
                  .replace(/^vi[-_]VN[-_]?/i, '')
                  || voice.name;
                return (
                  <button
                    key={globalIdx}
                    onClick={() => selectVoice(globalIdx)}
                    className={`w-full text-left px-3 py-2.5 rounded-xl flex items-center justify-between transition-colors ${isSelected ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300' : 'hover:bg-black/5 dark:hover:bg-white/5'}`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">{displayName}</div>
                      <div className="text-xs opacity-60 truncate">
                        {voice.lang} {voice.localService ? '• Offline' : '• Online'}
                      </div>
                    </div>
                    {isSelected && <span className="text-indigo-500 text-lg ml-2 flex-shrink-0">✓</span>}
                  </button>
                );
              })}
            </div>

            {viVoices.length > 0 && (
              <div className="text-xs text-center opacity-50 mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                {viVoices.length} giọng tiếng Việt có sẵn
              </div>
            )}
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {showSettings && (
        <div className={`fixed bottom-16 left-0 right-0 shadow-xl rounded-t-2xl z-50 p-6 animate-in slide-in-from-bottom-10 max-w-md mx-auto border ${settings.theme === 'dark' ? 'border-gray-700' : 'border-gray-100'} ${modalClasses[settings.theme]}`}>
          <h3 className="font-semibold mb-4">Cài đặt đọc</h3>

          <div className="space-y-6">
            {/* Theme */}
            <div>
              <label className="text-sm text-gray-500 dark:text-gray-400 mb-2 block">Giao diện</label>
              <div className="flex gap-3">
                <button
                  onClick={() => setSettings(s => ({ ...s, theme: 'light' }))}
                  className={`flex-1 py-2 rounded-lg border flex items-center justify-center gap-2 bg-white text-gray-900 ${settings.theme === 'light' ? 'border-indigo-500 ring-2 ring-indigo-200' : 'border-gray-200'}`}
                >
                  <Sun className="w-4 h-4" /> Sáng
                </button>
                <button
                  onClick={() => setSettings(s => ({ ...s, theme: 'sepia' }))}
                  className={`flex-1 py-2 rounded-lg border flex items-center justify-center gap-2 bg-[#f4ecd8] text-[#5b4636] ${settings.theme === 'sepia' ? 'border-amber-500 ring-2 ring-amber-200' : 'border-[#e4dcc8]'}`}
                >
                  Sepia
                </button>
                <button
                  onClick={() => setSettings(s => ({ ...s, theme: 'dark' }))}
                  className={`flex-1 py-2 rounded-lg border flex items-center justify-center gap-2 bg-gray-900 text-white ${settings.theme === 'dark' ? 'border-indigo-500 ring-2 ring-indigo-900' : 'border-gray-700'}`}
                >
                  <Moon className="w-4 h-4" /> Tối
                </button>
              </div>
            </div>

            {/* Font Size */}
            <div>
              <label className="text-sm text-gray-500 dark:text-gray-400 mb-2 flex justify-between">
                <span>Cỡ chữ</span>
                <span>{settings.fontSize}px</span>
              </label>
              <div className="flex items-center gap-4">
                <Type className="w-4 h-4 text-gray-400" />
                <input
                  type="range"
                  min="12"
                  max="32"
                  value={settings.fontSize}
                  onChange={(e) => setSettings(s => ({ ...s, fontSize: Number(e.target.value) }))}
                  className="flex-1 accent-indigo-600"
                />
                <Type className="w-6 h-6 text-gray-400" />
              </div>
            </div>

            {/* Line Height */}
            <div>
              <label className="text-sm text-gray-500 dark:text-gray-400 mb-2 flex justify-between">
                <span>Dãn dòng</span>
                <span>{settings.lineHeight}</span>
              </label>
              <div className="flex items-center gap-4">
                <AlignJustify className="w-4 h-4 text-gray-400" />
                <input
                  type="range"
                  min="1"
                  max="3"
                  step="0.1"
                  value={settings.lineHeight}
                  onChange={(e) => setSettings(s => ({ ...s, lineHeight: Number(e.target.value) }))}
                  className="flex-1 accent-indigo-600"
                />
                <AlignJustify className="w-6 h-6 text-gray-400" />
              </div>
            </div>

            {/* Paragraph Spacing */}
            <div>
              <label className="text-sm text-gray-500 dark:text-gray-400 mb-2 flex justify-between">
                <span>Dãn đoạn</span>
                <span>{settings.paragraphSpacing}em</span>
              </label>
              <div className="flex items-center gap-4">
                <MoveVertical className="w-4 h-4 text-gray-400" />
                <input
                  type="range"
                  min="0"
                  max="3"
                  step="0.25"
                  value={settings.paragraphSpacing}
                  onChange={(e) => setSettings(s => ({ ...s, paragraphSpacing: Number(e.target.value) }))}
                  className="flex-1 accent-indigo-600"
                />
                <MoveVertical className="w-6 h-6 text-gray-400" />
              </div>
            </div>

            {/* Font Family */}
            <div>
              <label className="text-sm text-gray-500 dark:text-gray-400 mb-2 block">Font chữ</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setSettings(s => ({ ...s, fontFamily: 'sans-serif' }))}
                  className={`flex-1 py-2 rounded-lg border font-sans ${settings.fontFamily === 'sans-serif' ? 'bg-indigo-50 border-indigo-200 text-indigo-700 dark:bg-indigo-900/30 dark:border-indigo-700 dark:text-indigo-300' : 'border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300'}`}
                >
                  Sans
                </button>
                <button
                  onClick={() => setSettings(s => ({ ...s, fontFamily: 'serif' }))}
                  className={`flex-1 py-2 rounded-lg border font-serif ${settings.fontFamily === 'serif' ? 'bg-indigo-50 border-indigo-200 text-indigo-700 dark:bg-indigo-900/30 dark:border-indigo-700 dark:text-indigo-300' : 'border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300'}`}
                >
                  Serif
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TOC Modal */}
      {showTOC && (
        <div className="fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowTOC(false)}></div>
          <div className={`relative w-4/5 max-w-sm h-full shadow-2xl flex flex-col animate-in slide-in-from-left ${modalClasses[settings.theme]}`}>
            <div className={`p-4 border-b flex justify-between items-center ${settings.theme === 'dark' ? 'border-gray-800' : 'border-black/5'}`}>
              <h3 className="font-bold text-lg">Mục lục</h3>
              <button onClick={() => setShowTOC(false)} className="p-2 rounded-full hover:bg-black/10 text-current opacity-60 hover:opacity-100">
                <ArrowLeft className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {chapters.map((ch, idx) => (
                <button
                  key={ch.id}
                  onClick={() => {
                    setCurrentChapterIndex(idx);
                    setShowTOC(false);
                  }}
                  className={`w-full text-left px-4 py-3 rounded-lg mb-1 transition-colors ${idx === currentChapterIndex ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300 font-medium' : 'hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300'}`}
                >
                  <div className="truncate">{ch.title}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
