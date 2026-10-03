Run: PowerShell `node U:\extractors\extract-unity.js "<game folder>"` | WSL `node /mnt/u/extractors/extract-unity.js '<game folder>'` (WSL: script path in /mnt form, Windows game paths in 'single quotes') + `[--name X] [--dry-run] [--ghidra] [--primary] [--force] [--steps a,b] [--assemblies a,b] [--out dir]` (game folder read-only; re-run retries only failed steps).
Output: `U:\extractors\output\<Name>\` (or `--out`) -> `cs-cpp2il\` approx C# bodies (Mono: `cs\` full source), `assetripper\UnityProject\` assets + prefab/scene/SO values, `il2cppdumper\`/`redux\` exact structure, `logs\`, `report.json` (exit 0 = OK, 1 = a step failed).
IL2CPP = exact structure + full assets, but rough method bodies (no comments/local names; native code only via Ghidra) -> use as reference, never copy; never `--out` into `U:\WORKSPACE`.

## usage example:
```shell
node U:\extractors\extract-unity.js "E:\X\--steam\Genres\Genre-BulletHeaven--bh\Megabonk-SteamRIP.com\Megabonk"`
```
> output shall be at `U:\extractors\output`