/* Committee Tape — self-serve song uploads.
 * Validates the selected file, uploads it to Supabase Storage, and
 * inserts a row into the `songs` table. New uploads reach the shared
 * feed via the realtime insert subscription in player.js.
 */
(function () {
  const $ = id => document.getElementById(id);
  const upToggle = $('upToggle');
  const upPanel = $('upPanel');
  const upFile = $('upFile');
  const upFileLabel = $('upFileLabel');
  const upTitle = $('upTitle');
  const upName = $('upName');
  const upSubmit = $('upSubmit');
  const upMsg = $('upMsg');

  const NAME_KEY = 'committee-tape:name';
  const MAX_MB = 15;
  const MAX_BYTES = MAX_MB * 1024 * 1024;

  /* polyfill crypto.randomUUID for non-HTTPS or older browsers */
  function safeUUID() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      var arr = new Uint8Array(16);
      crypto.getRandomValues(arr);
      arr[6] = (arr[6] & 0x0f) | 0x40;
      arr[8] = (arr[8] & 0x3f) | 0x80;
      var hex = Array.from(arr, function(b) { return b.toString(16).padStart(2, '0'); }).join('');
      return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
    }
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  /* check if a file looks like an MP3 — MIME type OR extension */
  function isAudioMp3(f) {
    if (!f) return false;
    if (f.type === 'audio/mpeg' || f.type === 'audio/mp3') return true;
    if (/\.mp3$/i.test(f.name)) return true;
    /* some mobile browsers report no type or application/octet-stream for audio */
    if (!f.type && f.size > 0 && /\.mp3$/i.test(f.name)) return true;
    return false;
  }

  let busy = false;

  const savedName = localStorage.getItem(NAME_KEY);
  if (savedName) upName.value = savedName;

  function clearMsg() {
    upMsg.textContent = '';
    upMsg.classList.remove('ok', 'err');
  }
  function showMsg(text, kind) {
    upMsg.textContent = text;
    upMsg.classList.toggle('ok', kind === 'ok');
    upMsg.classList.toggle('err', kind === 'err');
  }
  function titleFromFile(name) {
    return name.replace(/\.mp3$/i, '').replace(/[_-]+/g, ' ').trim() || 'Untitled';
  }

  upToggle.addEventListener('click', () => {
    const open = upPanel.hidden;
    upPanel.hidden = !open;
    upToggle.classList.toggle('on', open);
    upToggle.textContent = open ? '− CLOSE' : '+ ADD A SONG';
  });

  upFile.addEventListener('change', () => {
    clearMsg();
    const f = upFile.files && upFile.files[0];
    upFileLabel.textContent = f ? f.name : 'Choose an mp3…';
    upFileLabel.classList.toggle('picked', !!f);
  });

  [upTitle, upName].forEach(el => el.addEventListener('input', clearMsg));

  upSubmit.addEventListener('click', async () => {
    if (busy) return;
    clearMsg();

    const file = upFile.files && upFile.files[0];
    const title = upTitle.value.trim();
    const name = upName.value.trim();

    if (!file) return showMsg('Pick an mp3 file to upload.', 'err');
    if (!isAudioMp3(file)) return showMsg('That file is not an MP3 — pick an .mp3 audio file.', 'err');
    if (file.size > MAX_BYTES) return showMsg('That file is ' + (file.size / MAX_BYTES * MAX_MB).toFixed(1) + 'MB — over the ' + MAX_MB + 'MB limit.', 'err');
    if (!name) return showMsg('Enter your name so people know who added it.', 'err');

    var sb = window.supabaseClient;
    if (!sb) return showMsg('Supabase is not configured yet — see the README.', 'err');

    localStorage.setItem(NAME_KEY, name);

    var storagePath = safeUUID() + '-' + file.name;
    busy = true;
    upSubmit.disabled = true;
    upSubmit.classList.add('busy');
    upSubmit.innerHTML = '<span class="spin up-spin"></span> Uploading…';

    try {
      /* upload with a 60s timeout so mobile connections don't hang forever */
      var uploadPromise = sb.storage.from('songs').upload(storagePath, file, {
        cacheControl: '3600',
        upsert: false
      });
      var timeoutPromise = new Promise(function(_, reject) {
        setTimeout(function() { reject(new Error('Upload timed out. Check your connection and try again.')); }, 60000);
      });
      var result = await Promise.race([uploadPromise, timeoutPromise]);
      if (result.error) throw result.error;

      var { data } = sb.storage.from('songs').getPublicUrl(storagePath);
      var publicUrl = data.publicUrl;

      var { error: insErr } = await sb.from('songs').insert({
        title: title || titleFromFile(file.name),
        storage_path: publicUrl,
        added_by: name
      });
      if (insErr) throw insErr;

      upFile.value = '';
      upFileLabel.textContent = 'Choose an mp3…';
      upFileLabel.classList.remove('picked');
      upTitle.value = '';
      showMsg('Song added.', 'ok');
    } catch (err) {
      console.error('Upload failed:', err);
      /* show a useful error message instead of a generic one */
      var msg = err.message || err.error?.message || '';
      if (msg.includes('timed out')) {
        showMsg('Upload timed out — try a smaller file or a stronger connection.', 'err');
      } else if (msg.includes('File size')) {
        showMsg('File too large for the server — try a file under ' + MAX_MB + 'MB.', 'err');
      } else if (msg.includes('mime') || msg.includes('content-type') || msg.includes('type')) {
        showMsg('The server rejected the file type — make sure it is a valid MP3.', 'err');
      } else if (msg.includes('permission') || msg.includes('RLS') || msg.includes('row level')) {
        showMsg('Permission denied — the server is not accepting uploads right now.', 'err');
      } else {
        showMsg('Upload failed: ' + (msg || 'unknown error') + '. Try again.', 'err');
      }
    } finally {
      busy = false;
      upSubmit.disabled = false;
      upSubmit.classList.remove('busy');
      upSubmit.textContent = 'Upload';
    }
  });

  /* warn before navigating away during an active upload */
  window.addEventListener('beforeunload', function(e) {
    if (busy) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
})();
