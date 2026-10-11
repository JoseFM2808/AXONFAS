"""Construye el panel de contexto de AXONFAS: las seis pestañas de `.ai-context/` en una sola página HTML.

    py src/frontend/context-panel/build_panel.py               -> src/frontend/context-panel/dist/axonfas-panel.html
    py src/frontend/context-panel/build_panel.py OTRO.html

La fuente de verdad son los `.md` de `.ai-context/`; el HTML se regenera y nunca se edita a mano. Tras regenerarlo se
republica en la misma URL de artifact (ver CLAUDE.md). Los bloques mermaid salen como <pre class="mermaid">, que el
visor de artifacts dibuja solo. Convierte el subconjunto de Markdown que usan las pestañas: títulos, párrafos, listas,
tablas, citas, código, negrita, cursiva y enlaces. Solo biblioteca estándar (Python 3.11+).
"""
from __future__ import annotations

import html
import math
import re
import sys
import unicodedata
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]                                  # src/frontend/context-panel/ -> AXONFAS
CTX = ROOT / ".ai-context"
TEMPLATE = HERE / "template.html"
LAUNCH = ROOT / "src" / "frontend" / "validation-prototype" / "lanzar-prototipo.cmd"   # script de lanzamiento (TD-33)
OUT = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else HERE / "dist" / "axonfas-panel.html"

# (ancla estable para enlaces profundos, etiqueta, número de pestaña)
TABS = [("logic", "Lógica", "01"), ("architecture", "Arquitectura", "02"), ("database", "Base de datos", "03"),
        ("decisions", "Decisiones", "04"), ("pending", "Pendientes", "05"), ("api", "API y MCP", "06")]
HACKATHON = {"start": "2026-10-12", "end": "2026-10-18"}     # 05-tech-debt.md §El hackathon

CODE_RE = re.compile(r"`([^`]+)`")
LINK_RE = re.compile(r"\[([^\]]+)\]\(([^)\s]+)\)")
ID_RE = re.compile(r"\b(ADR-\d{3}|TD-\d{2,3}|I-\d+)\b")
ROW_ID_RE = re.compile(r"^(TD-\d{2,3}|I-\d+)$")
MERMAID_INIT = '%%{init: {"theme": "neutral"}}%%'
CHIPS = {"P1": "p1", "P2": "p2", "P3": "p3", "Aceptada": "ok", "Propuesta": "hold", "Reemplazada": "off"}


def esc(s: str) -> str:
    return html.escape(s, quote=False)


def slug(text: str) -> str:
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", text).strip("-")[:60]


