import { z } from 'zod';
import type { DesktopSettings } from '@cinegather/contracts';
export const settingsSchema = z.strictObject({ minimizeToTray: z.boolean(), pushToTalk: z.boolean(), pttShortcut: z.string().min(1).max(64), muteShortcut: z.string().min(1).max(64), quality: z.enum(['saver', 'cinema', 'game']), inputDevice: z.string().max(256), outputDevice: z.string().max(256) });
export const defaultSettings: DesktopSettings = { minimizeToTray: true, pushToTalk: false, pttShortcut: 'CommandOrControl+Shift+Space', muteShortcut: 'CommandOrControl+Shift+M', quality: 'cinema', inputDevice: '', outputDevice: '' };
