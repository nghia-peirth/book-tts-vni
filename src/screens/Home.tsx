import React, { useState, useEffect, useRef } from 'react';
import { Book, getBooks, addBook, deleteBook, updateBookCover } from '../db';
import { parseFile } from '../parser';
import { Book as BookIcon, Plus, Trash2, Loader2, FileText, Type, Upload, X, ImagePlus } from 'lucide-react';

export function Home({ onOpenBook }: { onOpenBook: (id: string) => void }) {
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState('');
  const [statusDetail, setStatusDetail] = useState('');
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [coverEditId, setCoverEditId] = useState<string | null>(null);
  const [abortController, setAbortController] = useState<AbortController | null>(null);
  const [showManualInput, setShowManualInput] = useState(false);
  const [manualTitle, setManualTitle] = useState('');
  const [manualContent, setManualContent] = useState('');
  const [lastDetection, setLastDetection] = useState<any>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadBooks();

    // Load last detection log
    const savedLog = localStorage.getItem('last-detection-log');
    if (savedLog) {
      try {
        setLastDetection(JSON.parse(savedLog));
      } catch (e) {
        console.error('Failed to parse detection log');
      }
    }

    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowAddMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const loadBooks = async () => {
    const loadedBooks = await getBooks();
    setBooks(loadedBooks.sort((a, b) => b.addedAt - a.addedAt));
  };

  const lastReadBook = books
    .filter(b => b.lastReadAt)
    .sort((a, b) => (b.lastReadAt || 0) - (a.lastReadAt || 0))[0];

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const controller = new AbortController();
    setAbortController(controller);
    setLoading(true);
    setProgress(0);
    setStatusText('Đang chuẩn bị...');
    setStatusDetail('Đang khởi tạo trình đọc file...');
    try {
      const { title, chapters } = await parseFile(file, (p, status, detail) => {
        setProgress(p);
        if (status) setStatusText(status);
        if (detail) setStatusDetail(detail);
      }, controller.signal);

      // Save detection info to localStorage for persistence/history
      const detectionLog = {
        fileName: file.name,
        title,
        chapterCount: chapters.length,
        timestamp: Date.now(),
        chapterTitles: chapters.slice(0, 10).map(c => c.title), // Save first 10 for preview
      };
      localStorage.setItem('last-detection-log', JSON.stringify(detectionLog));
      setLastDetection(detectionLog);

      setStatusText('Đang lưu vào thiết bị...');
      setStatusDetail(`Đang lưu ${chapters.length} chương vào cơ sở dữ liệu...`);
      const bookId = crypto.randomUUID();

      const newBook: Book = {
        id: bookId,
        title,
        addedAt: Date.now(),
        chapterCount: chapters.length,
      };

      const newChapters = chapters.map((ch, index) => ({
        id: crypto.randomUUID(),
        bookId,
        title: ch.title,
        content: ch.content,
        order: index,
      }));

      await addBook(newBook, newChapters);
      await loadBooks();
    } catch (error: any) {
      if (error.message === 'Aborted') {
        console.log('Import cancelled by user');
      } else {
        console.error('Error parsing file:', error);
        alert('Có lỗi xảy ra khi đọc file. Vui lòng thử lại.');
      }
    } finally {
      setLoading(false);
      setProgress(0);
      setAbortController(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDelete = async (id: string) => {
    if (deletingId) return;

    setDeletingId(id);
    setConfirmDeleteId(null);
    try {
      await deleteBook(id);
      await loadBooks();
    } catch (error) {
      console.error('Error deleting book:', error);
      alert('Không thể xóa truyện. Vui lòng thử lại.');
    } finally {
      setDeletingId(null);
    }
  };

  const handleCoverEdit = async (bookId: string) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async (e: any) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async () => {
        const dataUrl = reader.result as string;
        await updateBookCover(bookId, dataUrl);
        await loadBooks();
      };
      reader.readAsDataURL(file);
    };
    input.click();
  };

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualTitle.trim() || !manualContent.trim()) return;

    const controller = new AbortController();
    setAbortController(controller);
    setLoading(true);
    setStatusText('Đang lưu truyện...');

    try {
      const bookId = crypto.randomUUID();
      const newBook: Book = {
        id: bookId,
        title: manualTitle.trim(),
        addedAt: Date.now(),
        chapterCount: 1,
      };

      const newChapters = [{
        id: crypto.randomUUID(),
        bookId,
        title: 'Nội dung',
        content: manualContent.trim(),
        order: 0,
      }];

      await addBook(newBook, newChapters);
      await loadBooks();
      setShowManualInput(false);
      setManualTitle('');
      setManualContent('');
    } catch (error: any) {
      if (error.message === 'Aborted') {
        console.log('Manual import cancelled');
      } else {
        console.error('Error saving manual book:', error);
        alert('Có lỗi xảy ra khi lưu truyện. Vui lòng thử lại.');
      }
    } finally {
      setLoading(false);
      setAbortController(null);
    }
  };

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Chào buổi sáng';
    if (hour < 18) return 'Chào buổi chiều';
    return 'Chào buổi tối';
  };

  return (
    <div className="min-h-screen bg-[#FDFBF7] dark:bg-[#121212] text-[#1C1C1C] dark:text-[#E0E0E0] font-sans">
      <header className="bg-[#FDFBF7]/90 dark:bg-[#121212]/90 backdrop-blur-md px-6 py-6 flex justify-between items-center sticky top-0 z-10 border-b border-[#E8E6E1] dark:border-[#2A2A2A]">
        <div>
          <h1 className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-1">
            {new Date().toLocaleDateString('vi-VN', { weekday: 'long', month: 'long', day: 'numeric' })}
          </h1>
          <h2 className="text-2xl font-serif font-bold text-[#1C1C1C] dark:text-white">
            {getGreeting()}, Độc giả
          </h2>
        </div>

        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setShowAddMenu(!showAddMenu)}
            disabled={loading}
            className="text-[#1C1C1C] dark:text-white hover:opacity-70 p-2 rounded-full flex items-center gap-2 transition-opacity disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-6 h-6 animate-spin" /> : <Plus className="w-6 h-6" />}
          </button>

          {showAddMenu && (
            <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-100 dark:border-gray-700 py-2 z-20 animate-in slide-in-from-top-2">
              <label className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer transition-colors">
                <Upload className="w-5 h-5 text-indigo-500" />
                <span className="text-sm font-medium">Tải file (PDF/TXT)</span>
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={(e) => { handleFileChange(e); setShowAddMenu(false); }}
                  accept=".txt,.pdf"
                  className="hidden"
                />
              </label>
              <button
                onClick={() => { setShowManualInput(true); setShowAddMenu(false); }}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer transition-colors text-left"
              >
                <Type className="w-5 h-5 text-emerald-500" />
                <span className="text-sm font-medium">Nhập văn bản</span>
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="p-6 max-w-4xl mx-auto">
        {lastReadBook && (
          <div className="mb-12">
            <h3 className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-4 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-[#B8860B] animate-pulse"></span>
              Đang đọc dở
            </h3>
            <div
              onClick={() => onOpenBook(lastReadBook.id)}
              className="bg-white dark:bg-[#1C1C1E] border border-[#E8E6E1] dark:border-[#2A2A2A] rounded-xl p-6 shadow-sm hover:shadow-md cursor-pointer group transition-all"
            >
              <div className="flex gap-6 items-center">
                <div className="w-20 h-28 bg-[#F4F1EA] dark:bg-[#2C2C2E] rounded flex-shrink-0 flex items-center justify-center shadow-inner border border-[#E8E6E1] dark:border-[#3A3A3C]">
                  <BookIcon className="w-8 h-8 text-[#B8860B]/50" />
                </div>
                <div className="flex-1">
                  <h4 className="text-xl font-serif font-bold mb-2 line-clamp-2 text-[#1C1C1C] dark:text-white leading-snug">
                    {lastReadBook.title}
                  </h4>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-4 font-serif italic">
                    Chương {lastReadBook.chapterCount}
                  </p>

                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-1 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[#B8860B] transition-all duration-500"
                        style={{ width: `${lastReadBook.progress || 0}%` }}
                      ></div>
                    </div>
                    <span className="text-xs font-bold text-[#B8860B] w-8 text-right">
                      {lastReadBook.progress || 0}%
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {books.length === 0 && (
          <div className="text-center py-20 text-gray-500 dark:text-gray-400">
            <FileText className="w-16 h-16 mx-auto mb-4 opacity-20" />
            <p className="text-lg">Tủ sách trống</p>
            <p className="text-sm mt-2">Nhấn "Thêm truyện" để bắt đầu</p>
          </div>
        )}

        {books.length > 0 && (
          <div>
            <h3 className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-4">
              Tủ sách của tôi
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-6">
              {books.map(book => (
                <div
                  key={book.id}
                  onClick={() => onOpenBook(book.id)}
                  className="group cursor-pointer relative"
                >
                  <div className="aspect-[2/3] w-full bg-[#F4F1EA] dark:bg-[#1C1C1E] border border-[#E8E6E1] dark:border-[#2A2A2A] rounded-lg shadow-sm group-hover:shadow-md transition-shadow flex items-center justify-center mb-3 relative overflow-hidden">
                    {book.cover ? (
                      <img src={book.cover} alt={book.title} className="w-full h-full object-cover" />
                    ) : (
                      <BookIcon className="w-8 h-8 text-gray-300 dark:text-gray-700 transition-transform group-hover:scale-110" />
                    )}

                    {/* Nút sửa ảnh bìa */}
                    <button
                      type="button"
                      title="Sửa ảnh bìa"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleCoverEdit(book.id);
                      }}
                      className="absolute top-2 left-2 bg-white/90 dark:bg-gray-900/90 text-gray-400 hover:text-indigo-500 p-2 rounded-full transition-all z-20 opacity-70"
                    >
                      <ImagePlus className="w-4 h-4" />
                    </button>

                    {/* Nút xóa - luôn hiện trên mobile */}
                    <button
                      type="button"
                      title="Xóa truyện"
                      disabled={deletingId === book.id}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setConfirmDeleteId(book.id);
                      }}
                      className="absolute top-2 right-2 bg-white/90 dark:bg-gray-900/90 text-gray-400 hover:text-red-500 p-2 rounded-full transition-all z-20 opacity-70"
                    >
                      {deletingId === book.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Trash2 className="w-4 h-4" />
                      )}
                    </button>

                    {book.progress !== undefined && book.progress > 0 && (
                      <div className="absolute bottom-0 left-0 right-0 h-1 bg-gray-200 dark:bg-gray-800">
                        <div className="h-full bg-[#B8860B]" style={{ width: `${book.progress}%` }}></div>
                      </div>
                    )}
                  </div>

                  <h4 className="font-serif font-bold text-sm text-[#1C1C1C] dark:text-white line-clamp-2 leading-snug">
                    {book.title}
                  </h4>
                  <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1 uppercase tracking-widest">
                    {book.chapterCount} Chương
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {
          lastDetection && (
            <div className="mt-12 p-6 bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="font-bold text-gray-900 dark:text-white">Thông tin nhận diện gần nhất</h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    File: {lastDetection.fileName} • {new Date(lastDetection.timestamp).toLocaleString('vi-VN')}
                  </p>
                </div>
                <button
                  onClick={() => {
                    localStorage.removeItem('last-detection-log');
                    setLastDetection(null);
                  }}
                  className="text-gray-400 hover:text-red-500 transition-colors"
                  title="Xóa lịch sử"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex items-center gap-4 mb-4">
                <div className="bg-indigo-50 dark:bg-indigo-900/30 px-3 py-1 rounded-full text-xs font-bold text-indigo-600 dark:text-indigo-400">
                  {lastDetection.chapterCount} chương được tìm thấy
                </div>
              </div>

              <div className="space-y-1">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">10 chương đầu tiên:</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
                  {lastDetection.chapterTitles.map((title: string, i: number) => (
                    <div key={i} className="text-xs text-gray-600 dark:text-gray-400 truncate flex items-center gap-2">
                      <span className="w-4 text-[10px] text-gray-400">{i + 1}.</span>
                      {title}
                    </div>
                  ))}
                </div>
                {lastDetection.chapterCount > 10 && (
                  <p className="text-[10px] text-gray-400 italic mt-2">... và {lastDetection.chapterCount - 10} chương khác</p>
                )}
              </div>
            </div>
          )
        }
      </main >

      {/* Manual Input Modal */}
      {
        showManualInput && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowManualInput(false)}></div>
            <div className="relative bg-white dark:bg-gray-800 w-full max-w-2xl rounded-2xl shadow-2xl flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200">
              <div className="p-4 border-b border-gray-100 dark:border-gray-700 flex justify-between items-center">
                <h3 className="font-bold text-lg">Nhập truyện mới</h3>
                <button onClick={() => setShowManualInput(false)} className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <form onSubmit={handleManualSubmit} className="flex-1 overflow-y-auto p-6 flex flex-col gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Tên truyện</label>
                  <input
                    type="text"
                    required
                    value={manualTitle}
                    onChange={(e) => setManualTitle(e.target.value)}
                    placeholder="Ví dụ: Dế Mèn Phiêu Lưu Ký"
                    className="w-full px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>
                <div className="flex-1 flex flex-col">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nội dung</label>
                  <textarea
                    required
                    value={manualContent}
                    onChange={(e) => setManualContent(e.target.value)}
                    placeholder="Dán nội dung truyện vào đây..."
                    className="flex-1 w-full px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 focus:ring-2 focus:ring-indigo-500 outline-none resize-none min-h-[300px]"
                  />
                </div>
                <div className="flex justify-end gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setShowManualInput(false)}
                    className="px-6 py-2 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 font-medium"
                  >
                    Hủy
                  </button>
                  <button
                    type="submit"
                    disabled={loading}
                    className="px-6 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-medium shadow-md shadow-indigo-200 dark:shadow-none disabled:opacity-50"
                  >
                    Lưu truyện
                  </button>
                </div>
              </form>
            </div>
          </div>
        )
      }

      {/* Delete Confirmation Modal */}
      {
        confirmDeleteId && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setConfirmDeleteId(null)}></div>
            <div className="relative bg-white dark:bg-gray-800 w-full max-w-sm rounded-2xl shadow-2xl p-6 animate-in zoom-in-95 duration-200">
              <div className="w-16 h-16 bg-red-50 dark:bg-red-900/20 rounded-full flex items-center justify-center mb-4 mx-auto">
                <Trash2 className="w-8 h-8 text-red-500" />
              </div>
              <h3 className="text-xl font-bold text-center mb-2">Xóa truyện?</h3>
              <p className="text-gray-500 dark:text-gray-400 text-center mb-6">
                Bạn có chắc muốn xóa truyện này? Hành động này không thể hoàn tác.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setConfirmDeleteId(null)}
                  className="flex-1 py-3 rounded-xl border border-gray-200 dark:border-gray-700 font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  Hủy
                </button>
                <button
                  onClick={() => handleDelete(confirmDeleteId)}
                  className="flex-1 py-3 rounded-xl bg-red-500 hover:bg-red-600 text-white font-medium shadow-lg shadow-red-200 dark:shadow-none transition-colors"
                >
                  Xóa ngay
                </button>
              </div>
            </div>
          </div>
        )
      }

      {/* Progress Overlay */}
      {
        loading && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-6 bg-black/60 backdrop-blur-md animate-in fade-in duration-300">
            <div className="bg-white dark:bg-gray-800 rounded-3xl p-10 shadow-2xl w-full max-w-md text-center border border-white/10">
              <div className="relative w-20 h-20 mx-auto mb-8">
                <div className="absolute inset-0 rounded-full border-4 border-indigo-100 dark:border-indigo-900/30"></div>
                <div
                  className="absolute inset-0 rounded-full border-4 border-indigo-600 border-t-transparent animate-spin"
                  style={{ animationDuration: '1.5s' }}
                ></div>
                <div className="absolute inset-0 flex items-center justify-center">
                  <FileText className="w-8 h-8 text-indigo-600" />
                </div>
              </div>

              <h3 className="text-2xl font-bold mb-2 text-gray-900 dark:text-white">
                {statusText || 'Đang xử lý...'}
              </h3>
              <p className="text-indigo-600 dark:text-indigo-400 font-medium mb-2 text-sm animate-pulse">
                {statusDetail}
              </p>
              <p className="text-gray-500 dark:text-gray-400 mb-8 px-4 text-xs">
                Hệ thống đang phân tích nội dung truyện. Quá trình này có thể mất vài giây tùy vào độ dài của file.
              </p>

              <div className="space-y-3">
                <div className="flex justify-between text-sm font-bold mb-1">
                  <span className="text-indigo-600 dark:text-indigo-400">Tiến độ</span>
                  <span className="text-indigo-600 dark:text-indigo-400">{progress}%</span>
                </div>
                <div className="w-full bg-gray-100 dark:bg-gray-700 rounded-full h-4 overflow-hidden p-1 shadow-inner">
                  <div
                    className="bg-indigo-600 h-full rounded-full transition-all duration-500 ease-out relative overflow-hidden"
                    style={{ width: `${progress}%` }}
                  >
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-shimmer"></div>
                  </div>
                </div>
                <div className="flex justify-center gap-1">
                  {[...Array(3)].map((_, i) => (
                    <div
                      key={i}
                      className="w-1.5 h-1.5 rounded-full bg-indigo-600 animate-bounce"
                      style={{ animationDelay: `${i * 0.15}s` }}
                    ></div>
                  ))}
                </div>
              </div>

              <button
                onClick={() => abortController?.abort()}
                className="mt-8 w-full py-3 px-6 rounded-xl border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors font-medium text-gray-600 dark:text-gray-300"
              >
                Hủy quá trình
              </button>
            </div>
          </div>
        )
      }
    </div >
  );
}
