#!/usr/bin/env node
/**
 * extract-unity.js
 *
 * One-command decompile/extract for a Unity game folder, driving the tools kept
 * next to this script (U:\extractors). Detects Mono vs IL2CPP, the Unity version
 * and the IL2CPP metadata version, then runs only the tools that can work:
 *
 *   IL2CPP  dumper      Il2CppDumper        metadata v16..v31 only (dump.cs, DummyDll, script.json, il2cpp.h)
 *           redux       Il2CppInspectorRedux Legacy CLI (C# stubs, shim DLLs, metadata.json, Ghidra script)
 *           cpp2il      Cpp2IL nightly  --output-as dll_il_recovery (approximate method bodies)
 *           ilspy       ilspycmd on the Cpp2IL DLLs of the game assemblies -> .cs projects
 *           assetripper AssetRipper headless: Unity project export (prefabs, scenes, MB/SO values)
 *           ghidra      OPT-IN (--ghidra): headless import + il2cpp.h + Il2CppDumper names, runs detached
 *   Mono    ilspy       ilspycmd on Managed/<game assemblies> (full method bodies)
 *           assetripper as above
 *
 * The game folder is only READ. Everything goes to <out> (default <tools>/output/<Name>).
 * Works from WSL bash (tools run through Windows interop) and from Windows PowerShell/cmd.
 *
 * CLI:
 *   node extract-unity.js "<game folder>" [options]
 *
 *   --name <Name>        output folder name (default: game exe name, sanitized)
 *   --out <dir>          output root (default: <tools>/output/<Name>)
 *   --tools <dir>        tools root (default: folder of this script)
 *   --steps a,b,c        subset of: dumper,redux,cpp2il,ilspy,assetripper,ghidra
 *   --ghidra             add the (long, detached) Ghidra headless step
 *   --ghidra-mem <N>G    Ghidra heap (default 12G)
 *   --primary            AssetRipper: also export Primary Content
 *   --assemblies a,b     game assemblies to decompile (default: auto, vendor/framework filtered)
 *   --force              delete and redo a step whose output folder already exists
 *   --dry-run            detect and print the plan only, run nothing
 *
 * Exit codes: 0 = every selected step OK/SKIP, 1 = at least one step FAILED, 2 = bad usage.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

// ---------------------------------------------------------------------------
// Environment: WSL vs native Windows
// ---------------------------------------------------------------------------
const IS_WIN = process.platform === 'win32';
const IS_WSL = !IS_WIN && /microsoft/i.test(os.release());
if (!IS_WIN && !IS_WSL) { console.error('Needs Windows or WSL (tools are Windows executables).'); process.exit(2); }

/** Converts any path form to a Windows path for tool arguments. */
function toWin(p) {
    if (IS_WIN) return path.resolve(p);
    const m = /^\/mnt\/([a-z])(\/.*)?$/i.exec(path.resolve(p));
    if (!m) throw new Error('Path is not on a Windows drive (/mnt/<x>/...): ' + p);
    return m[1].toUpperCase() + ':' + (m[2] || '\\').replace(/\//g, '\\');
}

/** Converts any path form to a path usable by this process. */
function toLocal(p) {
    if (IS_WIN) return path.resolve(p);
    const m = /^([a-z]):[\\/](.*)$/i.exec(p);
    return m ? '/mnt/' + m[1].toLowerCase() + '/' + m[2].replace(/\\/g, '/') : path.resolve(p);
}

const SYS32 = IS_WIN ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32') : '/mnt/c/Windows/System32';
const CURL = path.join(SYS32, 'curl.exe');
const POWERSHELL = path.join(SYS32, 'WindowsPowerShell', 'v1.0', 'powershell.exe');

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------
const ALL_STEPS = ['dumper', 'redux', 'cpp2il', 'ilspy', 'assetripper', 'ghidra'];

function parseArgs(argv) {
    const o = { flags: {} };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a.startsWith('--')) {
            const k = a.slice(2);
            if (['ghidra', 'primary', 'force', 'dry-run', 'help'].includes(k)) o.flags[k] = true;
            else o.flags[k] = argv[++i];
        } else if (!o.game) o.game = a;
        else { console.error('Unexpected argument: ' + a); process.exit(2); }
    }
    return o;
}

