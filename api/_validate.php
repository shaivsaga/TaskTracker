<?php
declare(strict_types=1);
// Shared validators. Loaded by api/publish.php and transfer.php, and by tests/php/run.php.

// Announcement formatting: only <b> <i> <ul> <li> <br>, no attributes, balanced, text escaped as &amp; &lt; &gt; only. Anything else is rejected, never rewritten.
function announce_html_ok($h) {
  if (!is_string($h) || strlen($h) > 8000 || !mb_check_encoding($h, 'UTF-8')) return false;
  $stack = [];
  foreach (preg_split('/(<[^<>]*>)/', $h, -1, PREG_SPLIT_DELIM_CAPTURE) as $p) {
    if ($p === '') continue;
    if ($p[0] === '<') {
      if ($p === '<br>') continue;
      if (!preg_match('/^<(\/?)(b|i|ul|li)>$/D', $p, $m)) return false;
      if ($m[1] === '') { $stack[] = $m[2]; if (count($stack) > 20) return false; }
      elseif (array_pop($stack) !== $m[2]) return false;
    } elseif (strpbrk($p, '<>') !== false || preg_match('/&(?!(?:amp|lt|gt);)/', $p)) {
      return false;
    }
  }
  return !$stack;
}

// Rebuilds the transfer payload from a strict whitelist. Returns null if anything is off.
function clean_payload($p) {
    if (!is_array($p) || ($p['v'] ?? null) !== 1) return null;
    $pr = $p['progress'] ?? null;
    if (!is_array($pr) || count($pr) > 5000) return null;
    $progress = [];
    foreach ($pr as $id => $e) {
        $id = (string)$id;
        if ($id === '__proto__' || !preg_match('/^[\w.\-]{1,100}$/', $id)) return null;
        if (!is_array($e)) return null;
        $st = $e['status'] ?? null;
        $mv = $e['movedAt'] ?? null;
        if (!in_array($st, ['not_started', 'in_progress', 'done'], true)) return null;
        if ((!is_int($mv) && !is_float($mv)) || $mv < 0 || $mv > 4102444800000) return null;
        $progress[$id] = ['status' => $st, 'movedAt' => (int)round($mv)];
    }
    $clean = ['v' => 1, 'progress' => (object)$progress];
    if (array_key_exists('draft', $p) && $p['draft'] !== null) {
        $d = $p['draft'];
        if (!is_array($d)) return null;
        $tasks = $d['tasks'] ?? null;
        $ann   = $d['announcements'] ?? [];
        if (!is_array($tasks) || !is_array($ann) || count($tasks) > 2000 || count($ann) > 200) return null;
        // Same per-field rules the publish path applies (publish.php:30-54), so a transfer can no
        // longer carry a field the publish endpoint would have refused. The count caps stay looser
        // here (2000/200 vs publish's 300/100) — deliberate, since a transfer carries a saved draft
        // rather than a publish. The html check is the one that matters: the client re-sanitises on
        // every render, but the server must not be relying on that. Anything that fails here is
        // rejected, never rewritten.
        foreach ($tasks as $t) {
            if (!is_array($t)) return null;
            if (!is_string($t['id'] ?? null) || $t['id'] === '' || strlen($t['id']) > 64) return null;
            if (isset($t['title']) && (!is_string($t['title']) || mb_strlen($t['title']) > 500)) return null;
            foreach (['notes', 'subject'] as $k) if (isset($t[$k]) && !is_string($t[$k])) return null;
            if (isset($t['subject']) && strlen($t['subject']) > 32) return null;
            if (isset($t['dueDate']) && (!is_string($t['dueDate']) || !preg_match('/^\d{4}-\d{2}-\d{2}$/D', $t['dueDate']))) return null;
            if (isset($t['dueTime']) && (!is_string($t['dueTime']) || !preg_match('/^([01]\d|2[0-3]):[0-5]\d$/D', $t['dueTime']))) return null;
            if (isset($t['files'])) {
                if (!is_array($t['files']) || count($t['files']) > 10) return null;
                foreach ($t['files'] as $f) {
                    if (!is_array($f) || !is_string($f['id'] ?? null) || !preg_match('/^[a-f0-9]{32}\.(pdf|pptx|docx|jpg|png)$/D', $f['id'])
                        || !is_string($f['name'] ?? null) || mb_strlen($f['name']) > 120 || !is_int($f['size'] ?? null) || $f['size'] < 0) return null;
                }
            }
        }
        foreach ($ann as $a) {
            if (!is_array($a) || !is_string($a['text'] ?? null) || mb_strlen($a['text']) > 500 || !is_numeric($a['createdAt'] ?? null)) return null;
            if (isset($a['html']) && !announce_html_ok($a['html'])) return null;
        }
        $clean['draft'] = ['tasks' => array_values($tasks), 'announcements' => array_values($ann)];
    }
    return $clean;
}