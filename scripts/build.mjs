import {execFileSync} from 'node:child_process';
import {cpSync,mkdirSync,rmSync} from 'node:fs';
execFileSync(process.execPath,['scripts/verify.mjs'],{stdio:'inherit'});
rmSync('dist',{recursive:true,force:true});
mkdirSync('dist/src/assets',{recursive:true});
cpSync('index.html','dist/index.html');
for(const file of ['app.js','art.js','data.js','icons.js','logic.js','store.js','ui.js','time-picker.js','policy.js','entitlements.js','policy-ui.js','styles.css','premium.css'])cpSync(`src/${file}`,`dist/src/${file}`);
cpSync('src/assets','dist/src/assets',{recursive:true});
console.log('Static release generated in dist/. Run npm run dev for the editable local preview.');
