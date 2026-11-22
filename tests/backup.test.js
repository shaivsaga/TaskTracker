import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
const SCRIPT = path.join(ROOT, 'deploy', 'backup.sh');

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('backup.sh creates a verified archive, rejects tampering, and restores safely', () => {
  const work = mkTmp('tt-backup-test-');
  try {
    const dataDir = path.join(work, 'data');
    const outDir = path.join(work, 'backups');
    const restoreDir = path.join(work, 'restored-data');

    fs.mkdirSync(path.join(dataDir, 'versions'), { recursive: true });
    fs.mkdirSync(path.join(dataDir, 'uploads'), { recursive: true });
    fs.mkdirSync(path.join(dataDir, 'admin'), { recursive: true });
    fs.mkdirSync(path.join(dataDir, 'sessions'), { recursive: true });
    fs.mkdirSync(path.join(dataDir, 'sections', 'b', 'versions'), { recursive: true });
    fs.mkdirSync(path.join(dataDir, 'sections', 'b', 'uploads'), { recursive: true });
    fs.mkdirSync(path.join(dataDir, 'sections', 'b', 'admin'), { recursive: true });
    fs.mkdirSync(path.join(dataDir, 'sections', 'b', 'sessions'), { recursive: true });
    fs.mkdirSync(path.join(dataDir, 'sections', 'b', 'transfers'), { recursive: true });

    const board = JSON.stringify({ publishedAt: 1700000000, tasks: [{ id: 't1', title: 'Read ch1' }], announcements: [] });
    const secBoard = JSON.stringify({ schemaVersion: 2, revision: 1, publishedAt: 1700000001, tasks: [{ id: 'tb1', title: 'Sec B' }], announcements: [], subjects: [], deletedTasks: [] });
    fs.writeFileSync(path.join(dataDir, 'current.json'), board);
    fs.writeFileSync(path.join(dataDir, 'versions', '1700000000.json'), board);
    fs.writeFileSync(path.join(dataDir, 'uploads', '0123456789abcdef0123456789abcdef.pdf'), '%PDF-1.4\n');
    fs.writeFileSync(path.join(dataDir, 'admin', 'state.json'), '{"bin":[]}');
    fs.writeFileSync(path.join(dataDir, 'sessions', 'secret-session.json'), '{"token":"ignored"}');
    fs.writeFileSync(path.join(dataDir, 'sections', 'b', 'current.json'), secBoard);
    fs.writeFileSync(path.join(dataDir, 'sections', 'b', 'versions', '1700000001.json'), secBoard);
    fs.writeFileSync(path.join(dataDir, 'sections', 'b', 'uploads', 'fedcba9876543210fedcba9876543210.pdf'), '%PDF-1.4\n');
    fs.writeFileSync(path.join(dataDir, 'sections', 'b', 'admin', 'state.json'), '{"bin":[]}');
    fs.writeFileSync(path.join(dataDir, 'sections', 'b', 'sessions', 'sec-session.json'), '{"token":"ignored"}');
    fs.writeFileSync(path.join(dataDir, 'sections', 'b', 'transfers', 'sec-xfer.json'), '{"payload":{}}');

    const out = execFileSync('bash', [SCRIPT, 'backup', dataDir, outDir], { encoding: 'utf8' });
    assert.match(out, /^BACKUP OK:/m);

    const files = fs.readdirSync(outDir);
    const archiveName = files.find((f) => f.endsWith('.tar.gz'));
    assert.ok(archiveName, 'expected .tar.gz archive in outDir');
    const archivePath = path.join(outDir, archiveName);
    const sumPath = `${archivePath}.sha256`;
    assert.ok(fs.existsSync(sumPath), 'expected .sha256 sidecar');

    const verifyOut = execFileSync('bash', [SCRIPT, 'verify', archivePath], { encoding: 'utf8' });
    assert.match(verifyOut, /^VERIFY OK:/m);

    const listing = execFileSync('tar', ['-tzf', archivePath], { encoding: 'utf8' });
    assert.match(listing, /current\.json/);
    assert.match(listing, /versions\/1700000000\.json/);
    assert.match(listing, /uploads\/0123456789abcdef0123456789abcdef\.pdf/);
    assert.match(listing, /admin\/state\.json/);
    assert.match(listing, /sections\/b\/current\.json/);
    assert.match(listing, /sections\/b\/versions\/1700000001\.json/);
    assert.match(listing, /sections\/b\/uploads\/fedcba9876543210fedcba9876543210\.pdf/);
    assert.match(listing, /sections\/b\/admin\/state\.json/);
    assert.doesNotMatch(listing, /sessions\//, 'transient sessions should not be backed up');
    assert.doesNotMatch(listing, /sections\/b\/sessions\//, 'transient section sessions should not be backed up');
    assert.doesNotMatch(listing, /sections\/b\/transfers\//, 'transient section transfers should not be backed up');

    // Restore into a populated directory and confirm pre-restore safety copy is preserved.
    fs.mkdirSync(restoreDir, { recursive: true });
    fs.writeFileSync(path.join(restoreDir, 'current.json'), '{"publishedAt":1,"tasks":[],"announcements":[]}');

    const restoreOut = execFileSync('bash', [SCRIPT, 'restore', archivePath, restoreDir], { encoding: 'utf8' });
    assert.match(restoreOut, /^RESTORE OK:/m);
    assert.equal(fs.readFileSync(path.join(restoreDir, 'current.json'), 'utf8'), board);
    assert.ok(fs.existsSync(path.join(restoreDir, 'admin', 'state.json')));
    assert.equal(fs.readFileSync(path.join(restoreDir, 'sections', 'b', 'current.json'), 'utf8'), secBoard);
    assert.ok(fs.existsSync(path.join(restoreDir, 'sections', 'b', 'admin', 'state.json')));
    assert.ok(!fs.existsSync(path.join(restoreDir, 'sections', 'b', 'sessions')));
    assert.ok(!fs.existsSync(path.join(restoreDir, 'sections', 'b', 'transfers')));
    assert.ok(
      fs.readdirSync(work).some((name) => name.startsWith('restored-data.pre-restore-')),
      'existing target data should be preserved in a .pre-restore-* directory',
    );

    // Tampered checksum must fail verification.
    fs.writeFileSync(sumPath, '0'.repeat(64) + '  ' + archiveName + '\n');
    assert.throws(
      () => execFileSync('bash', [SCRIPT, 'verify', archivePath], { stdio: 'pipe' }),
      /Checksum mismatch/,
    );
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
});
