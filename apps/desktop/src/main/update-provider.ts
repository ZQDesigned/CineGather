import { Provider } from "electron-updater";
import type { ProviderRuntimeOptions } from "electron-updater/out/providers/Provider";
import type { CustomPublishOptions, UpdateInfo } from "builder-util-runtime";
import { artifactURL, type Release } from "./update-release";

// A provider receives an already verified, immutable release. It never refetches
// unsigned latest.yml, so metadata cannot change between verification and download.
export class SignedReleaseProvider extends Provider<UpdateInfo> {
  private release: Release;
  constructor(
    options: CustomPublishOptions,
    _updater: unknown,
    runtime: ProviderRuntimeOptions,
  ) {
    super(runtime);
    const release = (options as CustomPublishOptions & { release?: Release })
      .release;
    if (!release) throw new Error("Verified update metadata is required");
    this.release = structuredClone(release);
  }
  async getLatestVersion(): Promise<UpdateInfo> {
    const release = this.release;
    return {
      version: release.version,
      releaseDate: release.publishedAt,
      releaseNotes: release.notes,
      path: artifactURL(release),
      sha512: release.artifact.sha512,
      files: [
        {
          url: artifactURL(release),
          sha512: release.artifact.sha512,
          size: release.artifact.size,
        },
      ],
    };
  }
  resolveFiles(info: UpdateInfo) {
    return info.files.map((file) => ({ url: new URL(file.url), info: file }));
  }
}
