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
  const upArtist = $('upArtist');
  const upName = $('upName');
  const upSubmit = $('upSubmit');
  const upMsg = $('upMsg');

  const NAME_KEY = 'committee-tape:name';
  const MAX_MB = 15;
  const MAX_BYTES = MAX_MB * 1024 * 1024;
  const isAudioMp3 = f => !!f && (f.type === 'audio/mpeg' || f.type === 'audio/mp3' || /\.mp3$/i.test(f.name));

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
    const txt = upToggle.querySelector('.up-toggle-txt');
    if (txt) txt.textContent = open ? 'CLOSE' : 'ADD A SONG';
  });

  upFile.addEventListener('change', () => {
    clearMsg();
    const f = upFile.files && upFile.files[0];
    upFileLabel.textContent = f ? f.name : 'Choose an mp3…';
    upFileLabel.classList.toggle('picked', !!f);
  });

  [upTitle, upArtist, upName].forEach(el => el.addEventListener('input', clearMsg));

  upSubmit.addEventListener('click', async () => {
    if (busy) return;
    clearMsg();

    const file = upFile.files && upFile.files[0];
    const title = upTitle.value.trim();
    const artist = upArtist.value.trim();
    const name = upName.value.trim();

    if (!file) return showMsg('Pick an mp3 file to upload.', 'err');
    if (!isAudioMp3(file)) return showMsg('That file is not an MP3 — pick an .mp3 audio file.', 'err');
    if (file.size > MAX_BYTES) return showMsg(`That file is ${(file.size / MAX_BYTES * MAX_MB).toFixed(1)}MB — over the ${MAX_MB}MB limit.`, 'err');
    if (!name) return showMsg('Enter your name so people know who added it.', 'err');

    const sb = window.supabaseClient;
    if (!sb) return showMsg('Supabase is not configured yet — see the README.', 'err');

    localStorage.setItem(NAME_KEY, name);

    const storagePath = `${crypto.randomUUID()}-${file.name}`;
    busy = true;
    upSubmit.disabled = true;
    upSubmit.classList.add('busy');
    upSubmit.innerHTML = '<span class="spin up-spin"></span> Uploading…';

    try {
      const { error: upErr } = await sb.storage.from('songs').upload(storagePath, file, {
        cacheControl: '3600',
        upsert: false
      });
      if (upErr) throw upErr;

      const { data } = sb.storage.from('songs').getPublicUrl(storagePath);
      const publicUrl = data.publicUrl;

      const { error: insErr } = await sb.from('songs').insert({
        title: title || titleFromFile(file.name),
        artist: artist || null,
        storage_path: publicUrl,
        added_by: name
      });
      if (insErr) throw insErr;

      upFile.value = '';
      upFileLabel.textContent = 'Choose an mp3…';
      upFileLabel.classList.remove('picked');
      upTitle.value = '';
      upArtist.value = '';
      showMsg('Uploaded — it should appear in the tape now.', 'ok');
    } catch (err) {
      console.error('Upload failed:', err);
      showMsg('Upload failed, try again.', 'err');
    } finally {
      busy = false;
      upSubmit.disabled = false;
      upSubmit.classList.remove('busy');
      upSubmit.textContent = 'Upload';
    }
  });
})();
