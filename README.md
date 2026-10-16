# PixaiClackHelper — PixAI 이미지 생성·예약·자동 저장 도우미

이 저장소는 NAIS3의 GPL-3.0 포크입니다. PixAI 공식 API로 **재료 편집·스크립트 백업 호환·여러 캐릭터 × 여러 씬 예약·1장/4장 생성·원본 자동 저장**을 지원하는 Windows 초기 버전입니다. PixAI와 제휴하지 않은 비공식 도구이며 API 키와 사용 크레딧이 필요합니다.

Windows 설치 파일은 [최신 출시](https://github.com/cotton100/PixaiClackHelper/releases/latest)에서 받으세요. 오래된 PixAIS에서 업데이트 목록을 읽지 못하면 최신 정식 설치 파일로 한 번 업데이트해 주세요.

처음 사용한다면 [그림 사용설명서](GUIDE.md)에서 설치부터 첫 생성·씬 예약·백업까지 따라 해 보세요.

사용 순서와 개발 실행 방법은 [PixaiClackHelper 안내](PIXAIS.md)를 참고하세요. PixaiClackHelper는 원작 NAIS3와 별도 앱·자료 폴더를 사용합니다. 아래는 원작 NAIS3의 소개와 저작자 안내이며, 아래 기능이 모두 PixAI에서 동작한다는 뜻은 아닙니다.

### PixaiClackHelper 브랜치

- `main`: 검증된 안정판 코드. GitHub 기본 브랜치이며 정식 출시 태그는 여기서 만듭니다.
- `develop`: 새 기능과 수정 사항을 먼저 시험하는 개발 브랜치. 일반 개발 작업은 여기서 시작합니다.
- 개발 변경을 테스트한 뒤 `develop` → `main` PR로 반영하고, 출시할 때 `vX.Y.Z` 태그를 붙입니다. 큰 기능은 `develop`에서 임시 작업 브랜치를 만들어 진행해도 됩니다.
- 두 브랜치의 코드 변경과 PR에는 자동 테스트·타입 검사가 실행됩니다. 브랜치에 올리는 것만으로 앱이 배포되지는 않습니다. 정식 공개 절차는 [배포 안내](RELEASING.md)를 따릅니다.

0.1.16부터 설정에서 정식판/개발판 수신 채널을 고르고 **같은 앱과 자료**로 업데이트합니다. 기본은 정식판이며 개발판은 직접 선택한 사용자만 받습니다. 채널 선택만으로 설치하지 않으며, `develop`에 코드를 올리는 것만으로 배포되지는 않습니다.

---

<div align="center">

# NAIS3

<img src="build/icon-win.png" width="128" alt="NAIS3" />

**NovelAI Image Studio 3** — NovelAI 이미지 생성을 위한 데스크톱 앱

[![Discord](https://img.shields.io/badge/Discord-문의-5865F2?logo=discord&logoColor=white)](https://discord.gg/bFxP5Qvaz)
[![Patreon](https://img.shields.io/badge/Patreon-후원-FF424D?logo=patreon&logoColor=white)](https://www.patreon.com/c/sunakgo)
[![License](https://img.shields.io/badge/License-GPL--3.0-blue)](LICENSE)

</div>

---

NAIS3는 NAIS2의 후속작으로, NovelAI 이미지 생성을 빠르고 안정적으로 다룰 수 있게 만든 데스크톱 애플리케이션입니다. 수백 개의 캐릭터·프리셋을 저장하고 수만 장의 이미지를 생성하는 헤비 유저를 염두에 두고 설계했습니다.

## 주요 기능

- **생성** — 텍스트→이미지, i2i, 인페인트. NAI 웹과 바이트 단위로 동일한 payload(시드 일관성) + 실시간 스트리밍 미리보기
- **프롬프트 주석** — `#`부터 그 줄 끝까지 주석으로 처리되어 전송에서 제외됩니다 (기본·캐릭터·조각 프롬프트 공통, 회색 배경으로 표시)
- **캐릭터 프롬프트** — 라이브러리로 저장·폴더 정리, 위치 지정, 동시 6명까지 활성
- **조각(와일드카드)** — `<이름>`으로 프롬프트에 삽입, 여러 줄 중 랜덤 선택
- **바이브 트랜스퍼 / 캐릭터 레퍼런스** — 이미지 라이브러리로 관리, 인코딩 캐시
- **씬 모드** — 씬별 프롬프트를 미리 저장하고 예약→일괄 생성
- **디렉터 툴** — 배경 제거·라인아트·스케치·색칠·표정 변경·이미지 정리·업스케일
- **메타데이터** — PNG/스텔스 청크에서 프롬프트·파라미터·캐릭터·UC 프리셋·퀄리티 태그 읽기
- **프롬프트 프리셋** — 자주 쓰는 프롬프트+네거티브 저장/불러오기
- **백업** — 라이브러리 전체를 JSON으로 내보내기/불러오기 (NAIS2 백업 가져오기 지원)
- **자동 업데이트** — GitHub Release 기반
- **기타** — 라이트/다크 테마, Anlas 소모 예상 표시, 태그 자동완성(작가 태그 포함), 단축키

## 다운로드

[Releases](../../releases)에서 최신 버전을 받으세요. (macOS `.dmg` / Windows `.exe`)

## 기술 스택

- [Electron](https://www.electronjs.org/) + [electron-vite](https://electron-vite.org/)
- [React](https://react.dev/) 19 + [TypeScript](https://www.typescriptlang.org/)
- [Tailwind CSS](https://tailwindcss.com/) v4
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) (로컬 DB) · [Zustand](https://github.com/pmndrs/zustand) · [sharp](https://sharp.pixelplumbing.com/)

## 개발

```bash
pnpm install      # 의존성 설치
pnpm run dev      # 개발 모드 실행
pnpm run dev:web  # 브라우저 개발 모드 (127.0.0.1:5173)
pnpm run build    # 타입체크 + 빌드
pnpm test         # 테스트
pnpm run test:db  # 실제 SQLite 업그레이드·백업 검증 (Electron Node 모드)

# 패키징
pnpm run build:mac    # macOS (.dmg)
pnpm run build:win    # Windows (.exe)
```

브라우저 개발 모드는 Electron과 별도의 IndexedDB 작업 공간을 사용합니다.
API 토큰은 개발용 브라우저 프로필에 저장되며, 작업 데이터 JSON 백업에는 포함되지 않습니다.
브라우저 백업은 브라우저 모드에서 복원하며, 복원 시 현재 등록된 계정은 유지됩니다.
씬/조각 ZIP 처리 및 내장 웹뷰는 Electron 전용입니다.

태그 빌드·Draft 검증·정식 공개 절차는 [릴리즈 안내](RELEASING.md)를 참고하세요.

## 번역 기여

한국어·영어·간체 중국어 UI를 지원합니다. 설정 → 모양 → 언어에서 변경할 수 있습니다.
번역은 고정 메시지 ID를 사용하는 언어별 카탈로그로 관리합니다.
문구 수정·새 언어 추가 방법은 [번역 기여 안내](CONTRIBUTING.md)를 참고하세요.
번역 변경은 `pnpm i18n:check`로 검증할 수 있습니다.

## 문의 · 후원

- 💬 **Discord**: <https://discord.gg/bFxP5Qvaz>
- ❤️ **Patreon**: <https://www.patreon.com/c/sunakgo>

## Thanks to

NovelAI API 동작을 이해하는 데 아래 프로젝트들을 참고했습니다.

- **SDStudio**
- **NAIA 2.0**

## 라이선스

이 프로젝트는 [GNU General Public License v3.0](LICENSE) 하에 배포됩니다.
