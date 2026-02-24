import { openDB, DBSchema } from 'idb';

export interface Book {
  id: string;
  title: string;
  author?: string;
  cover?: string;
  lastReadChapterId?: string;
  lastReadAt?: number;
  progress?: number;
  addedAt: number;
  chapterCount?: number;
  toc?: { id: string; title: string; order: number }[];
}

export interface Chapter {
  id: string;
  bookId: string;
  title: string;
  content: string;
  order: number;
}

interface ReaderDB extends DBSchema {
  books: {
    key: string;
    value: Book;
  };
  chapters: {
    key: string;
    value: Chapter;
    indexes: { 'by-book': string };
  };
}

export const dbPromise = openDB<ReaderDB>('reader-db', 1, {
  upgrade(db) {
    db.createObjectStore('books', { keyPath: 'id' });
    const chapterStore = db.createObjectStore('chapters', { keyPath: 'id' });
    chapterStore.createIndex('by-book', 'bookId');
  },
});

export async function addBook(book: Book, chapters: Chapter[]) {
  const db = await dbPromise;

  // Save TOC in the book object for instant loading
  const bookWithToc = {
    ...book,
    progress: book.progress || 0,
    toc: chapters.map(ch => ({ id: ch.id, title: ch.title, order: ch.order }))
  };

  // Save book first
  await db.put('books', bookWithToc);

  // Save chapters in batches to prevent transaction timeouts for large books
  const BATCH_SIZE = 500;
  for (let i = 0; i < chapters.length; i += BATCH_SIZE) {
    const tx = db.transaction('chapters', 'readwrite');
    const store = tx.objectStore('chapters');
    const batch = chapters.slice(i, i + BATCH_SIZE);

    for (const chapter of batch) {
      store.put(chapter);
    }

    await tx.done;
  }
}

export async function getBooks() {
  const db = await dbPromise;
  return db.getAll('books');
}

export async function getBook(id: string) {
  const db = await dbPromise;
  return db.get('books', id);
}

export async function getChaptersMetadata(bookId: string) {
  const db = await dbPromise;

  // Try to get TOC from book object first (instant)
  const book = await db.get('books', bookId);
  if (book && book.toc) {
    return book.toc.map(t => ({ ...t, bookId }));
  }

  // Fallback for older books without TOC in the book object
  const tx = db.transaction('chapters', 'readonly');
  const index = tx.store.index('by-book');

  const metadata = [];
  let cursor = await index.openCursor(IDBKeyRange.only(bookId));

  while (cursor) {
    const { id, bookId: bId, title, order } = cursor.value;
    metadata.push({ id, bookId: bId, title, order });
    cursor = await cursor.continue();
  }

  return metadata.sort((a, b) => a.order - b.order);
}

export async function getChapter(id: string) {
  const db = await dbPromise;
  return db.get('chapters', id);
}

export async function getChapters(bookId: string) {
  const db = await dbPromise;
  const chapters = await db.getAllFromIndex('chapters', 'by-book', bookId);
  return chapters.sort((a, b) => a.order - b.order);
}

export async function updateBookProgress(bookId: string, chapterId: string, progress: number) {
  const db = await dbPromise;
  const book = await db.get('books', bookId);
  if (book) {
    book.lastReadChapterId = chapterId;
    book.progress = progress;
    book.lastReadAt = Date.now();
    await db.put('books', book);
  }
}

export async function deleteBook(bookId: string) {
  const db = await dbPromise;
  const tx = db.transaction(['books', 'chapters'], 'readwrite');

  try {
    // Delete the book record
    tx.objectStore('books').delete(bookId);

    // Delete all chapters associated with the book
    const chapterStore = tx.objectStore('chapters');
    const index = chapterStore.index('by-book');
    const chapterIds = await index.getAllKeys(bookId);

    for (const chapterId of chapterIds) {
      chapterStore.delete(chapterId);
    }

    await tx.done;
    return true;
  } catch (error) {
    console.error('Database error during book deletion:', error);
    throw error;
  }
}

export async function updateBookCover(bookId: string, coverDataUrl: string) {
  const db = await dbPromise;
  const book = await db.get('books', bookId);
  if (book) {
    book.cover = coverDataUrl;
    await db.put('books', book);
  }
}
