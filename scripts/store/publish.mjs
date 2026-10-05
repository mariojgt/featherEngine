/** Publish free packages with the signed-in Supabase CLI; update catalog only after verification. */
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { cacheDir, packagePath, sha256, storeRoot, validateCatalog } from './files.mjs';

const config = JSON.parse(await readFile(resolve(storeRoot, 'store.config.json'), 'utf8'));
const catalog = validateCatalog(JSON.parse(await readFile(resolve(cacheDir, 'catalog.json'), 'utf8')));
const dryRun = process.argv.includes('--dry-run');
const base = new URL(config.publicBaseUrl);
if (base.href !== `https://${config.projectRef}.supabase.co/storage/v1/object/public/${config.bucket}/`) {
  throw new Error('Store URL does not match the configured Supabase project and bucket.');
}

// Fully validate and prepare the publication before making any cloud changes.
const objects = [];
const packages = [];
for (const entry of catalog.packages) {
  if (config.websiteSlugs.includes(entry.slug) && (entry.previewStatus !== 'verified' || !entry.screenshots?.length)) {
    throw new Error(`${entry.slug}: capture and review the current package before featuring it. Run store:capture, then build:store.`);
  }
  const bytes = await readFile(resolve(cacheDir, packagePath(entry)));
  const hash = sha256(bytes);
  const folder = packagePath(entry).split('/')[1];
  const key = `packages/${folder}/${entry.slug}/${hash}.nfpack`;
  objects.push({ key, bytes, type: 'application/octet-stream' });
  const imageUrl = (input) => {
    const data = typeof input === 'string' && input.match(/^data:(image\/(?:png|jpeg|svg\+xml|webp));base64,(.+)$/s);
    if (!data) {
      if (input && !input.startsWith(base.href)) throw new Error(`Unmanaged preview URL for ${entry.slug}.`);
      return input;
    }
    const image = Buffer.from(data[2], 'base64');
    const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/svg+xml': 'svg', 'image/webp': 'webp' }[data[1]];
    const imageKey = `previews/${entry.slug}/${sha256(image)}.${extension}`;
    objects.push({ key: imageKey, bytes: image, type: data[1] });
    return new URL(imageKey, base).href;
  };
  const thumbnail = imageUrl(entry.thumbnail);
  const screenshots = (entry.screenshots ?? []).map(screenshot => ({ ...screenshot, url: imageUrl(screenshot.url) }));
  packages.push({ ...entry, thumbnail, screenshots, previewStatus: undefined, sizeBytes: bytes.length, sha256: hash,
    downloadUrl: new URL(key, base).href, websiteVisible: config.websiteSlugs.includes(entry.slug) });
}
const uniqueObjects = [...new Map(objects.map(object => [object.key, object])).values()];
console.log(`${dryRun ? 'Plan' : 'Publishing'}: ${packages.length} free packages, ${uniqueObjects.length} objects → ${config.bucket}`);
if (dryRun) process.exit(0);

const cli = (args) => execFileSync('supabase', args, { cwd: storeRoot, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 4 * 1024 * 1024 });
const linkedRef = await readFile(resolve(storeRoot, 'supabase/.temp/project-ref'), 'utf8').catch(() => '');
if (linkedRef.trim() !== config.projectRef) throw new Error('Link the configured project with supabase link before publishing.');
// Server credentials stay in memory. Never write them to env files, a catalog, or CLI arguments.
const keys = JSON.parse(cli(['projects', 'api-keys', '--project-ref', config.projectRef, '--output', 'json']));
const serverKey = keys.find((entry) => entry.name === 'service_role')?.api_key;
if (!serverKey) throw new Error('The CLI account cannot access the project server key.');
const headers = { apikey: serverKey, Authorization: `Bearer ${serverKey}`, 'Content-Type': 'application/json' };
const storage = `https://${config.projectRef}.supabase.co/storage/v1`;
const bucketResponse = await fetch(`${storage}/bucket/${config.bucket}`, { headers });
if (bucketResponse.ok) {
  if (!(await bucketResponse.json()).public) throw new Error('Existing store bucket is private; refusing to change its access.');
} else if (bucketResponse.status === 400 || bucketResponse.status === 404) {
  const created = await fetch(`${storage}/bucket`, { method: 'POST', headers, body: JSON.stringify({
    id: config.bucket, name: config.bucket, public: true, file_size_limit: 50 * 1024 * 1024,
    allowed_mime_types: ['application/octet-stream', 'application/json', 'image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'],
  }) });
  if (!created.ok) throw new Error(`Bucket creation failed (HTTP ${created.status}).`);
} else throw new Error(`Bucket inspection failed (HTTP ${bucketResponse.status}).`);

async function upload(object, mutable = false) {
  const url = new URL(object.key, base);
  // Immutable content-addressed objects are reusable; never replace an existing different object.
  if (!mutable) {
    const current = await fetch(url, { signal: AbortSignal.timeout(120000) });
    if (current.ok) {
      if (sha256(Buffer.from(await current.arrayBuffer())) !== sha256(object.bytes)) throw new Error(`Remote checksum mismatch: ${object.key}`);
      return;
    }
    if (![400, 404].includes(current.status)) throw new Error(`Could not inspect ${object.key} (HTTP ${current.status}).`);
  }
  const file = resolve(cacheDir, 'upload.tmp');
  await writeFile(file, object.bytes);
  if (mutable) {
    // CLI cp is create-only. A catalog is the single mutable object; upsert it through Storage.
    const result = await fetch(`${storage}/object/${config.bucket}/${object.key}`, {
      method: 'POST', headers: { ...headers, 'Content-Type': object.type, 'x-upsert': 'true', 'Cache-Control': 'max-age=60' },
      body: object.bytes, signal: AbortSignal.timeout(120000),
    });
    if (!result.ok) throw new Error(`Catalog publication failed (HTTP ${result.status}).`);
    url.searchParams.set('publication', sha256(object.bytes));
  } else {
    try {
      cli(['storage', 'cp', file, `ss:///${config.bucket}/${object.key}`, '--experimental', '--yes',
        '--content-type', object.type, '--cache-control', 'max-age=31536000']);
    } catch { throw new Error(`Supabase CLI upload failed for ${object.key}. No local catalog was changed.`); }
  }
  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(120000) });
  if (!response.ok || sha256(Buffer.from(await response.arrayBuffer())) !== sha256(object.bytes)) {
    throw new Error(`Public download verification failed for ${object.key}.`);
  }
  console.log(`Verified ${object.key}`);
}
for (const object of uniqueObjects) await upload(object);
const published = { ...catalog, updatedAt: new Date().toISOString(), packages };
const json = `${JSON.stringify(published, null, 2)}\n`;
await upload({ key: 'catalog.json', bytes: Buffer.from(json), type: 'application/json' }, true);
await mkdir(resolve(storeRoot, 'public/store'), { recursive: true });
await writeFile(resolve(storeRoot, 'public/store/catalog.json'), json);
console.log(`Published and verified ${new URL('catalog.json', base)}. Run the website's sync:store next.`);
