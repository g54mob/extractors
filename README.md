Run: PowerShell `node U:\extractors\extract-unity.js "<game folder>"` | WSL `node /mnt/u/extractors/extract-unity.js '<game folder>'` (WSL: script path in /mnt form, Windows game paths in 'single quotes') + `[--name X] [--dry-run] [--unity-project] [--ghidra] [--force] [--steps a,b] [--assemblies a,b] [--out dir]` (game folder read-only; re-run retries only failed steps).
Output: `U:\extractors\output\<Name>\` (or `--out`) -> `assetripper\AssetRipper_export_<utc>\` = GUI "Open File exe + Export Primary Content + Create subfolder" (.cs if Mono, .glb 3D, images, audio, fonts; `--unity-project` adds `assetripper\UnityProject\` prefab/scene/SO values), `cs-cpp2il\` approx C# bodies (Mono: `cs\` full source), `il2cppdumper\`/`redux\` exact structure, `logs\`, `report.json` (exit 0 = OK, 1 = a step failed).
IL2CPP = exact structure + full assets, but rough method bodies (no comments/local names; native code only via Ghidra) -> use as reference, never copy; never `--out` into `U:\WORKSPACE`.


## example
```bash
node U:/extractors/extract-unity.js --steps assetripper --force "E:\X\--steam\Genres\Genre-BulletHeaven--bh\Megabonk-SteamRIP.com\Megabonk"
```