import { describe, expect, it } from 'vitest';
import { parsePlaylistId } from './playlist';

const ID = 'PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG';

describe('parsePlaylistId', () => {
  it('accepts a bare id', () => {
    expect(parsePlaylistId(ID)).toBe(ID);
    expect(parsePlaylistId(`  ${ID}\n`)).toBe(ID);
    expect(parsePlaylistId('OLAK5uy_kQ2gW7m3dJp9xYzABCDEFGHIJKLMNOPQ')).toBe('OLAK5uy_kQ2gW7m3dJp9xYzABCDEFGHIJKLMNOPQ');
  });

  it('accepts a playlist URL', () => {
    expect(parsePlaylistId(`https://www.youtube.com/playlist?list=${ID}`)).toBe(ID);
    expect(parsePlaylistId(`youtube.com/playlist?list=${ID}`)).toBe(ID);
    expect(parsePlaylistId(`https://m.youtube.com/playlist?list=${ID}&si=abc`)).toBe(ID);
    expect(parsePlaylistId(`https://music.youtube.com/playlist?list=${ID}`)).toBe(ID);
  });

  it('accepts a watch URL or short link with list=', () => {
    expect(parsePlaylistId(`https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=${ID}&index=3`)).toBe(ID);
    expect(parsePlaylistId(`https://youtu.be/dQw4w9WgXcQ?list=${ID}`)).toBe(ID);
  });

  it('rejects empty, plain videos and other sites', () => {
    expect(parsePlaylistId('')).toBeNull();
    expect(parsePlaylistId('   ')).toBeNull();
    expect(parsePlaylistId(null)).toBeNull();
    expect(parsePlaylistId(undefined)).toBeNull();
    expect(parsePlaylistId('dQw4w9WgXcQ')).toBeNull(); // a video id, not a playlist
    expect(parsePlaylistId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(parsePlaylistId(`https://example.com/playlist?list=${ID}`)).toBeNull();
    expect(parsePlaylistId('my favourite songs')).toBeNull();
    expect(parsePlaylistId('https://www.youtube.com/playlist?list=<script>')).toBeNull();
  });
});