const args = parseArgs(process.argv.slice(2));
if (!args.game || args.flags.help) {
    console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0]);
    process.exit(args.game ? 0 : 2);
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
const stripAnsi = s => s.replace(/\x1b\[[0-9;]*m/g, '');
const exists = p => { try { fs.accessSync(p); return true; } catch { return false; } };
const isInside = (child, parent) => { const r = path.relative(parent, child); return !!r && !r.startsWith('..') && !path.isAbsolute(r); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Finds the first directory under root whose name starts with prefix. */
function findDir(root, prefix) {
    if (!exists(root)) return null;
    const hit = fs.readdirSync(root, { withFileTypes: true })
        .filter(d => d.isDirectory() && d.name.startsWith(prefix))
        .map(d => d.name).sort().reverse()[0];
    return hit ? path.join(root, hit) : null;
}

/** Counts files with an extension below a folder. */
function countFiles(dir, ext) {
    if (!exists(dir)) return 0;
    let n = 0;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) n += countFiles(p, ext);
        else if (e.name.toLowerCase().endsWith(ext)) n++;
    }
    return n;
}

/** Runs an executable with an argument array, tees output to a log, resolves {code, out}. */
function run(exe, argv, logFile, opts = {}) {
    return new Promise(resolve => {
        const log = fs.createWriteStream(logFile, { flags: 'a' });
        log.write('> ' + exe + ' ' + argv.map(a => (/\s/.test(a) ? '"' + a + '"' : a)).join(' ') + '\n');
        let out = '';
        const child = spawn(exe, argv, { cwd: opts.cwd, windowsHide: true });
        const onData = d => { const s = stripAnsi(d.toString()); out += s; log.write(s); if (out.length > 4e6) out = out.slice(-2e6); };
        child.stdout.on('data', onData);
        child.stderr.on('data', onData);
        child.on('error', e => { log.end('spawn error: ' + e.message + '\n'); resolve({ code: -1, out: out + e.message }); });
        child.on('close', code => { log.end('\n[exit ' + code + ']\n'); resolve({ code, out }); });
    });
}

/** Runs a PowerShell one-liner and returns stdout. */
async function ps(command, logFile) {
    const r = await run(POWERSHELL, ['-NoProfile', '-NonInteractive', '-Command', command], logFile);
    return r.out.trim();
}

/** HTTP via Windows curl.exe (reaches Windows localhost from WSL too). */
async function http(url, logFile, form) {
    const a = ['-s', '-o', 'NUL', '-w', '%{http_code}', '--max-time', form ? '14400' : '5'];
    if (form) for (const [k, v] of Object.entries(form)) a.push('--data-urlencode', k + '=' + v);
    a.push(url);
    const r = await run(CURL, a, logFile);
    return parseInt(r.out.trim().slice(-3), 10) || 0;
}

// ---------------------------------------------------------------------------
// Tool locations (resolved by folder prefix so version bumps keep working)
// ---------------------------------------------------------------------------
const TOOLS = toLocal(args.flags.tools || __dirname);

function locateTools() {
    const ghidraHome = findDir(path.join(TOOLS, 'Ghidra'), 'ghidra_');
    const jdk = findDir(path.join(TOOLS, 'JDK'), 'jdk-');
    const ar = findDir(TOOLS, 'AssetRipper-');
    const redux = findDir(path.join(TOOLS, 'Il2CppInspectorRedux', 'LegacyCLI'), 'Il2CppInspectorRedux.Legacy.CLI');
    return {
        dumper: path.join(TOOLS, 'Il2CppDumper', 'Il2CppDumper.exe'),
        redux: redux && path.join(redux, 'Il2CppInspector.exe'),
        cpp2il: path.join(TOOLS, 'Cpp2IL', 'nightly-dev', 'Cpp2IL.exe'),
        ilspycmd: path.join(TOOLS, 'ILSpyCmd', 'ilspycmd.exe'),
        assetripper: ar && path.join(ar, 'AssetRipper.GUI.Free.exe'),
        ghidraHeadless: ghidraHome && path.join(ghidraHome, 'support', 'analyzeHeadless.bat'),
        jdk,
        ghidraScripts: path.join(TOOLS, '_scripts', 'ghidra'),
    };
}

