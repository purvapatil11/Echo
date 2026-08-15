/* Committee Tape — the single shared Supabase client.
 *
 * Every Supabase call in the app (song library feed, uploads, realtime)
 * goes through window.supabaseClient. Do not create additional clients.
 */
(function () {
  if (window.supabaseClient) return;

  var url = window.SUPABASE_URL;
  var anonKey = window.SUPABASE_ANON_KEY;

  if (!url || !anonKey || url.indexOf('PASTE_') === 0 || anonKey.indexOf('PASTE_') === 0) {
    console.error('Committee Tape: SUPABASE_URL / SUPABASE_ANON_KEY are not configured. Edit supabase-config.js — see the README.');
    window.supabaseClient = null;
    return;
  }

  if (typeof window.supabase === 'undefined' || typeof window.supabase.createClient !== 'function') {
    console.error('Committee Tape: @supabase/supabase-js is not loaded — check the CDN <script> tag in index.html.');
    window.supabaseClient = null;
    return;
  }

  window.supabaseClient = window.supabase.createClient(url, anonKey);
})();
