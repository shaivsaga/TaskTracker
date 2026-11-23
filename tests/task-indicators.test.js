import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.document = undefined;
globalThis.window = undefined;
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const { hasMeaningfulNotes } = await import('../js/tasks.js');

test('hasMeaningfulNotes detects meaningful text, images, and links while ignoring empty HTML', () => {
  assert.equal(hasMeaningfulNotes(''), false);
  assert.equal(hasMeaningfulNotes(null), false);
  assert.equal(hasMeaningfulNotes('<br>'), false);
  assert.equal(hasMeaningfulNotes('<div><br></div>'), false);
  assert.equal(hasMeaningfulNotes('<p>&nbsp;  &#160;</p>'), false);
  assert.equal(hasMeaningfulNotes('<p>  \u00a0 </p>'), false);
  assert.equal(hasMeaningfulNotes('Read chapter 4'), true);
  assert.equal(hasMeaningfulNotes('<p>Read <b>chapter 4</b></p>'), true);
  assert.equal(hasMeaningfulNotes('<img src="uploads/img_abc.png" alt="">'), true);
  assert.equal(hasMeaningfulNotes('<img src="data:image/png;base64,AAAA">'), true);
  assert.equal(hasMeaningfulNotes('<a href="https://example.com">Rubric</a>'), true);
  assert.equal(hasMeaningfulNotes('<a href="https://example.com"></a>'), true);
});