// ---------------------------------------------------------------------------
// Game detection
// ---------------------------------------------------------------------------
const FRAMEWORK_OR_VENDOR = /^(System|Unity|UnityEngine|Mono\.|mscorlib|netstandard|Microsoft|Newtonsoft|DOTween|DG\.|DemiLib|Sirenix|Rewired|Cinemachine|FMOD|com\.rlabrecque|Steamworks|Facepunch|ParadoxNotion|RenderHeads|Photon|Mirror|FishNet|I2\.|Coffee|LeTai|Febucci|Kamgam|MalbersAnimations|Obi|Zenject|UniTask|MessagePack|Google|Firebase|Discord|PlayFab|Backtrace|Bakery|Vectrosity|NaughtyAttributes|MoreMountains|NiceVibrations|Lofelt|MK\.|Shapes|Beautify|QFSW|SRDebugger|Ude\.|clipper|ATL|Autodesk|Heathen|HTrace|InputGlyphs|NativeCursor|PerfectCulling|TND\.|LocalizationsForSettings|Assembly-CSharp-Editor|__Generated)|\.(Demos?|Examples?|Samples?|Tests?|BuildTestAssets)$/i;

/** Finds the shallowest <Name>_Data folder that has a matching <Name>.exe next to it. */
function findGameRoot(start) {
    let level = [start];
    for (let depth = 0; depth <= 4 && level.length; depth++) {
        const next = [];
        for (const dir of level) {
            let entries;
            try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
            const names = new Set(entries.map(e => e.name));
            for (const e of entries) {
                if (e.isDirectory() && e.name.endsWith('_Data') && names.has(e.name.slice(0, -5) + '.exe'))
                    return { root: dir, dataDir: path.join(dir, e.name), exeBase: e.name.slice(0, -5) };
            }
            for (const e of entries) if (e.isDirectory()) next.push(path.join(dir, e.name));
        }
        level = next;
    }
    return null;
}

/** Reads the Unity version string from the first bytes of the main data file. */
function unityVersion(dataDir) {
    for (const f of ['globalgamemanagers', 'data.unity3d', 'mainData']) {
        const p = path.join(dataDir, f);
        if (!exists(p)) continue;
        const fd = fs.openSync(p, 'r'); const b = Buffer.alloc(4096);
        fs.readSync(fd, b, 0, b.length, 0); fs.closeSync(fd);
        const m = /(\d{1,4}\.\d+\.\d+[abfpx]\d+)/.exec(b.toString('latin1'));
        if (m) return m[1];
    }
    return 'unknown';
}

/** Reads IL2CPP metadata magic + version (magic mismatch = encrypted/obfuscated). */
function metadataInfo(file) {
    const fd = fs.openSync(file, 'r'); const b = Buffer.alloc(8);
    fs.readSync(fd, b, 0, 8, 0); fs.closeSync(fd);
    const ok = b.readUInt32LE(0) === 0xFAB11BAF;
    return { ok, version: ok ? b.readInt32LE(4) : null };
}

/** Lists game (non-framework, non-vendor) assembly names. */
function gameAssemblies(dataDir, backend) {
    if (args.flags.assemblies) return args.flags.assemblies.split(',').map(s => s.trim().replace(/\.dll$/i, ''));
    let names = [];
    const sa = path.join(dataDir, 'ScriptingAssemblies.json');
    if (exists(sa)) { try { names = JSON.parse(fs.readFileSync(sa, 'utf8')).names || []; } catch { names = []; } }
    if (!names.length && backend === 'Mono') names = fs.readdirSync(path.join(dataDir, 'Managed')).filter(n => n.endsWith('.dll'));
    return [...new Set(names.map(n => n.replace(/\.dll$/i, '')))].filter(n => !FRAMEWORK_OR_VENDOR.test(n));
}

