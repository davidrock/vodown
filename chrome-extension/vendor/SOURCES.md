# Bundled libraries

`@ffmpeg/ffmpeg` 0.12.15 (MIT) and `@ffmpeg/core` 0.12.10
(GPL-2.0-or-later) are copied without modification from their official npm
packages. SHA-512 package integrity values are recorded in the project's
`package-lock.json`. No binary from another downloader project is included.

- Wrapper source, core bindings, build scripts and Dockerfile:
  <https://github.com/ffmpegwasm/ffmpeg.wasm>
- FFmpeg 5.1.4 source and licenses: <https://github.com/FFmpeg/FFmpeg/tree/n5.1.4>
- Core compilation and dependencies:
  <https://github.com/ffmpegwasm/ffmpeg.wasm/blob/main/Dockerfile>
- Build instructions: <https://ffmpegwasm.netlify.app/docs/contribution/>
- Package distributions:
  <https://www.npmjs.com/package/@ffmpeg/ffmpeg/v/0.12.15> and
  <https://www.npmjs.com/package/@ffmpeg/core/v/0.12.10>

The upstream Dockerfile identifies the external libraries and their source
repositories: x264, x265, libvpx, LAME, Ogg, Theora, Opus, Vorbis, zlib,
libwebp, FreeType, FriBidi, HarfBuzz, libass and zimg. Their original notices
and terms remain applicable. The packaged engine reports FFmpeg 5.1.4 and
Emscripten 3.1.40. All runtime assets are local to the extension.

These links are source and attribution references; the extension never opens
them or retrieves executable code from them at runtime.
