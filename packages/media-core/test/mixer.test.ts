import { test, expect } from 'bun:test';
import { AudioMixer } from '../src/mixer';
test('film volume never changes voice, while member volume scales only that member voice', () => {
  const mix = new AudioMixer(); const levels = { a: 0, b: 0, film: 0 };
  mix.attach('mic-a', 'a', 'voice', { setVolume: v => { levels.a = v; } });
  mix.attach('mic-b', 'b', 'voice', { setVolume: v => { levels.b = v; } });
  mix.attach('film', 'a', 'screen', { setVolume: v => { levels.film = v; } });
  mix.voice(0.8); mix.screen(0.25); mix.member('a', 0.5);
  expect(levels).toEqual({ a: 0.4, b: 0.8, film: 0.25 });
  mix.attach('film-new', 'b', 'screen', { setVolume: v => { levels.film = v; } });
  expect(levels.film).toBe(0.25);
});