function detect(gameArg) {
    const start = toLocal(gameArg);
    if (!exists(start)) throw new Error('Game folder not found: ' + gameArg);
    const g = findGameRoot(start);
    if (!g) throw new Error('No <Name>_Data folder with a matching <Name>.exe found (searched 4 levels).');
    const meta = path.join(g.dataDir, 'il2cpp_data', 'Metadata', 'global-metadata.dat');
    const gameAssembly = path.join(g.root, 'GameAssembly.dll');
    const backend = exists(gameAssembly) && exists(meta) ? 'IL2CPP'
        : exists(path.join(g.dataDir, 'Managed', 'Assembly-CSharp.dll')) ? 'Mono' : 'unknown';
    const info = { ...g, backend, unity: unityVersion(g.dataDir), gameAssembly, metadata: meta, metadataOk: null, metadataVersion: null };
    if (backend === 'IL2CPP') { const m = metadataInfo(meta); info.metadataOk = m.ok; info.metadataVersion = m.version; }
    info.assemblies = gameAssemblies(g.dataDir, backend);
    return info;
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------
const results = [];
function record(step, status, note, extra = {}) {
    results.push({ step, status, note, ...extra });
    console.log(('[' + status + ']').padEnd(7) + ' ' + step.padEnd(12) + ' ' + note);
}

const PREVIOUS = {};

/** Keeps a previous OK result instead of redoing the step. */
function keep(step) {
    return record(step, 'OK', 'kept previous run (--force to redo): ' + PREVIOUS[step].note.replace(/^kept previous run \(--force to redo\): /, ''));
}

/** Prepares a step folder; returns false if a previous OK run exists and --force is not set. */
function prepareStepDir(OUT, dir, step) {
    if (!isInside(dir, OUT)) throw new Error('Refusing to touch a folder outside the output root: ' + dir);
    if (exists(dir)) {
        if (!args.flags.force && PREVIOUS[step] && PREVIOUS[step].status === 'OK') return false;
        fs.rmSync(dir, { recursive: true, force: true });
    }
    fs.mkdirSync(dir, { recursive: true });
    return true;
}

async function stepDumper(G, T, OUT, LOGS) {
    const dir = path.join(OUT, 'il2cppdumper');
    if (G.metadataVersion < 16 || G.metadataVersion > 31) return record('dumper', 'SKIP', 'metadata v' + G.metadataVersion + ' outside Il2CppDumper range v16..v31');
    if (!prepareStepDir(OUT, dir, 'dumper')) return keep('dumper');
    const cfgPath = path.join(path.dirname(T.dumper), 'config.json');
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    if (cfg.RequireAnyKey) { cfg.RequireAnyKey = false; fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2)); }
    const r = await run(T.dumper, [toWin(G.gameAssembly), toWin(G.metadata), toWin(dir)], path.join(LOGS, 'dumper.log'), { cwd: path.dirname(T.dumper) });
    const ok = exists(path.join(dir, 'dump.cs')) && exists(path.join(dir, 'script.json'));
    record('dumper', ok ? 'OK' : 'FAIL', ok ? 'dump.cs + DummyDll (' + countFiles(path.join(dir, 'DummyDll'), '.dll') + ' dlls) + script.json + il2cpp.h'
        : (r.out.match(/ERROR[^\r\n]*/) || ['see logs/dumper.log'])[0]);
}

async function stepRedux(G, T, OUT, LOGS) {
    const dir = path.join(OUT, 'redux');
    if (!prepareStepDir(OUT, dir, 'redux')) return keep('redux');
    const w = toWin(dir);
    const r = await run(T.redux, ['-i', toWin(G.gameAssembly), '-m', toWin(G.metadata), '-l', 'tree',
        '-c', w + '\\cs', '-p', w + '\\il2cpp_ghidra.py', '-t', 'Ghidra', '-o', w + '\\metadata.json', '-h', w + '\\cpp', '-d', w + '\\dll'],
        path.join(LOGS, 'redux.log'), { cwd: path.dirname(T.redux) });
    const ok = exists(path.join(dir, 'metadata.json'));
    const why = ((r.out.match(/The error was: ([^\r\n]*)/) || [])[1]) || (r.out.match(/[^\r\n]*(do not pass validation|does not exist)[^\r\n]*/) || ['see logs/redux.log'])[0];
    record('redux', ok ? 'OK' : 'FAIL', ok ? countFiles(path.join(dir, 'cs'), '.cs') + ' C# stub files, metadata.json, Ghidra script, C++ scaffolding' : why.slice(0, 160));
}

