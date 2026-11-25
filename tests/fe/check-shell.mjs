// 실행: node tests/fe/check-shell.mjs — FE/js 파일이 문법에 맞고, 서비스 워커의 SHELL 목록에 빠짐없이 있는지 본다.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const FE = fileURLToPath(new URL('../../FE/', import.meta.url));
const shell = [...readFileSync(FE + 'sw.js', 'utf8').match(/const SHELL = \[([\s\S]*?)\];/)[1].matchAll(/'(\/[^']+)'/g)].map(m => m[1]);
const bad = shell.filter(p => !existsSync(FE + p.slice(1))).map(p => `SHELL 에 있지만 파일이 없음: ${p}`);
const files = readdirSync(FE + 'js').filter(f => f.endsWith('.js'));
const all = readFileSync(FE + 'index-redesign.html', 'utf8') + files.map(f => readFileSync(FE + 'js/' + f, 'utf8')).join('\n');
for (const f of files) {
  if (!all.includes(`/${f}`)) continue;             // 어디에서도 불러오지 않는 파일
  if (!shell.includes(`/js/${f}`)) bad.push(`SHELL 에 없음: /js/${f}`);
  try { execFileSync(process.execPath, ['--input-type=module', '--check'], { input: readFileSync(FE + 'js/' + f), stdio: ['pipe', 'pipe', 'pipe'] }); }
  catch (e) { bad.push(`문법 오류 ${f}: ${String(e.stderr).split('\n').slice(0, 5).join(' ')}`); }
}
if (bad.length) { console.error(bad.join('\n')); process.exit(1); }
console.log(`SHELL ${shell.length}개 확인`);
