'use strict';

// 서버 없이 휴대폰 등 어디서나 열어볼 수 있는 단일 HTML 데모를 만든다.
// 화면(public/)과 도메인 로직(src/catalog·assessment·finance)은 그대로 쓰고, /api 는 demo/mock-api.js 가 대신한다.
// 사용법: node scripts/build-demo.js [출력 경로]   (기본 dist/demo.html)
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const out = path.resolve(process.argv[2] || path.join(root, 'dist', 'demo.html'));

const logo = `data:image/png;base64,${fs.readFileSync(path.join(root, 'public/assets/pwc-logo.png')).toString('base64')}`;

const modules = ['catalog', 'assessment', 'finance']
  .map((name) => `__mods.${name} = (() => { const module = { exports: {} }; ${read(`src/${name}.js`)}\nreturn module.exports; })();`)
  .join('\n');

const scripts = [
  'window.FGS_DEMO = true;\nconst __mods = {};',
  modules,
  read('demo/mock-api.js'),
  `document.getElementById('demo-reset').addEventListener('click', async () => {
  await window.fgsDemoReset();
  location.reload();
});`,
  read('public/app.js'),
].join('\n;\n');

if (scripts.includes('</script')) throw new Error('인라인 스크립트에 </script 문자열이 있습니다.');

const body = read('public/index.html')
  .match(/<body>([\s\S]*)<\/body>/)[1]
  .replace(/<script[^>]*><\/script>/g, '')
  .replaceAll('/assets/pwc-logo.png', logo)
  .replace(
    '<header class="topbar">',
    `<div class="demo-banner">데모 모드 · 입력한 데이터는 이 기기의 브라우저에만 저장됩니다.<button type="button" class="link" id="demo-reset">데모 데이터 초기화</button></div>
    <header class="topbar">`,
  );

const html = `<title>재무성장지원서비스</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>
${read('public/styles.css')}
</style>
${body.trim()}
<script>
${scripts}
</script>
`;

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(`데모 생성: ${out} (${Math.round(html.length / 1024)}KB)`);