async function stepCpp2il(G, T, OUT, LOGS) {
    const dir = path.join(OUT, 'cpp2il', 'dll_il_recovery');
    if (!prepareStepDir(OUT, path.dirname(dir), 'cpp2il')) return keep('cpp2il');
    const r = await run(T.cpp2il, ['--game-path', toWin(G.root), '--exe-name', G.exeBase, '--output-as', 'dll_il_recovery',
        '--use-processor', 'attributeanalyzer,attributeinjector', '--output-to', toWin(dir)], path.join(LOGS, 'cpp2il.log'), { cwd: path.dirname(T.cpp2il) });
    const m = /(\d+)% of methods successfully decompiled \((\d+) \/ (\d+)\)/.exec(r.out);
    const ok = exists(path.join(dir, 'Assembly-CSharp.dll')) || countFiles(dir, '.dll') > 0;
    record('cpp2il', ok ? 'OK' : 'FAIL', ok ? (m ? m[2] + '/' + m[3] + ' methods recovered' : 'DLLs written (no recovery stats in log)')
        : (r.out.match(/\[Fail\][^\r\n]*/) || ['see logs/cpp2il.log'])[0]);
}

async function stepIlspy(G, T, OUT, LOGS) {
    const srcDir = G.backend === 'Mono' ? path.join(G.dataDir, 'Managed') : path.join(OUT, 'cpp2il', 'dll_il_recovery');
    if (!exists(srcDir)) return record('ilspy', 'SKIP', 'no input DLLs (cpp2il step missing or failed)');
    const dir = path.join(OUT, G.backend === 'Mono' ? 'cs' : 'cs-cpp2il');
    if (!prepareStepDir(OUT, dir, 'ilspy')) return keep('ilspy');
    const counts = [];
    for (const asm of G.assemblies) {
        const dll = path.join(srcDir, asm + '.dll');
        if (!exists(dll)) { counts.push(asm + '=missing'); continue; }
        await run(T.ilspycmd, ['-p', '-o', toWin(path.join(dir, asm)), '-r', toWin(srcDir), '--nested-directories', toWin(dll)], path.join(LOGS, 'ilspy.log'));
        counts.push(asm + '=' + countFiles(path.join(dir, asm), '.cs'));
    }
    const total = countFiles(dir, '.cs');
    record('ilspy', total ? 'OK' : 'FAIL', (G.backend === 'Mono' ? 'full bodies: ' : 'approx bodies: ') + counts.join(', '));
}

async function stepAssetRipper(G, T, OUT, LOGS) {
    const dir = path.join(OUT, 'assetripper');
    if (!prepareStepDir(OUT, dir, 'assetripper')) return keep('assetripper');
    const log = path.join(LOGS, 'assetripper-http.log');
    let port = 0;
    for (let i = 0; i < 20 && !port; i++) { const p = 50000 + Math.floor(Math.random() * 9999); if (!(await http('http://127.0.0.1:' + p + '/', log))) port = p; }
    if (!port) return record('assetripper', 'FAIL', 'no free port found');
    const child = spawn(T.assetripper, ['--headless', '--port', String(port), '--log-path', toWin(path.join(LOGS, 'assetripper.log'))],
        { cwd: path.dirname(T.assetripper), stdio: 'ignore', windowsHide: true });
    const base = 'http://127.0.0.1:' + port;
    try {
        let up = false;
        for (let i = 0; i < 60 && !up; i++) { await sleep(1500); up = (await http(base + '/', log)) === 200; }
        if (!up) return record('assetripper', 'FAIL', 'server did not come up on port ' + port);
        const t0 = Date.now();
        await http(base + '/LoadFolder', log, { Path: toWin(G.root) });
        await http(base + '/Export/UnityProject', log, { Path: toWin(path.join(dir, 'UnityProject')) });
        if (args.flags.primary) await http(base + '/Export/PrimaryContent', log, { Path: toWin(path.join(dir, 'PrimaryContent')) });
        const assets = path.join(dir, 'UnityProject', 'ExportedProject', 'Assets');
        const ok = exists(assets);
        record('assetripper', ok ? 'OK' : 'FAIL', ok
            ? countFiles(path.join(assets, 'Scripts'), '.cs') + ' .cs in Assets/Scripts, ' + countFiles(path.join(assets, 'Plugins'), '.dll') + ' DLLs kept in Assets/Plugins (source: ilspy step), '
              + countFiles(assets, '.prefab') + ' prefabs, ' + countFiles(assets, '.unity') + ' scenes, '
              + countFiles(assets, '.asset') + ' .asset (' + Math.round((Date.now() - t0) / 1000) + ' s)'
            : 'no ExportedProject/Assets - see logs/assetripper.log');
    } finally {
        await ps('Get-NetTCPConnection -LocalPort ' + port + ' -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }', log);
        try { child.kill(); } catch { /* already gone */ }
    }
}

