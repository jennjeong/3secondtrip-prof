// 앱 아이콘·시작 화면 이미지를 FE/assets 의 원본으로 만든다(macOS sips 사용).
//  node scripts/make-icons.mjs <아이콘 1024px PNG(꽉 찬 정사각형)> [시작 화면용 로고 PNG(둥근 모서리, 배경색 위)]
//  - iOS: AppIcon(1024, 투명 없음) · Splash(2732², 가운데 로고)
//  - Android: mipmap 아이콘 5종 · 시작 화면 splash.png(각 폴더 크기에 맞춤)
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync, copyFileSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const APP = join(here, '..');
const src = process.argv[2];
const splashSrc = process.argv[3];
if (!src) throw new Error('아이콘 PNG 경로를 넣어 주세요');
const BG = 'F7F8FA';
const tmp = mkdtempSync(join(tmpdir(), 'tst-icons-'));
const sips = (...a) => execFileSync('sips', a, { stdio: 'ignore' });
const dims = (f) => {
  const out = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', f]).toString();
  return [Number(/pixelWidth: (\d+)/.exec(out)[1]), Number(/pixelHeight: (\d+)/.exec(out)[1])];
};

// 투명 없는 1024 아이콘(jpeg 을 거쳐 알파 제거)
const flat = join(tmp, 'flat.png');
sips('-s', 'format', 'jpeg', '-z', '1024', '1024', src, '--out', join(tmp, 'flat.jpg'));
sips('-s', 'format', 'png', join(tmp, 'flat.jpg'), '--out', flat);
copyFileSync(flat, join(APP, 'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png'));

// 시작 화면: 가운데 로고(짧은 변의 약 18%) + 앱 배경색
function splash(out, w, h) {
  const logo = Math.round(Math.min(w, h) * 0.18);
  const f = join(tmp, `s-${w}x${h}.png`);
  sips('-z', String(logo), String(logo), splashSrc || flat, '--out', f);
  sips('--padToHeightWidth', String(h), String(w), '--padColor', BG, f, '--out', out);
}
for (const n of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png']) {
  splash(join(APP, 'ios/App/App/Assets.xcassets/Splash.imageset', n), 2732, 2732);
}

// Android
const RES = join(APP, 'android/app/src/main/res');
for (const d of readdirSync(RES)) {
  const dir = join(RES, d);
  if (!statSync(dir).isDirectory()) continue;
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (f === 'splash.png') { const [w, h] = dims(p); splash(p, w, h); }
    if (/^ic_launcher(_round)?\.png$/.test(f)) { const [w] = dims(p); sips('-z', String(w), String(w), flat, '--out', p); }
    if (f === 'ic_launcher_foreground.png') {
      // 적응형 아이콘: 바깥 1/6 은 잘리므로 가운데 2/3 에 그림이 오도록 — 꽉 찬 아이콘은 그대로 채운다
      const [w] = dims(p); sips('-z', String(w), String(w), flat, '--out', p);
    }
  }
}
console.log('아이콘·시작 화면 이미지를 만들었어요');
