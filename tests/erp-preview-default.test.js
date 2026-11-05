import test from 'node:test';
import assert from 'node:assert/strict';
import { wantsErpPreview } from '../src/erp-client.js';

const NETLIFY = 'prorack-move.netlify.app';

test('Netlify addresses open the ERP preview by default', () => {
  assert.equal(wantsErpPreview({ hostname: NETLIFY }), true);
  assert.equal(wantsErpPreview({ hostname: 'deploy-preview-3--prorack-move.netlify.app' }), true);
});

test('the older demo stays reachable on Netlify', () => {
  assert.equal(wantsErpPreview({ hostname: NETLIFY, search: '?demo=1' }), false);
  assert.equal(wantsErpPreview({ hostname: NETLIFY, hash: '#demo' }), false);
});

test('an explicit preview request wins everywhere', () => {
  assert.equal(wantsErpPreview({ hostname: 'localhost', search: '?preview=erp' }), true);
  assert.equal(wantsErpPreview({ hostname: 'localhost', hash: '#preview-erp' }), true);
  assert.equal(wantsErpPreview({ hostname: NETLIFY, search: '?preview=erp&demo=1' }), true);
});

test('local and Convex hosting never start the preview on their own', () => {
  assert.equal(wantsErpPreview({ hostname: 'localhost' }), false);
  assert.equal(wantsErpPreview({ hostname: '127.0.0.1' }), false);
  assert.equal(wantsErpPreview({ hostname: 'happy-otter-123.convex.site' }), false);
});

test('only real netlify.app hosts match', () => {
  assert.equal(wantsErpPreview({ hostname: 'netlify.app.example.com' }), false);
  assert.equal(wantsErpPreview({ hostname: 'notnetlify.app' }), false);
  assert.equal(wantsErpPreview({ search: '?preview=other' }), false);
  assert.equal(wantsErpPreview(), false);
});
