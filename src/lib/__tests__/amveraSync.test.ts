import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  clearLatest1CSnapshot,
  extract1CPayloadFromRequest,
  readLatest1CSnapshot,
  resolve1CCachePaths,
  saveLatest1CSnapshot,
} from '../import1c/syncStorage';

test('Amvera deployment config, package.json scripts, and next.config.mjs low-RAM settings', async () => {
  const repoRoot = process.cwd();

  // 1. Check amvera.yml exists, has no UTF-8 BOM, no scriptName, and matches strict schema
  const amveraPath = path.join(repoRoot, 'amvera.yml');
  assert.equal(fs.existsSync(amveraPath), true, 'amvera.yml must exist at root');
  assert.equal(fs.existsSync(path.join(repoRoot, 'amvera(1).yml')), false);
  assert.equal(fs.existsSync(path.join(repoRoot, 'start.cjs')), false);

  const rawBytes = fs.readFileSync(amveraPath);
  const hasUtf8Bom =
    rawBytes.length >= 3 &&
    rawBytes[0] === 0xef &&
    rawBytes[1] === 0xbb &&
    rawBytes[2] === 0xbf;
  assert.equal(hasUtf8Bom, false, 'amvera.yml must be UTF-8 without BOM');

  const amveraText = rawBytes.toString('utf-8');
  assert.equal(amveraText.includes('scriptName'), false, 'scriptName must not be present');
  assert.ok(amveraText.includes('additionalCommands: npm run build'));
  assert.ok(amveraText.includes('command: npm run start'));
  assert.ok(amveraText.includes('containerPort: 3000'));

  // 2. Check package.json scripts
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf-8'));
  assert.equal(pkg.scripts.build, 'next build');
  assert.equal(pkg.scripts.start, 'next start -H 0.0.0.0 -p 3000');

  // 3. Check next.config.mjs low-RAM flags
  const nextConfigMod = await import(path.join(repoRoot, 'next.config.mjs'));
  const nextConfig = nextConfigMod.default;
  assert.equal(nextConfig.productionBrowserSourceMaps, false);
  assert.equal(nextConfig.typescript?.ignoreBuildErrors, true);
  assert.equal(nextConfig.eslint?.ignoreDuringBuilds, true);
  assert.equal(nextConfig.experimental?.cpus, 1);
  assert.equal(nextConfig.experimental?.workerThreads, false);
});

test('1C sync storage resolves /data/1c-cache on Linux volume, .cache locally, and guards Windows paths', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'amvera-1c-test-'));
  try {
    const fakeDataVolume = path.join(tmpRoot, 'data');
    const fakeCwd = path.join(tmpRoot, 'app');
    fs.mkdirSync(fakeDataVolume, { recursive: true });
    fs.mkdirSync(fakeCwd, { recursive: true });

    // Linux with /data mounted -> creates <volume>/1c-cache
    const amveraPaths = resolve1CCachePaths({
      platform: 'linux',
      cwd: fakeCwd,
      amveraVolumeRoot: fakeDataVolume,
      customCacheDir: '',
    });
    assert.equal(amveraPaths.usingAmveraVolume, true);
    assert.equal(amveraPaths.cacheDir, path.join(fakeDataVolume, '1c-cache'));
    assert.equal(fs.existsSync(amveraPaths.cacheDir), true);

    // Windows -> uses <cwd>/.cache even if /data directory exists
    const winPaths = resolve1CCachePaths({
      platform: 'win32',
      cwd: fakeCwd,
      amveraVolumeRoot: fakeDataVolume,
      customCacheDir: '',
    });
    assert.equal(winPaths.usingAmveraVolume, false);
    assert.equal(winPaths.cacheDir, path.join(fakeCwd, '.cache'));

    // Linux ignores accidental Windows drive path in customCacheDir and windowsExportPath
    const guardedLinux = resolve1CCachePaths({
      platform: 'linux',
      cwd: fakeCwd,
      amveraVolumeRoot: path.join(tmpRoot, 'nonexistent-data'),
      customCacheDir: 'C:\\Users\\Accountant\\Desktop\\1c-cache',
    });
    assert.equal(guardedLinux.cacheDir, path.join(fakeCwd, '.cache'));

    await clearLatest1CSnapshot({
      platform: 'linux',
      cwd: fakeCwd,
      amveraVolumeRoot: path.join(tmpRoot, 'nonexistent-data'),
    });

    const emptyRead = await readLatest1CSnapshot({
      platform: 'linux',
      cwd: fakeCwd,
      amveraVolumeRoot: path.join(tmpRoot, 'nonexistent-data'),
      windowsExportPath: 'C:\\Users\\Accountant\\1c_export.json',
    });
    assert.equal(emptyRead.connected, false);
    assert.equal(emptyRead.snapshot, null);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('POST /api/1c-sync payload extractor & storage supports raw JSON and multipart File uploads', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'amvera-post-test-'));
  try {
    const fakeVolume = path.join(tmpRoot, 'data');
    fs.mkdirSync(fakeVolume, { recursive: true });

    const samplePayload = JSON.stringify({
      Организация: {
        Наименование: 'ООО «ПромСинтез»',
        ИНН: '7701234567',
        КПП: '770101001',
      },
      Остатки: [
        { Счет: '51', СальдоНачальноеДт: 250000, СальдоКонечноеДт: 250000 },
        { Счет: '80.09', СальдоНачальноеКт: 250000, СальдоКонечноеКт: 250000 },
      ],
      Проводки: [],
      ВсеСправочники: {},
    });

    // 1. Direct JSON request with UTF-8 BOM
    const jsonReq = new Request('http://localhost:3000/api/1c-sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '\uFEFF' + samplePayload,
    });
    const extractedJson = await extract1CPayloadFromRequest(jsonReq);
    const saved = await saveLatest1CSnapshot(extractedJson.rawText, extractedJson.sourceLabel, {
      platform: 'linux',
      amveraVolumeRoot: fakeVolume,
    });
    assert.equal(saved.persistedToDisk, true);
    assert.equal(saved.snapshot.organization.name, 'ООО «ПромСинтез»');
    assert.equal(fs.existsSync(saved.paths.rawFile), true);
    assert.equal(fs.existsSync(saved.paths.latestFile), true);

    // Remove 1c_latest_raw.json to verify fallback read from 1c_latest.json
    fs.rmSync(saved.paths.rawFile);
    const fromLatestOnly = await readLatest1CSnapshot({
      platform: 'linux',
      amveraVolumeRoot: fakeVolume,
    });
    assert.equal(fromLatestOnly.connected, true);
    assert.equal(fromLatestOnly.snapshot?.organization.inn, '7701234567');

    // 2. Multipart browser File upload
    const form = new FormData();
    form.append(
      'file',
      new File([samplePayload], '1c_export.json', { type: 'application/json' })
    );
    const multipartReq = new Request('http://localhost:3000/api/1c-sync', {
      method: 'POST',
      body: form,
    });
    const extractedFile = await extract1CPayloadFromRequest(multipartReq);
    assert.equal(extractedFile.sourceLabel, '1c_export.json');
    assert.ok(extractedFile.rawText.includes('ПромСинтез'));

    await clearLatest1CSnapshot({
      platform: 'linux',
      amveraVolumeRoot: fakeVolume,
    });
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
