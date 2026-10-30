<?php
// Admin-only file upload. Accepts one file per request (multipart, field "file").
// Only pdf, pptx, docx, jpg, png. The type is decided by the file's CONTENT, not by what the browser says.
// Files are stored under data/uploads/ with a random name and served by nginx at /uploads/<name>.
require __DIR__ . '/_session.php';
tt_require_admin();
$config = is_file(__DIR__ . '/config.php') ? require __DIR__ . '/config.php' : [];

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') tt_json(405, ['error' => 'POST only']);
// A custom header cannot be sent by a plain cross-site form, so this is a second guard on top of SameSite=Lax.
if (($_SERVER['HTTP_X_REQUESTED_WITH'] ?? '') !== 'tasktracker') tt_json(400, ['error' => 'Bad request']);
@ignore_user_abort(true);

const UPLOAD_EXTS = ['pdf', 'pptx', 'docx', 'jpg', 'png'];
$mb = filter_var(is_array($config) ? ($config['max_upload_mb'] ?? null) : null, FILTER_VALIDATE_INT);
$maxBytes = ($mb === false || $mb < 1 || $mb > 12) ? 10 * 1048576 : $mb * 1048576;
$tmb = filter_var(is_array($config) ? ($config['max_upload_total_mb'] ?? null) : null, FILTER_VALIDATE_INT);
$totalBytes = ($tmb === false || $tmb < 10) ? 2048 * 1048576 : $tmb * 1048576;

function head_bytes($path, $n) {
  $h = @fopen($path, 'rb');
  if (!$h) return '';
  $d = (string)fread($h, $n);
  fclose($h);
  return $d;
}

function content_ok($path, $ext) {
  $head = head_bytes($path, 8);
  if ($ext === 'pdf') return strncmp($head, '%PDF-', 5) === 0;
  if ($ext === 'png' || $ext === 'jpg') {
    $info = @getimagesize($path);
    if (!$info || $info[2] !== ($ext === 'png' ? IMAGETYPE_PNG : IMAGETYPE_JPEG)) return false;
    return $info[0] > 0 && $info[1] > 0 && $info[0] <= 10000 && $info[1] <= 10000 && $info[0] * $info[1] <= 50000000;
  }
  // docx / pptx are ZIP packages
  if (strncmp($head, "PK\x03\x04", 4) !== 0) return false;
  // Fail closed. Without the zip extension the macro rejection and the zip-bomb guard below cannot
  // run at all, and a signature-only pass would silently drop both. Refuse the file instead.
  if (!class_exists('ZipArchive')) return false;
  $z = new ZipArchive();
  if ($z->open($path, ZipArchive::RDONLY) !== true) return false;
  $main = $ext === 'docx' ? 'word/document.xml' : 'ppt/presentation.xml';
  $macro = $ext === 'docx' ? 'word/vbaProject.bin' : 'ppt/vbaProject.bin';
  $ok = $z->numFiles > 0 && $z->numFiles <= 5000
     && $z->locateName('[Content_Types].xml') !== false
     && $z->locateName($main) !== false
     && $z->locateName($macro) === false;
  $total = 0;
  for ($i = 0; $ok && $i < $z->numFiles; $i++) {  // guard against zip bombs
    $s = $z->statIndex($i);
    $total += $s ? (int)$s['size'] : 0;
    if ($total > 500 * 1048576) $ok = false;
  }
  $z->close();
  return $ok;
}

$f = $_FILES['file'] ?? null;
if (!is_array($f) || is_array($f['error'] ?? null)) tt_json(400, ['error' => 'No file received.']);
if ($f['error'] === UPLOAD_ERR_INI_SIZE || $f['error'] === UPLOAD_ERR_FORM_SIZE) tt_json(413, ['error' => 'That file is too large.']);
if ($f['error'] !== UPLOAD_ERR_OK) tt_json(400, ['error' => 'The upload did not finish. Try again.']);
if (!is_uploaded_file($f['tmp_name'])) tt_json(400, ['error' => 'Bad request']);
$size = (int)$f['size'];
if ($size <= 0) tt_json(422, ['error' => 'That file is empty.']);
if ($size > $maxBytes) tt_json(413, ['error' => 'That file is over ' . intdiv($maxBytes, 1048576) . ' MB.']);

$orig = basename(str_replace('\\', '/', (string)($f['name'] ?? '')));
if (!mb_check_encoding($orig, 'UTF-8')) $orig = 'file';
$orig = trim((string)preg_replace('/[\x00-\x1f\x7f<>"]+/', '', $orig));
$ext = strtolower(pathinfo($orig, PATHINFO_EXTENSION));
if ($ext === 'jpeg') $ext = 'jpg';
if (!in_array($ext, UPLOAD_EXTS, true)) tt_json(415, ['error' => 'Only PDF, PPTX, DOCX, JPG and PNG files are allowed.']);
// Asserted here so a host missing the extension says so, instead of blaming the file (see content_ok).
if (($ext === 'docx' || $ext === 'pptx') && !class_exists('ZipArchive')) tt_json(500, ['error' => 'Office files cannot be checked on this server: the PHP zip extension is missing.']);
if (!content_ok($f['tmp_name'], $ext)) tt_json(415, ['error' => 'That file does not look like a valid .' . $ext . ' file.']);
$display = mb_substr($orig, 0, 120);

$dir = dirname(__DIR__) . '/data/uploads';
if (!is_dir($dir) && !@mkdir($dir, 0775, true) && !is_dir($dir)) tt_json(500, ['error' => 'Cannot create upload storage.']);
$used = 0;
foreach (glob($dir . '/*') ?: [] as $x) { if (is_file($x)) $used += (int)@filesize($x); }
if ($used + $size > $totalBytes) tt_json(507, ['error' => 'Upload storage is full.']);

$id = bin2hex(random_bytes(16)) . '.' . $ext;
$dest = $dir . '/' . $id;
if (!@move_uploaded_file($f['tmp_name'], $dest)) tt_json(500, ['error' => 'Could not save the file.']);
@chmod($dest, 0644);
tt_json(200, ['id' => $id, 'name' => $display, 'size' => $size]);
