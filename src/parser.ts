import * as pdfjsLib from 'pdfjs-dist';

// Cấu hình Worker cho PDF.js bằng CDN tương ứng với phiên bản để tránh lỗi Capacitor
const pdfjsVersion = '3.11.174'; // Sử dụng phiên bản ổn định hơn cho di động nếu cần thiết, hoặc lấy the version được cài
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js`;

export async function parseFile(
  file: File,
  onProgress?: (percent: number, status: string, detail?: string) => void,
  signal?: AbortSignal
): Promise<{ title: string; chapters: { title: string; content: string }[] }> {
  let text = '';
  const isPdf = file.type === 'application/pdf' || file.name.endsWith('.pdf');

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

  const title = file.name.replace(/\.[^/.]+$/, "");

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

async function parsePdf(file: File, onProgress?: (percent: number, detail?: string) => void, signal?: AbortSignal): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  const numPages = pdf.numPages;
  const BATCH_SIZE = 30; // Doubled batch size for much faster extraction
  const pagesText: string[] = new Array(numPages);

  for (let i = 1; i <= numPages; i += BATCH_SIZE) {
    if (signal?.aborted) throw new Error('Aborted');

    const currentBatchEnd = Math.min(i + BATCH_SIZE - 1, numPages);
    if (onProgress) {
      onProgress((i - 1) / numPages * 100, `Đang xử lý trang ${i} đến ${currentBatchEnd} trên tổng số ${numPages} trang`);
    }

    const batchPromises = [];
    for (let j = 0; j < BATCH_SIZE && i + j <= numPages; j++) {
      const pageNum = i + j;
      batchPromises.push(
        pdf.getPage(pageNum).then(async (page) => {
          const textContent = await page.getTextContent();
          // Sort items by vertical position (top to bottom) then horizontal (left to right)
          const items = (textContent.items as any[]).sort((a, b) => {
            // Treat items on roughly the same line as the same vertical position
            if (Math.abs(a.transform[5] - b.transform[5]) > 4) {
              return b.transform[5] - a.transform[5];
            }
            return a.transform[4] - b.transform[4];
          });

          let pageText = '';
          let lastY = -1;
          let lastX = -1;   // Track horizontal end position of last item
          let lastWidth = 0; // Track width of last item
          for (const item of items) {
            if (lastY !== -1) {
              const yDiff = Math.abs(item.transform[5] - lastY);
              const fontHeight = item.transform[3]; // The height (scaleY) of the current font

              // If the distance between lines is greater than 1.4x the font height, it's a new paragraph
              const isNewParagraph = yDiff > (fontHeight * 1.4);

              if (isNewParagraph) {
                pageText += '\n\n';
              } else if (yDiff > fontHeight * 0.4) {
                // If the distance is > 0.4x font height, it's just a normal new line
                pageText += '\n';
              } else {
                // Same line: check horizontal gap to decide if we need a space
                const currentX = item.transform[4]; // X position of current item
                const gap = currentX - lastX; // Gap between end of last item and start of current

                // Estimate average character width from the last item
                const lastStr = pageText.slice(-Math.max(1, lastWidth > 0 ? 1 : 0));
                const avgCharWidth = lastWidth > 0 ? fontHeight * 0.5 : fontHeight * 0.3;

                // Only add space if the gap is significant (> 30% of font height)
                // Small gaps are just kerning between characters in the same word
                if (gap > fontHeight * 0.3) {
                  pageText += ' ';
                }
                // If gap is negative or very small, characters are adjacent - no space needed
              }
            }
            pageText += item.str;
            lastY = item.transform[5];
            lastX = item.transform[4] + (item.width || 0); // End position = X + width
            lastWidth = item.width || 0;
          }
          // Post-processing: remove middle dots (·) that are PDF extraction artifacts
          // e.g. "b·ị" → "bị", "t·ử v·ong" → "tử vong"
          pageText = pageText.replace(/\u00B7/g, '');
          return pageText;
        })
      );
    }

    const batchResults = await Promise.all(batchPromises);
    for (let j = 0; j < batchResults.length; j++) {
      pagesText[i + j - 1] = batchResults[j];
    }

    // Removed artificial timeout to maximize throughput on capable devices. 
    // Small timeout if needed to let UI breathe just 1ms.
    await new Promise(resolve => setTimeout(resolve, 1));
  }

  return pagesText.join('\n\n');
}

async function splitIntoChapters(text: string, onProgress?: (percent: number, detail?: string) => void, signal?: AbortSignal): Promise<{ title: string; content: string }[]> {
  // Strategy: Use a regex that finds chapter keywords + number ANYWHERE in the text,
  // not just at the start of a line. Then extract the chapter title from the match.
  // This handles cases where "Chương X" appears mid-line (e.g. after metadata, Read Count, etc.)

  // Pattern 1: Keyword + Number (most reliable) - can appear anywhere
  // Captures: full match = "Chương 1" or "Chương 1 Tiêu đề chương" or "Chapter 10: Title"
  // The keyword can be preceded by whitespace or newline
  const chapterPatterns = [
    // Vietnamese & English keywords followed by a number, then optional title (up to end of line)
    /(?:^|\n)[ \t]*(?:Chương|Chapter|Hồi|Quyển|Book)[ \t]*[:\-\.]?[ \t]*(\d+|[IVXLCDM]+)(?:[ \t]*[:\-\.\s][ \t]*([^\n]{0,100}))?/gi,
    // "Phần", "Tiết", "Mục", "Part" followed by a number  
    /(?:^|\n)[ \t]*(?:Phần|Tiết|Mục|Part)[ \t]*[:\-\.]?[ \t]*(\d+|[IVXLCDM]+)(?:[ \t]*[:\-\.\s][ \t]*([^\n]{0,100}))?/gi,
  ];

  // False positive patterns to exclude
  const falsePositivePattern = /^[ \t]*(?:Chương trình|Chương mục|Phần lớn|Phần đông|Phần nào|Phần nhiều|Tiết khí|Tiết kiệm)/i;

  interface ChapterMatch {
    index: number;      // Position in text where chapter content starts
    matchStart: number;  // Position where the match begins (for splitting)
    title: string;       // Extracted chapter title
  }

  const allMatches: ChapterMatch[] = [];
  let count = 0;

  for (const regex of chapterPatterns) {
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(text)) !== null) {
      if (signal?.aborted) throw new Error('Aborted');

      const fullMatch = match[0];
      const trimmedMatch = fullMatch.replace(/^[\n\r]+/, '').trim();

      // Skip false positives
      if (falsePositivePattern.test(trimmedMatch)) continue;

      // Skip if the match is too short (no meaningful content) 
      if (trimmedMatch.length === 0) continue;

      // Build the chapter title
      const chapterNumber = match[1];
      const chapterSubtitle = match[2]?.trim() || '';

      // Extract keyword from the trimmed match
      const keywordMatch = trimmedMatch.match(/^(Chương|Chapter|Hồi|Phần|Quyển|Tiết|Mục|Book|Part)/i);
      const keyword = keywordMatch ? keywordMatch[1] : '';

      let title = `${keyword} ${chapterNumber}`;
      if (chapterSubtitle && !chapterSubtitle.match(/[,\.!?;]$/)) {
        // Only append subtitle if it doesn't look like a regular sentence
        // Also skip if subtitle is too long (likely paragraph content, not title)
        if (chapterSubtitle.length <= 80) {
          title = `${keyword} ${chapterNumber}: ${chapterSubtitle}`;
        }
      }

      // Calculate where the match starts in the original text
      // Account for possible leading newline in the match
      const leadingNewlineLen = fullMatch.length - fullMatch.replace(/^[\n\r]+/, '').length;
      const matchStart = match.index + leadingNewlineLen;

      // The content starts after the full matched line
      const lineEndIndex = text.indexOf('\n', matchStart);
      const contentStart = lineEndIndex !== -1 ? lineEndIndex + 1 : match.index + fullMatch.length;

      allMatches.push({
        index: contentStart,
        matchStart: matchStart,
        title: title.trim(),
      });

      count++;
      if (count % 100 === 0 && onProgress) {
        onProgress(0, `Đã tìm thấy ${count} chương...`);
      }
    }
  }

  if (allMatches.length === 0) {
    return [{ title: 'Nội dung', content: text }];
  }

  // Remove duplicates (by matchStart position) and sort
  const uniqueMatches = Array.from(
    new Map(allMatches.map(m => [m.matchStart, m])).values()
  ).sort((a, b) => a.matchStart - b.matchStart);

  const chapters: { title: string; content: string }[] = [];

  // Add prologue if there's content before the first chapter
  if (uniqueMatches[0].matchStart > 0) {
    const prologue = text.substring(0, uniqueMatches[0].matchStart).trim();
    if (prologue.length > 0) {
      chapters.push({ title: 'Mở đầu', content: prologue });
    }
  }

  for (let i = 0; i < uniqueMatches.length; i++) {
    if (signal?.aborted) throw new Error('Aborted');
    const m = uniqueMatches[i];
    const endIndex = i < uniqueMatches.length - 1 ? uniqueMatches[i + 1].matchStart : text.length;

    const content = text.substring(m.index, endIndex).trim();
    chapters.push({ title: m.title, content });

    if (i % 50 === 0) {
      if (onProgress) {
        onProgress((i / uniqueMatches.length) * 100, `Đang tách chương ${i + 1} / ${uniqueMatches.length}`);
      }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }

  return chapters;
}
