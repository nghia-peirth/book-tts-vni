import * as pdfjsLib from 'pdfjs-dist';
import JSZip from 'jszip';

// Cấu hình Worker cho PDF.js bằng CDN tương ứng với phiên bản để tránh lỗi Capacitor
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js`;

export async function parseFile(
  file: File,
  onProgress?: (percent: number, status: string, detail?: string) => void,
  signal?: AbortSignal
): Promise<{ title: string; chapters: { title: string; content: string }[] }> {
  const isPdf = file.type === 'application/pdf' || file.name.endsWith('.pdf');
  const isEpub = file.type === 'application/epub+zip' || file.name.endsWith('.epub');

  // EPUB has its own chapter structure — parse directly
  if (isEpub) {
    if (onProgress) onProgress(0, 'Đang đọc file EPUB...', 'Đang giải nén...');
    const result = await parseEpub(file, onProgress, signal);
    if (onProgress) onProgress(100, 'Hoàn tất!', 'Đang chuẩn bị lưu...');
    return result;
  }

  // PDF / TXT: extract text then split into chapters
  let text = '';

  if (isPdf) {
    if (onProgress) onProgress(0, 'Đang đọc file PDF...', 'Khởi tạo...');
    text = await parsePdf(file, (p, detail) => {
      if (onProgress) onProgress(Math.round(p * 0.5), 'Đang đọc file PDF...', detail);
    }, signal);
  } else {
    if (onProgress) onProgress(0, 'Đang đọc file văn bản...', 'Đang đọc nội dung...');
    text = await file.text();
  }

  if (signal?.aborted) throw new Error('Aborted');

  const title = file.name.replace(/\.[^/.]+$/, '');

  if (onProgress) onProgress(isPdf ? 50 : 0, 'Đang phân tích chương...', 'Đang tìm kiếm tiêu đề chương...');

  const chapters = await splitIntoChapters(text, (p, detail) => {
    if (onProgress) {
      const base = isPdf ? 50 : 0;
      const multiplier = isPdf ? 0.5 : 1;
      onProgress(Math.round(base + p * multiplier), 'Đang phân tích chương...', detail);
    }
  }, signal);

  if (onProgress) onProgress(100, 'Hoàn tất!', 'Đang chuẩn bị lưu...');
  return { title, chapters };
}

// ── EPUB Parser ──

async function parseEpub(
  file: File,
  onProgress?: (percent: number, status: string, detail?: string) => void,
  signal?: AbortSignal
): Promise<{ title: string; chapters: { title: string; content: string }[] }> {
  const arrayBuffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);

  if (signal?.aborted) throw new Error('Aborted');

  // 1. Read container.xml to find the OPF file path
  const containerXml = await zip.file('META-INF/container.xml')?.async('text');
  if (!containerXml) throw new Error('Invalid EPUB: missing container.xml');

  const rootfileMatch = containerXml.match(/full-path="([^"]+)"/i);
  if (!rootfileMatch) throw new Error('Invalid EPUB: cannot find rootfile');
  const opfPath = rootfileMatch[1];
  const opfDir = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : '';

  // 2. Read and parse the OPF file
  const opfXml = await zip.file(opfPath)?.async('text');
  if (!opfXml) throw new Error('Invalid EPUB: missing OPF file');

  // Extract title from metadata
  const titleMatch = opfXml.match(/<dc:title[^>]*>([^<]+)<\/dc:title>/i);
  const bookTitle = titleMatch ? titleMatch[1].trim() : file.name.replace(/\.[^/.]+$/, '');

  // Build manifest: id → href mapping
  const manifest = new Map<string, string>();
  const manifestRegex = /<item\s[^>]*id="([^"]+)"[^>]*href="([^"]+)"[^>]*>/gi;
  let manifestMatch;
  while ((manifestMatch = manifestRegex.exec(opfXml)) !== null) {
    manifest.set(manifestMatch[1], manifestMatch[2]);
  }

  // Get spine order (reading order)
  const spineItems: string[] = [];
  const spineRegex = /<itemref\s[^>]*idref="([^"]+)"[^>]*\/?>\s*/gi;
  let spineMatch;
  while ((spineMatch = spineRegex.exec(opfXml)) !== null) {
    spineItems.push(spineMatch[1]);
  }

  if (spineItems.length === 0) {
    throw new Error('Invalid EPUB: no spine items found');
  }

  // 3. Try to parse NCX for chapter titles
  const chapterTitles = new Map<string, string>(); // href → title
  const ncxItem = opfXml.match(/<item[^>]*media-type="application\/x-dtbncx\+xml"[^>]*href="([^"]+)"[^>]*>/i);
  if (ncxItem) {
    const ncxPath = opfDir + decodeURIComponent(ncxItem[1]);
    const ncxXml = await zip.file(ncxPath)?.async('text');
    if (ncxXml) {
      const navPointRegex = /<navPoint[^>]*>\s*<navLabel>\s*<text>([^<]*)<\/text>\s*<\/navLabel>\s*<content\s+src="([^"]+)"[^>]*\/>/gi;
      let navMatch;
      while ((navMatch = navPointRegex.exec(ncxXml)) !== null) {
        const title = navMatch[1].trim();
        const href = decodeURIComponent(navMatch[2].split('#')[0]);
        if (title) chapterTitles.set(href, title);
      }
    }
  }

  // 4. Read spine items in batches of 10 for speed
  const chapters: { title: string; content: string }[] = [];
  let chapterNum = 0;
  const EPUB_BATCH = 10;

  for (let i = 0; i < spineItems.length; i += EPUB_BATCH) {
    if (signal?.aborted) throw new Error('Aborted');

    const batchEnd = Math.min(i + EPUB_BATCH, spineItems.length);
    const batchPromises: Promise<{ title: string; content: string } | null>[] = [];

    for (let j = i; j < batchEnd; j++) {
      const itemId = spineItems[j];
      const href = manifest.get(itemId);
      if (!href) { batchPromises.push(Promise.resolve(null)); continue; }

      const filePath = opfDir + decodeURIComponent(href);
      batchPromises.push(
        (async () => {
          const xhtml = await zip.file(filePath)?.async('text');
          if (!xhtml) return null;

          const textContent = htmlToText(xhtml).trim();
          if (!textContent || textContent.length < 10) return null;

          // Try to get title from NCX, fallback to <title> or <h1>
          let chTitle = chapterTitles.get(href) || chapterTitles.get(decodeURIComponent(href));
          if (!chTitle) {
            const htmlTitleMatch = xhtml.match(/<title[^>]*>([^<]+)<\/title>/i);
            if (htmlTitleMatch && htmlTitleMatch[1].trim().length > 0 && htmlTitleMatch[1].trim().length < 100) {
              chTitle = htmlTitleMatch[1].trim();
            }
          }
          if (!chTitle) {
            const headingMatch = xhtml.match(/<h[12][^>]*>([^<]+)<\/h[12]>/i);
            if (headingMatch && headingMatch[1].trim().length > 0) {
              chTitle = headingMatch[1].trim();
            }
          }

          return { title: chTitle || '', content: textContent };
        })()
      );
    }

    const batchResults = await Promise.all(batchPromises);
    for (const result of batchResults) {
      if (result) {
        chapterNum++;
        chapters.push({
          title: result.title || `Chương ${chapterNum}`,
          content: result.content,
        });
      }
    }

    if (onProgress) {
      const pct = Math.round((batchEnd / spineItems.length) * 90);
      onProgress(pct, 'Đang đọc file EPUB...', `Đang xử lý ${chapterNum}/${spineItems.length} phần`);
    }
  }

  if (chapters.length === 0) {
    throw new Error('EPUB không có nội dung hoặc định dạng không hỗ trợ.');
  }

  return { title: bookTitle, chapters };
}

/** Convert XHTML/HTML content to plain text, preserving paragraph structure */
function htmlToText(html: string): string {
  // Remove <head> section entirely
  let text = html.replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '');

  // Remove <style> and <script> tags
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');

  // Convert <br> and block-level tags to newlines
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/(p|div|h[1-6]|li|blockquote|tr)>/gi, '\n\n');
  text = text.replace(/<(p|div|h[1-6]|li|blockquote|tr)[^>]*>/gi, '');

  // Remove all remaining HTML tags
  text = text.replace(/<[^>]+>/g, '');

  // Decode common HTML entities
  text = text.replace(/&nbsp;/gi, ' ');
  text = text.replace(/&amp;/gi, '&');
  text = text.replace(/&lt;/gi, '<');
  text = text.replace(/&gt;/gi, '>');
  text = text.replace(/&quot;/gi, '"');
  text = text.replace(/&#39;/gi, "'");
  text = text.replace(/&#x([0-9a-fA-F]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  text = text.replace(/&#(\d+);/gi, (_, dec) => String.fromCharCode(parseInt(dec, 10)));

  // Clean up excessive whitespace while preserving paragraph breaks
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\n\s*\n\s*\n/g, '\n\n');
  text = text.split('\n').map(l => l.trim()).join('\n');

  return text.trim();
}

// ── PDF Parser (optimized: batch 50, no timeout) ──

async function parsePdf(file: File, onProgress?: (percent: number, detail?: string) => void, signal?: AbortSignal): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  const numPages = pdf.numPages;
  const BATCH_SIZE = 50; // Larger batches = fewer awaits = faster
  const pagesText: string[] = new Array(numPages);

  for (let i = 1; i <= numPages; i += BATCH_SIZE) {
    if (signal?.aborted) throw new Error('Aborted');

    const currentBatchEnd = Math.min(i + BATCH_SIZE - 1, numPages);
    if (onProgress) {
      onProgress((i - 1) / numPages * 100, `Trang ${i}-${currentBatchEnd} / ${numPages}`);
    }

    const batchPromises = [];
    for (let j = 0; j < BATCH_SIZE && i + j <= numPages; j++) {
      const pageNum = i + j;
      batchPromises.push(
        pdf.getPage(pageNum).then(async (page) => {
          const textContent = await page.getTextContent();
          const items = (textContent.items as any[]).sort((a, b) => {
            if (Math.abs(a.transform[5] - b.transform[5]) > 4) {
              return b.transform[5] - a.transform[5];
            }
            return a.transform[4] - b.transform[4];
          });

          // Use array + join instead of string concatenation for large pages
          const parts: string[] = [];
          let lastY = -1;
          let lastX = -1;
          let lastWidth = 0;
          for (const item of items) {
            if (lastY !== -1) {
              const yDiff = Math.abs(item.transform[5] - lastY);
              const fontHeight = item.transform[3];

              if (yDiff > (fontHeight * 1.4)) {
                parts.push('\n\n');
              } else if (yDiff > fontHeight * 0.4) {
                parts.push('\n');
              } else {
                const gap = item.transform[4] - lastX;
                if (gap > fontHeight * 0.3) {
                  parts.push(' ');
                }
              }
            }
            parts.push(item.str);
            lastY = item.transform[5];
            lastX = item.transform[4] + (item.width || 0);
            lastWidth = item.width || 0;
          }
          // Post-processing: remove middle dots (·) - PDF extraction artifacts
          return parts.join('').replace(/\u00B7/g, '');
        })
      );
    }

    const batchResults = await Promise.all(batchPromises);
    for (let j = 0; j < batchResults.length; j++) {
      pagesText[i + j - 1] = batchResults[j];
    }
    // No setTimeout — let browser schedule naturally via Promise.all
  }

  return pagesText.join('\n\n');
}

// ── TXT/PDF Chapter Splitter (optimized: single combined regex, no yield delay) ──

async function splitIntoChapters(text: string, onProgress?: (percent: number, detail?: string) => void, signal?: AbortSignal): Promise<{ title: string; content: string }[]> {
  // Single combined regex for all chapter patterns — runs once, not twice
  const chapterRegex = /(?:^|\n)[ \t]*(?:Chương|Chapter|Hồi|Quyển|Book|Phần|Tiết|Mục|Part)[ \t]*[:\-\.]?[ \t]*(\d+|[IVXLCDM]+)(?:[ \t]*[:\-\.\s][ \t]*([^\n]{0,100}))?/gi;

  // False positive patterns to exclude
  const falsePositivePattern = /^[ \t]*(?:Chương trình|Chương mục|Phần lớn|Phần đông|Phần nào|Phần nhiều|Tiết khí|Tiết kiệm)/i;

  interface ChapterMatch {
    index: number;
    matchStart: number;
    title: string;
  }

  const allMatches: ChapterMatch[] = [];

  let match;
  while ((match = chapterRegex.exec(text)) !== null) {
    if (signal?.aborted) throw new Error('Aborted');

    const fullMatch = match[0];
    const trimmedMatch = fullMatch.replace(/^[\n\r]+/, '').trim();

    if (falsePositivePattern.test(trimmedMatch)) continue;
    if (trimmedMatch.length === 0) continue;

    const chapterNumber = match[1];
    const chapterSubtitle = match[2]?.trim() || '';

    const keywordMatch = trimmedMatch.match(/^(Chương|Chapter|Hồi|Phần|Quyển|Tiết|Mục|Book|Part)/i);
    const keyword = keywordMatch ? keywordMatch[1] : '';

    let title = `${keyword} ${chapterNumber}`;
    if (chapterSubtitle && !chapterSubtitle.match(/[,\.!?;]$/) && chapterSubtitle.length <= 80) {
      title = `${keyword} ${chapterNumber}: ${chapterSubtitle}`;
    }

    const leadingNewlineLen = fullMatch.length - fullMatch.replace(/^[\n\r]+/, '').length;
    const matchStart = match.index + leadingNewlineLen;

    const lineEndIndex = text.indexOf('\n', matchStart);
    const contentStart = lineEndIndex !== -1 ? lineEndIndex + 1 : match.index + fullMatch.length;

    allMatches.push({ index: contentStart, matchStart, title: title.trim() });
  }

  if (onProgress) onProgress(50, `Tìm thấy ${allMatches.length} chương`);

  if (allMatches.length === 0) {
    return [{ title: 'Nội dung', content: text }];
  }

  // Remove duplicates and sort
  const uniqueMatches = Array.from(
    new Map(allMatches.map(m => [m.matchStart, m])).values()
  ).sort((a, b) => a.matchStart - b.matchStart);

  const chapters: { title: string; content: string }[] = [];

  // Add prologue
  if (uniqueMatches[0].matchStart > 0) {
    const prologue = text.substring(0, uniqueMatches[0].matchStart).trim();
    if (prologue.length > 0) {
      chapters.push({ title: 'Mở đầu', content: prologue });
    }
  }

  // Split chapters — no setTimeout needed, this is pure synchronous string slicing
  for (let i = 0; i < uniqueMatches.length; i++) {
    if (signal?.aborted) throw new Error('Aborted');
    const m = uniqueMatches[i];
    const endIndex = i < uniqueMatches.length - 1 ? uniqueMatches[i + 1].matchStart : text.length;
    chapters.push({ title: m.title, content: text.substring(m.index, endIndex).trim() });
  }

  if (onProgress) onProgress(100, `Hoàn tất ${chapters.length} chương`);

  return chapters;
}
