// Assemble genuine VS Code captures; requires FFmpeg and Swift/AppKit (macOS).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const scenes = require('./demo-scenes.json');
const commands = require('../package.json').contributes.commands;
const covered = new Set(scenes.flatMap((scene) => scene.commands || []));
const unknown = [...covered].filter((id) => !commands.some((command) => command.command === id));
if (unknown.length) throw new Error(`Tour references removed commands: ${unknown.join(', ')}`);
for (const scene of scenes) {
  if (!fs.existsSync(path.join(root, 'images', 'demo', scene.file)))
    throw new Error(`Missing capture: ${scene.file}`);
}
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-tour-'));
try {
  execFileSync(
    'swift',
    [
      '-module-cache-path',
      path.join(temporary, 'swift-cache'),
      path.join(__dirname, 'caption-demo.swift'),
      root,
      temporary,
    ],
    { stdio: 'inherit' },
  );
  const manifest = scenes
    .map((scene, index) => `file '${index}.png'\nduration ${scene.duration}`)
    .join('\n');
  fs.writeFileSync(
    path.join(temporary, 'frames.txt'),
    `${manifest}\nfile '${scenes.length - 1}.png'\n`,
  );
  execFileSync(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'concat',
      '-i',
      'frames.txt',
      '-filter_complex',
      'fps=1/4,split[a][b];[a]palettegen[p];[b][p]paletteuse=dither=bayer:bayer_scale=3',
      '-t',
      String(scenes.reduce((sum, scene) => sum + scene.duration, 0)),
      '-loop',
      '0',
      path.join(root, 'images', 'preview.gif'),
    ],
    { cwd: temporary, stdio: 'inherit' },
  );
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
console.log(
  `Built ${scenes.length} scenes; ${covered.size} of ${commands.length} contributed commands represented. The feature catalog documents every command.`,
);