class Renderer:
    """Markdown de una pestaña -> HTML. `anchors` son los ids que existen en todo el panel (ADR, TD, I)."""

    def __init__(self, tab_of_file: dict[str, str], anchors: set[str]):
        self.tab_of_file = tab_of_file
        self.anchors = anchors

    # ------------------------------------------------------------------ inline
    def inline(self, text: str, autolink: bool = True) -> str:
        """El código se aparta primero, así una **negrita** puede envolver `código` sin que se toque su contenido."""
        codes: list[str] = []

        def code(m: re.Match) -> str:
            codes.append(f"<code>{esc(m.group(1))}</code>")
            return f"\x01{len(codes) - 1}\x01"

        s = self._plain(CODE_RE.sub(code, text), autolink)
        return re.sub(r"\x01(\d+)\x01", lambda m: codes[int(m.group(1))], s)

    def _plain(self, s: str, autolink: bool) -> str:
        kept: list[str] = []

        def keep(fragment: str) -> str:
            kept.append(fragment)
            return f"\x00{len(kept) - 1}\x00"

        def link(m: re.Match) -> str:
            label, href = self._emph(esc(m.group(1))), m.group(2)
            if re.match(r"^https?://", href):
                return keep(f'<a href="{html.escape(href)}" target="_blank" rel="noopener">{label}</a>')
            target = href.split("#", 1)[0]
            if target in self.tab_of_file:                 # enlace a otra pestaña
                return keep(f'<a href="#{self.tab_of_file[target]}">{label}</a>')
            return keep(f'<span class="file" title="{html.escape(href)}">{label}</span>')   # archivo del repo

        s = self._emph(esc(LINK_RE.sub(link, s)))
        if autolink:
            s = ID_RE.sub(lambda m: (f'<a class="ref" href="#{m.group(1).lower()}">{m.group(1)}</a>'
                                     if m.group(1).lower() in self.anchors else m.group(1)), s)
        return re.sub(r"\x00(\d+)\x00", lambda m: kept[int(m.group(1))], s)

    @staticmethod
    def _emph(s: str) -> str:
        s = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", s)
        return re.sub(r"(?<![\w])_(?!\s)(.+?)(?<!\s)_(?![\w])", r"<em>\1</em>", s)

    # ------------------------------------------------------------------ blocks
    def render(self, md: str, tab: str) -> tuple[str, str]:
        lines = md.replace("\r\n", "\n").split("\n")
        title, out, para, i = "", [], [], 0

        def flush() -> None:
            if para:
                out.append(f"<p>{self.inline(' '.join(para))}</p>")
                para.clear()

        while i < len(lines):
            s = lines[i].strip()
            if s.startswith("```"):
                flush()
                lang, j = s[3:].strip(), i + 1
                while j < len(lines) and not lines[j].strip().startswith("```"):
                    j += 1
                code = esc("\n".join(lines[i + 1:j]))
                if lang == "mermaid":                      # tema fijo: el diagrama va sobre un fondo claro en ambos temas
                    out.append(f'<figure class="diagram"><pre class="mermaid">{MERMAID_INIT}\n{code}</pre></figure>')
                else:
                    out.append(f'<pre class="code"><code>{code}</code></pre>')
                i = j + 1
            elif not s:
                flush()
                i += 1
            elif m := re.match(r"^(#{1,6})\s+(.*)$", s):
                flush()
                level, text = len(m.group(1)), m.group(2)
                if level == 1 and not title:
                    title = text
                else:
                    adr = re.match(r"^(ADR-\d{3})", text)
                    hid = adr.group(1).lower() if adr else f"{tab}-{slug(text)}"
                    tag = f"h{min(level + 1, 6)}"
                    out.append(f'<{tag} id="{hid}">{self.inline(text, autolink=False)}</{tag}>')
                i += 1
            elif s.startswith(">"):
                flush()
                quote = []
                while i < len(lines) and lines[i].strip().startswith(">"):
                    quote.append(self.inline(lines[i].strip().lstrip(">").strip()))
                    i += 1
                out.append(f'<div class="meta">{"<br>".join(quote)}</div>')
            elif s.startswith("|") and i + 1 < len(lines) and re.match(r"^\s*\|?\s*:?-{3,}", lines[i + 1]):
                flush()
                j = i + 2
                while j < len(lines) and lines[j].strip().startswith("|"):
                    j += 1
                out.append(self._table(lines[i], lines[i + 2:j], tab))
                i = j
            elif re.match(r"^([-*]|\d+\.)\s+", s):
                flush()
                ordered = bool(re.match(r"^\d+\.", s))
                items: list[str] = []
                while i < len(lines):
                    raw = lines[i]
                    if re.match(r"^\s*([-*]|\d+\.)\s+", raw) and not raw.startswith("    "):
                        items.append(re.sub(r"^\s*([-*]|\d+\.)\s+", "", raw).strip())
                    elif raw.startswith(" ") and raw.strip() and items:
                        items[-1] += " " + raw.strip()             # continuación de la línea anterior
                    else:
                        break
                    i += 1
                tag = "ol" if ordered else "ul"
                out.append(f"<{tag}>" + "".join(f"<li>{self.inline(t)}</li>" for t in items) + f"</{tag}>")
            elif s in ("---", "***"):
                flush()
                out.append("<hr>")
                i += 1
            else:
                para.append(s)
                i += 1
        flush()
        return title, "\n".join(out)

    def _table(self, head: str, rows: list[str], tab: str) -> str:
        heads = split_row(head)
        parts = ["<thead><tr>" + "".join(f"<th>{self.inline(h, False)}</th>" for h in heads) + "</tr></thead><tbody>"]
        for row in rows:
            cells = split_row(row)
            first = cells[0] if cells else ""
            rid = f' id="{first.lower()}"' if ROW_ID_RE.match(first) else ""
            tds = []
            for k, cell in enumerate(cells):
                if k == 0 and (rid or (tab == "decisions" and re.fullmatch(r"\d{3}", cell))):
                    inner = (f'<a class="ref" href="#adr-{cell}">ADR-{cell}</a>' if not rid
                             else f"<strong>{esc(cell)}</strong>")
                elif cell in CHIPS:
                    inner = f'<span class="chip {CHIPS[cell]}">{esc(cell)}</span>'
                else:
                    inner = self.inline(cell)
                tds.append(f"<td>{inner}</td>")
            parts.append(f"<tr{rid}>" + "".join(tds) + "</tr>")
        return '<div class="table-wrap"><table>' + "".join(parts) + "</tbody></table></div>"


