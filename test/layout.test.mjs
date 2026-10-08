import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
test('HTML rejects accidental section nesting before deployment',()=>{
 const cwd=fileURLToPath(new URL('../scripts/',import.meta.url));
 const result=execFileSync('python3',['-c',`from validate_html import validate
assert validate('<main><div class="hero"></main>'), 'Missing closing wrapper must fail'
assert not validate('<main><div></div><section></section></main>')
`],{cwd,encoding:'utf8'});assert.equal(result,'');
 const output=execFileSync('python3',['validate_html.py'],{cwd,encoding:'utf8'});assert.match(output,/explicitly balanced/);
});
