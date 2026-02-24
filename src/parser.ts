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
                pageText += ' ';
              }
            }
            pageText += item.str;
            lastY = item.transform[5];
          }
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
  // A regex that looks for common chapter keywords at the start of a line
  const chapterRegex = /^\s*(?:Chương|Chapter|Hồi|Phần|Quyển|Tiết|Mục|Book|Part|[\dIVXLCDM]+)\s*.*$/gim;

  const matches: RegExpExecArray[] = [];
  let match;

  chapterRegex.lastIndex = 0;
  let count = 0;
  while ((match = chapterRegex.exec(text)) !== null) {
    if (signal?.aborted) throw new Error('Aborted');

    const line = match[0].trim();
    // Heuristic: Chapter titles are usually short
    if (line.length > 0 && line.length < 120) {
      // 1. Check for Keyword + Number (The most reliable pattern)
      // Supports digits, Roman numerals, and Vietnamese number words.
      // We use a stricter check for Roman numerals to ensure they aren't just the start of a word (like 'l' in 'luật').
      const keywordPattern = /^(?:Chương|Chapter|Hồi|Phần|Quyển|Tiết|Mục|Book|Part)/i;
      const numberPattern = /(?:\d+|One|Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten|Một|Hai|Ba|Bốn|Năm|Sáu|Bảy|Tám|Chín|Mười|Mươi|Trăm|Ngàn|Vạn|Lăm|Lẻ|Linh|Tư)\b/i;
      const romanPattern = /\b[IVXLCDM]+\b/i;

      const hasKeyword = keywordPattern.test(line);
      const hasNumber = numberPattern.test(line) || romanPattern.test(line);

      // A line is a likely chapter if it has a keyword followed closely by a number
      const keywordWithNumber = hasKeyword && /^(?:Chương|Chapter|Hồi|Phần|Quyển|Tiết|Mục|Book|Part)\s*(?:[:\-\.]?\s*)?(?:\d+|[IVXLCDM]+|Một|Hai|Ba|Bốn|Năm|Sáu|Bảy|Tám|Chín|Mười|Mươi|Trăm|Ngàn|Vạn|Lăm|Lẻ|Linh|Tư)\b/i.test(line);

      // 2. Check for just a Number at the start (e.g., "1. Chapter Title")
      // Must be followed by a clear separator and a capitalized word
      const isNumberedHeader = /^\d+[\.\-\:]\s+[A-ZÀ-Ỹ]/.test(line);
      const isRomanHeader = /^[IVXLCDM]+[\.\-\:]\s+[A-ZÀ-Ỹ]/.test(line);

      // 3. Exclude lines that look like normal sentences
      // Normal sentences often end with punctuation or contain many lowercase words without a clear structure
      const endsWithSentencePunctuation = /[,\.!?;]$/.test(line);

      // Heuristic: If it starts with "Chương" but is followed by a common word that isn't a number/title
      const isFalsePositiveKeyword = /^(?:Chương trình|Chương mục|Phần lớn|Phần đông|Tiết khí)/i.test(line);

      if ((keywordWithNumber && !isFalsePositiveKeyword) || ((isNumberedHeader || isRomanHeader) && !endsWithSentencePunctuation)) {
        // Final sanity check: if it's just a range like "1-7", skip it
        if (/^\d+[\-\/]\d+$/.test(line)) continue;

        matches.push(match);
        count++;
        if (count % 100 === 0 && onProgress) {
          onProgress(0, `Đã tìm thấy ${count} chương...`);
        }
      }
    }
  }

  if (matches.length === 0) {
    return [{ title: 'Nội dung', content: text }];
  }

  // Remove duplicates and sort by index
  const sortedMatches = Array.from(new Map(matches.map(m => [m.index, m])).values())
    .sort((a, b) => a.index - b.index);

  const chapters: { title: string; content: string }[] = [];

  if (sortedMatches[0].index > 0) {
    const prologue = text.substring(0, sortedMatches[0].index).trim();
    if (prologue.length > 0) {
      chapters.push({ title: 'Mở đầu', content: prologue });
    }
  }

  for (let i = 0; i < sortedMatches.length; i++) {
    if (signal?.aborted) throw new Error('Aborted');
    const m = sortedMatches[i];
    const title = m[0].trim();
    const startIndex = m.index + m[0].length;
    const endIndex = i < sortedMatches.length - 1 ? sortedMatches[i + 1].index : text.length;

    let content = text.substring(startIndex, endIndex).trim();
    chapters.push({ title, content });

    if (i % 50 === 0) {
      if (onProgress) {
        onProgress((i / matches.length) * 100, `Đang tách chương ${i + 1} / ${matches.length}`);
      }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }

  return chapters;
}