async function stepGhidra(G, T, OUT, LOGS) {
    const dumpDir = path.join(OUT, 'il2cppdumper');
    if (!exists(path.join(dumpDir, 'script.json')) || !exists(path.join(dumpDir, 'il2cpp.h'))) {
        return record('ghidra', 'SKIP', 'needs Il2CppDumper output (metadata <= v31). Manual route: open GameAssembly.dll in Ghidra GUI (pyghidraRun), '
            + 'File > Parse C Source: redux/cpp/appdata/il2cpp-types.h, then run redux/il2cpp_ghidra.py');
    }
    if (!T.ghidraHeadless || !T.jdk) return record('ghidra', 'FAIL', 'Ghidra or JDK folder not found under tools');
    const dir = path.join(OUT, 'ghidra');
    if (!prepareStepDir(OUT, dir, 'ghidra')) return keep('ghidra');
    fs.mkdirSync(path.join(dir, 'project'), { recursive: true });
    const header = 'typedef unsigned __int8 uint8_t;\ntypedef unsigned __int16 uint16_t;\ntypedef unsigned __int32 uint32_t;\ntypedef unsigned __int64 uint64_t;\n'
        + 'typedef __int8 int8_t;\ntypedef __int16 int16_t;\ntypedef __int32 int32_t;\ntypedef __int64 int64_t;\ntypedef __int64 intptr_t;\n'
        + 'typedef __int64 uintptr_t;\ntypedef unsigned __int64 size_t;\ntypedef _Bool bool;\n';
    const h = fs.readFileSync(path.join(dumpDir, 'il2cpp.h'), 'utf8').replace(/: (\w+) \{/g, '{\n $1 super;');
    fs.writeFileSync(path.join(dir, 'il2cpp_ghidra.h'), header + h);
    const W = toWin(dir);
    const bat = ['@echo off',
        'set "JAVA_HOME=' + toWin(T.jdk) + '"', 'set "PATH=%JAVA_HOME%\\bin;%PATH%"', 'set "GHIDRA_HEADLESS_MAXMEM=' + (args.flags['ghidra-mem'] || '12G') + '"',
        'call "' + toWin(T.ghidraHeadless) + '" "' + W + '\\project" "' + G.exeBase.replace(/[^\w.-]/g, '_') + '" ^',
        ' -import "' + toWin(G.gameAssembly) + '" -overwrite ^',
        ' -scriptPath "' + toWin(T.ghidraScripts) + '" ^',
        ' -preScript ParseIl2cppHeader.java "' + W + '\\il2cpp_ghidra.h" ^',
        ' -preScript il2cpp_apply_with_struct.py "' + toWin(path.join(dumpDir, 'script.json')) + '" ^',
        ' -log "' + W + '\\ghidra-headless.log" -scriptlog "' + W + '\\ghidra-scripts.log"',
        'echo EXITCODE=%ERRORLEVEL% > "' + W + '\\DONE.txt"', ''].join('\r\n');
    fs.writeFileSync(path.join(dir, 'run-headless.bat'), bat);
    await ps("Start-Process -FilePath 'cmd.exe' -ArgumentList '/c','\"" + W + "\\run-headless.bat\"' -WindowStyle Minimized", path.join(LOGS, 'ghidra-launch.log'));
    record('ghidra', 'OK', 'launched detached; finished when ' + W + '\\DONE.txt exists (can take hours)');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
(async () => {
    let G;
    try { G = detect(args.game); } catch (e) { console.error('ERROR: ' + e.message); process.exit(2); }
    const T = locateTools();
    const name = (args.flags.name || G.exeBase).replace(/[^\w.-]+/g, '_');
    const OUT = toLocal(args.flags.out || path.join(TOOLS, 'output', name));
    if (OUT === G.root || isInside(OUT, G.root)) { console.error('ERROR: output must not be inside the game folder.'); process.exit(2); }

    let steps = G.backend === 'IL2CPP' ? ['dumper', 'redux', 'cpp2il', 'ilspy', 'assetripper'] : ['ilspy', 'assetripper'];
    if (args.flags.steps) steps = args.flags.steps.split(',').map(s => s.trim());
    if (args.flags.ghidra && !steps.includes('ghidra')) steps.push('ghidra');
    const bad = steps.filter(s => !ALL_STEPS.includes(s));
    if (bad.length) { console.error('Unknown step(s): ' + bad.join(', ')); process.exit(2); }
    if (G.backend === 'Mono') steps = steps.filter(s => ['ilspy', 'assetripper'].includes(s));

    console.log('Game       : ' + toWin(G.root));
    console.log('Executable : ' + G.exeBase + '.exe');
    console.log('Unity      : ' + G.unity);
    console.log('Backend    : ' + G.backend + (G.backend === 'IL2CPP'
        ? '  metadata ' + (G.metadataOk ? 'v' + G.metadataVersion : 'ENCRYPTED/OBFUSCATED (bad magic)') : ''));
    console.log('Assemblies : ' + (G.assemblies.join(', ') || '(none detected)'));
    console.log('Output     : ' + toWin(OUT));
    console.log('Steps      : ' + steps.join(', '));
    const missing = steps.map(s => s === 'ilspy' ? 'ilspycmd' : s === 'ghidra' ? 'ghidraHeadless' : s).filter(k => !T[k] || !exists(T[k]));
    if (missing.length) console.log('WARNING    : tool(s) not found under ' + toWin(TOOLS) + ': ' + missing.join(', '));
    if (G.backend === 'unknown') { console.error('ERROR: neither IL2CPP nor Mono layout detected.'); process.exit(2); }
    if (args.flags['dry-run']) process.exit(0);

    const LOGS = path.join(OUT, 'logs');
    fs.mkdirSync(LOGS, { recursive: true });
    try { for (const r of JSON.parse(fs.readFileSync(path.join(OUT, 'report.json'), 'utf8')).results || []) PREVIOUS[r.step] = r; } catch { /* first run */ }
    console.log('');
    const runners = { dumper: stepDumper, redux: stepRedux, cpp2il: stepCpp2il, ilspy: stepIlspy, assetripper: stepAssetRipper, ghidra: stepGhidra };
    for (const s of steps) {
        const toolKey = s === 'ilspy' ? 'ilspycmd' : s === 'ghidra' ? 'ghidraHeadless' : s;
        if (G.backend === 'IL2CPP' && G.metadataOk === false && ['dumper', 'redux', 'cpp2il'].includes(s)) { record(s, 'SKIP', 'metadata encrypted/obfuscated - needs a decryptor first'); continue; }
        if (!T[toolKey] || !exists(T[toolKey])) { record(s, 'FAIL', 'tool missing: ' + toolKey); continue; }
        const t0 = Date.now();
        try { await runners[s](G, T, OUT, LOGS); } catch (e) { record(s, 'FAIL', e.message); }
        results[results.length - 1].seconds = Math.round((Date.now() - t0) / 1000);
    }

    const merged = [...Object.values(PREVIOUS).filter(p => !results.some(r => r.step === p.step)), ...results]
        .sort((a, b) => ALL_STEPS.indexOf(a.step) - ALL_STEPS.indexOf(b.step));
    const report = { game: toWin(G.root), exe: G.exeBase, unity: G.unity, backend: G.backend, metadataVersion: G.metadataVersion,
        metadataOk: G.metadataOk, assemblies: G.assemblies, output: toWin(OUT), finished: new Date().toISOString(), results: merged };
    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
    console.log('\nReport     : ' + toWin(path.join(OUT, 'report.json')));
    process.exit(results.some(r => r.status === 'FAIL') ? 1 : 0);
})();
