/* Committee Tape — song library player.
 * Loads the song feed from the Supabase `songs` table, then fetches each
 * track's mp3 (a Supabase Storage public URL) at runtime via the Fetch
 * API, converts the response to a Blob, and creates an object URL to use
 * as the shared Audio instance's src. Object URLs are cached per song id
 * for the session, so only the first play per track triggers a download.
 * New uploads appear live via the realtime INSERT subscription below.
 */
(function(){
  const $ = id => document.getElementById(id);
  const playerAudio = new Audio();
  const npTitle = $('npTitle');
  const npArtist = $('npArtist');
  const npCur = $('npCur');
  const npDur = $('npDur');
  const btnPlay = $('btnPlay');
  const btnPrev = $('btnPrev');
  const btnNext = $('btnNext');
  const btnStop = $('btnStop');
  const queue = $('queue');
  const seekBar = $('seek');

  const objectUrls = new Map();  // song id (or url) -> cached object URL
  const loadingIds = new Set();  // songs currently being fetched
  const brokenIds = new Set(JSON.parse(sessionStorage.getItem('tape-broken') || '[]'));  // songs that failed to load/play
  const rememberBroken = () => sessionStorage.setItem('tape-broken', JSON.stringify([...brokenIds]));

  const icoPlay = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
  const icoPause = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>';
  const spinner = '<span class="spin"></span>';
  const fmt = s => Number.isFinite(s) ? `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}` : '0:00';

  let library = [];
  let current = null;
  let seekDrag = false;
  let interacted = false;

  const songId = s => s && (s.id || s.url);
  const chipAt = i => queue.children[i];

  function setNP(title, sub){
    npTitle.textContent = title;
    npArtist.textContent = sub || '';
    npArtist.classList.remove('err');
  }

  function markChipLoading(i, on){
    const c = chipAt(i);
    if (!c) return;
    if (on) {
      c.dataset.label = c.textContent;
      c.textContent = '…';
      c.classList.add('loading');
    } else {
      if (c.dataset.label) c.textContent = c.dataset.label;
      c.classList.remove('loading');
    }
  }

  function markChipBroken(i, on){
    const c = chipAt(i);
    if (c) c.classList.toggle('broken', on);
  }

  function renderQueue(){
    queue.innerHTML = '';
    library.forEach((s, i) => {
      const c = document.createElement('button');
      c.type = 'button';
      c.className = 'q-chip' + (i === current ? ' on' : '');
      c.textContent = s.title || s.url;
      c.addEventListener('click', () => playIndex(i));
      queue.appendChild(c);
    });
    for (let i = 0; i < library.length; i++) {
      const id = songId(library[i]);
      if (id && loadingIds.has(id)) markChipLoading(i, true);
      if (id && brokenIds.has(id)) markChipBroken(i, true);
    }
  }

  function syncPlayIcon(){
    const loading = current != null && loadingIds.has(songId(library[current]));
    if (loading) btnPlay.innerHTML = spinner;
    else btnPlay.innerHTML = (playerAudio.src && !playerAudio.paused) ? icoPause : icoPlay;
  }

  async function loadSong(i, autoplay){
    const song = library[i];
    if (!song) return;
    const id = songId(song);
    current = i;
    setNP(song.title || 'Untitled', [song.artist, song.addedBy ? `from ${song.addedBy}` : ''].filter(Boolean).join(' · '));

    if (objectUrls.has(id)) {
      playerAudio.src = objectUrls.get(id);
      brokenIds.delete(id);
      renderQueue();
      syncPlayIcon();
      if (autoplay) playerAudio.play().catch(() => {});
      return;
    }

    if (loadingIds.has(id)) return;

    loadingIds.add(id);
    brokenIds.delete(id);
    renderQueue();
    syncPlayIcon();

    try {
      const res = await fetch(song.url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      objectUrls.set(id, url);
      if (i === current) {
        playerAudio.src = url;
        if (autoplay) playerAudio.play().catch(() => {});
      }
    } catch (err) {
      if (location.protocol === 'file:') {
        playerAudio.src = song.url;
        if (autoplay) playerAudio.play().catch(() => {});
        return;
      }
      dropSong(i);
    } finally {
      loadingIds.delete(id);
      renderQueue();
      syncPlayIcon();
    }
  }

  function playIndex(i){
    const song = library[i];
    if (!song) return;
    const id = songId(song);
    if (i === current && playerAudio.src && !playerAudio.paused && !loadingIds.has(id)) {
      playerAudio.pause();
      return;
    }
    loadSong(i, true);
  }

  btnPlay.addEventListener('click', () => {
    if (current != null && loadingIds.has(songId(library[current]))) return;
    if (!playerAudio.src) { if (library.length) loadSong(current == null ? 0 : current, true); return; }
    playerAudio.paused ? playerAudio.play().catch(() => {}) : playerAudio.pause();
  });
  btnNext.addEventListener('click', () => {
    if (library.length) loadSong((current == null ? 0 : current + 1) % library.length, true);
  });
  btnPrev.addEventListener('click', () => {
    if (library.length) loadSong((current == null ? 0 : current - 1 + library.length) % library.length, true);
  });
  btnStop.addEventListener('click', () => {
    playerAudio.pause();
    playerAudio.currentTime = 0;
    seekBar.value = 0;
    seekBar.style.setProperty('--fill', '0%');
    npCur.textContent = fmt(0);
    syncPlayIcon();
  });

  seekBar.addEventListener('input', e => {
    seekDrag = true;
    if (playerAudio.duration) {
      playerAudio.currentTime = e.target.value / 100 * playerAudio.duration;
      e.target.style.setProperty('--fill', e.target.value + '%');
    }
  });
  seekBar.addEventListener('change', () => { seekDrag = false; });

  playerAudio.addEventListener('timeupdate', () => {
    if (seekDrag || !playerAudio.duration) return;
    const pct = playerAudio.currentTime / playerAudio.duration * 100;
    seekBar.value = pct;
    seekBar.style.setProperty('--fill', pct + '%');
    npCur.textContent = fmt(playerAudio.currentTime);
    npDur.textContent = fmt(playerAudio.duration);
  });
  playerAudio.addEventListener('play', syncPlayIcon);
  playerAudio.addEventListener('pause', syncPlayIcon);
  playerAudio.addEventListener('playing', () => {
    if (current != null) {
      brokenIds.delete(songId(library[current]));
      renderQueue();
    }
  });
  playerAudio.addEventListener('error', () => {
    if (current != null) {
      dropSong(current);
    }
  });
  playerAudio.addEventListener('ended', () => {
    if (library.length > 1) loadSong((current + 1) % library.length, true);
  });

  function loadLibrary(){
    const sb = window.supabaseClient;
    if (!sb) return Promise.reject(new Error('supabase not configured'));
    return sb.from('songs')
      .select('*')
      .order('added_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) throw error;
        return (data || []).map(row => ({
          id: row.id,
          title: row.title,
          artist: row.artist || '',
          url: row.storage_path,
          addedBy: row.added_by
        }));
      });
  }

  function addSongFromRow(row){
    if (!row || !row.storage_path) return;
    const entry = {
      id: row.id,
      title: row.title,
      artist: row.artist || '',
      url: row.storage_path,
      addedBy: row.added_by
    };
    if (library.some(s => s.id === entry.id)) return;
    const wasEmpty = library.length === 0;
    library.unshift(entry);
    if (current != null) current += 1;
    renderQueue();
    if (wasEmpty) {
      current = 0;
      setNP(entry.title || 'Untitled', [entry.artist, entry.addedBy ? `from ${entry.addedBy}` : ''].filter(Boolean).join(' · '));
    }
  }

  function removeSongFromRow(row){
    const id = row && row.id;
    if (!id) return;
    const idx = library.findIndex(s => s.id === id);
    if (idx === -1) return;
    library.splice(idx, 1);
    const objUrl = objectUrls.get(id);
    if (objUrl) URL.revokeObjectURL(objUrl);
    objectUrls.delete(id);
    loadingIds.delete(id);
    brokenIds.delete(id);
    if (current != null) {
      if (current === idx) {
        playerAudio.pause();
        playerAudio.removeAttribute('src');
        playerAudio.load();
        if (library.length) {
          current = Math.min(idx, library.length - 1);
          loadSong(current, false);
        } else {
          current = null;
          setNP('No songs on the tape yet — add one with “+ ADD A SONG” above.', '');
        }
      } else if (current > idx) {
        current -= 1;
      }
    }
    renderQueue();
    syncPlayIcon();
  }

  function dropSong(i){
    if (i < 0 || i >= library.length) return;
    const song = library[i];
    const id = songId(song);
    if (id) { brokenIds.add(id); rememberBroken(); }
    library.splice(i, 1);
    const objUrl = objectUrls.get(id);
    if (objUrl) URL.revokeObjectURL(objUrl);
    objectUrls.delete(id);
    loadingIds.delete(id);
    if (current != null) {
      if (current === i) {
        playerAudio.pause();
        playerAudio.removeAttribute('src');
        playerAudio.load();
        if (library.length) {
          current = Math.min(i, library.length - 1);
          loadSong(current, false);
        } else {
          current = null;
          setNP('No songs on the tape yet — add one with “+ ADD A SONG” above.', '');
        }
      } else if (current > i) {
        current -= 1;
      }
    }
    renderQueue();
    syncPlayIcon();
  }

  function syncLibrary(data){
    if (!Array.isArray(data)) return;
    data = data.filter(d => !brokenIds.has(d.id));
    const oldCurrentId = current != null && library[current] ? library[current].id : null;
    const newIds = new Set(data.map(d => d.id));

    for (const id of [...objectUrls.keys()]) {
      if (!newIds.has(id)) {
        URL.revokeObjectURL(objectUrls.get(id));
        objectUrls.delete(id);
      }
    }
    for (const id of [...loadingIds]) if (!newIds.has(id)) loadingIds.delete(id);
    for (const id of [...brokenIds]) if (!newIds.has(id)) brokenIds.delete(id);

    library = data;

    if (!library.length) {
      playerAudio.pause();
      playerAudio.removeAttribute('src');
      playerAudio.load();
      current = null;
      setNP('No songs on the tape yet — add one with “+ ADD A SONG” above.', '');
      renderQueue();
      syncPlayIcon();
      return;
    }

    if (oldCurrentId) {
      const idx = library.findIndex(s => s.id === oldCurrentId);
      if (idx === -1) {
        current = 0;
        loadSong(0, false);
        return;
      }
      current = idx;
    } else {
      current = 0;
    }
    setNP(library[current].title || 'Untitled', [library[current].artist, library[current].addedBy ? `from ${library[current].addedBy}` : ''].filter(Boolean).join(' · '));
    renderQueue();
    syncPlayIcon();
  }

  function refreshLibrary(){
    loadLibrary().then(syncLibrary).catch(() => {});
  }

  function validateSongs(entries){
    if (!Array.isArray(entries)) return entries;
    if (location.protocol === 'file:') return Promise.resolve(entries);
    let changed = false;
    return Promise.all(entries.map(entry =>
      fetch(entry.url, { headers: { Range: 'bytes=0-0' } })
        .then(res => {
          if (!res.ok) throw new Error('missing');
          return entry;
        })
        .catch(() => {
          brokenIds.add(entry.id);
          changed = true;
          return null;
        })
    )).then(list => {
      if (changed) rememberBroken();
      return list.filter(Boolean);
    });
  }

  function subscribeRealtime(){
    const sb = window.supabaseClient;
    if (!sb) return;
    sb.channel('songs-feed')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'songs' }, ({ new: row }) => {
        addSongFromRow(row);
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'songs' }, ({ old: row }) => {
        removeSongFromRow(row);
      })
      .subscribe();
  }

  loadLibrary()
    .then(validateSongs)
    .then(syncLibrary)
    .catch(() => {
      setNP("Couldn't load the song library — is Supabase configured? See the README.", '');
    });

  subscribeRealtime();

  setInterval(refreshLibrary, 20000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshLibrary(); });
  window.addEventListener('focus', refreshLibrary);

  const wakeEvents = ['pointerdown', 'keydown', 'touchstart'];
  const wake = () => {
    interacted = true;
    if (library.length && !playerAudio.src) loadSong(current == null ? 0 : current, true);
    wakeEvents.forEach(ev => removeEventListener(ev, wake));
  };
  wakeEvents.forEach(ev => addEventListener(ev, wake));
})();
