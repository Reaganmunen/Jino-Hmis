/* ============================================================
   avatar.js — SHARED across patient, dentist, and staff portals
   ------------------------------------------------------------
   Single place that knows how to show a person's profile photo.
   Every page should use renderAvatarInto() instead of writing its
   own "img if photoUrl else initials" logic — that duplication is
   exactly how the dentist/patient photo mismatch happened: each
   page had its own copy of this logic and only some of them got
   updated when the photo storage location changed.

   Load this AFTER api.js (needs fetchMethod) and BEFORE any
   page-specific script that calls these functions:
     <script src="../js/api.js"></script>
     <script src="../js/avatar.js"></script>
     <script src="../js/dentistPatients.js"></script>
   ============================================================ */
(function () {
  'use strict';

  // Simple in-memory cache so a page listing 30 patients doesn't fire
  // 30 separate requests — cleared on full page reload, which is fine
  // since these are short-lived views anyway.
  const cache = {}; // userId -> profile_picture_url (or null)

  /**
   * Renders a photo (if available) or initials into a container element.
   * Works for any role — patient, dentist, staff — since profile_picture_url
   * lives on User for everyone.
   *
   * @param {HTMLElement} el - the container (e.g. a div.avatar / div.roster-avatar)
   * @param {string} name - full name, used for initials fallback and alt text
   * @param {string|null} photoUrl - profile_picture_url value, or null/undefined
   */
  function renderAvatarInto(el, name, photoUrl) {
    if (!el) return;
    if (photoUrl) {
      el.innerHTML = `<img src="${escapeAttr(photoUrl)}" alt="${escapeAttr(name)}">`;
    } else {
      el.textContent = initialsOf(name);
    }
  }

  /**
   * Fetches a single user's profile_picture_url by id, with caching.
   * Use this when a page has a userId but not the full user object yet
   * (e.g. showing a dentist's photo from just dentist_id on an appointment).
   * Requires GET /users/:id (admin-only today) — for non-admin contexts,
   * prefer batch-loading photos via the list endpoint you already call
   * (e.g. GET /users/dentists, which now includes profile_picture_url).
   */
  async function fetchAvatarUrl(userId) {
    if (!userId) return null;
    if (Object.prototype.hasOwnProperty.call(cache, userId)) return cache[userId];
    try {
      const user = await fetchMethod(`/users/${userId}`, 'GET', null, true);
      cache[userId] = user.profile_picture_url || null;
    } catch (err) {
      cache[userId] = null; // fail quiet — falls back to initials
    }
    return cache[userId];
  }

  /** Manually prime the cache from data a page already fetched in bulk
   *  (e.g. after GET /users/dentists), so fetchAvatarUrl() doesn't
   *  re-request something already in hand. */
  function primeAvatarCache(users) {
    (users || []).forEach((u) => {
      if (u && u.id != null) cache[u.id] = u.profile_picture_url || null;
    });
  }

  /**
   * Same as renderAvatarInto, but returns an HTML string instead of writing
   * into an element — for pages that build rows via template literals
   * (e.g. `<div class="sched-avatar">${Avatar.avatarInnerHtml(name, photo)}</div>`)
   * rather than creating DOM nodes one at a time.
   */
  function avatarInnerHtml(name, photoUrl) {
    if (photoUrl) {
      return `<img src="${escapeAttr(photoUrl)}" alt="${escapeAttr(name)}">`;
    }
    return escapeHtml(initialsOf(name));
  }

  function initialsOf(name) {
    if (!name) return '--';
    return name.replace('Dr. ', '').trim().split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase();
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  function escapeAttr(str) {
    return escapeHtml(str).replace(/"/g, '&quot;');
  }

  // Exposed globally — every page script calls window.Avatar.* or the
  // bare function names, matching how api.js exposes fetchMethod etc.
  window.Avatar = { renderAvatarInto, avatarInnerHtml, fetchAvatarUrl, primeAvatarCache, initialsOf };
})();