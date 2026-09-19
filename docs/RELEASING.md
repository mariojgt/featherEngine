# Releasing Feather Engine

Pushing a `v*` tag builds and publishes the desktop installers for **Windows, macOS
(Apple Silicon + Intel) and Linux**, then the website has to be pointed at the new
version. A release is not finished until both halves are done.

> **Rule for anyone — human or AI assistant — cutting a release:**
> a `v*` tag is only half the job. The matching website download-link update in
> [FeatherEngineWebsite](https://github.com/mariojgt/FeatherEngineWebsite) is part
> of the same task. Do not report a release as done until `npm run sync:release`
> has been run there and the site deployed.

## 1. Prepare the version

The tag, `package.json` and `src-tauri/tauri.conf.json` must all carry the same
version. `tauri-action` names the GitHub release from `tauri.conf.json`, so a
mismatch produces a release for a tag nobody pushed. The `verify-version` job
fails the run in seconds if they disagree.

```bash
# e.g. releasing 0.2.1
npm version 0.2.1 --no-git-tag-version          # package.json
jq '.version = "0.2.1"' src-tauri/tauri.conf.json > /tmp/t && mv /tmp/t src-tauri/tauri.conf.json

npm run build                                    # must pass before tagging
git commit -am "chore(release): prepare v0.2.1"
git push
```

## 2. Tag and push

```bash
git tag v0.2.1
git push origin v0.2.1
```

That triggers [`.github/workflows/release-desktop.yml`](../.github/workflows/release-desktop.yml):

| Job | What it does |
| --- | --- |
| `verify-version` | Fails fast unless the tag matches both version files |
| `release` (matrix) | Builds on `windows-latest`, `ubuntu-22.04` and `macos-latest` ×2 (arm64 + x64). Tauri cannot cross-compile, so each OS needs its own runner. Assets land on a **draft** release |
| `publish` | Attaches `latest.json`, then flips the release out of draft and marks it `latest` |

Roughly 15–20 minutes end to end. Watch it with:

```bash
gh run watch --repo mariojgt/featherEngine
```

Assets produced per platform:

- **Windows** — `Feather.Engine_<version>_x64-setup.exe` (NSIS), `Feather.Engine_<version>_x64_en-US.msi`
- **macOS** — `Feather.Engine_<version>_aarch64.dmg` / `.app.tar.gz` and `Feather.Engine_<version>_x64.dmg` / `.app.tar.gz`
- **Linux** — `.AppImage`, `.deb` and `.rpm`
- **`latest.json`** — machine-readable manifest of the above, permanently resolvable at
  `https://github.com/mariojgt/featherEngine/releases/latest/download/latest.json`

The release stays a draft while the matrix runs, so nobody can download a release
that is missing half its platforms. If one leg fails, fix it and re-run that job —
the release only goes live once every platform has uploaded.

## 3. Update the website download links — required

The site keeps its installer table in generated data, so this is one command, not
an edit pass. Never hand-edit the URLs, filenames or sizes.

```bash
cd ../FeatherEngineWebsite
npm run sync:release          # reads the latest published release from the GitHub API
git diff src/data/release.json
npm run build                 # confirm the site still builds
git commit -am "Point downloads at v0.2.1"
git push                      # then deploy dist/
```

`sync:release` rewrites `src/data/release.json` with the new tag, asset URLs and
byte-accurate sizes, and the page picks up the version badges from the same file.
A platform with no assets in that release is dropped from the page rather than
rendered as a dead link — so if the Linux card is missing, the Linux build leg
did not upload.

Verify afterwards: the download section, the hero badge and the footer should all
read the new tag, and every installer link should resolve.

```bash
cd ../FeatherEngineWebsite && npm run sync:release -- --check   # non-zero if stale
```

## Troubleshooting

**The site still shows the old version.** The release is probably still a draft —
`/releases/latest` skips drafts. Check with `gh release list --repo mariojgt/featherEngine`
and publish it:

```bash
gh release edit v0.2.1 --repo mariojgt/featherEngine --draft=false --latest
```

**A platform is missing from the release.** Look at that matrix leg's log. Linux
bundling in particular needs the full prerequisite set (`libwebkit2gtk-4.1-dev`,
`libayatana-appindicator3-dev`, `libxdo-dev`, …) — the shorter list that satisfies
`cargo check` is not enough to build an AppImage.

**Preview the site against an unpublished release.** `npm run sync:release -- --tag v0.2.1`
reads drafts too (with an authenticated `gh`), and rewrites the draft's temporary
`untagged-…` asset URLs to the permanent form they take once published.
