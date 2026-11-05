import {execFileSync} from 'node:child_process';
import {cpSync,mkdirSync,rmSync,readdirSync} from 'node:fs';
execFileSync(process.execPath,['scripts/verify.mjs'],{stdio:'inherit'});
rmSync('dist',{recursive:true,force:true});
mkdirSync('dist/src',{recursive:true});
cpSync('index.html','dist/index.html');
// Every browser module and stylesheet in src/ (so new modules are never left out of the build).
for(const file of readdirSync('src'))if(/\.(js|css)$/.test(file))cpSync(`src/${file}`,`dist/src/${file}`);
// Only the artwork the app references (the SVG illustrations are unused).
mkdirSync('dist/src/assets',{recursive:true});
for(const file of readdirSync('src/assets'))if(/\.(jpg|png|svg)$/.test(file))cpSync(`src/assets/${file}`,`dist/src/assets/${file}`);
cpSync('src/assets/generated','dist/src/assets/generated',{recursive:true});
// The /api logic is shared with the opt-in browser preview (?preview=erp).
mkdirSync('dist/convex/lib',{recursive:true});
for(const file of readdirSync('convex/lib'))if(file.endsWith('.js'))cpSync(`convex/lib/${file}`,`dist/convex/lib/${file}`);
console.log('Static release generated in dist/. Run npm run dev for the editable local preview.');
