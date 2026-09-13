import {
  EXPORT_SETTINGS_VERSION,
  EXPORT_TARGET_IDS,
  type ExportProfile,
  type ExportSettings,
  type ExportTargetId,
} from '../types';

// SemVer 2.0.0, including the no-leading-zero rule for numeric prerelease identifiers.
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
// The portable subset accepted by Windows/macOS/Linux bundle metadata and Android/iOS package ids.
const IDENTIFIER = /^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)+$/;
const targets = new Set<string>(EXPORT_TARGET_IDS);

/** Portable identifier segment used only when a project has never chosen its own stable id. */
export function exportIdentifierSlug(value: string): string {
  const slug = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .replace(/^[^a-z]+/, '');
  return slug || 'game';
}

export function createDefaultExportSettings(projectName: string, startSceneId: string): ExportSettings {
  const productName = projectName.trim() || 'Game';
  return {
    version: EXPORT_SETTINGS_VERSION,
    activeProfileId: 'default',
    profiles: [
      {
        id: 'default',
        name: 'Default',
        configuration: 'release',
        targets: ['web'],
        startSceneId,
        application: {
          productName,
          identifier: `com.thedevrealm.${exportIdentifierSlug(productName)}`,
          version: '0.1.0',
          buildNumber: 1,
        },
        window: {
          title: productName,
          width: 1280,
          height: 720,
          minWidth: 640,
          minHeight: 360,
          resizable: true,
          fullscreen: false,
        },
        includeDebugOverlay: false,
      },
    ],
  };
}

const positiveInteger = (value: unknown, fallback: number) => {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
};

const text = (value: unknown, fallback: string) =>
  typeof value === 'string' && value.trim() ? value.trim() : fallback;

/**
 * Migrate legacy/partially-authored settings into the current shape. Invalid user-authored identity
 * is retained so validation can explain it instead of silently changing an installed game's id.
 */
export function parseExportSettings(
  raw: unknown,
  projectName: string,
  sceneIds: readonly string[],
  preferredStartSceneId?: string,
): ExportSettings {
  const fallbackScene =
    (preferredStartSceneId && sceneIds.includes(preferredStartSceneId) ? preferredStartSceneId : undefined) ??
    sceneIds[0] ??
    'scene-main';
  const defaults = createDefaultExportSettings(projectName, fallbackScene);
  if (!raw || typeof raw !== 'object') return defaults;

  const source = raw as Partial<ExportSettings>;
  if (!Array.isArray(source.profiles) || source.profiles.length === 0) return defaults;

  const seenIds = new Set<string>();
  const profiles = source.profiles.map((candidate, index) => {
    const value = (candidate ?? {}) as Partial<ExportProfile>;
    let id = text(value.id, index === 0 ? 'default' : `profile-${index + 1}`);
    if (seenIds.has(id)) id = `${id}-${index + 1}`;
    seenIds.add(id);
    const productName = text(value.application?.productName, projectName || 'Game');
    const startSceneId =
      typeof value.startSceneId === 'string' && sceneIds.includes(value.startSceneId)
        ? value.startSceneId
        : fallbackScene;
    const parsedTargets = Array.isArray(value.targets)
      ? [...new Set(value.targets.filter((target): target is ExportTargetId => targets.has(String(target))))]
      : [];
    return {
      id,
      name: text(value.name, index === 0 ? 'Default' : `Profile ${index + 1}`),
      configuration: value.configuration === 'debug' ? 'debug' : 'release',
      targets: parsedTargets.length ? parsedTargets : ['web'],
      startSceneId,
      application: {
        productName,
        identifier: text(value.application?.identifier, `com.thedevrealm.${exportIdentifierSlug(productName)}`),
        version: text(value.application?.version, '0.1.0'),
        buildNumber: positiveInteger(value.application?.buildNumber, 1),
      },
      window: {
        title: text(value.window?.title, productName),
        width: positiveInteger(value.window?.width, 1280),
        height: positiveInteger(value.window?.height, 720),
        minWidth: positiveInteger(value.window?.minWidth, 640),
        minHeight: positiveInteger(value.window?.minHeight, 360),
        resizable: value.window?.resizable !== false,
        fullscreen: value.window?.fullscreen === true,
      },
      includeDebugOverlay: value.includeDebugOverlay === true,
      optimization: {
        geometry: value.optimization?.geometry !== false,
        textures: value.optimization?.textures === true,
        streamAssets: value.optimization?.streamAssets !== false,
      },
    } satisfies ExportProfile;
  });

  return {
    version: EXPORT_SETTINGS_VERSION,
    activeProfileId: profiles.some((profile) => profile.id === source.activeProfileId)
      ? (source.activeProfileId as string)
      : profiles[0]!.id,
    profiles,
  };
}

export function activeExportProfile(settings: ExportSettings): ExportProfile {
  return settings.profiles.find((profile) => profile.id === settings.activeProfileId) ?? settings.profiles[0]!;
}

export function validateExportProfile(profile: ExportProfile, sceneIds: readonly string[]): string[] {
  const errors: string[] = [];
  if (!profile.application.productName.trim()) errors.push('Build profile product name is required.');
  if (/[\\/\0\r\n]/.test(profile.application.productName)) {
    errors.push('Product name cannot contain path separators or line breaks.');
  }
  if (!profile.window.title.trim()) errors.push('Window title is required.');
  if (/[\0\r\n]/.test(profile.window.title)) errors.push('Window title cannot contain line breaks.');
  if (!IDENTIFIER.test(profile.application.identifier)) {
    errors.push('Application identifier must be a portable reverse-DNS value such as com.example.mygame.');
  }
  if (!SEMVER.test(profile.application.version)) {
    errors.push('Application version must be semantic versioning such as 1.0.0.');
  }
  if (profile.targets.includes('ios') && !/^\d+\.\d+\.\d+$/.test(profile.application.version)) {
    errors.push('iOS versions must use three numeric parts such as 1.0.0 (no prerelease or build suffix).');
  }
  if (
    !Number.isInteger(profile.application.buildNumber) ||
    profile.application.buildNumber < 1 ||
    profile.application.buildNumber > 2_100_000_000
  ) {
    errors.push('Application build number must be an integer from 1 to 2,100,000,000.');
  }
  if (!sceneIds.includes(profile.startSceneId)) errors.push(`Launch scene does not exist: ${profile.startSceneId}`);
  if (profile.targets.length === 0) errors.push('Select at least one export target.');
  if (new Set(profile.targets).size !== profile.targets.length) errors.push('Export targets must not contain duplicates.');
  for (const target of profile.targets) {
    if (!targets.has(target)) errors.push(`Unknown export target: ${String(target)}`);
  }
  const dimensions = [profile.window.width, profile.window.height, profile.window.minWidth, profile.window.minHeight];
  if (dimensions.some((dimension) => !Number.isInteger(dimension) || dimension < 1)) {
    errors.push('Window dimensions must be positive whole numbers.');
  } else if (profile.window.minWidth > profile.window.width || profile.window.minHeight > profile.window.height) {
    errors.push('Minimum window dimensions cannot exceed the initial window dimensions.');
  }
  return errors;
}

export function retargetDeletedScene(
  settings: ExportSettings,
  deletedSceneId: string,
  replacementSceneId: string,
): ExportSettings {
  return {
    ...settings,
    profiles: settings.profiles.map((profile) =>
      profile.startSceneId === deletedSceneId ? { ...profile, startSceneId: replacementSceneId } : profile,
    ),
  };
}
