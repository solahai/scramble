const fs = require('fs-extra');
const path = require('path');

const args = process.argv.slice(2);
const target = args[0]; // 'chrome', 'firefox', 'package', or undefined (all)

async function clean(dir) {
  await fs.remove(dir);
  await fs.ensureDir(dir);
}

async function buildChrome() {
  console.log('🔨 Building Chrome extension (MV3)...');
  const dir = 'dist/chrome';
  await clean(dir);
  await fs.copy('src', dir);
  await fs.copy('manifests/manifest_v3.json', path.join(dir, 'manifest.json'));
  // Remove files not needed in extension
  await fs.remove(path.join(dir, 'libs/tw-input.css'));
  console.log('✅ Chrome build complete → dist/chrome/');
}

async function buildFirefox() {
  console.log('🔨 Building Firefox extension (MV2)...');
  const dir = 'dist/firefox';
  await clean(dir);
  await fs.copy('src', dir);
  await fs.copy('manifests/manifest_v2.json', path.join(dir, 'manifest.json'));
  // Remove files not needed in extension
  await fs.remove(path.join(dir, 'libs/tw-input.css'));
  console.log('✅ Firefox build complete → dist/firefox/');
}

async function packageExtensions() {
  console.log('📦 Packaging extensions...');
  // For Chrome, create a zip
  const archiver = (() => {
    try { return require('archiver'); } catch { return null; }
  })();
  
  if (!archiver) {
    console.log('ℹ️  Install "archiver" package for zip packaging: npm i -D archiver');
    console.log('   For now, manually zip the dist/chrome and dist/firefox directories.');
    return;
  }

  for (const browser of ['chrome', 'firefox']) {
    const output = fs.createWriteStream(`dist/scramble-${browser}.zip`);
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.pipe(output);
    archive.directory(`dist/${browser}/`, false);
    await archive.finalize();
    console.log(`✅ Packaged → dist/scramble-${browser}.zip`);
  }
}

async function build() {
  console.log('');
  console.log('  🧩 Scramble Extension Builder');
  console.log('  ─────────────────────────────');
  console.log('');

  try {
    if (target === 'chrome') {
      await buildChrome();
    } else if (target === 'firefox') {
      await buildFirefox();
    } else if (target === 'package') {
      await buildChrome();
      await buildFirefox();
      await packageExtensions();
    } else {
      await buildChrome();
      await buildFirefox();
    }

    console.log('');
    console.log('  🎉 Build successful!');
    console.log('');
  } catch (error) {
    console.error('❌ Build failed:', error.message);
    process.exit(1);
  }
}

build();
