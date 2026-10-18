"""AXONFAS · video de presentación: un solo comando para preparar, narrar, previsualizar y exportar.

El código vive en el repo (Google Drive), pero `node_modules`, el venv del TTS, el modelo Kokoro, el audio y el .mp4 van
a un workdir fuera de Drive y del repo: `~/.axonfas/video-presentation` (o `AXONFAS_VIDEO_WORKDIR`), junto a la base de
Staging y los certificados. Cada comando copia primero el código y `docs/design-system/tokens.css` al workdir.

    py video.py setup         # copia el proyecto e instala las dependencias de Node
    py video.py voice-setup   # venv con kokoro-onnx y el modelo Kokoro-82M (una vez, ~340 MB)
    py video.py voice         # genera la voz en off (Kokoro, o las voces de Windows si Kokoro no está)
    py video.py check         # TypeScript sin errores
    py video.py studio        # abre Remotion Studio para revisar escena por escena
    py video.py still 600 1350     # exporta uno o varios fotogramas a PNG (un solo bundle)
    py video.py render        # exporta el .mp4 (1920x1080, 30 fps)
    py video.py render --preview   # .mp4 corto de prueba (primeros 10 s a la mitad de resolución)
    py video.py all           # setup + voice + render

Solo biblioteca estándar.
"""
from __future__ import annotations

import argparse
import hashlib
import os
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
TOKENS = REPO / "docs" / "design-system" / "tokens.css"
COMPOSITION = "AXONFAS"
COPY_FILES = ["package.json", "package-lock.json", "tsconfig.json", "remotion.config.ts"]
COPY_DIRS = ["src", "script", "tts", "tools"]

KOKORO_BASE = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/"
KOKORO_FILES = {  # SHA-256 de la versión v1.0 del modelo (Kokoro-82M, Apache-2.0)
    "kokoro-v1.0.onnx":
        "7d5df8ecf7d4b1878015a32686053fd0eebe2bc377234608764cc0ef3636a6c5",
    "voices-v1.0.bin":
        "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d",
}


def workdir() -> Path:
    env = os.environ.get("AXONFAS_VIDEO_WORKDIR")
    if env:
        return Path(env)
    return Path.home() / ".axonfas" / "video-presentation"


def run(cmd: list[str], cwd: Path) -> None:
    print("›", " ".join(cmd))
    exe = shutil.which(cmd[0])
    if not exe:
        raise SystemExit(f"No encuentro `{cmd[0]}` en el PATH.")
    res = subprocess.run([exe, *cmd[1:]], cwd=cwd)
    if res.returncode != 0:
        raise SystemExit(res.returncode)


def sync(wd: Path) -> None:
    wd.mkdir(parents=True, exist_ok=True)
    for name in COPY_FILES:
        src = HERE / name
        if src.is_file():
            shutil.copy2(src, wd / name)
    ignore = shutil.ignore_patterns("__pycache__", "*.pyc", "design-system")
    for name in COPY_DIRS:
        shutil.copytree(HERE / name, wd / name, dirs_exist_ok=True, ignore=ignore)
    tokens_dst = wd / "src" / "design-system"
    tokens_dst.mkdir(parents=True, exist_ok=True)
    shutil.copy2(TOKENS, tokens_dst / "tokens.css")
    (wd / "public").mkdir(exist_ok=True)


def cmd_setup(wd: Path) -> None:
    sync(wd)
    run(["npm", "ci" if (wd / "package-lock.json").is_file() else "install", "--no-audit", "--no-fund"], wd)
    if not (HERE / "package-lock.json").is_file() and (wd / "package-lock.json").is_file():
        shutil.copy2(wd / "package-lock.json", HERE / "package-lock.json")
        print("package-lock.json copiado al repo (versiónalo).")


