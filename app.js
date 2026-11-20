(() => {
  'use strict';

  const USER_BOOKS_KEY = 'biblioteca_user_books_v1';
  const PROGRESS_KEY = 'biblioteca_progress_v1';
  const PREFS_KEY = 'biblioteca_prefs_v1';

  const CATEGORY_LABELS = {
    romances: '❤️ Romances',
    contos: '📖 Contos & Histórias',
    classicos: '🇵🇹 Clássicos Portugueses',
    especiais: '🌹 Histórias Especiais'
  };

  const COVER_PALETTES = [
    ['#5b1b2b', '#8d2d45', '#e8bd70'],
    ['#1e4d3b', '#2f7258', '#f2d388'],
    ['#2c3e50', '#4a6b82', '#e5c17b'],
    ['#4a2545', '#7d3f75', '#f3c6a5'],
    ['#7a2039', '#b23a48', '#f6d186']
  ];

  const RECENT_BOOK_MIN_YEAR = 2024;

  // State
  let userBooks = [];
  let progressMap = {};
  let prefs = { fontSize: 1.25, theme: 'sepia' };
  let activeCategory = 'todos';
  let searchQuery = '';
  let recentOnlyLocal = false;
  let recentOnlyInternet = false;
  let lastInternetResults = [];

  let activeBook = null;
  let activeChapterIdx = 0;
  let scrollSaveTimer = null;
  let toastTimer = null;

  // SpeechSynthesis state
  let ttsQueue = [];
  let ttsIndex = 0;
  let ttsSpeaking = false;
  let ttsPaused = false;
  let ttsSessionId = 0;

  // DOM
  const booksGrid = document.getElementById('books-grid');
  const shelfMeta = document.getElementById('shelf-meta');
  const readingCountEl = document.getElementById('reading-count');
  const searchInput = document.getElementById('search-input');
  const btnClearSearch = document.getElementById('btn-clear-search');
  const btnRecentLocal = document.getElementById('btn-recent-local');
  const catButtons = document.querySelectorAll('.cat-btn');
  const offlineBadge = document.getElementById('offline-badge');

  // Reader DOM
  const readerView = document.getElementById('reader-view');
  const readerBookTitle = document.getElementById('reader-book-title');
  const readerBookAuthor = document.getElementById('reader-book-author');
  const btnBackShelf = document.getElementById('btn-back-shelf');
  const btnDeleteBook = document.getElementById('btn-delete-book');
  const btnFontDown = document.getElementById('btn-font-down');
  const btnFontUp = document.getElementById('btn-font-up');
  const themeChips = document.querySelectorAll('.theme-chip');
  const chapterSelect = document.getElementById('chapter-select');
  const readerScroll = document.getElementById('reader-scroll');
  const readerChapterTitle = document.getElementById('reader-chapter-title');
  const readerChapterText = document.getElementById('reader-chapter-text');
  const btnPrevChap = document.getElementById('btn-prev-chap');
  const btnNextChap = document.getElementById('btn-next-chap');
  const chapterIndicator = document.getElementById('chapter-indicator');

  // TTS DOM
  const btnTtsPlay = document.getElementById('btn-tts-play');
  const btnTtsPause = document.getElementById('btn-tts-pause');
  const btnTtsStop = document.getElementById('btn-tts-stop');
  const ttsStatus = document.getElementById('tts-status');

  // Add Book & Device Import DOM
  const btnMyShelf = document.getElementById('btn-my-shelf');
  const btnImportDevice = document.getElementById('btn-import-device');
  const deviceFileInput = document.getElementById('device-file-input');
  const btnAddBook = document.getElementById('btn-add-book');
  const addModal = document.getElementById('add-modal');
  const btnPickFile = document.getElementById('btn-pick-file');
  const bookFileInput = document.getElementById('book-file-input');
  const importFileStatus = document.getElementById('import-file-status');
  const addBookForm = document.getElementById('add-book-form');
  const addTitle = document.getElementById('add-title');
  const addAuthor = document.getElementById('add-author');
  const addCategory = document.getElementById('add-category');
  const addText = document.getElementById('add-text');

  // Internet Search Modal DOM
  const btnInternetBooks = document.getElementById('btn-internet-books');
  const internetModal = document.getElementById('internet-modal');
  const internetSearchForm = document.getElementById('internet-search-form');
  const internetQuery = document.getElementById('internet-query');
  const btnRecentInternet = document.getElementById('btn-recent-internet');
  const internetStatus = document.getElementById('internet-status');
  const internetResults = document.getElementById('internet-results');
  const suggestChips = document.querySelectorAll('.chip-suggest');

  const toastEl = document.getElementById('toast');

  async function init() {
    loadState();
    applyReaderPrefs();
    renderShelf();
    bindEvents();
    updateOnlineStatus();
    registerServiceWorker();
    await loadBooksFromIdb();
  }

  function loadState() {
    try {
      const ub = JSON.parse(localStorage.getItem(USER_BOOKS_KEY) || '[]');
      userBooks = Array.isArray(ub) ? ub : [];
    } catch (_) {
      userBooks = [];
    }
    try {
      const pr = JSON.parse(localStorage.getItem(PROGRESS_KEY) || '{}');
      progressMap = pr && typeof pr === 'object' ? pr : {};
    } catch (_) {
      progressMap = {};
    }
    try {
      const pf = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null');
      if (pf && typeof pf === 'object') prefs = { ...prefs, ...pf };
    } catch (_) {}
  }

  function saveUserBooks() {
    try {
      localStorage.setItem(USER_BOOKS_KEY, JSON.stringify(userBooks));
    } catch (_) {
      // Livros grandes ficam guardados no IndexedDB
    }
  }

  // IndexedDB para livros completos offline (sem limite de 5MB do localStorage)
  function openBooksDb() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) return reject(new Error('IndexedDB indisponível'));
      const req = indexedDB.open('biblioteca_offline_books_db', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('books')) {
          db.createObjectStore('books', { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function saveBookToIdb(book) {
    try {
      const db = await openBooksDb();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('books', 'readwrite');
        tx.objectStore('books').put(book);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (_) {}
  }

  async function deleteBookFromIdb(id) {
    try {
      const db = await openBooksDb();
      const tx = db.transaction('books', 'readwrite');
      tx.objectStore('books').delete(id);
    } catch (_) {}
  }

  async function loadBooksFromIdb() {
    try {
      const db = await openBooksDb();
      const idbBooks = await new Promise((resolve, reject) => {
        const tx = db.transaction('books', 'readonly');
        const req = tx.objectStore('books').getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
      if (Array.isArray(idbBooks) && idbBooks.length > 0) {
        const existingIds = new Set(userBooks.map((b) => b.id));
        let merged = false;
        for (const b of idbBooks) {
          if (b && b.id && !existingIds.has(b.id)) {
            userBooks.unshift(b);
            merged = true;
          }
        }
        if (merged) renderShelf();
      }
    } catch (_) {}
  }

  function saveProgressMap() {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(progressMap));
  }

  function savePrefs() {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  }

  function getAllBooks() {
    const base = Array.isArray(window.INITIAL_LIBRARY_BOOKS) ? window.INITIAL_LIBRARY_BOOKS : [];
    return [...userBooks, ...base];
  }

  function applyReaderPrefs() {
    document.documentElement.style.setProperty('--reader-font-size', `${prefs.fontSize}rem`);
    readerView.classList.remove('theme-light', 'theme-sepia', 'theme-dark');
    readerView.classList.add(`theme-${prefs.theme || 'sepia'}`);
    themeChips.forEach((chip) => {
      chip.classList.toggle('active', chip.dataset.theme === (prefs.theme || 'sepia'));
    });
  }

  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.add('hidden'), 3000);
  }

  function parseBookYear(val) {
    if (val === null || val === undefined || val === '') return null;
    if (Array.isArray(val)) {
      const years = val.map(parseBookYear).filter((y) => y !== null);
      return years.length > 0 ? Math.max(...years) : null;
    }
    if (typeof val === 'number' && Number.isFinite(val)) {
      const yr = Math.trunc(val);
      return yr >= 1000 && yr <= 2100 ? yr : null;
    }
    const matches = String(val).match(/\b(1[0-9]{3}|20[0-9]{2}|2100)\b/g);
    if (!matches || matches.length === 0) return null;
    const yr = Number(matches[matches.length - 1]);
    return yr >= 1000 && yr <= 2100 ? yr : null;
  }

  function normalizeLanguageCode(lang) {
    const raw = String(lang || '').toLowerCase().trim();
    if (!raw) return '';
    if (raw === 'pt' || raw.startsWith('pt-') || raw.startsWith('pt_') || raw === 'por' || raw.includes('portug')) {
      return 'pt';
    }
    return raw;
  }

  function isPortugueseBook(item) {
    if (!item) return false;
    if (normalizeLanguageCode(item.language) === 'pt') return true;
    if (Array.isArray(item.languages)) {
      return item.languages.some((l) => normalizeLanguageCode(l) === 'pt');
    }
    return false;
  }

  function formatLanguageLabel(lang) {
    const code = normalizeLanguageCode(lang) || 'pt';
    if (code === 'pt') return 'Português (pt)';
    return code.toUpperCase();
  }

  function compareBooksByPtAndRecency(a, b) {
    const ptDiff = (isPortugueseBook(b) ? 1 : 0) - (isPortugueseBook(a) ? 1 : 0);
    if (ptDiff !== 0) return ptDiff;
    const edDiff = (b.hasPtEdition ? 1 : 0) - (a.hasPtEdition ? 1 : 0);
    if (edDiff !== 0) return edDiff;
    const yearA = parseBookYear(a.year);
    const yearB = parseBookYear(b.year);
    if (yearA !== null && yearB !== null && yearB !== yearA) return yearB - yearA;
    if (yearB !== null && yearA === null) return 1;
    if (yearA !== null && yearB === null) return -1;
    return (b.ptPriority || 0) - (a.ptPriority || 0);
  }

  // Bookshelf Rendering
  function renderShelf() {
    const allBooks = getAllBooks();
    const readingIds = Object.keys(progressMap).filter((id) => allBooks.some((b) => b.id === id));
    readingCountEl.textContent = String(readingIds.length);

    const q = searchQuery.trim().toLowerCase();
    let filtered = allBooks.filter((book) => {
      if (activeCategory === 'lendo') {
        if (!progressMap[book.id]) return false;
      } else if (activeCategory !== 'todos' && book.category !== activeCategory) {
        return false;
      }
      if (recentOnlyLocal) {
        const yr = parseBookYear(book.year);
        if (yr === null || yr < RECENT_BOOK_MIN_YEAR) return false;
      }
      if (!q) return true;
      return `${book.title} ${book.author}`.toLowerCase().includes(q);
    });

    if (activeCategory === 'lendo' && !q) {
      filtered.sort((a, b) => (progressMap[b.id]?.updatedAt || 0) - (progressMap[a.id]?.updatedAt || 0));
    } else {
      filtered.sort((a, b) => compareBooksByPtAndRecency(
        { ...a, language: a.language || 'pt' },
        { ...b, language: b.language || 'pt' }
      ));
    }

    shelfMeta.textContent = `${filtered.length} ${filtered.length === 1 ? 'livro disponível' : 'livros disponíveis'}${recentOnlyLocal ? ' · desde 2024' : ''}`;
    booksGrid.innerHTML = '';

    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent =
        recentOnlyLocal
          ? 'Nenhum livro recente (a partir de 2024) encontrado na tua estante com esses critérios.'
          : activeCategory === 'lendo'
            ? 'Ainda não começaste a ler nenhum livro. Escolhe um livro na estante para começar!'
            : 'Nenhum livro encontrado com essa pesquisa.';
      booksGrid.appendChild(empty);
      return;
    }

    const frag = document.createDocumentFragment();
    for (const book of filtered) {
      const card = document.createElement('article');
      card.className = 'book-card';
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      card.setAttribute('aria-label', `Ler ${book.title}`);

      const palette = book.palette || COVER_PALETTES[0];
      const cover = document.createElement('div');
      cover.className = 'book-cover';
      cover.style.background = `linear-gradient(155deg, ${palette[0]} 0%, ${palette[1]} 100%)`;

      const chCount = (book.chapters || []).length;
      cover.innerHTML = `
        <div class="cover-top">
          <span class="cover-emoji">${book.coverEmoji || '📖'}</span>
          <span class="cover-chapters">${chCount} ${chCount === 1 ? 'cap.' : 'caps.'}</span>
        </div>
        <h3 class="cover-title">${escapeHtml(book.title)}</h3>
        <div class="cover-author">${escapeHtml(book.author)}</div>
      `;

      const info = document.createElement('div');
      info.className = 'book-info';

      const catTag = document.createElement('div');
      catTag.className = 'book-cat-tag';
      catTag.textContent = CATEGORY_LABELS[book.category] || '📖 Livro';
      info.appendChild(catTag);

      const yearVal = parseBookYear(book.year);
      const langLabel = formatLanguageLabel(book.language || 'pt');
      const metaBadges = document.createElement('div');
      metaBadges.className = 'book-meta-badges';
      metaBadges.innerHTML = `
        <span class="meta-badge meta-badge-year">📅 ${yearVal ? escapeHtml(String(yearVal)) : 'Ano n/d'}</span>
        <span class="meta-badge meta-badge-pt">🗣️ ${escapeHtml(langLabel)}</span>
      `;
      info.appendChild(metaBadges);

      const prog = progressMap[book.id];
      if (prog) {
        const pct = Math.min(100, Math.max(5, Math.round(((prog.chapterIndex + 1) / Math.max(1, chCount)) * 100)));
        const progRow = document.createElement('div');
        progRow.className = 'progress-row';
        progRow.innerHTML = `
          <span class="progress-label">Capítulo ${prog.chapterIndex + 1} de ${chCount} (${pct}%)</span>
          <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
        `;
        info.appendChild(progRow);
      }

      card.append(cover, info);
      card.addEventListener('click', () => openBook(book.id));
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openBook(book.id);
        }
      });

      frag.appendChild(card);
    }

    booksGrid.appendChild(frag);
  }

  // Reader View
  function openBook(bookId) {
    const book = getAllBooks().find((b) => b.id === bookId);
    if (!book || !book.chapters || book.chapters.length === 0) return;

    stopTts();
    activeBook = book;
    const saved = progressMap[book.id];
    activeChapterIdx = saved ? Math.min(saved.chapterIndex || 0, book.chapters.length - 1) : 0;

    readerBookTitle.textContent = book.title;
    readerBookAuthor.textContent = book.author;
    btnDeleteBook.classList.toggle('hidden', !book.isUserBook);

    chapterSelect.innerHTML = '';
    book.chapters.forEach((ch, idx) => {
      const opt = document.createElement('option');
      opt.value = String(idx);
      opt.textContent = ch.title || `Capítulo ${idx + 1}`;
      chapterSelect.appendChild(opt);
    });

    renderChapter(saved ? saved.scrollTop || 0 : 0);
    readerView.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  function renderChapter(restoreScrollTop = 0) {
    if (!activeBook) return;
    stopTts();

    const chapters = activeBook.chapters;
    const ch = chapters[activeChapterIdx];
    chapterSelect.value = String(activeChapterIdx);
    readerChapterTitle.textContent = ch.title || `Capítulo ${activeChapterIdx + 1}`;
    readerChapterText.textContent = ch.text || '';

    btnPrevChap.disabled = activeChapterIdx <= 0;
    btnNextChap.disabled = activeChapterIdx >= chapters.length - 1;
    chapterIndicator.textContent = `Capítulo ${activeChapterIdx + 1} de ${chapters.length}`;

    requestAnimationFrame(() => {
      readerScroll.scrollTop = restoreScrollTop;
      saveCurrentProgress();
    });
  }

  function saveCurrentProgress() {
    if (!activeBook) return;
    progressMap[activeBook.id] = {
      chapterIndex: activeChapterIdx,
      scrollTop: Math.round(readerScroll.scrollTop),
      updatedAt: Date.now()
    };
    saveProgressMap();
  }

  function closeReader() {
    saveCurrentProgress();
    stopTts();
    readerView.classList.add('hidden');
    document.body.style.overflow = '';
    activeBook = null;
    renderShelf();
  }

  // Audiobook / SpeechSynthesis (pt-PT)
  function getPortugueseVoice() {
    if (!('speechSynthesis' in window)) return null;
    const voices = window.speechSynthesis.getVoices() || [];
    return (
      voices.find((v) => v.lang && v.lang.toLowerCase() === 'pt-pt') ||
      voices.find((v) => v.lang && v.lang.toLowerCase().startsWith('pt')) ||
      null
    );
  }

  function splitIntoSpeechChunks(text) {
    const clean = text.replace(/\s+/g, ' ').trim();
    if (!clean) return [];
    const sentences = clean.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [clean];
    const chunks = [];
    let buf = '';
    for (const s of sentences) {
      if ((buf + ' ' + s).length > 220 && buf) {
        chunks.push(buf.trim());
        buf = s;
      } else {
        buf = buf ? `${buf} ${s}` : s;
      }
    }
    if (buf.trim()) chunks.push(buf.trim());
    return chunks;
  }

  function startTts() {
    if (!('speechSynthesis' in window)) {
      showToast('Leitura em voz alta não suportada neste navegador.');
      return;
    }
    if (!activeBook) return;

    stopTts();
    const ch = activeBook.chapters[activeChapterIdx];
    const fullText = `${ch.title}. ${ch.text}`;
    ttsQueue = splitIntoSpeechChunks(fullText);
    if (ttsQueue.length === 0) return;

    ttsSessionId++;
    const session = ttsSessionId;
    ttsIndex = 0;
    ttsSpeaking = true;
    ttsPaused = false;
    updateTtsButtons();
    speakNextChunk(session);
  }

  function speakNextChunk(session) {
    if (session !== ttsSessionId || !ttsSpeaking || ttsIndex >= ttsQueue.length) {
      if (session === ttsSessionId) stopTts();
      return;
    }

    const utt = new SpeechSynthesisUtterance(ttsQueue[ttsIndex]);
    utt.lang = 'pt-PT';
    utt.rate = 0.96;
    const voice = getPortugueseVoice();
    if (voice) utt.voice = voice;

    utt.onend = () => {
      if (session !== ttsSessionId || !ttsSpeaking) return;
      ttsIndex++;
      speakNextChunk(session);
    };

    utt.onerror = () => {
      if (session === ttsSessionId) stopTts();
    };

    ttsStatus.textContent = `A ler em voz alta (${ttsIndex + 1}/${ttsQueue.length})...`;
    window.speechSynthesis.speak(utt);
  }

  function togglePauseTts() {
    if (!('speechSynthesis' in window) || !ttsSpeaking) return;
    if (ttsPaused) {
      window.speechSynthesis.resume();
      ttsPaused = false;
      btnTtsPause.textContent = '⏸️ Pausa';
      ttsStatus.textContent = 'A continuar leitura...';
    } else {
      window.speechSynthesis.pause();
      ttsPaused = true;
      btnTtsPause.textContent = '▶️ Continuar';
      ttsStatus.textContent = 'Leitura em pausa.';
    }
  }

  function stopTts() {
    ttsSessionId++;
    ttsSpeaking = false;
    ttsPaused = false;
    ttsQueue = [];
    ttsIndex = 0;
    if ('speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch (_) {}
    }
    ttsStatus.textContent = '';
    updateTtsButtons();
  }

  function updateTtsButtons() {
    btnTtsPlay.classList.toggle('hidden', ttsSpeaking);
    btnTtsPause.classList.toggle('hidden', !ttsSpeaking);
    btnTtsStop.classList.toggle('hidden', !ttsSpeaking);
    if (!ttsPaused) btnTtsPause.textContent = '⏸️ Pausa';
  }

  // Text & EPUB Parsing
  function splitTextIntoChapters(rawText) {
    const text = rawText.replace(/\r\n/g, '\n').trim();
    if (!text) return [];

    const lines = text.split('\n');
    const headingRegex = /^(cap[ií]tulo|conto|parte)\s+[ivxlcdm0-9]+/i;
    const chapters = [];
    let currentTitle = '';
    let buf = [];

    for (const line of lines) {
      if (headingRegex.test(line.trim())) {
        if (buf.join('\n').trim()) {
          chapters.push({
            title: currentTitle || `Capítulo ${chapters.length + 1}`,
            text: buf.join('\n').trim()
          });
        }
        currentTitle = line.trim();
        buf = [];
      } else {
        buf.push(line);
      }
    }

    if (buf.join('\n').trim()) {
      chapters.push({
        title: currentTitle || (chapters.length === 0 ? 'Capítulo I' : `Capítulo ${chapters.length + 1}`),
        text: buf.join('\n').trim()
      });
    }

    // Se um livro longo veio sem marcadores de capítulo, divide em partes legíveis (~5500 caracteres)
    if (chapters.length === 1 && chapters[0].text.length > 7000) {
      return splitLongTextIntoParts(chapters[0].text, 5500);
    }

    return chapters;
  }

  function splitLongTextIntoParts(text, maxLen) {
    const paragraphs = text.split(/\n{2,}/);
    const parts = [];
    let current = '';

    for (const p of paragraphs) {
      if ((current + '\n\n' + p).length > maxLen && current) {
        parts.push({ title: `Parte ${parts.length + 1}`, text: current.trim() });
        current = p;
      } else {
        current = current ? `${current}\n\n${p}` : p;
      }
    }
    if (current.trim()) {
      parts.push({ title: `Parte ${parts.length + 1}`, text: current.trim() });
    }
    return parts;
  }

  async function readZipEntries(arrayBuffer) {
    const view = new DataView(arrayBuffer);
    const bytes = new Uint8Array(arrayBuffer);
    const entries = new Map();
    let offset = 0;

    while (offset + 30 < bytes.length) {
      const sig = view.getUint32(offset, true);
      if (sig !== 0x04034b50) break;

      const compression = view.getUint16(offset + 8, true);
      const compSize = view.getUint32(offset + 18, true);
      const nameLen = view.getUint16(offset + 26, true);
      const extraLen = view.getUint16(offset + 28, true);

      const nameStart = offset + 30;
      const entryName = new TextDecoder('utf-8').decode(bytes.slice(nameStart, nameStart + nameLen));
      const dataStart = nameStart + nameLen + extraLen;
      const dataEnd = dataStart + compSize;

      if (compSize > 0 && dataEnd <= bytes.length) {
        const chunk = bytes.slice(dataStart, dataEnd);
        entries.set(entryName, { compression, chunk });
      }

      offset = dataEnd;
    }

    return entries;
  }

  async function decompressZipEntry(entry) {
    if (!entry) return '';
    if (entry.compression === 0) {
      return new TextDecoder('utf-8').decode(entry.chunk);
    }
    if (entry.compression === 8 && typeof DecompressionStream !== 'undefined') {
      const ds = new DecompressionStream('deflate-raw');
      const stream = new Blob([entry.chunk]).stream().pipeThrough(ds);
      return await new Response(stream).text();
    }
    return '';
  }

  async function parseEpubWithJsZip(file) {
    if (typeof window.JSZip === 'undefined') {
      return parseEpubFallback(file);
    }

    const zip = await window.JSZip.loadAsync(file);
    const parser = new DOMParser();

    let opfPath = '';
    const containerFile = zip.file('META-INF/container.xml');
    if (containerFile) {
      const containerXml = await containerFile.async('string');
      const doc = parser.parseFromString(containerXml, 'application/xml');
      const rf = doc.querySelector('rootfile');
      if (rf) opfPath = rf.getAttribute('full-path') || '';
    }

    if (!opfPath) {
      const opfKeys = Object.keys(zip.files).filter((k) => k.endsWith('.opf'));
      if (opfKeys.length > 0) opfPath = opfKeys[0];
    }

    let title = file.name.replace(/\.epub$/i, '');
    let author = 'Autor Desconhecido';
    const chapters = [];

    if (opfPath && zip.file(opfPath)) {
      const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
      const opfXml = await zip.file(opfPath).async('string');
      const opfDoc = parser.parseFromString(opfXml, 'application/xml');

      const titleEl = opfDoc.getElementsByTagName('dc:title')[0] || opfDoc.querySelector('title');
      if (titleEl && titleEl.textContent.trim()) title = titleEl.textContent.trim();

      const authorEl = opfDoc.getElementsByTagName('dc:creator')[0] || opfDoc.querySelector('creator');
      if (authorEl && authorEl.textContent.trim()) author = authorEl.textContent.trim();

      const manifestMap = new Map();
      opfDoc.querySelectorAll('manifest > item').forEach((item) => {
        manifestMap.set(item.getAttribute('id'), item.getAttribute('href'));
      });

      const spineRefs = Array.from(opfDoc.querySelectorAll('spine > itemref')).map((ref) => ref.getAttribute('idref'));
      for (const idref of spineRefs) {
        const href = manifestMap.get(idref);
        if (!href) continue;
        const fullHref = decodeURIComponent(opfDir + href);
        const zipEntry = zip.file(fullHref) || zip.file(href);
        if (!zipEntry) continue;

        const html = await zipEntry.async('string');
        const htmlDoc = parser.parseFromString(html, 'text/html');
        const bodyText = htmlDoc.body ? htmlDoc.body.innerText.trim() : '';
        if (bodyText.length < 40) continue;

        const hEl = htmlDoc.querySelector('h1, h2, h3');
        const chapTitle = hEl && hEl.textContent.trim() ? hEl.textContent.trim() : `Capítulo ${chapters.length + 1}`;
        chapters.push({ title: chapTitle, text: bodyText });
      }
    }

    return { title, author, chapters };
  }

  async function parsePdfFile(file) {
    if (typeof window.pdfjsLib === 'undefined') {
      throw new Error('PDF.js não disponível');
    }

    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    const buf = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
    const pagesPerChapter = 8;
    const chapters = [];
    let pageTexts = [];

    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const strings = content.items.map((it) => it.str);
      const text = strings.join(' ').replace(/\s+/g, ' ').trim();
      if (text) pageTexts.push(text);

      if (pageTexts.length >= pagesPerChapter || p === pdf.numPages) {
        if (pageTexts.length > 0) {
          const startPage = p - pageTexts.length + 1;
          chapters.push({
            title: `Parte ${chapters.length + 1} (Págs. ${startPage}–${p})`,
            text: pageTexts.join('\n\n')
          });
          pageTexts = [];
        }
      }
    }

    const title = file.name.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim() || 'Livro PDF';
    return { title, author: 'Livro Importado (.PDF)', chapters };
  }

  async function parseEpubFallback(file) {
    const buf = await file.arrayBuffer();
    const entries = await readZipEntries(buf);
    const parser = new DOMParser();

    let opfPath = '';
    const containerEntry = entries.get('META-INF/container.xml');
    if (containerEntry) {
      const containerXml = await decompressZipEntry(containerEntry);
      const doc = parser.parseFromString(containerXml, 'application/xml');
      const rf = doc.querySelector('rootfile');
      if (rf) opfPath = rf.getAttribute('full-path') || '';
    }

    if (!opfPath) {
      for (const key of entries.keys()) {
        if (key.endsWith('.opf')) {
          opfPath = key;
          break;
        }
      }
    }

    let title = file.name.replace(/\.epub$/i, '');
    let author = 'Autor Desconhecido';
    const chapters = [];

    if (opfPath && entries.has(opfPath)) {
      const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
      const opfXml = await decompressZipEntry(entries.get(opfPath));
      const opfDoc = parser.parseFromString(opfXml, 'application/xml');

      const titleEl = opfDoc.getElementsByTagName('dc:title')[0] || opfDoc.querySelector('title');
      if (titleEl && titleEl.textContent.trim()) title = titleEl.textContent.trim();

      const authorEl = opfDoc.getElementsByTagName('dc:creator')[0] || opfDoc.querySelector('creator');
      if (authorEl && authorEl.textContent.trim()) author = authorEl.textContent.trim();

      const manifestMap = new Map();
      opfDoc.querySelectorAll('manifest > item').forEach((item) => {
        manifestMap.set(item.getAttribute('id'), item.getAttribute('href'));
      });

      const spineRefs = Array.from(opfDoc.querySelectorAll('spine > itemref')).map((ref) => ref.getAttribute('idref'));
      for (const idref of spineRefs) {
        const href = manifestMap.get(idref);
        if (!href) continue;
        const fullHref = decodeURIComponent(opfDir + href);
        const entry = entries.get(fullHref) || entries.get(href);
        if (!entry) continue;

        const html = await decompressZipEntry(entry);
        const htmlDoc = parser.parseFromString(html, 'text/html');
        const bodyText = htmlDoc.body ? htmlDoc.body.innerText.trim() : '';
        if (bodyText.length < 40) continue;

        const hEl = htmlDoc.querySelector('h1, h2, h3');
        const chapTitle = hEl && hEl.textContent.trim() ? hEl.textContent.trim() : `Capítulo ${chapters.length + 1}`;
        chapters.push({ title: chapTitle, text: bodyText });
      }
    }

    return { title, author, chapters };
  }

  // Add Book Modal
  function openAddModal() {
    addTitle.value = '';
    addAuthor.value = '';
    addCategory.value = activeCategory !== 'todos' && activeCategory !== 'lendo' ? activeCategory : 'especiais';
    addText.value = '';
    importFileStatus.textContent = '';
    bookFileInput.value = '';
    addModal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  function closeAddModal() {
    addModal.classList.add('hidden');
    if (readerView.classList.contains('hidden')) {
      document.body.style.overflow = '';
    }
  }

  async function handleBookFile(file) {
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    importFileStatus.textContent = 'A ler ficheiro...';

    try {
      if (ext === 'epub') {
        const parsed = await parseEpubWithJsZip(file);
        if (parsed.chapters.length === 0) {
          importFileStatus.textContent = 'Não foi possível extrair capítulos deste EPUB.';
          return;
        }
        addTitle.value = parsed.title;
        addAuthor.value = parsed.author;
        addText.value = parsed.chapters.map((c) => `${c.title}\n\n${c.text}`).join('\n\n');
        importFileStatus.textContent = `EPUB carregado (${parsed.chapters.length} capítulos)! Carrega em "Guardar na Estante".`;
      } else if (ext === 'pdf') {
        const parsed = await parsePdfFile(file);
        if (parsed.chapters.length === 0) {
          importFileStatus.textContent = 'Não foi possível extrair texto deste PDF.';
          return;
        }
        addTitle.value = parsed.title;
        addAuthor.value = parsed.author;
        addText.value = parsed.chapters.map((c) => `${c.title}\n\n${c.text}`).join('\n\n');
        importFileStatus.textContent = `PDF carregado (${parsed.chapters.length} partes)! Carrega em "Guardar na Estante".`;
      } else {
        const text = await file.text();
        addTitle.value = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
        addAuthor.value = addAuthor.value || 'Ficheiro Importado';
        addText.value = text;
        importFileStatus.textContent = 'Ficheiro de texto carregado! Carrega em "Guardar na Estante".';
      }
    } catch (_) {
      importFileStatus.textContent = 'Erro ao ler o ficheiro selecionado.';
    }
  }

  async function importDeviceFileDirectly(file) {
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    showToast(`A importar "${file.name}"...`);

    try {
      let title = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
      let author = 'Livro do Aparelho';
      let chapters = [];

      if (ext === 'epub') {
        const parsed = await parseEpubWithJsZip(file);
        title = parsed.title || title;
        author = parsed.author || author;
        chapters = parsed.chapters;
      } else if (ext === 'pdf') {
        const parsed = await parsePdfFile(file);
        title = parsed.title || title;
        author = parsed.author || author;
        chapters = parsed.chapters;
      } else {
        const text = await file.text();
        chapters = splitTextIntoChapters(text);
      }

      if (!chapters || chapters.length === 0) {
        showToast('Não foi possível extrair texto deste ficheiro.');
        return;
      }

      const category = activeCategory !== 'todos' && activeCategory !== 'lendo' ? activeCategory : 'especiais';
      const emojiMap = { romances: '❤️', contos: '📖', classicos: '🇵🇹', especiais: '🌹' };
      const palette = COVER_PALETTES[userBooks.length % COVER_PALETTES.length];

      const newBook = {
        id: `device-${Date.now()}`,
        title,
        author,
        year: new Date().getFullYear(),
        language: 'pt',
        category,
        palette,
        coverEmoji: emojiMap[category] || '📖',
        isUserBook: true,
        chapters
      };

      userBooks.unshift(newBook);
      await saveBookToIdb(newBook);
      saveUserBooks();
      renderShelf();
      showToast(`"${title}" importado offline (${chapters.length} capítulos)!`);
    } catch (_) {
      showToast('Erro ao importar este ficheiro. Verifica se é .EPUB, .PDF ou .TXT válido.');
    } finally {
      deviceFileInput.value = '';
    }
  }

  function bindEvents() {
    catButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        catButtons.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        activeCategory = btn.dataset.cat;
        renderShelf();
      });
    });

    searchInput.addEventListener('input', () => {
      searchQuery = searchInput.value;
      btnClearSearch.classList.toggle('hidden', !searchQuery);
      renderShelf();
    });

    btnClearSearch.addEventListener('click', () => {
      searchInput.value = '';
      searchQuery = '';
      btnClearSearch.classList.add('hidden');
      renderShelf();
    });

    if (btnRecentLocal) {
      btnRecentLocal.addEventListener('click', () => {
        recentOnlyLocal = !recentOnlyLocal;
        btnRecentLocal.classList.toggle('active', recentOnlyLocal);
        btnRecentLocal.setAttribute('aria-pressed', String(recentOnlyLocal));
        renderShelf();
      });
    }

    btnBackShelf.addEventListener('click', closeReader);

    btnDeleteBook.addEventListener('click', () => {
      if (!activeBook || !activeBook.isUserBook) return;
      if (confirm(`Queres mesmo apagar "${activeBook.title}" da estante?`)) {
        userBooks = userBooks.filter((b) => b.id !== activeBook.id);
        delete progressMap[activeBook.id];
        deleteBookFromIdb(activeBook.id);
        saveUserBooks();
        saveProgressMap();
        closeReader();
        showToast('Livro removido da estante.');
      }
    });

    btnFontDown.addEventListener('click', () => {
      prefs.fontSize = Math.max(0.95, Number((prefs.fontSize - 0.1).toFixed(2)));
      applyReaderPrefs();
      savePrefs();
    });

    btnFontUp.addEventListener('click', () => {
      prefs.fontSize = Math.min(2.2, Number((prefs.fontSize + 0.1).toFixed(2)));
      applyReaderPrefs();
      savePrefs();
    });

    themeChips.forEach((chip) => {
      chip.addEventListener('click', () => {
        prefs.theme = chip.dataset.theme;
        applyReaderPrefs();
        savePrefs();
      });
    });

    chapterSelect.addEventListener('change', () => {
      activeChapterIdx = Number(chapterSelect.value) || 0;
      renderChapter(0);
    });

    btnPrevChap.addEventListener('click', () => {
      if (activeChapterIdx > 0) {
        activeChapterIdx--;
        renderChapter(0);
      }
    });

    btnNextChap.addEventListener('click', () => {
      if (activeBook && activeChapterIdx < activeBook.chapters.length - 1) {
        activeChapterIdx++;
        renderChapter(0);
      }
    });

    readerScroll.addEventListener('scroll', () => {
      clearTimeout(scrollSaveTimer);
      scrollSaveTimer = setTimeout(saveCurrentProgress, 250);
    });

    btnTtsPlay.addEventListener('click', startTts);
    btnTtsPause.addEventListener('click', togglePauseTts);
    btnTtsStop.addEventListener('click', stopTts);

    if (btnMyShelf) {
      btnMyShelf.addEventListener('click', () => {
        if (!addModal.classList.contains('hidden')) closeAddModal();
        if (!internetModal.classList.contains('hidden')) closeInternetModal();
        if (!readerView.classList.contains('hidden')) closeReader();
        activeCategory = 'todos';
        catButtons.forEach((b) => b.classList.toggle('active', b.dataset.cat === 'todos'));
        searchInput.value = '';
        searchQuery = '';
        btnClearSearch.classList.add('hidden');
        renderShelf();
        const mainEl = document.querySelector('.app-main');
        if (mainEl) mainEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }

    btnImportDevice.addEventListener('click', () => deviceFileInput.click());
    deviceFileInput.addEventListener('change', (e) => importDeviceFileDirectly(e.target.files[0]));
    btnAddBook.addEventListener('click', openAddModal);
    btnPickFile.addEventListener('click', () => bookFileInput.click());
    bookFileInput.addEventListener('change', (e) => handleBookFile(e.target.files[0]));

    addBookForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = addTitle.value.trim();
      const author = addAuthor.value.trim() || 'Autoria Pessoal';
      const rawText = addText.value.trim();
      if (!title || !rawText) return;

      const chapters = splitTextIntoChapters(rawText);
      const palette = COVER_PALETTES[userBooks.length % COVER_PALETTES.length];
      const emojiMap = { romances: '❤️', contos: '📖', classicos: '🇵🇹', especiais: '🌹' };

      const newBook = {
        id: `user-${Date.now()}`,
        title,
        author,
        year: new Date().getFullYear(),
        language: 'pt',
        category: addCategory.value,
        palette,
        coverEmoji: emojiMap[addCategory.value] || '🌹',
        isUserBook: true,
        chapters
      };

      userBooks.unshift(newBook);
      await saveBookToIdb(newBook);
      saveUserBooks();
      closeAddModal();
      renderShelf();
      showToast(`"${title}" guardado na estante!`);
    });

    // Internet Search (Gutendex)
    btnInternetBooks.addEventListener('click', openInternetModal);

    internetSearchForm.addEventListener('submit', (e) => {
      e.preventDefault();
      searchUniversalBooks(internetQuery.value.trim());
    });

    if (btnRecentInternet) {
      btnRecentInternet.addEventListener('click', () => {
        recentOnlyInternet = !recentOnlyInternet;
        btnRecentInternet.classList.toggle('active', recentOnlyInternet);
        btnRecentInternet.setAttribute('aria-pressed', String(recentOnlyInternet));
        if (lastInternetResults.length > 0) {
          applyAndRenderInternetResults();
        } else {
          searchUniversalBooks(internetQuery.value.trim());
        }
      });
    }

    suggestChips.forEach((chip) => {
      chip.addEventListener('click', () => {
        const q = chip.dataset.q || '';
        internetQuery.value = q;
        suggestChips.forEach((c) => c.classList.toggle('active', c === chip));
        searchUniversalBooks(q);
      });
    });

    document.querySelectorAll('[data-close="add"]').forEach((el) => {
      el.addEventListener('click', closeAddModal);
    });
    document.querySelectorAll('[data-close="internet"]').forEach((el) => {
      el.addEventListener('click', closeInternetModal);
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (!addModal.classList.contains('hidden')) closeAddModal();
        else if (!internetModal.classList.contains('hidden')) closeInternetModal();
        else if (!readerView.classList.contains('hidden')) closeReader();
      }
    });

    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);
  }

  // Internet Search & Download (Universal em Português: Gutendex + Internet Archive + Open Library)
  const PORTUGAL_AUTHORS = [
    'eça de queirós', 'eca de queiros', 'queirós', 'queiroz',
    'camilo castelo branco', 'castelo branco',
    'júlio dinis', 'julio dinis', 'florbela espanca',
    'almeida garrett', 'garrett', 'fernando pessoa',
    'camões', 'camoes', 'antero de quental', 'cesário verde', 'cesario verde',
    'bocage', 'ramalho ortigão', 'ramalho ortigao', 'fialho de almeida',
    'alexandre herculano', 'aquilino ribeiro', 'teixeira de pascoaes',
    'guerra junqueiro', 'soares de passos', 'oliveira martins',
    'antónio nobre', 'antonio nobre', 'gil vicente', 'fernão mendes pinto',
    'antónio vieira', 'antonio vieira', 'raul brandão', 'raul brandao',
    'ferreira de castro', 'branquinho da fonseca', 'alves redol',
    'soeiro pereira gomes', 'manuel da fonseca', 'carlos de oliveira',
    'vitorino nemésio', 'vitorino nemesio', 'josé saramago', 'jose saramago',
    'antónio lobo antunes', 'antonio lobo antunes', 'lídia jorge', 'lidia jorge',
    'sophia de mello breyner', 'agustina bessa-luís', 'agustina bessa luis',
    'vergílio ferreira', 'vergilio ferreira', 'miguel torga',
    'josé cardoso pires', 'jose cardoso pires', 'natália correia', 'natalia correia',
    'urbano tavares rodrigues', 'josé luís peixoto', 'jose luis peixoto',
    'valter hugo mãe', 'valter hugo mae', 'afonso cruz', 'dulce maria cardoso',
    'gonçalo m. tavares', 'goncalo m tavares', 'mário cláudio', 'mario claudio',
    'josé rodrigues dos santos', 'jose rodrigues dos santos', 'inês pedrosa', 'ines pedrosa',
    'hélia correia', 'helia correia', 'rui zink', 'francisco josé viegas',
    'alice vieira', 'isabel stilwell', 'margarida rebelo pinto', 'pedro chagas freitas',
    'eugénio de andrade', 'eugenio de andrade', 'mário cesariny', 'alexandre o\'neill',
    'ruy belo', 'herberto helder', 'nuno júdice', 'vasco graça moura', 'miguel sousa tavares'
  ];

  const PORTUGAL_EDITION_TERMS = [
    'lisboa', 'porto', 'coimbra', 'portugal', 'portuguesa', 'português', 'portugues',
    'lello', 'bertrand', 'parceria a. m. pereira', 'guimarães editores', 'clássica editora',
    'dom quixote', 'editorial caminho', 'editorial presença', 'relógio d\'água',
    'porto editora', 'gradiva', 'quetzal', 'tinta-da-china', 'leya', 'asa'
  ];

  const BRAZIL_REGIONAL_TERMS = [
    'machado de assis', 'josé de alencar', 'jose de alencar', 'aluísio azevedo', 'aluisio azevedo',
    'lima barreto', 'graça aranha', 'olavo bilac', 'coelho neto', 'raúl pompéia', 'euclides da cunha',
    'dom casmurro', 'memórias póstumas', 'quincas borba', 'iracema', 'o cortiço', 'o guarani',
    'senhora', 'a moreninha', 'triste fim de policarpo', 'rio de janeiro', 'são paulo'
  ];

  function openInternetModal() {
    internetModal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    if (internetResults.children.length === 0) {
      searchUniversalBooks('');
    }
  }

  function closeInternetModal() {
    internetModal.classList.add('hidden');
    if (readerView.classList.contains('hidden') && addModal.classList.contains('hidden')) {
      document.body.style.overflow = '';
    }
  }

  async function fetchWithTimeout(url, ms = 7000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    try {
      return await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  function isLikelyForeignTitle(title, author = '') {
    const cleanTitle = (title || '').toLowerCase().trim();
    const combined = `${cleanTitle} ${author || ''}`.toLowerCase().trim();
    if (!cleanTitle) return true;
    const hasPtMarkers = /[ãõçáéíóúâêôà]|\b(o|a|os|as|um|uma|de|do|da|dos|das|em|no|na|para|com|por|que|história|contos|romance|poesia|amor|viagens|mar)\b/i.test(combined);
    const hasForeignStopwords = /\b(the|and|with|from|into|about|which|their|there|would|could|should|chapter|complete|edition|translated|translation|volume|vol\.|part|story|stories|tales|novel|poems|love|adventures|les|des|une|dans|avec|pour|sur|par|qui|est|et|histoire|littérature|géographie|mélanges|contes|roman|amour|los|las|del|una|por|para|con|sobre|entre|historia|cuentos|novela|novelas|libro|die|der|und|ein|eine|mit|für|von|das)\b/i.test(cleanTitle);
    if (hasForeignStopwords && !/[ãõç]/.test(cleanTitle)) {
      const strongPtTitle = /\b(não|são|coração|paixão|história|histórias|português|portuguesa|portugal|lisboa|conto|contos|poesias|sonetos|cartas|viagens|senhora|menina|irmãos|amor de|cidade e as|pupilas|crime do|primo basílio)\b/i.test(cleanTitle);
      if (!strongPtTitle) return true;
    }
    return !hasPtMarkers && hasForeignStopwords;
  }

  function scorePortugalPriority(item) {
    const text = `${item.title || ''} ${item.author || ''} ${item.publisher || ''}`.toLowerCase();
    let score = 0;
    if (PORTUGAL_AUTHORS.some((a) => text.includes(a))) score += 120;
    if (PORTUGAL_EDITION_TERMS.some((t) => text.includes(t))) score += 45;
    const yr = Number(item.year);
    if (!Number.isNaN(yr) && yr >= 1980) score += 25;
    else if (!Number.isNaN(yr) && yr >= 1940) score += 15;
    if (item.source === 'gutendex') score += 15;
    if (BRAZIL_REGIONAL_TERMS.some((b) => text.includes(b))) score -= 30;
    return score;
  }

  function mapSearchQuery(rawQuery) {
    const q = (rawQuery || '').trim();
    if (!q) {
      return {
        gutendex: '',
        ia: '(romance OR contos OR amor OR Eça OR Camilo OR Dinis)',
        ol: 'romance'
      };
    }
    const lower = q.toLowerCase();
    if (lower === 'romances em português') {
      return {
        gutendex: 'romance',
        ia: '(romance OR amor OR paixão OR novela)',
        ol: 'romance'
      };
    }
    if (lower === 'autores de portugal') {
      return {
        gutendex: '',
        ia: '(Eça de Queirós OR Camilo Castelo Branco OR Júlio Dinis OR Almeida Garrett OR Florbela Espanca OR Fernando Pessoa OR José Saramago OR António Lobo Antunes OR Lídia Jorge OR Miguel Torga OR Sophia de Mello Breyner OR Vergílio Ferreira OR Agustina Bessa-Luís OR José Luís Peixoto OR Valter Hugo Mãe OR Afonso Cruz OR Dulce Maria Cardoso OR Raul Brandão OR Aquilino Ribeiro)',
        ol: 'Portugal'
      };
    }
    if (lower === 'contos & histórias') {
      return {
        gutendex: 'contos',
        ia: '(contos OR histórias OR novelas)',
        ol: 'contos'
      };
    }
    if (lower === 'mar & aventura') {
      return {
        gutendex: 'mar',
        ia: '(mar OR viagem OR viagens OR aventura OR navegadores)',
        ol: 'viagens mar'
      };
    }
    if (lower === 'poesia & amor') {
      return {
        gutendex: 'poesia',
        ia: '(poesia OR sonetos OR versos OR lírica OR amor)',
        ol: 'poesia'
      };
    }
    return { gutendex: q, ia: q, ol: q };
  }

  async function fetchGutendexPt(query) {
    const qParam = query ? `&search=${encodeURIComponent(query)}` : '';
    const url = `https://gutendex.com/books/?languages=pt${qParam}`;
    const res = await fetchWithTimeout(url, 8000);
    if (!res.ok) throw new Error('Gutendex error');
    const data = await res.json();
    const books = Array.isArray(data.results) ? data.results : [];
    const results = [];
    for (const b of books) {
      const langs = Array.isArray(b.languages) ? b.languages : [];
      if (!langs.includes('pt')) continue;
      const formatInfo = pickGutenbergFormat(b.formats);
      if (!formatInfo) continue;
      const author = (b.authors || []).map((a) => a.name).join(', ') || 'Autor Desconhecido';
      if (isLikelyForeignTitle(b.title, author)) continue;
      results.push({
        source: 'gutendex',
        sourceLabel: 'Projeto Gutenberg',
        id: `gut-${b.id}`,
        gutenbergId: b.id,
        formatInfo,
        onlineUrl: `https://www.gutenberg.org/ebooks/${b.id}`,
        title: b.title || 'Sem Título',
        author,
        language: 'pt',
        hasPtEdition: true,
        year: null,
        subjects: b.subjects || [],
        bookshelves: b.bookshelves || [],
        coverUrl: b.formats && b.formats['image/jpeg'] ? b.formats['image/jpeg'] : ''
      });
    }
    return results;
  }

  async function fetchInternetArchivePt(query) {
    const iaQuery = `language:por AND mediatype:texts AND NOT collection:inlibrary AND NOT collection:printdisabled AND ${query}`;
    const url = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(iaQuery)}&fl[]=identifier,title,creator,language,year,imagecount,format,publisher,downloads&sort[]=downloads+desc&rows=25&output=json`;
    const res = await fetchWithTimeout(url, 8000);
    if (!res.ok) throw new Error('IA error');
    const data = await res.json();
    const docs = Array.isArray(data?.response?.docs) ? data.response.docs : [];
    const results = [];
    for (const d of docs) {
      if (!d.identifier || !d.title) continue;
      const langs = Array.isArray(d.language) ? d.language.map((l) => String(l).toLowerCase()) : [String(d.language || '').toLowerCase()];
      if (!langs.some((l) => l === 'por' || l === 'pt' || l.includes('portug'))) continue;
      if (d.imagecount !== undefined && Number(d.imagecount) > 0 && Number(d.imagecount) < 15) continue;
      const formats = Array.isArray(d.format) ? d.format : [];
      const hasDirectText = formats.some((f) => /djvutxt|text|epub/i.test(f));
      if (!hasDirectText) continue;
      const author = Array.isArray(d.creator) ? d.creator.join(', ') : (d.creator || 'Autor Desconhecido');
      if (isLikelyForeignTitle(d.title, author)) continue;
      results.push({
        source: 'archive',
        sourceLabel: 'Internet Archive',
        id: `ia-${d.identifier}`,
        identifier: d.identifier,
        onlineUrl: `https://archive.org/details/${encodeURIComponent(d.identifier)}`,
        title: d.title,
        author,
        publisher: Array.isArray(d.publisher) ? d.publisher.join(', ') : (d.publisher || ''),
        year: parseBookYear(d.year),
        language: 'pt',
        hasPtEdition: true,
        pages: d.imagecount ? Number(d.imagecount) : null,
        coverUrl: `https://archive.org/services/img/${encodeURIComponent(d.identifier)}`
      });
    }
    return results;
  }

  async function fetchOpenLibraryPt(query) {
    const baseQ = query ? `${query} language:por` : 'romance language:por';
    const fields = 'key,title,author_name,language,ia,ebook_access,public_scan_b,number_of_pages_median,first_publish_year,publish_year,cover_i,editions,editions.key,editions.title,editions.language,editions.publish_date,editions.cover_i,editions.publisher';
    const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(baseQ)}&sort=new&limit=30&fields=${fields}`;
    const res = await fetchWithTimeout(url, 8000);
    if (!res.ok) throw new Error('OL error');
    const data = await res.json();
    const docs = Array.isArray(data.docs) ? data.docs : [];
    const results = [];
    for (const d of docs) {
      const edDocs = Array.isArray(d.editions?.docs) ? d.editions.docs : [];
      const ptEdition = edDocs.find((ed) => Array.isArray(ed.language) && ed.language.some((l) => normalizeLanguageCode(l) === 'pt')) || edDocs[0] || null;
      const workLangs = Array.isArray(d.language) ? d.language.map(normalizeLanguageCode) : [];
      const hasPt = workLangs.includes('pt') || (ptEdition && Array.isArray(ptEdition.language) && ptEdition.language.some((l) => normalizeLanguageCode(l) === 'pt'));
      if (!hasPt) continue;

      const title = (ptEdition && ptEdition.title) ? ptEdition.title : (d.title || 'Sem Título');
      const author = Array.isArray(d.author_name) ? d.author_name.join(', ') : 'Autor Desconhecido';
      if (!ptEdition && isLikelyForeignTitle(title, author)) continue;

      const edYear = ptEdition ? parseBookYear(ptEdition.publish_date) : null;
      const maxPubYear = parseBookYear(d.publish_year);
      const year = edYear || maxPubYear || parseBookYear(d.first_publish_year);

      const iaId = Array.isArray(d.ia) && d.ia.length > 0 ? d.ia[0] : null;
      const isPublicDownload = d.ebook_access === 'public' && d.public_scan_b === true && Boolean(iaId);
      const coverId = (ptEdition && ptEdition.cover_i) || d.cover_i;
      const publisher = (ptEdition && (Array.isArray(ptEdition.publisher) ? ptEdition.publisher.join(', ') : ptEdition.publisher)) || '';
      const onlineKey = (ptEdition && ptEdition.key) || d.key;

      results.push({
        source: isPublicDownload ? 'archive' : 'openlibrary',
        sourceLabel: 'Open Library',
        id: isPublicDownload ? `ia-${iaId}` : `ol-${String(onlineKey || title).replace(/[^a-z0-9]+/gi, '_')}`,
        identifier: isPublicDownload ? iaId : undefined,
        onlineUrl: onlineKey ? `https://openlibrary.org${onlineKey}` : (iaId ? `https://archive.org/details/${iaId}` : ''),
        title,
        author,
        publisher,
        year,
        language: 'pt',
        hasPtEdition: Boolean(ptEdition),
        pages: d.number_of_pages_median ? Number(d.number_of_pages_median) : null,
        coverUrl: coverId ? `https://covers.openlibrary.org/b/id/${coverId}-M.jpg` : ''
      });
    }
    return results;
  }

  async function fetchGoogleBooksPt(query) {
    const q = query || 'romance';
    const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&langRestrict=pt&orderBy=newest&maxResults=25`;
    const res = await fetchWithTimeout(url, 8000);
    if (!res.ok) throw new Error('Google Books error');
    const data = await res.json();
    const items = Array.isArray(data.items) ? data.items : [];
    const results = [];
    for (const item of items) {
      const info = item.volumeInfo || {};
      const lang = normalizeLanguageCode(info.language) || 'pt';
      if (lang !== 'pt') continue;
      const title = info.title || 'Sem Título';
      const author = Array.isArray(info.authors) && info.authors.length > 0 ? info.authors.join(', ') : 'Autor Desconhecido';
      const thumb = info.imageLinks?.thumbnail || info.imageLinks?.smallThumbnail || '';
      results.push({
        source: 'google',
        sourceLabel: 'Google Books',
        id: `gb-${item.id}`,
        onlineUrl: info.infoLink || info.previewLink || '',
        title,
        author,
        publisher: info.publisher || '',
        year: parseBookYear(info.publishedDate),
        language: 'pt',
        hasPtEdition: true,
        pages: info.pageCount ? Number(info.pageCount) : null,
        coverUrl: thumb ? thumb.replace(/^http:\/\//i, 'https://') : ''
      });
    }
    return results;
  }

  async function searchUniversalBooks(rawQuery) {
    const queries = mapSearchQuery(rawQuery);
    internetStatus.textContent = 'A procurar livros em Português e edições recentes (Open Library, Google Books, Gutendex e Internet Archive)...';
    internetResults.innerHTML = '';

    const settled = await Promise.allSettled([
      fetchOpenLibraryPt(queries.ol),
      fetchGoogleBooksPt(rawQuery || queries.ol),
      fetchGutendexPt(queries.gutendex),
      fetchInternetArchivePt(queries.ia)
    ]);

    const mergedByKey = new Map();
    let anySuccess = false;

    for (const res of settled) {
      if (res.status === 'fulfilled') {
        anySuccess = true;
        for (const item of res.value) {
          const normKey = `${item.title}::${item.author}`
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, ' ')
            .trim();
          item.ptPriority = scorePortugalPriority(item);
          const existing = mergedByKey.get(normKey);
          if (!existing) {
            mergedByKey.set(normKey, item);
          } else {
            const itemDownloadable = Boolean(item.identifier || item.formatInfo);
            const existingDownloadable = Boolean(existing.identifier || existing.formatInfo);
            const itemYr = parseBookYear(item.year) || 0;
            const existingYr = parseBookYear(existing.year) || 0;
            if ((itemDownloadable && !existingDownloadable) || itemYr > existingYr) {
              mergedByKey.set(normKey, {
                ...existing,
                ...item,
                year: itemYr >= existingYr ? item.year : existing.year,
                coverUrl: item.coverUrl || existing.coverUrl
              });
            }
          }
        }
      }
    }

    if (!anySuccess) {
      lastInternetResults = [];
      internetStatus.textContent = 'Não foi possível contactar os catálogos online. Verifica a ligação à internet.';
      return;
    }

    const merged = Array.from(mergedByKey.values());
    merged.sort(compareBooksByPtAndRecency);
    lastInternetResults = merged;
    applyAndRenderInternetResults();
  }

  function applyAndRenderInternetResults() {
    internetResults.innerHTML = '';
    let visible = lastInternetResults;
    if (recentOnlyInternet) {
      visible = visible.filter((item) => {
        const yr = parseBookYear(item.year);
        return yr !== null && yr >= RECENT_BOOK_MIN_YEAR;
      });
    }

    if (visible.length === 0) {
      internetStatus.textContent = recentOnlyInternet
        ? 'Nenhum livro em Português publicado a partir de 2024 encontrado com esse termo. Desativa o filtro de recentes ou tenta outro autor.'
        : 'Nenhum livro em Português encontrado com esse termo. Tenta outro autor ou sugestão.';
      return;
    }

    const filterNote = recentOnlyInternet ? ` · filtro desde ${RECENT_BOOK_MIN_YEAR}` : '';
    internetStatus.textContent = `${visible.length} livros em Português encontrados (ordenados dos mais recentes para os mais antigos${filterNote}):`;
    renderUniversalResults(visible);
  }

  function pickGutenbergFormat(formats) {
    if (!formats) return null;
    const preferred = [
      'text/plain; charset=utf-8',
      'text/plain; charset=us-ascii',
      'text/plain; charset=iso-8859-1',
      'text/plain',
      'text/html; charset=utf-8',
      'text/html'
    ];
    for (const mime of preferred) {
      if (formats[mime] && !formats[mime].endsWith('.zip')) {
        return { url: formats[mime], isHtml: mime.includes('html') };
      }
    }
    for (const [mime, u] of Object.entries(formats)) {
      if ((mime.startsWith('text/plain') || mime.startsWith('text/html')) && u && !u.endsWith('.zip')) {
        return { url: u, isHtml: mime.includes('html') };
      }
    }
    return null;
  }

  function renderUniversalResults(results) {
    const frag = document.createDocumentFragment();
    const savedIds = new Set(userBooks.map((b) => b.id));

    for (const item of results) {
      const card = document.createElement('div');
      card.className = 'internet-book-card';

      if (item.coverUrl) {
        const img = document.createElement('img');
        img.className = 'internet-book-cover';
        img.src = item.coverUrl;
        img.alt = `Capa de ${item.title}`;
        img.loading = 'lazy';
        img.onerror = () => img.remove();
        card.appendChild(img);
      }

      const info = document.createElement('div');
      info.className = 'internet-book-info';
      const yearVal = parseBookYear(item.year);
      const yearLabel = yearVal ? String(yearVal) : 'n/d';
      const langLabel = formatLanguageLabel(item.language || 'pt');
      const pagesTxt = item.pages ? ` · ${item.pages} págs.` : '';
      const ptBadge = item.ptPriority >= 40 ? '🇵🇹 Portugal · ' : '';
      const sourceTxt = item.sourceLabel ? `${ptBadge}${item.sourceLabel}${pagesTxt}` : `${ptBadge.replace(/ · $/, '')}${pagesTxt}`;
      info.innerHTML = `
        <h3 class="internet-book-title">${escapeHtml(item.title)}</h3>
        <div class="internet-book-author">✍️ ${escapeHtml(item.author)}</div>
        <div class="internet-book-badges">
          <span class="meta-badge meta-badge-year">📅 Ano: ${escapeHtml(yearLabel)}</span>
          <span class="meta-badge meta-badge-pt">🗣️ Idioma: ${escapeHtml(langLabel)}</span>
        </div>
        ${sourceTxt ? `<div class="internet-book-source">${escapeHtml(sourceTxt)}</div>` : ''}
      `;

      const actions = document.createElement('div');
      actions.className = 'internet-book-actions';

      if (item.identifier || item.formatInfo) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn-download-book';

        if (savedIds.has(item.id)) {
          btn.textContent = '✅ Já na Estante';
          btn.disabled = true;
        } else {
          btn.textContent = '📥 Guardar na Estante';
          btn.addEventListener('click', () => downloadAndSaveUniversalBook(item, btn));
        }
        actions.appendChild(btn);
      }

      if (item.onlineUrl) {
        const link = document.createElement('a');
        link.className = 'btn-online-book';
        link.href = item.onlineUrl;
        link.target = '_blank';
        link.rel = 'noopener';
        link.textContent = '🔗 Abrir Livro Online';
        actions.appendChild(link);
      }

      card.append(info, actions);
      frag.appendChild(card);
    }

    internetResults.appendChild(frag);
  }

  async function downloadAndSaveUniversalBook(item, btn) {
    btn.disabled = true;
    btn.textContent = '⏳ A descarregar...';

    try {
      let cleanText = '';

      if (item.source === 'gutendex') {
        const raw = await fetchWithCorsFallback(item.formatInfo.url);
        cleanText = cleanGutenbergText(raw, item.formatInfo.isHtml);
      } else if (item.source === 'archive') {
        const txtUrl = `https://archive.org/download/${encodeURIComponent(item.identifier)}/${encodeURIComponent(item.identifier)}_djvu.txt`;
        try {
          cleanText = await fetchWithCorsFallback(txtUrl);
        } catch (_) {
          const metaRes = await fetchWithTimeout(`https://archive.org/metadata/${encodeURIComponent(item.identifier)}/files`, 7000);
          if (!metaRes.ok) throw new Error('Sem metadados Archive');
          const metaJson = await metaRes.json();
          const files = Array.isArray(metaJson.result) ? metaJson.result : [];
          const txtFile = files.find((f) => f.name && f.name.toLowerCase().endsWith('.txt'));
          if (!txtFile) throw new Error('Sem ficheiro de texto direto');
          const altUrl = `https://archive.org/download/${encodeURIComponent(item.identifier)}/${encodeURIComponent(txtFile.name)}`;
          cleanText = await fetchWithCorsFallback(altUrl);
        }
      }

      if (!cleanText || cleanText.trim().length < 1500) {
        throw new Error('Texto demasiado curto (amostra)');
      }

      const chapters = splitTextIntoChapters(cleanText);
      if (chapters.length === 0) throw new Error('Texto vazio');

      const category = guessBookCategory(item);
      const emojiMap = { romances: '❤️', contos: '📖', classicos: '🇵🇹', especiais: '🌹' };
      const palette = COVER_PALETTES[userBooks.length % COVER_PALETTES.length];

      const newBook = {
        id: item.id,
        gutenbergId: item.gutenbergId,
        title: item.title,
        author: item.author,
        year: parseBookYear(item.year),
        language: normalizeLanguageCode(item.language) || 'pt',
        category,
        palette,
        coverEmoji: emojiMap[category] || '📖',
        isUserBook: true,
        chapters
      };

      userBooks.unshift(newBook);
      await saveBookToIdb(newBook);
      saveUserBooks();
      renderShelf();

      btn.textContent = '✅ Já na Estante';
      showToast(`"${item.title}" guardado offline (${chapters.length} capítulos)!`);
    } catch (_) {
      btn.disabled = false;
      btn.textContent = '📥 Guardar na Minha Estante';
      showToast('Não foi possível descarregar o texto deste livro. Experimenta outro resultado.');
    }
  }

  async function fetchWithCorsFallback(targetUrl) {
    const attempts = [
      targetUrl,
      `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`,
      `https://corsproxy.io/?url=${encodeURIComponent(targetUrl)}`
    ];

    for (const attemptUrl of attempts) {
      try {
        const res = await fetch(attemptUrl);
        if (res.ok) {
          const text = await res.text();
          if (text && text.length > 200) return text;
        }
      } catch (_) {}
    }

    throw new Error('Falha ao descarregar o livro.');
  }

  function cleanGutenbergText(raw, isHtml) {
    let text = raw;
    if (isHtml) {
      const doc = new DOMParser().parseFromString(raw, 'text/html');
      text = doc.body ? doc.body.innerText : raw;
    }

    text = text.replace(/\r\n/g, '\n');

    const startMatch = text.match(/\*\*\*\s*START OF (THE|THIS) PROJECT GUTENBERG EBOOK[^\n]*\*\*\*/i);
    if (startMatch) {
      text = text.slice(startMatch.index + startMatch[0].length);
    }

    const endMatch = text.match(/\*\*\*\s*END OF (THE|THIS) PROJECT GUTENBERG EBOOK/i);
    if (endMatch) {
      text = text.slice(0, endMatch.index);
    }

    return text.replace(/\n{4,}/g, '\n\n\n').trim();
  }

  function guessBookCategory(gBook) {
    const meta = `${gBook.title || ''} ${(gBook.subjects || []).join(' ')} ${(gBook.bookshelves || []).join(' ')}`.toLowerCase();
    if (/(conto|short stories|fables|novela)/.test(meta)) return 'contos';
    if (/(romance|love|amor|fiction)/.test(meta)) return 'romances';
    return 'classicos';
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function updateOnlineStatus() {
    if (navigator.onLine) {
      offlineBadge.textContent = 'Pronto Offline';
      offlineBadge.classList.remove('is-offline');
    } else {
      offlineBadge.textContent = 'Modo Offline';
      offlineBadge.classList.add('is-offline');
    }
  }

  function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch(() => {});
      });
    }
  }

  init();
})();
