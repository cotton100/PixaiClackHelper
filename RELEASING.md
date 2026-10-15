# PixaiClackHelper 배포

현재 Windows 배포 절차는 [PixaiClackHelper 안내](PIXAIS.md#업데이트버전-선택)를 따릅니다. `pnpm build:win`으로 설치본·latest.yml·pixais-update.json을 생성하고, 해당 버전 소스와 LICENSE를 공개 배포 저장소 cotton100/PixaiClackHelper에 함께 제공합니다. CI는 빌드 산출물까지만 만들며 자동 릴리스를 게시하지 않습니다.

## PixaiClackHelper 개발 → 정식 출시

1. 일반 기능 개발과 수정은 `develop`에서 시작합니다. 기존 작업 트리가 깨끗한지 먼저 확인합니다.
2. `develop`에서 테스트·타입 검사 및 변경에 필요한 실행 검증을 마칩니다. `main`과 `develop`의 코드 변경에는 동일한 자동 검사가 실행됩니다.
3. 검증된 변경을 `develop` → `main` PR로 반영합니다. 배포 전 리뷰와 데이터 호환성 검증은 기존 절차대로 수행합니다.
4. 정식 버전과 출시 문구가 반영된 `main` 커밋에 `vX.Y.Z` 태그를 만들고 해당 코드로 패키징합니다. 공개된 태그·설치 파일은 덮어쓰지 않습니다.
5. 설치 파일·업데이트 메타데이터·해당 태그 소스를 검증한 뒤 정식 릴리스를 공개합니다. `main`에 직접 넣은 긴급 수정이나 버전 변경은 `develop`에도 반영합니다.

`develop`에 push하거나 PR을 합치는 것만으로 릴리스가 공개되지는 않습니다. 업데이트 채널은 브랜치 이름이 아니라 게시한 버전과 설치 파일로 구분합니다. GitHub 기본 브랜치는 `main`으로 유지합니다.

## 개발판 (Beta) 출시

- 개발판은 develop에서 `package.json` 버전을 `0.1.13-beta.1` 같은 형식으로 정하고 같은 태그·출시 문구로 준비합니다. 아래 문서의 정식 배포와 동일하게 검사·게시 승인이 필요합니다.
- `pnpm build:win`은 버전 접미사에 따라 Beta 설정을 선택하지만 이제 정식판의 설치 식별자를 그대로 상속합니다. 두 채널 모두 설치 파일은 `PixaiClackHelper-<version>-setup.exe`이며 manifest에 `channel`과 `installation: shared`를 기록합니다. Beta는 GitHub **Pre-release**로 게시하고 최신 정식 릴리스로 지정하지 않습니다.
- 두 채널 모두 기존 appId·실행 파일 `PixAIS.exe`·자료 폴더 `%APPDATA%/PixAIS`·업데이트 캐시를 유지합니다. 수신 채널 선택은 저장만 하며, 업데이트/전환 버튼을 눌러야 백업 후 설치합니다. 낮은 버전으로 전환할 때도 데이터 epoch/DB 호환 검사를 유지합니다.
- 기존 정식 사용자는 먼저 정식 **0.1.16**으로 앱 안에서 업데이트하면 새 채널 전환을 사용할 수 있습니다. 이후 새 형식 Beta를 같은 앱에 설치하고 자료를 이어 씁니다.
- **옛 `PixaiClackHelper-Beta-...` 파일명은 새 통합 설치본에 절대 쓰지 마세요.** 그 이름은 구 별도 Beta updater가 받아서 다른 설치/자료 위치를 잘못 덮어쓸 수 있습니다. 기존 공개 릴리스는 변경하지 않으며, 새 앱에서 옛 별도 Beta 설치는 차단합니다.
- 이미 별도 Beta를 쓰는 사람의 `%APPDATA%/PixAIS-Beta` 자료는 자동으로 합치지 않습니다. 기존 Beta 자료를 선택 백업한 뒤 정식 앱에 명시적으로 가져오는 방식으로 옮깁니다. API 키와 진행 작업을 임의로 복사하지 않습니다.

아래 내용은 **원작 NAIS3의 보존된 배포 참고 자료**입니다. PixaiClackHelper의 현재 대상 플랫폼·산출물·게시 방식에 그대로 적용하지 마세요.

---

# Release procedure

Production releases use a stable version such as `1.0.26` in `package.json` and
the matching tag `v1.0.26`. The Release workflow builds **drafts only**.

## Prepare

1. Merge the intended fixes and update `package.json` plus `release-notes/v<version>.md`.
2. Verify author and committer identity, a clean worktree, CI results, and the exact
   commit SHA to tag. Local uncommitted fixes are not included in a tag build.
3. Run `pnpm test` (including real SQLite integration tests) and `pnpm run build`.
4. Tag only the reviewed commit and push only that tag.

## Automated draft checks

The tag workflow checks the tag/app version and release notes, and refuses to
modify an already published release. Builds run separately on Windows x64,
Mac ARM64, and Mac Intel x64. Every platform runs tests and typechecking, packages
with `--publish never`, and exercises the shipped SQLite/sharp dependencies with
the packaged Electron executable in Node mode.

Mac builds additionally verify native module architecture. Each platform validates
its assets; the final aggregation must contain exactly these seven files:

- `latest.yml`
- `nais3-<version>-setup.exe`
- `nais3-<version>-setup.exe.blockmap`
- `nais3-<version>-arm64.dmg`
- `nais3-<version>-arm64-mac.zip`
- `nais3-<version>-x64.dmg`
- `nais3-<version>-x64-mac.zip`

The validator checks Windows metadata version, file paths, sizes, and SHA-512,
and Mac ZIP bundle paths, identifiers, and versions. Run it locally against the
downloaded draft files with `node scripts/verify-release.mjs assets all <directory>`.

## Review and publish

Download and test the **draft's actual artifacts** before publishing. Check clean
installation and upgrade from the previous version on each supported platform,
including stored language, account access, database migration/backup, and restart.
Use a copy of an existing workspace when testing migration.

Publishing as the latest stable release is a separate, explicit action. Once public,
check `/releases/latest`, public asset downloads, and the old application's update
detection/download/restart. Development mode does not exercise the updater, and old
apps cannot discover a private draft through the public update feed.

After publication, do not replace binaries or move the tag. If a defect is found,
stop further distribution and ship a higher-version compatible fix. Schema v18
cannot be opened by apps supporting only v17. Restoring a pre-migration database is
a separate recovery action and does not retain work performed after the snapshot.
