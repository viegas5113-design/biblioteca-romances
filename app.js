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

  // State
  let userBooks = [];
  let progressMap = {};
  let prefs = { fontSize: 1.25, theme: 'sepia' };
  let activeCategory = 'todos';
  let searchQuery = '';

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

  // Add Book Modal DOM
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

  const toastEl = document.getElementById('toast');

  function init() {
    loadState();
    applyReaderPrefs();
    renderShelf();
    bindEvents();
    updateOnlineStatus();
    registerServiceWorker();
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
    localStorage.setItem(USER_BOOKS_KEY, JSON.stringify(userBooks));
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
      if (!q) return true;
      return `${book.title} ${book.author}`.toLowerCase().includes(q);
    });

    if (activeCategory === 'lendo') {
      filtered.sort((a, b) => (progressMap[b.id]?.updatedAt || 0) - (progressMap[a.id]?.updatedAt || 0));
    }

    shelfMeta.textContent = `${filtered.length} ${filtered.length === 1 ? 'livro disponível' : 'livros disponíveis'}`;
    booksGrid.innerHTML = '';

    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent =
        activeCategory === 'lendo'
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

    return chapters;
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

  async function parseEpubFile(file) {
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
        const parsed = await parseEpubFile(file);
        if (parsed.chapters.length === 0) {
          importFileStatus.textContent = 'Não foi possível extrair capítulos deste EPUB.';
          return;
        }
        addTitle.value = parsed.title;
        addAuthor.value = parsed.author;
        addText.value = parsed.chapters.map((c) => `${c.title}\n\n${c.text}`).join('\n\n');
        importFileStatus.textContent = `EPUB carregado (${parsed.chapters.length} capítulos)! Carrega em "Guardar na Estante".`;
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

    btnBackShelf.addEventListener('click', closeReader);

    btnDeleteBook.addEventListener('click', () => {
      if (!activeBook || !activeBook.isUserBook) return;
      if (confirm(`Queres mesmo apagar "${activeBook.title}" da estante?`)) {
        userBooks = userBooks.filter((b) => b.id !== activeBook.id);
        delete progressMap[activeBook.id];
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

    btnAddBook.addEventListener('click', openAddModal);
    btnPickFile.addEventListener('click', () => bookFileInput.click());
    bookFileInput.addEventListener('change', (e) => handleBookFile(e.target.files[0]));

    addBookForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const title = addTitle.value.trim();
      const author = addAuthor.value.trim() || 'Autoria Pessoal';
      const rawText = addText.value.trim();
      if (!title || !rawText) return;

      const chapters = splitTextIntoChapters(rawText);
      const palette = COVER_PALETTES[userBooks.length % COVER_PALETTES.length];
      const emojiMap = { romances: '❤️', contos: '📖', classicos: '🇵🇹', especiais: '🌹' };

      userBooks.unshift({
        id: `user-${Date.now()}`,
        title,
        author,
        category: addCategory.value,
        palette,
        coverEmoji: emojiMap[addCategory.value] || '🌹',
        isUserBook: true,
        chapters
      });

      try {
        saveUserBooks();
        closeAddModal();
        renderShelf();
        showToast(`"${title}" guardado na estante!`);
      } catch (_) {
        userBooks.shift();
        showToast('O livro é demasiado grande para a memória do navegador.');
      }
    });

    document.querySelectorAll('[data-close="add"]').forEach((el) => {
      el.addEventListener('click', closeAddModal);
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (!addModal.classList.contains('hidden')) closeAddModal();
        else if (!readerView.classList.contains('hidden')) closeReader();
      }
    });

    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);
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
