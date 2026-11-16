/**
 * Saved state in localStorage (GDD §2): settings now; cup in progress, history, records and
 * album from F6. Versioned and validated: a corrupt or outdated save resets only what is
 * broken and never stops the game.
 */
import { z } from 'zod';

const KEY = 'wis:save';
export const SAVE_VERSION = 1;

export const QUALITY_CHOICES = ['auto', 'alta', 'media', 'baja'] as const;
export type QualityChoice = (typeof QUALITY_CHOICES)[number];

const SettingsSchema = z.object({
  quality: z.enum(QUALITY_CHOICES).default('auto'),
  padMode: z.enum(['flotante', 'fijo']).default('flotante'),
  /** Left-handed layout: pad on the right, buttons on the left. */
  swapSides: z.boolean().default(false),
  /** Touch controls size multiplier. */
  controlScale: z.number().min(0.7).max(1.4).default(1),
  vibration: z.boolean().default(true),
  autoSwitchDefender: z.boolean().default(true),
  sound: z.boolean().default(true),
  /** Background of water and crowd: normal, low or none. */
  ambience: z.enum(['normal', 'bajo', 'no']).default('normal'),
  difficulty: z.enum(['facil', 'normal', 'dificil']).default('normal'),
});
export type Settings = z.infer<typeof SettingsSchema>;

const SaveSchema = z.object({
  version: z.literal(SAVE_VERSION),
  settings: SettingsSchema.default(() => SettingsSchema.parse({})),
  /** Filled in from F6. Kept as opaque records so older saves stay readable. */
  cup: z.unknown().nullable().default(null),
  history: z.array(z.unknown()).default(() => []),
  records: z.record(z.string(), z.unknown()).default(() => ({})),
  album: z.record(z.string(), z.unknown()).default(() => ({})),
});
export type SaveData = z.infer<typeof SaveSchema>;

export function defaultSave(): SaveData {
  return SaveSchema.parse({ version: SAVE_VERSION });
}

/** Parses a stored save, keeping every part that is still valid. */
export function parseSave(raw: string | null): SaveData {
  if (raw === null) return defaultSave();
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return defaultSave();
  }
  if (typeof json !== 'object' || json === null) return defaultSave();
  const source = json as Record<string, unknown>;
  const full = SaveSchema.safeParse({ ...source, version: SAVE_VERSION });
  if (full.success) return full.data;

  // Salvage section by section instead of throwing everything away.
  const save = defaultSave();
  const base = defaultSave().settings as Record<string, unknown>;
  const stored = (typeof source.settings === 'object' && source.settings !== null ? source.settings : {}) as Record<string, unknown>;
  for (const key of Object.keys(base)) {
    const attempt = SettingsSchema.safeParse({ ...save.settings, [key]: stored[key] });
    if (stored[key] !== undefined && attempt.success) save.settings = attempt.data;
  }
  for (const key of ['history', 'records', 'album', 'cup'] as const) {
    const attempt = SaveSchema.safeParse({ ...save, [key]: source[key] });
    if (source[key] !== undefined && attempt.success) Object.assign(save, { [key]: attempt.data[key] });
  }
  return save;
}

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** In-memory fallback for when localStorage is blocked (private mode, some file:// setups). */
export function memoryStore(): KeyValueStore {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

function browserStore(): KeyValueStore {
  try {
    const store = globalThis.localStorage;
    const probe = 'wis:probe';
    store.setItem(probe, '1');
    store.removeItem(probe);
    return store;
  } catch {
    return memoryStore();
  }
}

export class SaveStore {
  private data: SaveData;
  private readonly listeners = new Set<(data: SaveData) => void>();

  constructor(private readonly store: KeyValueStore = browserStore()) {
    let raw: string | null = null;
    try {
      raw = this.store.getItem(KEY);
    } catch {
      raw = null;
    }
    this.data = parseSave(raw);
  }

  get(): SaveData {
    return this.data;
  }

  get settings(): Settings {
    return this.data.settings;
  }

  update(change: (draft: SaveData) => void): void {
    const draft = structuredClone(this.data);
    change(draft);
    this.data = draft;
    try {
      this.store.setItem(KEY, JSON.stringify(draft));
    } catch {
      // Storage full or blocked: the session keeps working with the in-memory copy.
    }
    for (const listener of this.listeners) listener(draft);
  }

  setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
    this.update((draft) => {
      draft.settings[key] = value;
    });
  }

  /** Erases everything except nothing: back to a fresh install. */
  reset(): void {
    this.data = defaultSave();
    try {
      this.store.removeItem(KEY);
    } catch {
      // Nothing to do.
    }
    for (const listener of this.listeners) listener(this.data);
  }

  subscribe(listener: (data: SaveData) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
