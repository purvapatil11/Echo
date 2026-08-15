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
  const brokenIds = new Set();   // songs that failed to load/play

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
      brokenIds.add(id);
      if (i === current) {
        setNP(song.title || 'Untitled', "Couldn't load this track");
        npArtist.classList.add('err');
      }
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
      brokenIds.add(songId(library[current]));
      npArtist.textContent = "Couldn't load this track";
      npArtist.classList.add('err');
      renderQueue();
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

  function subscribeRealtime(){
    const sb = window.supabaseClient;
    if (!sb) return;
    sb.channel('songs-feed')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'songs' }, ({ new: row }) => {
        addSongFromRow(row);
      })
      .subscribe();
  }

  loadLibrary()
    .then(data => {
      if (!Array.isArray(data)) throw new Error('not an array');
      library = data;
      if (!library.length) {
        setNP('No songs on the tape yet — add one with “+ ADD A SONG” above.', '');
        return;
      }
      current = 0;
      setNP(library[0].title || 'Untitled', [library[0].artist, library[0].addedBy ? `from ${library[0].addedBy}` : ''].filter(Boolean).join(' · '));
      renderQueue();
    })
    .catch(() => {
      setNP("Couldn't load the song library — is Supabase configured? See the README.", '');
    });

  subscribeRealtime();

  const wakeEvents = ['pointerdown', 'keydown', 'touchstart'];
  const wake = () => {
    interacted = true;
    if (library.length && !playerAudio.src) loadSong(current == null ? 0 : current, true);
    wakeEvents.forEach(ev => removeEventListener(ev, wake));
  };
  wakeEvents.forEach(ev => addEventListener(ev, wake));
})();
