import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Book, Chapter, getBook, getChaptersMetadata, getChapter, updateBookProgress } from '../db';
import { ArrowLeft, Settings, List, ChevronLeft, ChevronRight, Moon, Sun, Type, Book as BookIcon, X, Loader2, AlignJustify, MoveVertical } from 'lucide-react';

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
      const currentChapter = chapters[currentChapterIndex];
      const progress = Math.round(((currentChapterIndex + 1) / chapters.length) * 100);
      updateBookProgress(book.id, currentChapter.id, progress);
      window.scrollTo(0, 0);

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

  const handleNextChapter = () => {
    if (currentChapterIndex < chapters.length - 1) {
      setCurrentChapterIndex(prev => prev + 1);
    }
  };

  const handlePrevChapter = () => {
    if (currentChapterIndex > 0) {
      setCurrentChapterIndex(prev => prev - 1);
    }
  };

  const toggleBars = () => {
    setShowBars(prev => !prev);
    setShowSettings(false);
    setShowTOC(false);
  };

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
    light: 'bg-white text-gray-900',
    dark: 'bg-gray-900 text-gray-100',
    sepia: 'bg-[#f4ecd8] text-[#5b4636]',
  };

  return (
    <div className={`min-h-screen transition-colors duration-300 ${themeClasses[settings.theme]}`}>
      {/* Top Bar */}
      <div className={`fixed top-0 left-0 right-0 bg-white/90 dark:bg-gray-900/90 backdrop-blur-md shadow-sm transition-transform duration-300 z-40 flex items-center justify-between px-4 py-3 ${showBars ? 'translate-y-0' : '-translate-y-full'}`}>
        <button onClick={onBack} className="p-2 -ml-2 rounded-full hover:bg-black/5 dark:hover:bg-white/10">
          <ArrowLeft className="w-6 h-6" />
        </button>
        <div className="flex-1 flex flex-col items-center px-4 overflow-hidden">
          <h1 className="font-semibold text-sm sm:text-base truncate w-full text-center">{book.title}</h1>
          <span className="text-[10px] sm:text-xs text-gray-500 dark:text-gray-400 font-medium">
            Chương {currentChapterIndex + 1} / {chapters.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
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
              loadedChapters[currentChapter.id].split('\n').map((paragraph, idx) => {
                if (!paragraph.trim()) return null;
                return (
                  <p key={idx} style={{ marginBottom: `${settings.paragraphSpacing}em` }}>
                    {paragraph}
                  </p>
                );
              })
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
      <div className={`fixed bottom-0 left-0 right-0 bg-white/90 dark:bg-gray-900/90 backdrop-blur-md shadow-[0_-1px_3px_rgba(0,0,0,0.1)] transition-transform duration-300 z-40 px-4 py-3 flex items-center justify-between ${showBars ? 'translate-y-0' : 'translate-y-full'}`}>
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
      </div>

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed bottom-16 left-0 right-0 bg-white dark:bg-gray-800 shadow-xl rounded-t-2xl z-50 p-6 animate-in slide-in-from-bottom-10 max-w-md mx-auto border border-gray-100 dark:border-gray-700">
          <h3 className="font-semibold mb-4 text-gray-900 dark:text-gray-100">Cài đặt đọc</h3>
          
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
          <div className="relative w-4/5 max-w-sm bg-white dark:bg-gray-900 h-full shadow-2xl flex flex-col animate-in slide-in-from-left">
            <div className="p-4 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center bg-white dark:bg-gray-900">
              <h3 className="font-bold text-lg text-gray-900 dark:text-gray-100">Mục lục</h3>
              <button onClick={() => setShowTOC(false)} className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500">
                <ArrowLeft className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2 bg-white dark:bg-gray-900">
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
