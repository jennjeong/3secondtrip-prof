// FE/ 를 앱용 www/ 로 복사한다.
//  - 앱의 첫 화면은 index.html 이어야 해서 index-redesign.html 을 index.html 로 둔다.
//  - 앱 안에서는 서비스 워커를 쓰지 않으므로 sw.js 는 복사하지 않는다(코드에서도 등록을 건너뛴다).
//  - 웹 배포 전용 파일(vercel.json, 공개 코스 정적 페이지 생성물 등)은 뺀다.
import { cpSync, rmSync, renameSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const FE = join(here, '..', '..', 'FE');
const WWW = join(here, '..', 'www');
const SKIP = new Set(['sw.js', 'vercel.json', '.vercel', 'node_modules', '.env.local']);

rmSync(WWW, { recursive: true, force: true });
cpSync(FE, WWW, { recursive: true, filter: (src) => !SKIP.has(basename(src)) });
const from = join(WWW, 'index-redesign.html');
if (!existsSync(from)) throw new Error('FE/index-redesign.html 이 없어요');
renameSync(from, join(WWW, 'index.html'));
writeFileSync(join(WWW, 'app-build.txt'), new Date().toISOString() + '\n');
console.log('www 준비 완료:', WWW);
