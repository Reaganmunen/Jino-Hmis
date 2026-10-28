/* ============================================================
   IMAGING (dentist side) — X-rays and clinical photos
   ------------------------------------------------------------
     Imaging.mount(container, { patientId, patientName })
         Gallery for one patient: filter by type / tooth, upload
         (several files at once), open the viewer, tick two
         images to compare them side by side.

   Viewer: zoom (wheel / pinch), pan (drag), rotate, flip,
   brightness, contrast, invert, per-image findings.
   Images are fetched with the login token and shown from blob
   URLs, so nothing is reachable without being signed in.

   Needs api.js (getStoredUser), dashboard.css, imaging.css.
   ============================================================ */
(function () {
  'use strict';

  const TYPES = [
    { value: 'bitewing', label: 'Bitewing' },
    { value: 'periapical', label: 'Periapical' },
    { value: 'panoramic', label: 'Panoramic (OPG)' },
    { value: 'cephalometric', label: 'Cephalometric' },
    { value: 'cbct', label: 'CBCT slice' },
    { value: 'occlusal', label: 'Occlusal' },
    { value: 'intraoral_photo', label: 'Intraoral photo' },
    { value: 'extraoral_photo', label: 'Extraoral photo' },
    { value: 'other', label: 'Other' },
  ];
  const typeLabel = (v) => (TYPES.find((t) => t.value === v) || { label: v }).label;

  const MAX_DIM = 2560;          // longest side after browser-side resize
  const KEEP_ORIGINAL_UNDER = 3 * 1024 * 1024;
  const MAX_UPLOAD = 11 * 1024 * 1024;
  const THUMB_DIM = 360;

  const PERMANENT = [
    ['18', '17', '16', '15', '14', '13', '12', '11', '21', '22', '23', '24', '25', '26', '27', '28'],
    ['48', '47', '46', '45', '44', '43', '42', '41', '31', '32', '33', '34', '35', '36', '37', '38'],
  ];
  const PRIMARY = [
    ['55', '54', '53', '52', '51', '61', '62', '63', '64', '65'],
    ['85', '84', '83', '82', '81', '71', '72', '73', '74', '75'],
  ];

  /* ---------- helpers ---------- */
  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function todayIso() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function isDentist() {
    const u = typeof getStoredUser === 'function' ? getStoredUser() : null;
    return !!u && u.role === 'dentist';
  }
  function canDelete(study) {
    const u = typeof getStoredUser === 'function' ? getStoredUser() : null;
    return !!u && (u.role === 'admin' || (u.role === 'dentist' && u.id === study.uploaded_by));
  }
  function notify(msg) {
    const t = document.getElementById('toast');
    if (!t) { window.alert(msg); return; }
    t.textContent = msg;
    t.classList.add('is-visible');
    clearTimeout(notify._t);
    notify._t = setTimeout(() => t.classList.remove('is-visible'), 2800);
  }
  const el = (html) => {
    const d = document.createElement('div');
    d.innerHTML = html.trim();
    return d.firstElementChild;
  };

  /* ---------- API (raw fetch: the shared helper is JSON-only) ---------- */
  async function api(path, { method = 'GET', body = null, contentType = null, blob = false } = {}) {
    const headers = {};
    const token = localStorage.getItem('jino_token');
    if (token) headers.Authorization = `Bearer ${token}`;
    if (contentType) headers['Content-Type'] = contentType;
    else if (body && typeof body === 'object' && !(body instanceof Blob)) headers['Content-Type'] = 'application/json';
    const res = await fetch(`/api/imaging${path}`, {
      method,
      headers,
      body: body && !(body instanceof Blob) && typeof body === 'object' ? JSON.stringify(body) : body,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || `Request failed (${res.status})`);
    }
    return blob ? res.blob() : res.json();
  }

  // Blob URL cache so a thumbnail / image is downloaded once per patient session.
  const blobCache = new Map();
  function blobUrl(id, kind) {
    const key = `${id}:${kind}`;
    if (!blobCache.has(key)) {
      blobCache.set(key, api(`/${id}/${kind}`, { blob: true }).then((b) => URL.createObjectURL(b))
        .catch((e) => { blobCache.delete(key); throw e; }));
    }
    return blobCache.get(key);
  }
  function dropBlob(id) {
    ['image', 'thumb'].forEach((kind) => {
      const key = `${id}:${kind}`;
      const p = blobCache.get(key);
      if (p) p.then((u) => URL.revokeObjectURL(u)).catch(() => {});
      blobCache.delete(key);
    });
  }
  function clearBlobs() {
    blobCache.forEach((p) => p.then((u) => URL.revokeObjectURL(u)).catch(() => {}));
    blobCache.clear();
  }

  /* ---------- image processing (browser side) ---------- */
  function loadBitmap(file) {
    if (window.createImageBitmap) return createImageBitmap(file).catch(() => loadViaImg(file));
    return loadViaImg(file);
  }
  function loadViaImg(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read this image')); };
      img.src = url;
    });
  }
  function canvasBlob(source, w, h, quality) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(source, 0, 0, w, h);
    return new Promise((resolve, reject) => {
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('Image conversion failed'))), 'image/jpeg', quality);
    });
  }
  async function prepare(file) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      throw new Error(`${file.name}: only JPEG, PNG or WebP images are supported`);
    }
    const bmp = await loadBitmap(file);
    const w = bmp.width; const h = bmp.height;
    const scale = Math.min(1, MAX_DIM / Math.max(w, h));
    let main = file;
    if (scale < 1 || file.size > KEEP_ORIGINAL_UNDER) {
      main = await canvasBlob(bmp, Math.round(w * scale), Math.round(h * scale), 0.88);
    }
    if (main.size > MAX_UPLOAD) throw new Error(`${file.name} is too large even after resizing`);
    const ts = Math.min(1, THUMB_DIM / Math.max(w, h));
    const thumb = await canvasBlob(bmp, Math.max(1, Math.round(w * ts)), Math.max(1, Math.round(h * ts)), 0.75);
    if (bmp.close) bmp.close();
    return { main, thumb };
  }

  /* ---------- tooth picker (FDI) ---------- */
  function toothPicker(initial) {
    const selected = new Set(initial || []);
    const hasPrimary = [...selected].some((t) => Number(t) >= 51);
    let showPrimary = hasPrimary;
    const root = el(`<div class="img-teeth">
      <div class="img-teeth-head">
        <span class="img-teeth-sum"></span>
        <label class="img-teeth-switch"><input type="checkbox"> Primary teeth</label>
        <button type="button" class="img-link-btn" data-clear>Clear</button>
      </div>
      <div class="img-teeth-grid"></div>
    </div>`);
    const grid = root.querySelector('.img-teeth-grid');
    const sum = root.querySelector('.img-teeth-sum');
    const sw = root.querySelector('input');
    sw.checked = showPrimary;

    function paint() {
      const rows = showPrimary ? PRIMARY : PERMANENT;
      grid.innerHTML = rows.map((row) => `<div class="img-teeth-row">${row.map((t) =>
        `<button type="button" class="img-tooth${selected.has(t) ? ' is-on' : ''}" data-t="${t}">${t}</button>`).join('')}</div>`).join('');
      const list = [...selected].sort();
      sum.textContent = list.length ? `Teeth: ${list.join(', ')}` : 'No specific tooth (e.g. full mouth)';
    }
    grid.addEventListener('click', (e) => {
      const b = e.target.closest('.img-tooth');
      if (!b) return;
      const t = b.dataset.t;
      if (selected.has(t)) selected.delete(t); else selected.add(t);
      paint();
    });
    sw.addEventListener('change', () => { showPrimary = sw.checked; paint(); });
    root.querySelector('[data-clear]').addEventListener('click', () => { selected.clear(); paint(); });
    paint();
    return { el: root, get: () => [...selected].sort() };
  }

  /* ============================================================
     GALLERY
     ============================================================ */
  const state = {
    host: null, patientId: null, patientName: '',
    studies: [], filterType: '', filterTooth: '',
    compareMode: false, picked: [],
    io: null,
  };

  function mount(host, { patientId, patientName }) {
    if (state.patientId !== patientId) {
      clearBlobs();
      state.filterType = ''; state.filterTooth = '';
      state.compareMode = false; state.picked = [];
    }
    state.host = host; state.patientId = patientId; state.patientName = patientName || 'Patient';
    host.innerHTML = '<div class="records-loading"><div class="mpesa-spinner"></div>Loading images…</div>';
    return reload();
  }

  async function reload() {
    try {
      state.studies = await api(`/patient/${state.patientId}`);
      renderGallery();
    } catch (e) {
      state.host.innerHTML = `<div class="empty-state">Could not load images. ${esc(e.message)}</div>`;
    }
  }

  function visibleStudies() {
    return state.studies.filter((s) => (!state.filterType || s.image_type === state.filterType)
      && (!state.filterTooth || s.tooth_numbers.includes(state.filterTooth)));
  }

  function renderGallery() {
    const host = state.host;
    const list = visibleStudies();
    const usedTypes = TYPES.filter((t) => state.studies.some((s) => s.image_type === t.value));
    const usedTeeth = [...new Set(state.studies.flatMap((s) => s.tooth_numbers))].sort();

    host.innerHTML = `
      <div class="img-toolbar">
        <div class="img-filters">
          <select class="field-input img-select" id="imgFilterType" aria-label="Filter by image type">
            <option value="">All types (${state.studies.length})</option>
            ${usedTypes.map((t) => `<option value="${t.value}"${state.filterType === t.value ? ' selected' : ''}>${esc(t.label)}</option>`).join('')}
          </select>
          <select class="field-input img-select" id="imgFilterTooth" aria-label="Filter by tooth">
            <option value="">All teeth</option>
            ${usedTeeth.map((t) => `<option value="${t}"${state.filterTooth === t ? ' selected' : ''}>Tooth ${t}</option>`).join('')}
          </select>
        </div>
        <div class="img-actions">
          ${state.studies.length > 1 ? `<button class="btn btn-outline btn-sm" id="imgCompareBtn" type="button">${state.compareMode ? 'Cancel compare' : 'Compare'}</button>` : ''}
          ${state.compareMode ? `<button class="btn btn-primary btn-sm" id="imgCompareGo" type="button" ${state.picked.length === 2 ? '' : 'disabled'}>View ${state.picked.length}/2 side by side</button>` : ''}
          ${isDentist() ? '<button class="btn btn-primary btn-sm" id="imgUploadBtn" type="button">+ Add images</button>' : ''}
        </div>
      </div>
      ${state.compareMode ? '<p class="img-hint">Tick two images, for example before and after treatment.</p>' : ''}
      <div class="img-grid" id="imgGrid">
        ${list.length ? list.map(cardHtml).join('') : `<div class="empty-state" style="grid-column:1/-1;">${state.studies.length ? 'No images match these filters.' : 'No images yet.'}</div>`}
      </div>`;

    host.querySelector('#imgFilterType').addEventListener('change', (e) => { state.filterType = e.target.value; renderGallery(); });
    host.querySelector('#imgFilterTooth').addEventListener('change', (e) => { state.filterTooth = e.target.value; renderGallery(); });
    const up = host.querySelector('#imgUploadBtn');
    if (up) up.addEventListener('click', openUpload);
    const cb = host.querySelector('#imgCompareBtn');
    if (cb) cb.addEventListener('click', () => { state.compareMode = !state.compareMode; state.picked = []; renderGallery(); });
    const go = host.querySelector('#imgCompareGo');
    if (go) go.addEventListener('click', () => {
      const pair = state.picked.map((id) => state.studies.find((s) => s.id === id)).filter(Boolean)
        .sort((a, b) => String(a.captured_at).localeCompare(String(b.captured_at)));
      if (pair.length === 2) openViewer(pair, true);
    });

    host.querySelector('#imgGrid').addEventListener('click', (e) => {
      const card = e.target.closest('.img-card');
      if (!card) return;
      const id = card.dataset.id;
      if (state.compareMode) {
        const i = state.picked.indexOf(id);
        if (i >= 0) state.picked.splice(i, 1);
        else if (state.picked.length < 2) state.picked.push(id);
        else { state.picked.shift(); state.picked.push(id); }
        renderGallery();
        return;
      }
      openViewer(list, false, list.findIndex((s) => s.id === id));
    });

    lazyLoadThumbs();
  }

  function cardHtml(s) {
    const picked = state.picked.indexOf(s.id);
    return `<button type="button" class="img-card${picked >= 0 ? ' is-picked' : ''}" data-id="${s.id}">
      <span class="img-thumb"><img alt="${esc(typeLabel(s.image_type))}" data-thumb="${s.id}">
        ${state.compareMode ? `<span class="img-pick">${picked >= 0 ? picked + 1 : ''}</span>` : ''}
      </span>
      <span class="img-info">
        <span class="img-type">${esc(typeLabel(s.image_type))}</span>
        <span class="img-meta">${esc(fmtDate(s.captured_at))}${s.tooth_numbers.length ? ` · ${esc(s.tooth_numbers.join(', '))}` : ''}</span>
        ${s.findings ? '<span class="img-flag" title="Has findings">Findings noted</span>' : ''}
      </span>
    </button>`;
  }

  function lazyLoadThumbs() {
    if (state.io) state.io.disconnect();
    const imgs = state.host.querySelectorAll('img[data-thumb]');
    const load = (img) => blobUrl(img.dataset.thumb, 'thumb').then((u) => { img.src = u; }).catch(() => { img.alt = 'Unavailable'; });
    if (!('IntersectionObserver' in window)) { imgs.forEach(load); return; }
    state.io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) { state.io.unobserve(en.target); load(en.target); }
      });
    }, { rootMargin: '200px' });
    imgs.forEach((i) => state.io.observe(i));
  }

  /* ============================================================
     UPLOAD MODAL
     ============================================================ */
  function openUpload() {
    let files = [];
    const picker = toothPicker([]);
    const scrim = el(`<div class="modal-scrim img-scrim is-open">
      <div class="modal img-modal" role="dialog" aria-modal="true" aria-label="Add images">
        <div class="modal-head">
          <div><p class="modal-kicker">Imaging</p><h2>Add images for ${esc(state.patientName)}</h2></div>
          <button class="icon-link-btn" type="button" data-close aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
          </button>
        </div>
        <label class="img-drop" id="imgDrop">
          <input type="file" id="imgFiles" accept="image/jpeg,image/png,image/webp" multiple hidden>
          <strong>Choose images</strong> or drop them here
          <span>JPEG, PNG or WebP. Large images are resized automatically.</span>
        </label>
        <ul class="img-filelist" id="imgFileList"></ul>
        <div class="form-grid" style="margin-top:16px;">
          <div>
            <label class="field-label" for="imgType">Image type</label>
            <select class="field-input" id="imgType">${TYPES.map((t) => `<option value="${t.value}">${esc(t.label)}</option>`).join('')}</select>
          </div>
          <div>
            <label class="field-label" for="imgDate">Date taken</label>
            <input class="field-input" type="date" id="imgDate" max="${todayIso()}" value="${todayIso()}">
          </div>
        </div>
        <div style="margin-top:16px;"><label class="field-label">Teeth shown (applies to every image in this batch)</label><div id="imgPickerHost"></div></div>
        <div style="margin-top:16px;"><label class="field-label" for="imgFindings">Findings (optional)</label>
          <textarea class="field-input" id="imgFindings" rows="2" maxlength="2000" placeholder="e.g. Periapical radiolucency at the apex of 46."></textarea></div>
        <p class="field-hint img-error" id="imgUpError" style="display:none;"></p>
        <div class="modal-foot">
          <button class="btn btn-outline" type="button" data-close>Cancel</button>
          <button class="btn btn-primary" type="button" id="imgUpGo" disabled>Upload</button>
        </div>
      </div>
    </div>`);
    scrim.querySelector('#imgPickerHost').appendChild(picker.el);
    document.body.appendChild(scrim);

    const input = scrim.querySelector('#imgFiles');
    const list = scrim.querySelector('#imgFileList');
    const goBtn = scrim.querySelector('#imgUpGo');
    const errEl = scrim.querySelector('#imgUpError');
    let busy = false;

    const onEsc = (e) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();           // don't also close the patient record behind
      close();
    };
    const close = () => { if (!busy) { document.removeEventListener('keydown', onEsc, true); scrim.remove(); } };
    document.addEventListener('keydown', onEsc, true);
    scrim.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
    scrim.addEventListener('mousedown', (e) => { if (e.target === scrim) close(); });

    function setFiles(fl) {
      files = [...fl].slice(0, 20);
      list.innerHTML = files.map((f) => `<li>${esc(f.name)} <em>${(f.size / 1048576).toFixed(1)} MB</em></li>`).join('');
      goBtn.disabled = !files.length;
      goBtn.textContent = files.length > 1 ? `Upload ${files.length} images` : 'Upload';
    }
    input.addEventListener('change', () => setFiles(input.files));
    const drop = scrim.querySelector('#imgDrop');
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('is-over'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('is-over'); }));
    drop.addEventListener('drop', (e) => setFiles(e.dataTransfer.files));

    goBtn.addEventListener('click', async () => {
      errEl.style.display = 'none';
      busy = true; goBtn.disabled = true;
      const qs = new URLSearchParams({
        image_type: scrim.querySelector('#imgType').value,
        captured_at: scrim.querySelector('#imgDate').value || todayIso(),
        tooth: picker.get().join(','),
      });
      const findings = scrim.querySelector('#imgFindings').value.trim();
      if (findings) qs.set('findings', findings);

      let done = 0; const failed = [];
      for (const f of files) {
        goBtn.textContent = `Uploading ${done + failed.length + 1} of ${files.length}…`;
        try {
          const { main, thumb } = await prepare(f);
          const study = await api(`/patient/${state.patientId}?${qs}`, { method: 'POST', body: main, contentType: main.type });
          // The thumbnail is a nice-to-have: if it fails the gallery falls back to the full image.
          await api(`/${study.id}/thumb`, { method: 'PUT', body: thumb, contentType: 'image/jpeg' }).catch(() => {});
          done += 1;
        } catch (e) { failed.push(`${f.name}: ${e.message}`); }
      }
      busy = false;
      if (done) { notify(`${done} image${done > 1 ? 's' : ''} added`); reload(); }
      if (failed.length) {
        errEl.textContent = failed.join(' | ');
        errEl.style.display = 'block';
        goBtn.disabled = false; goBtn.textContent = 'Retry';
        files = files.filter((f) => failed.some((m) => m.startsWith(`${f.name}:`)));
      } else { document.removeEventListener('keydown', onEsc, true); scrim.remove(); }
    });
  }

  /* ============================================================
     VIEWER (single or side-by-side compare)
     ============================================================ */
  class Pane {
    constructor(host, study) {
      this.study = study;
      this.t = { s: 1, x: 0, y: 0, rot: 0, flip: false, b: 100, c: 100, inv: false };
      this.pointers = new Map();
      this.el = el(`<div class="img-pane"><img class="img-pane-img" alt="" draggable="false"><div class="img-pane-cap"></div><div class="img-pane-load">Loading…</div></div>`);
      this.img = this.el.querySelector('img');
      this.loading = this.el.querySelector('.img-pane-load');
      host.appendChild(this.el);
      this.setStudy(study);
    }
    setStudy(study) {
      this.study = study;
      this.t = { s: 1, x: 0, y: 0, rot: 0, flip: false, b: 100, c: 100, inv: false };
      this.loading.style.display = 'flex'; this.loading.textContent = 'Loading…';
      this.img.style.visibility = 'hidden';
      const token = study.id;
      blobUrl(study.id, 'image').then((u) => {
        if (this.study.id !== token) return;
        this.img.onload = () => { this.loading.style.display = 'none'; this.img.style.visibility = 'visible'; this.fit(); };
        this.img.src = u;
      }).catch((e) => { this.loading.textContent = `Could not load image. ${e.message}`; });
      this.caption();
    }
    caption() {
      this.el.querySelector('.img-pane-cap').textContent = `${typeLabel(this.study.image_type)} · ${fmtDate(this.study.captured_at)}`
        + (this.study.tooth_numbers.length ? ` · ${this.study.tooth_numbers.join(', ')}` : '');
    }
    rect() { return this.el.getBoundingClientRect(); }
    fit() {
      const r = this.rect();
      const sideways = this.t.rot % 180 !== 0;
      const iw = sideways ? this.img.naturalHeight : this.img.naturalWidth;
      const ih = sideways ? this.img.naturalWidth : this.img.naturalHeight;
      if (!iw || !ih) return;
      this.t.s = Math.min(r.width / iw, r.height / ih) * 0.98;
      this.t.x = 0; this.t.y = 0;
      this.fitScale = this.t.s;
      this.apply();
    }
    apply() {
      const t = this.t;
      this.img.style.width = `${this.img.naturalWidth}px`;
      this.img.style.height = `${this.img.naturalHeight}px`;
      this.img.style.transform = `translate(-50%,-50%) translate(${t.x}px,${t.y}px) rotate(${t.rot}deg) scale(${t.flip ? -t.s : t.s},${t.s})`;
      this.img.style.filter = `brightness(${t.b}%) contrast(${t.c}%) invert(${t.inv ? 1 : 0})`;
    }
    // px/py are relative to the pane centre.
    zoomBy(ratio, px = 0, py = 0) {
      const min = (this.fitScale || 0.1) * 0.3; const max = (this.fitScale || 1) * 12;
      const ns = Math.min(max, Math.max(min, this.t.s * ratio));
      const k = ns / this.t.s;
      this.t.x = px - (px - this.t.x) * k;
      this.t.y = py - (py - this.t.y) * k;
      this.t.s = ns;
      this.apply();
    }
    panBy(dx, dy) { this.t.x += dx; this.t.y += dy; this.apply(); }
    rotate(deg) { this.t.rot = (this.t.rot + deg + 360) % 360; this.fit(); }
  }

  function openViewer(studies, compare, startIndex = 0) {
    let index = Math.max(0, startIndex);
    let sync = true;
    let active = 0;
    const panes = [];

    const root = el(`<div class="img-viewer" role="dialog" aria-modal="true" aria-label="Image viewer">
      <div class="img-v-top">
        <div class="img-v-title"></div>
        <button class="img-v-x" type="button" data-close aria-label="Close viewer">&times;</button>
      </div>
      <div class="img-v-main">
        <div class="img-v-stage ${compare ? 'is-compare' : ''}"></div>
        <aside class="img-v-side"></aside>
      </div>
      <div class="img-v-tools">
        <button type="button" data-a="out" title="Zoom out (-)">&minus;</button>
        <button type="button" data-a="in" title="Zoom in (+)">+</button>
        <button type="button" data-a="fit" title="Fit to screen (0)">Fit</button>
        <button type="button" data-a="rotl" title="Rotate left">&#8634;</button>
        <button type="button" data-a="rotr" title="Rotate right (R)">&#8635;</button>
        <button type="button" data-a="flip" title="Mirror">Flip</button>
        <button type="button" data-a="inv" title="Invert (I)">Invert</button>
        <label>Brightness <input type="range" min="40" max="220" value="100" data-s="b"></label>
        <label>Contrast <input type="range" min="40" max="260" value="100" data-s="c"></label>
        <button type="button" data-a="reset">Reset</button>
        ${compare ? '<label class="img-v-sync"><input type="checkbox" checked data-sync> Link zoom &amp; pan</label>' : ''}
      </div>
    </div>`);
    document.body.appendChild(root);
    document.body.classList.add('img-viewer-open');
    const stage = root.querySelector('.img-v-stage');
    const side = root.querySelector('.img-v-side');
    const title = root.querySelector('.img-v-title');

    studies.slice(compare ? 0 : index, compare ? 2 : index + 1).forEach((s) => panes.push(new Pane(stage, s)));
    const targets = () => (compare && sync ? panes : [panes[active]]);

    /* pointer: pan, wheel zoom, pinch */
    panes.forEach((p, i) => {
      const e0 = p.el;
      e0.addEventListener('pointerdown', (e) => {
        active = i; syncSliders();
        e0.setPointerCapture(e.pointerId);
        p.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        e0.classList.add('is-grab');
      });
      e0.addEventListener('pointermove', (e) => {
        const prev = p.pointers.get(e.pointerId);
        if (!prev) return;
        if (p.pointers.size === 2) {
          const [a, b] = [...p.pointers.values()];
          const before = Math.hypot(a.x - b.x, a.y - b.y);
          p.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
          const [a2, b2] = [...p.pointers.values()];
          const after = Math.hypot(a2.x - b2.x, a2.y - b2.y);
          if (before > 0) {
            const r = p.rect();
            const mx = (a2.x + b2.x) / 2 - r.left - r.width / 2;
            const my = (a2.y + b2.y) / 2 - r.top - r.height / 2;
            targets().forEach((t) => t.zoomBy(after / before, mx, my));
          }
        } else {
          p.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
          targets().forEach((t) => t.panBy(e.clientX - prev.x, e.clientY - prev.y));
        }
      });
      const up = (e) => { p.pointers.delete(e.pointerId); if (!p.pointers.size) e0.classList.remove('is-grab'); };
      e0.addEventListener('pointerup', up);
      e0.addEventListener('pointercancel', up);
      e0.addEventListener('wheel', (e) => {
        e.preventDefault();
        active = i;
        const r = p.rect();
        const ratio = e.deltaY < 0 ? 1.12 : 1 / 1.12;
        targets().forEach((t) => t.zoomBy(ratio, e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2));
      }, { passive: false });
      e0.addEventListener('dblclick', () => targets().forEach((t) => t.fit()));
    });

    /* toolbar */
    function syncSliders() {
      const t = panes[active].t;
      root.querySelector('[data-s="b"]').value = t.b;
      root.querySelector('[data-s="c"]').value = t.c;
    }
    root.querySelector('.img-v-tools').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-a]');
      if (!b) return;
      const a = b.dataset.a;
      targets().forEach((p) => {
        if (a === 'in') p.zoomBy(1.25);
        else if (a === 'out') p.zoomBy(1 / 1.25);
        else if (a === 'fit') p.fit();
        else if (a === 'rotl') p.rotate(-90);
        else if (a === 'rotr') p.rotate(90);
        else if (a === 'flip') { p.t.flip = !p.t.flip; p.apply(); }
        else if (a === 'inv') { p.t.inv = !p.t.inv; p.apply(); }
        else if (a === 'reset') { p.t = { s: 1, x: 0, y: 0, rot: 0, flip: false, b: 100, c: 100, inv: false }; p.fit(); }
      });
      syncSliders();
    });
    root.querySelectorAll('input[data-s]').forEach((r) => r.addEventListener('input', () => {
      targets().forEach((p) => { p.t[r.dataset.s] = Number(r.value); p.apply(); });
    }));
    const syncBox = root.querySelector('[data-sync]');
    if (syncBox) syncBox.addEventListener('change', () => { sync = syncBox.checked; });

    /* side panel */
    function renderSide() {
      if (compare) {
        title.textContent = 'Compare images';
        side.innerHTML = `<div class="img-v-cmp">${panes.map((p, i) => `
          <div><p class="img-v-k">${i === 0 ? 'Earlier' : 'Later'}</p>
          <p class="img-v-v"><b>${esc(typeLabel(p.study.image_type))}</b> · ${esc(fmtDate(p.study.captured_at))}</p>
          ${p.study.findings ? `<p class="img-v-find">${esc(p.study.findings)}</p>` : '<p class="img-v-find is-empty">No findings recorded</p>'}</div>`).join('')}</div>`;
        return;
      }
      const s = panes[0].study;
      title.textContent = `${state.patientName} · ${typeLabel(s.image_type)} · ${fmtDate(s.captured_at)}`;
      const editable = isDentist();
      side.innerHTML = `
        <p class="img-v-count">${index + 1} of ${studies.length}</p>
        <label class="field-label" for="vType">Type</label>
        <select class="field-input" id="vType" ${editable ? '' : 'disabled'}>${TYPES.map((t) => `<option value="${t.value}"${t.value === s.image_type ? ' selected' : ''}>${esc(t.label)}</option>`).join('')}</select>
        <label class="field-label" for="vDate" style="margin-top:12px;">Date taken</label>
        <input class="field-input" type="date" id="vDate" max="${todayIso()}" value="${esc(s.captured_at)}" ${editable ? '' : 'disabled'}>
        <label class="field-label" style="margin-top:12px;">Teeth</label>
        <div id="vTeeth"></div>
        <label class="field-label" for="vFind" style="margin-top:12px;">Findings</label>
        <textarea class="field-input" id="vFind" rows="4" maxlength="2000" ${editable ? '' : 'disabled'} placeholder="What do you see on this image?">${esc(s.findings || '')}</textarea>
        <label class="field-label" for="vNotes" style="margin-top:12px;">Notes</label>
        <textarea class="field-input" id="vNotes" rows="2" maxlength="1000" ${editable ? '' : 'disabled'}>${esc(s.notes || '')}</textarea>
        <p class="img-v-by">Added by Dr ${esc(s.uploader_first_name)} ${esc(s.uploader_last_name)}${s.created_at ? ` on ${esc(fmtDate(s.created_at))}` : ''}</p>
        <div class="img-v-btns">
          ${editable ? '<button class="btn btn-primary btn-sm" type="button" id="vSave">Save changes</button>' : ''}
          <button class="btn btn-outline btn-sm" type="button" id="vDl">Download</button>
          ${canDelete(s) ? '<button class="btn btn-outline btn-sm img-danger" type="button" id="vDel">Delete</button>' : ''}
        </div>
        <div class="img-v-nav">
          <button class="btn btn-outline btn-sm" type="button" id="vPrev" ${index === 0 ? 'disabled' : ''}>&larr; Previous</button>
          <button class="btn btn-outline btn-sm" type="button" id="vNext" ${index >= studies.length - 1 ? 'disabled' : ''}>Next &rarr;</button>
        </div>`;
      const tp = toothPicker(s.tooth_numbers);
      if (!editable) tp.el.classList.add('is-readonly');
      side.querySelector('#vTeeth').appendChild(tp.el);

      side.querySelector('#vPrev').addEventListener('click', () => go(-1));
      side.querySelector('#vNext').addEventListener('click', () => go(1));
      side.querySelector('#vDl').addEventListener('click', () => download(s));
      const save = side.querySelector('#vSave');
      if (save) save.addEventListener('click', async () => {
        save.disabled = true;
        try {
          const upd = await api(`/${s.id}`, {
            method: 'PATCH',
            body: {
              image_type: side.querySelector('#vType').value,
              captured_at: side.querySelector('#vDate').value,
              tooth_numbers: tp.get(),
              findings: side.querySelector('#vFind').value,
              notes: side.querySelector('#vNotes').value,
            },
          });
          Object.assign(s, upd);           // keep list + viewer in sync
          panes[0].caption(); renderSide();
          notify('Image details saved');
        } catch (e) { notify(e.message); save.disabled = false; }
      });
      const del = side.querySelector('#vDel');
      if (del) del.addEventListener('click', async () => {
        if (!window.confirm('Delete this image? It will be removed from the patient record.')) return;
        try {
          await api(`/${s.id}`, { method: 'DELETE' });
          dropBlob(s.id);
          state.studies = state.studies.filter((x) => x.id !== s.id);
          studies.splice(index, 1);
          notify('Image deleted');
          if (!studies.length) { closeViewer(); return; }
          index = Math.min(index, studies.length - 1);
          panes[0].setStudy(studies[index]); renderSide();
          renderGallery();
        } catch (e) { notify(e.message); }
      });
    }

    function go(step) {
      const n = index + step;
      if (n < 0 || n >= studies.length) return;
      index = n;
      panes[0].setStudy(studies[index]);
      syncSliders();
      renderSide();
    }

    async function download(s) {
      try {
        const url = await blobUrl(s.id, 'image');
        const ext = s.mime_type === 'image/png' ? 'png' : s.mime_type === 'image/webp' ? 'webp' : 'jpg';
        const a = document.createElement('a');
        a.href = url;
        a.download = `${state.patientName}_${s.image_type}_${s.captured_at}.${ext}`.replace(/[^\w.\-]+/g, '_');
        document.body.appendChild(a); a.click(); a.remove();
      } catch (e) { notify(e.message); }
    }

    /* open / close / keys */
    function closeViewer() {
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onResize);
      root.remove();
      document.body.classList.remove('img-viewer-open');
      // Edits made in the viewer may change what the gallery shows.
      renderGallery();
    }
    function onKey(e) {
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') {
        if (e.key === 'Escape') { e.stopImmediatePropagation(); e.target.blur(); }
        return;
      }
      if (e.key === 'Escape') { e.stopImmediatePropagation(); closeViewer(); return; }
      if (!compare && e.key === 'ArrowLeft') go(-1);
      else if (!compare && e.key === 'ArrowRight') go(1);
      else if (e.key === '+' || e.key === '=') targets().forEach((p) => p.zoomBy(1.25));
      else if (e.key === '-') targets().forEach((p) => p.zoomBy(1 / 1.25));
      else if (e.key === '0') targets().forEach((p) => p.fit());
      else if (e.key.toLowerCase() === 'i') targets().forEach((p) => { p.t.inv = !p.t.inv; p.apply(); });
      else if (e.key.toLowerCase() === 'r') targets().forEach((p) => p.rotate(90));
    }
    const onResize = () => panes.forEach((p) => p.fit());
    document.addEventListener('keydown', onKey, true); // capture: runs before the records modal's Escape handler
    window.addEventListener('resize', onResize);
    root.querySelector('[data-close]').addEventListener('click', closeViewer);
    renderSide();
  }

  window.Imaging = { mount, reload, clear: clearBlobs };
})();
