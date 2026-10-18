import { test, expect } from 'bun:test';
import { trustedURL, allowedExternal } from '../src/main/security';
test('IPC trust compares origin and rejects lookalike hosts and privileged external protocols', () => {
  expect(trustedURL('https://localhost:5173.evil.test/', 'http://localhost:5173')).toBe(false);
  expect(trustedURL('http://localhost:5173/?next=evil', 'http://localhost:5173')).toBe(true);
  expect(trustedURL('app://cinegather/index.html')).toBe(true);
  expect(trustedURL('app://cinegather.evil/index.html')).toBe(false);
  expect(allowedExternal('file:///etc/passwd')).toBe(false);
  expect(allowedExternal('javascript:alert(1)')).toBe(false);
  expect(allowedExternal('https://example.com')).toBe(true);
});
