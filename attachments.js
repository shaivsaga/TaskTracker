/* Client side of file attachments: validation, image compression, upload.
   Plain JS, no libraries. Exposes window.TTFiles. Only pdf, pptx, docx, jpg, png are accepted. */
(function () {
  'use strict';

  var MIME = {
    pdf: 'application/pdf',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    jpg: 'image/jpeg',
    png: 'image/png'
  };
  var MAX_BYTES = 10 * 1024 * 1024;     // documents, per file (the server enforces this too)
  var MAX_INPUT = 40 * 1024 * 1024;     // images are shrunk, so allow a big camera original in
  var MAX_SIDE = 1600, MIN_SIDE = 640;  // longest side in pixels
  var TARGET = 250 * 1024;              // aim for 250 KB or less per image
  var KEEP_PNG = 150 * 1024;            // small PNGs (diagrams, icons) stay PNG
  var QUALITIES = [0.82, 0.72, 0.62, 0.5];
  var ACCEPT = '.pdf,.pptx,.docx,.jpg,.jpeg,.png';

  function extFor(file) {
    var m = /\.([a-z0-9]+)$/i.exec(file.name || '');
    if (m) {
      var e = m[1].toLowerCase();
      if (e === 'jpeg') e = 'jpg';
      return Object.prototype.hasOwnProperty.call(MIME, e) ? e : null;
    }
    for (var k in MIME) { if (MIME[k] === file.type) return k; }  // pasted files can have no name
    return null;
  }

  function loadImage(file) {
    if (window.createImageBitmap) {
      return createImageBitmap(file, { imageOrientation: 'from-image' }).catch(function () { return viaElement(file); });
    }
    return viaElement(file);
  }
  function viaElement(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('That image could not be read.')); };
      img.src = url;
    });
  }
  function toBlob(canvas, q) {
    return new Promise(function (resolve) { canvas.toBlob(resolve, 'image/jpeg', q); });
  }

  // Resize to MAX_SIDE and re-encode as JPEG, lowering quality (then size) until it is small.
  // Re-encoding also drops EXIF data such as GPS location.
  async function compressImage(file) {
    var base = (file.name || 'image').replace(/\.[^.]+$/, '') || 'image';
    var src = await loadImage(file);
    try {
      var w0 = src.width || src.naturalWidth, h0 = src.height || src.naturalHeight;
      if (!w0 || !h0) throw new Error('That image could not be read.');
      var long = Math.max(w0, h0);
      if (file.type === 'image/png' && file.size <= KEEP_PNG && long <= MAX_SIDE) return { blob: file, name: base + '.png' };
      var canvas = document.createElement('canvas');
      var ctx = canvas.getContext('2d');
      var side = Math.min(MAX_SIDE, long), best = null;
      for (;;) {
        var k = side / long;
        canvas.width = Math.max(1, Math.round(w0 * k));
        canvas.height = Math.max(1, Math.round(h0 * k));
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
        for (var i = 0; i < QUALITIES.length; i++) {
          var blob = await toBlob(canvas, QUALITIES[i]);
          if (!blob) throw new Error('That image could not be compressed.');
          best = blob;
          if (blob.size <= TARGET) return { blob: blob, name: base + '.jpg' };
        }
        if (side <= MIN_SIDE) return { blob: best, name: base + '.jpg' };
        side = Math.max(MIN_SIDE, Math.round(side * 0.8));
      }
    } finally { if (src.close) src.close(); }
  }

  // Returns { blob, name } ready to upload, or throws a readable error.
  async function prepare(file) {
    var ext = extFor(file);
    if (!ext) throw new Error('Only PDF, PPTX, DOCX, JPG and PNG files are allowed.');
    if (ext === 'jpg' || ext === 'png') {
      if (file.size > MAX_INPUT) throw new Error((file.name || 'That image') + ' is too large.');
      return compressImage(file);
    }
    if (file.size > MAX_BYTES) throw new Error((file.name || 'That file') + ' is over 10 MB.');
    return { blob: file, name: file.name || ('file.' + ext) };
  }

  async function upload(blob, name) {
    var fd = new FormData();
    fd.append('file', blob, name);
    var res = await fetch('api/upload.php', { method: 'POST', headers: { 'X-Requested-With': 'tasktracker' }, body: fd, cache: 'no-store' });
    var out = await res.json().catch(function () { return {}; });
    if (res.status === 413 && !out.error) out.error = 'That file is too large.';
    if (!res.ok) throw new Error(out.error || 'Upload failed.');
    return out;
  }

  function formatSize(n) {
    return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
  }

  window.TTFiles = {
    ACCEPT: ACCEPT,
    prepare: prepare,
    upload: upload,
    formatSize: formatSize,
    urlFor: function (id) { return 'uploads/' + id; }
  };
})();
