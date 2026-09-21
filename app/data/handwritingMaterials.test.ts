import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HANDWRITING_FILE_NAMES, HANDWRITING_PACKAGE_FORMAT, validateHandwritingPackage, handwritingMaterialPath } from './handwritingMaterials.ts';
const files = HANDWRITING_FILE_NAMES.map(name => ({name,mimeType:name==='workbook.pdf'?'application/pdf':'image/webp',base64:'YQ==',sha256:'a'.repeat(64)}));
test('private handwriting bundle accepts complete structure and rejects paths, duplicates, missing files and invalid payloads',()=>{
 const pack={format:HANDWRITING_PACKAGE_FORMAT,files};assert.equal(validateHandwritingPackage(pack).files.length,54);
 for(const changed of [files.slice(1),[files[0],...files.slice(0,-1)],[{...files[0],name:'../workbook.pdf'},...files.slice(1)],[{...files[0],base64:'!bad'},...files.slice(1)]])assert.throws(()=>validateHandwritingPackage({...pack,files:changed}));
 assert.throws(()=>handwritingMaterialPath('not-an-owner','workbook.pdf'));
 assert.throws(()=>handwritingMaterialPath('11111111-1111-1111-1111-111111111111','../../workbook.pdf'));
 assert.equal(handwritingMaterialPath('11111111-1111-1111-1111-111111111111','workbook.pdf'),'11111111-1111-1111-1111-111111111111/learning/film-v1/workbook.pdf');
});