def split_row(row: str) -> list[str]:
    """Celdas de una fila de tabla; un | dentro de `código` no separa celdas."""
    cells, cur, in_code = [], "", False
    for ch in row.strip().strip("|"):
        if ch == "`":
            in_code = not in_code
        if ch == "|" and not in_code:
            cells.append(cur.strip())
            cur = ""
        else:
            cur += ch
    cells.append(cur.strip())
    return cells


def goniometer() -> str:
    """Motivo: goniómetro con el sobre de seguridad y el ejemplo del turno de voz de 01 (meta de ROM 90° -> 70°)."""
    cx, cy, r = 110, 112, 84                                  # 0° a la derecha, 180° a la izquierda

    def pt(deg: float, rad: float) -> tuple[float, float]:
        a = math.radians(deg)
        return cx + rad * math.cos(a), cy - rad * math.sin(a)

    ticks = []
    for d in range(0, 181, 10):
        x1, y1 = pt(d, r)
        x2, y2 = pt(d, r - (11 if d % 30 == 0 else 6))
        ticks.append(f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" class="tick"/>')
    (bx1, by1), (bx2, by2) = pt(40, r - 20), pt(100, r - 20)
    band = f'<path d="M{bx1:.1f},{by1:.1f} A{r - 20},{r - 20} 0 0 0 {bx2:.1f},{by2:.1f}" class="band"/>'
    (ox, oy), (nx, ny) = pt(90, r - 26), pt(70, r - 26)
    (lx, ly), (mx, my) = pt(90, r + 12), pt(70, r + 12)
    return (f'<svg class="gonio" viewBox="0 0 220 124" role="img" aria-labelledby="gonio-t">'
            f'<title id="gonio-t">Goniómetro: el sobre de seguridad del terapeuta y una meta de rango de movimiento '
            f'que baja de 90 a 70 grados</title>'
            f'<path d="M{cx - r},{cy} A{r},{r} 0 0 1 {cx + r},{cy}" class="scale"/>{"".join(ticks)}{band}'
            f'<line x1="{cx}" y1="{cy}" x2="{ox:.1f}" y2="{oy:.1f}" class="needle old"/>'
            f'<line x1="{cx}" y1="{cy}" x2="{nx:.1f}" y2="{ny:.1f}" class="needle"/>'
            f'<circle cx="{cx}" cy="{cy}" r="4.5" class="pivot"/>'
            f'<text x="{lx:.1f}" y="{ly:.1f}" class="deg old" text-anchor="middle">90°</text>'
            f'<text x="{mx:.1f}" y="{my:.1f}" class="deg" text-anchor="start">70°</text>'
            f'<line x1="{cx - r - 6}" y1="{cy}" x2="{cx + r + 6}" y2="{cy}" class="base"/></svg>')


def tab_sources() -> dict[str, list[Path]]:
    found = {num: sorted(CTX.glob(f"{num}-*.md")) for _, _, num in TABS}
    missing = [num for num, files in found.items() if not files]
    if missing:
        sys.exit(f"faltan pestañas en .ai-context/: {', '.join(missing)}")
    return found


def summary(texts: dict[str, str]) -> dict:
    parts = re.split(r"^## Hechos.*$", texts["05"], maxsplit=1, flags=re.M)
    open_part, done_part = parts[0], parts[1] if len(parts) > 1 else ""
    prio = re.findall(r"^\|\s*TD-\d+\s*\|\s*(P[123])\s*\|", open_part, re.M)
    done = re.findall(r"^\|\s*TD-\d+\s*\|", done_part, re.M)
    adrs = re.findall(r"^##\s+ADR-\d{3}.*?—\s*(\w+)\s*$", texts["04"], re.M)
    invariants = re.findall(r"^\|\s*I-\d+\s*\|", texts["01"], re.M)
    updated = max(re.findall(r"Actualizado:\s*(\d{4}-\d{2}-\d{2})", "\n".join(texts.values())) or ["—"])
    return {"p1": prio.count("P1"), "p2": prio.count("P2"), "p3": prio.count("P3"), "open": len(prio),
            "done": len(done), "adrs": len(adrs), "accepted": adrs.count("Aceptada"),
            "invariants": len(invariants), "updated": updated}


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sources = tab_sources()
    texts = {num: "\n\n".join(p.read_text(encoding="utf-8") for p in files) for num, files in sources.items()}
    tab_of_file = {p.name: tab for tab, _, num in TABS for p in sources[num]}
    anchors = {a.lower() for t in texts.values() for a in re.findall(r"^#{1,4}\s+(ADR-\d{3})", t, re.M)}
    anchors |= {a.lower() for t in texts.values() for a in re.findall(r"^\|\s*(TD-\d{2,3}|I-\d+)\s*\|", t, re.M)}
    renderer = Renderer(tab_of_file, anchors)

    nav, panels = [], []
    for k, (tab, label, num) in enumerate(TABS):
        title, body = renderer.render(texts[num], tab)
        nav.append(f'<button type="button" role="tab" id="tab-{tab}" aria-controls="{tab}" data-tab="{tab}" '
                   f'aria-selected="{"true" if k == 0 else "false"}" tabindex="{0 if k == 0 else -1}">'
                   f'<span class="num">{num}</span>{esc(label)}</button>')
        files = ", ".join(p.name for p in sources[num])
        panels.append(f'<section class="panel{"" if k == 0 else " is-off"}" id="{tab}" role="tabpanel" '
                      f'aria-labelledby="tab-{tab}"{"" if k == 0 else " inert"}>'
                      f'<header class="panel-head"><h2>{renderer.inline(title, False)}</h2>'
                      f'<span class="src">.ai-context/{esc(files)}</span></header>{body}</section>')

    s = summary(texts)
    bar = "".join(f'<span class="seg {p}" style="flex-grow:{s[p]}" title="{p.upper()}: {s[p]}"></span>'
                  for p in ("p1", "p2", "p3") if s[p])
    launch = LAUNCH.read_text(encoding="utf-8").replace("\r\n", "\n").strip() if LAUNCH.is_file() else "(falta el script)"
    page = TEMPLATE.read_text(encoding="utf-8")
    for key, value in {
        "LAUNCH_FILE": LAUNCH.relative_to(ROOT).as_posix(), "LAUNCH_SCRIPT": esc(launch),
        "LAUNCH_CMD": esc(f'cd "{ROOT}"; py src\\frontend\\validation-prototype\\serve.py'),
        "GONIOMETER": goniometer(), "NAV": "".join(nav), "PANELS": "\n".join(panels), "PRIO_BAR": bar,
        "OPEN": str(s["open"]), "P1": str(s["p1"]), "P2": str(s["p2"]), "P3": str(s["p3"]), "DONE": str(s["done"]),
        "ADRS": str(s["adrs"]), "ACCEPTED": str(s["accepted"]), "INVARIANTS": str(s["invariants"]),
        "UPDATED": s["updated"], "BUILT": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "HACK_START": HACKATHON["start"], "HACK_END": HACKATHON["end"],
    }.items():
        page = page.replace("{{" + key + "}}", value)
    if leftover := re.findall(r"\{\{[A-Z0-9_]+\}\}", page):
        sys.exit(f"marcadores sin reemplazar en template.html: {', '.join(sorted(set(leftover)))}")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(page, encoding="utf-8")
    print(f"panel: {OUT} ({OUT.stat().st_size / 1024:.0f} KB) · {s['open']} pendientes abiertos "
          f"(P1 {s['p1']} · P2 {s['p2']} · P3 {s['p3']}), {s['done']} hechos, {s['adrs']} ADRs")
    return 0


if __name__ == "__main__":
    sys.exit(main())