def venv_python(wd: Path) -> Path:
    return wd / ".venv" / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def cmd_voice_setup(wd: Path) -> None:
    sync(wd)
    py = venv_python(wd)
    if not py.is_file():
        run([sys.executable, "-m", "venv", str(wd / ".venv")], wd)
    run([str(py), "-m", "pip", "install", "--disable-pip-version-check", "-r", str(wd / "tts" / "requirements.txt")], wd)
    models = wd / "models"
    models.mkdir(exist_ok=True)
    for name, digest in KOKORO_FILES.items():
        dst = models / name
        if not dst.is_file():
            print(f"Descargando {name} de {KOKORO_BASE} …")
            tmp = dst.with_suffix(dst.suffix + ".part")
            urllib.request.urlretrieve(KOKORO_BASE + name, tmp)
            tmp.replace(dst)
        got = sha256(dst)
        if digest and got != digest:
            raise SystemExit(f"{name}: SHA-256 inesperado ({got}). Bórralo y vuelve a correr voice-setup.")
        print(f"  {name} · {dst.stat().st_size / 1e6:.0f} MB · sha256 {got[:16]}…")


def cmd_voice(wd: Path, extra: list[str]) -> None:
    sync(wd)
    py = venv_python(wd)
    interpreter = str(py) if py.is_file() else sys.executable
    run([interpreter, str(wd / "tts" / "narrate.py"), "--out", str(wd / "public"), "--models", str(wd / "models"),
         *extra], wd)


def npx(wd: Path, args: list[str]) -> None:
    if not (wd / "node_modules").is_dir():
        raise SystemExit("Faltan las dependencias: corre `py video.py setup` primero.")
    run(["npx", *args], wd)


def main() -> int:
    ap = argparse.ArgumentParser(description="Video de presentación de AXONFAS (Remotion + TTS local).")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("setup")
    sub.add_parser("voice-setup")
    pv = sub.add_parser("voice")
    pv.add_argument("--backend", choices=["auto", "kokoro", "sapi"], default="auto")
    pv.add_argument("--voice")
    pv.add_argument("--speed")
    sub.add_parser("check")
    sub.add_parser("studio")
    ps = sub.add_parser("still")
    ps.add_argument("frames", type=int, nargs="+")
    pr = sub.add_parser("render")
    pr.add_argument("--preview", action="store_true", help="primeros 10 s a la mitad de resolución")
    pr.add_argument("--frames", help="rango de fotogramas de Remotion, por ejemplo 450-1049")
    pr.add_argument("--out", type=Path, help="ruta del .mp4 (por defecto, <workdir>/out/axonfas.mp4)")
    sub.add_parser("all")
    sub.add_parser("where")
    args = ap.parse_args()
    wd = workdir()

    if args.cmd == "where":
        print(wd)
    elif args.cmd == "setup":
        cmd_setup(wd)
    elif args.cmd == "voice-setup":
        cmd_voice_setup(wd)
    elif args.cmd == "voice":
        extra = ["--backend", args.backend]
        if args.voice:
            extra += ["--voice", args.voice]
        if args.speed:
            extra += ["--speed", args.speed]
        cmd_voice(wd, extra)
    elif args.cmd == "check":
        sync(wd)
        npx(wd, ["tsc", "--noEmit"])
    elif args.cmd == "studio":
        sync(wd)
        npx(wd, ["remotion", "studio", "src/index.ts"])
    elif args.cmd == "still":
        sync(wd)
        if not (wd / "node_modules").is_dir():
            raise SystemExit("Faltan las dependencias: corre `py video.py setup` primero.")
        run(["node", "tools/stills.mjs", *map(str, args.frames)], wd)
    elif args.cmd in ("render", "all"):
        if args.cmd == "all":
            cmd_setup(wd)
            cmd_voice(wd, ["--backend", "auto"])
        sync(wd)
        preview = getattr(args, "preview", False)
        default_name = "axonfas-preview.mp4" if preview else "axonfas.mp4"
        out = getattr(args, "out", None) or wd / "out" / default_name
        flags = ["--codec=h264", "--crf=18"]
        if preview:
            flags += ["--scale=0.5", "--frames=0-299"]
        if getattr(args, "frames", None):
            flags.append(f"--frames={args.frames}")
        npx(wd, ["remotion", "render", "src/index.ts", COMPOSITION, str(out), *flags])
        print(f"Listo: {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
