/**
 * Sanity checks on the SUPPLIED assets.
 *
 * These are the only files in the project that were authored elsewhere, and
 * none of them may be modified: a silent change should produce a loud failure
 * here rather than a character that animates wrongly weeks later.
 *
 * Everything else the game draws and every other noise it makes is generated
 * at runtime, which is why this list is short and why it stays short.
 */
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

/**
 * Known-good digests of the assets as supplied.
 *
 * `base_rig.fbx` is byte-identical to `player.fbx` on purpose; only
 * `player.fbx` is ever loaded, and the build prunes the other from `dist`.
 */
const EXPECTED = [
  { path: 'assets/player/player.fbx', md5: '4211d040bb7098791816ad92a0accaaa' },
  { path: 'assets/player/base_rig.fbx', md5: '4211d040bb7098791816ad92a0accaaa' },
  { path: 'assets/player/green.png', md5: '67421b6f13962ead111335ff50bf58fe' },
  // The seven HUD icons, used at their real aspect ratios and never
  // regenerated. `shoe.png` is the Speed icon; `inventory.png` the Backpack's.
  { path: 'assets/ui/trophy.png', md5: 'e57cb95031c6a5feb6142eb05b53e7c1' },
  { path: 'assets/ui/rebirth.png', md5: '022dccdad65f256a546d2a14baf7512a' },
  { path: 'assets/ui/trail.png', md5: 'fb6c8242f2f61c64569c7cce49879652' },
  { path: 'assets/ui/shoe.png', md5: 'c5305c2301b18df2d2b4f5f57ccf5fb7' },
  { path: 'assets/ui/aura.png', md5: 'f30df632e885addc0eeae9ca2753fe9c' },
  { path: 'assets/ui/inventory.png', md5: '012b566b91c89168b5e3b0f10fe692f1' },
  { path: 'assets/ui/shop.png', md5: 'baf5b63cba7737b79dd63478a11768fa' },
  // The three sounds. The track is the single largest file in the build. Its
  // name carries a capital B as supplied; it is referenced exactly so.
  { path: 'assets/audio/Background.mp3', md5: '1f1d91a0649db55386b984c3b55422a3' },
  { path: 'assets/audio/jump.mp3', md5: '77c58db6921be7b0c7a61903d38bbf30' },
  { path: 'assets/audio/death.mp3', md5: 'a6c361490b027a8effd0ac861936a5a7' },
];

let failures = 0;

for (const asset of EXPECTED) {
  const full = new URL(asset.path, `file://${root.replace(/\\/g, '/')}`);
  let bytes;
  try {
    bytes = readFileSync(full);
  } catch {
    console.error(`  FAIL  ${asset.path} is missing`);
    failures += 1;
    continue;
  }
  const digest = createHash('md5').update(bytes).digest('hex');
  const size = statSync(full).size;
  if (digest !== asset.md5) {
    console.error(`  FAIL  ${asset.path} has changed (${digest})`);
    failures += 1;
  } else {
    console.log(`  ok    ${asset.path} (${size} bytes)`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} asset problem(s). The supplied files must never be modified.`);
  process.exit(1);
}
console.log('\nassets OK');
