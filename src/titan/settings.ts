import type { ProjectVariable, Scene, SceneObject } from '../types';
import { validateHttpUrl } from './client';

export const TITAN_PLUGIN_ID = 'feather.titan';
/** Matches UDevRealmSettings::ApiBaseUrl in the Unreal plugin; replace with a project's live URL. */
export const TITAN_DEFAULT_API_URL = 'https://yourproject.supabase.co';
export const TITAN_SCENE_MARKER = 'Ember Meadow · Realm runtime';
export const TITAN_SETTINGS = { realmUrl: 'TitanRealmURL', baseUrl: 'TitanAPIURL', gameKey: 'TitanGameKey', publishMode: 'TitanPublishMode', gameOrigin: 'TitanGameOrigin' } as const;
export interface TitanProjectSettings { realmUrl: string; baseUrl: string; gameKey: string; publishMode: 'practice' | 'online'; gameOrigin: string }
export type TitanSettingsInput = Pick<TitanProjectSettings, 'realmUrl' | 'baseUrl' | 'gameKey'> & Partial<Pick<TitanProjectSettings, 'publishMode' | 'gameOrigin'>>;
export const defaultTitanSettings: TitanProjectSettings = { realmUrl: 'http://127.0.0.1:8787', baseUrl: '', gameKey: '', publishMode: 'practice', gameOrigin: '' };
export function readTitanSettings(variables: readonly ProjectVariable[]): TitanProjectSettings {
  const settings = { ...defaultTitanSettings };
  for (const key of Object.keys(TITAN_SETTINGS) as (keyof TitanProjectSettings)[]) {
    const value = variables.find(v => v.name === TITAN_SETTINGS[key])?.defaultValue;
    if (typeof value === 'string') {
      if (key === 'publishMode') settings.publishMode = value === 'online' ? 'online' : 'practice';
      else settings[key] = value;
    }
  }
  return settings;
}
export function validateTitanSettings(settings: TitanSettingsInput): TitanProjectSettings {
  const realmUrl = validateHttpUrl(settings.realmUrl);
  if (new URL(realmUrl).pathname !== '/') throw new Error('Realm URL must point to the server root, without a path.');
  const baseUrl = settings.baseUrl.trim() ? validateHttpUrl(settings.baseUrl) : '';
  const gameKey = settings.gameKey.trim();
  if (Boolean(baseUrl) !== Boolean(gameKey)) throw new Error('Enter both Titan API URL and game key, or leave both empty.');
  if (/^(sb_secret_|service_role|eyJ)/i.test(gameKey)) throw new Error('Use the Titan project game key. Supabase keys do not belong in this field.');
  const publishMode = settings.publishMode ?? 'practice';
  if (!['practice', 'online'].includes(publishMode)) throw new Error('Choose a solo or online release.');
  const gameOrigin = settings.gameOrigin?.trim() ? validateHttpUrl(settings.gameOrigin) : '';
  if (gameOrigin && new URL(gameOrigin).pathname !== '/') throw new Error('Game website must be an origin, such as https://play.example.com.');
  return { realmUrl, baseUrl, gameKey, publishMode, gameOrigin };
}
export const isTitanScene = (objects: readonly SceneObject[]) => objects.some(o => o.kind === 'empty' && o.name === TITAN_SCENE_MARKER);
/** Zone scenes of the Sunlit Reach template carry an empty named `Realm zone · <zoneId>`; a Titan scene without one is the home zone. */
export const TITAN_ZONE_MARKER = 'Realm zone · ';
export const TITAN_HOME_ZONE = 'ember-meadow';
export const zoneOfScene = (objects: readonly SceneObject[]): string =>
  objects.find(o => o.kind === 'empty' && o.name.startsWith(TITAN_ZONE_MARKER))?.name.slice(TITAN_ZONE_MARKER.length).trim() || TITAN_HOME_ZONE;
/** zoneId → sceneId for every Titan scene in the project (the zones this build can travel to). */
export const titanZoneScenes = (scenes: readonly Scene[]): Record<string, string> =>
  Object.fromEntries(scenes.filter(scene => isTitanScene(scene.objects)).map(scene => [zoneOfScene(scene.objects), scene.id]));

export interface TitanRealmConfig {
  version: 1; gameId: string; titanUrl: string; gameKey: string; origins: string; host: string; port: number;
}
export function titanReleaseConfig(settings: TitanProjectSettings, gameId: string, web: boolean): TitanRealmConfig | undefined {
  const checked = validateTitanSettings(settings);
  if (checked.publishMode === 'practice') return undefined;
  const hosted = (value: string) => {
    const url = new URL(value);
    return url.protocol === 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  };
  if (!hosted(checked.realmUrl)) throw new Error('Titan: enter your hosted HTTPS realm address in the Publish step before building an online game.');
  if (checked.baseUrl && !hosted(checked.baseUrl)) throw new Error('Titan: an online release needs a hosted HTTPS Titan API URL.');
  if (web && !checked.gameOrigin) throw new Error('Titan: enter the game website origin in Publish so the server accepts your web game.');
  if (checked.gameOrigin && !hosted(checked.gameOrigin)) throw new Error('Titan: use an HTTPS game website origin for an online release.');
  return { version: 1, gameId, titanUrl: checked.baseUrl, gameKey: checked.gameKey, host: '0.0.0.0', port: 8787,
    origins: ['tauri://localhost', 'http://tauri.localhost', 'https://tauri.localhost', 'feather://localhost', 'http://feather.localhost', 'https://feather.localhost', checked.gameOrigin].filter(Boolean).join(',') };
}
