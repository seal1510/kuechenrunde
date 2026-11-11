#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Küchenrunde – synthetische Foto-/Scan-Fixtures für den Rezept-OCR-Test.

Erzeugt deterministisch JPEG-Testbilder frei erfundener deutscher Rezepte und
die zugehörige Ground Truth für den Live-Test des Workers-AI-Fotoimports.

Wichtig:
  * Alle Rezepte sind frei erfunden. Es werden keine echten Familienrezepte
    gelesen oder abgebildet; ``fixtures-private/`` wird nicht angefasst.
  * Es werden keine externen Ressourcen geladen. Schriftarten kommen aus dem
    macOS-Systemverzeichnis, Rauschen/Beleuchtung entstehen aus festen Seeds.
  * Ein Lauf erzeugt byte-identische Dateien (SHA-256 wird ausgegeben).

Aufruf:
    python3 scripts/generate-photo-ocr-fixtures.py

Ausgabe:
    tests/fixtures/photo-ocr/*.jpg
    tests/fixtures/photo-ocr/ground-truth.json
"""

from __future__ import annotations

import hashlib
import json
import sys
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

REPO_ROOT = Path(__file__).resolve().parents[1]
FIXTURE_DIR = REPO_ROOT / "tests" / "fixtures" / "photo-ocr"
GROUND_TRUTH_PATH = FIXTURE_DIR / "ground-truth.json"

# A4 bei ca. 200 dpi: lange Kante 2339 px (Zielkorridor 2000–2400 px).
PAGE_W, PAGE_H = 1654, 2339
JPEG_QUALITY = 85
JPEG_SUBSAMPLING = 2  # 4:2:0
MAX_FILE_BYTES = 2_500_000
MIN_LONG_EDGE, MAX_LONG_EDGE = 2000, 2400

PAPER = (252, 250, 244)
PAPER_HARD = (246, 245, 240)
INK = (28, 28, 33)
INK_HAND = (30, 34, 66)
INK_HARD = (88, 90, 110)

FONT_DIRS = (
    Path("/System/Library/Fonts/Supplemental"),
    Path("/System/Library/Fonts"),
    Path("/Library/Fonts"),
    Path.home() / "Library" / "Fonts",
)


# --------------------------------------------------------------------------
# Schriftarten
# --------------------------------------------------------------------------


def _font_path(name: str) -> Path:
    for directory in FONT_DIRS:
        candidate = directory / name
        if candidate.is_file():
            return candidate
    raise SystemExit(
        f"Schriftart nicht gefunden: {name!r}. Erwartet unter "
        + ", ".join(str(d) for d in FONT_DIRS)
        + ". Das Skript benötigt die macOS-Systemschriften."
    )


@lru_cache(maxsize=None)
def font(name: str, size: int, index: int = 0) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(_font_path(name)), size, index=index)


# --------------------------------------------------------------------------
# Papier, Hintergrund, Rauschen
# --------------------------------------------------------------------------


def paper(
    seed: int,
    width: int = PAGE_W,
    height: int = PAGE_H,
    base: tuple[int, int, int] = PAPER,
    vignette: float = 0.05,
    grain: float = 1.2,
    mottle: float = 2.6,
) -> Image.Image:
    """Helles Papier mit schwacher Maserung, Körnung und Vignette."""
    rng = np.random.default_rng(seed)
    low_h, low_w = height // 40 + 3, width // 40 + 3
    low = rng.normal(0.0, 1.0, (low_h, low_w)).astype(np.float32)
    low_img = Image.fromarray(low, mode="F").resize((width, height), Image.BICUBIC)
    low_arr = np.asarray(low_img, dtype=np.float32)
    low_arr = low_arr / (float(low_arr.std()) + 1e-6)

    rgb = np.empty((height, width, 3), dtype=np.float32)
    warm = np.array([1.0, 0.996, 0.985], dtype=np.float32)
    for channel in range(3):
        rgb[..., channel] = base[channel] * warm[channel] + low_arr * mottle

    grain_arr = rng.normal(0.0, grain, (height, width, 1)).astype(np.float32)
    rgb += grain_arr

    yy = np.linspace(-1.0, 1.0, height, dtype=np.float32)[:, None]
    xx = np.linspace(-1.0, 1.0, width, dtype=np.float32)[None, :]
    shade = 1.0 - vignette * (xx * xx + yy * yy) / 2.0
    rgb *= shade[..., None]
    return Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), "RGB")


def desk_background(seed: int, width: int, height: int) -> Image.Image:
    """Grauer Tisch als Hintergrund für das simulierte Handyfoto."""
    rng = np.random.default_rng(seed ^ 0xD35C)
    yy, xx = np.mgrid[0:height, 0:width].astype(np.float32)
    gx = xx / max(1, width - 1)
    gy = yy / max(1, height - 1)
    light = 0.82 + 0.24 * (0.55 * (1.0 - gx) + 0.45 * (1.0 - gy))
    low = rng.normal(0.0, 6.0, (height // 24 + 3, width // 24 + 3)).astype(np.float32)
    low_img = Image.fromarray(low, mode="F").resize((width, height), Image.BICUBIC)
    texture = np.asarray(low_img, dtype=np.float32)

    base = np.array([112.0, 112.0, 116.0], dtype=np.float32)
    rgb = np.empty((height, width, 3), dtype=np.float32)
    for channel in range(3):
        rgb[..., channel] = base[channel] * light + texture
    rgb += rng.normal(0.0, 2.0, (height, width, 1)).astype(np.float32)
    return Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), "RGB").convert("RGBA")


def add_scan_noise(image: Image.Image, seed: int, sigma: float = 1.2) -> Image.Image:
    rng = np.random.default_rng(seed ^ 0x5CA7)
    arr = np.asarray(image.convert("RGB"), dtype=np.float32)
    arr += rng.normal(0.0, sigma, arr.shape)
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGB")


# --------------------------------------------------------------------------
# Text- und Handschrift-Helfer
# --------------------------------------------------------------------------


def wrap_lines(
    draw: ImageDraw.ImageDraw,
    text: str,
    f: ImageFont.FreeTypeFont,
    max_width: float,
) -> list[str]:
    words = text.split()
    if not words:
        return []
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = word if not current else f"{current} {word}"
        if draw.textlength(candidate, font=f) <= max_width or not current:
            current = candidate
        else:
            lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines


def hand_line(
    canvas: Image.Image,
    text: str,
    f: ImageFont.FreeTypeFont,
    x: float,
    y: float,
    fill: tuple[int, int, int],
    alpha: int,
    rng: np.random.Generator,
    jitter: float = 1.0,
    blur: float = 0.0,
    strike: bool = False,
) -> None:
    """Zeichnet eine leicht verkippte, leicht versetzte Handschriftzeile."""
    if not text:
        return
    left, top, right, bottom = f.getbbox(text)
    pad = 24
    width = int(right - left + 2 * pad)
    height = int(bottom - top + 2 * pad)
    layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    layer_draw = ImageDraw.Draw(layer)
    layer_draw.text((pad - left, pad - top), text, font=f, fill=(*fill, alpha))
    angle = float(rng.uniform(-jitter, jitter))
    rotated = layer.rotate(angle, expand=True, resample=Image.BICUBIC)
    if blur:
        rotated = rotated.filter(ImageFilter.GaussianBlur(blur))
    center_x = x - pad + width / 2.0
    center_y = y - pad + height / 2.0
    dest = (
        int(round(center_x - rotated.width / 2.0)),
        int(round(center_y - rotated.height / 2.0)),
    )
    canvas.alpha_composite(rotated, dest)
    if strike:
        canvas_draw = ImageDraw.Draw(canvas)
        middle = int(y + (bottom - top) * 0.62)
        end = int(x + (right - left))
        canvas_draw.line(
            [(x - 5, middle + 2), (end + 2, middle - 3)],
            fill=(*fill, 215),
            width=3,
        )
        canvas_draw.line(
            [(x - 3, middle + 7), (end + 4, middle + 2)],
            fill=(*fill, 165),
            width=2,
        )


def _whiteout(draw: ImageDraw.ImageDraw, rect: tuple[float, float, float, float]) -> None:
    """Tipp-Ex-Fleck: deckt die Menge ab, lässt aber einen Hauch Schmutz stehen."""
    x0, y0, x1, y1 = rect
    patch = (251, 250, 245, 255)
    draw.rectangle((x0, y0, x1, y1), fill=patch)
    draw.ellipse((x0 - 3, y0 + 1, x0 + 7, y1 - 1), fill=patch)
    draw.ellipse((x1 - 9, y0 + 1, x1 + 3, y1 - 1), fill=patch)
    middle = y0 + (y1 - y0) * 0.55
    draw.line([(x0 + 6, middle), (x1 - 6, middle + 2)], fill=(168, 168, 164, 110), width=4)
    draw.line(
        [(x0 + 9, middle + 5), (x1 - 9, middle + 7)],
        fill=(192, 191, 187, 80),
        width=3,
    )


# --------------------------------------------------------------------------
# Seitenlayout
# --------------------------------------------------------------------------


@dataclass
class IngredientLine:
    left: str  # Menge + Einheit in der linken Spalte
    name: str
    style: str = "print"  # "print" | "hand"
    redact_qty: str | None = None  # Menge, die mit Tipp-Ex unkenntlich wird
    strike: bool = False


@dataclass
class PageSpec:
    mode: str = "print"  # "print" | "mixed" | "hand-basic" | "hand-hard"
    title: str = ""
    meta: list[str] = field(default_factory=list)
    groups: list[tuple[str, list[IngredientLine]]] = field(default_factory=list)
    steps: list[str] = field(default_factory=list)
    footer: list[str] = field(default_factory=list)
    page_label: str = ""
    smudges: dict[int, str] = field(default_factory=dict)


def _ink_tuple(fill: tuple[int, int, int], alpha: int = 255) -> tuple[int, int, int, int]:
    return (fill[0], fill[1], fill[2], alpha)


def render_page(spec: PageSpec, seed: int) -> Image.Image:
    hand_all = spec.mode in ("hand-basic", "hand-hard")
    hard = spec.mode == "hand-hard"
    mixed = spec.mode == "mixed"
    rng = np.random.default_rng(seed ^ 0xA11CE)

    canvas = paper(
        seed,
        base=PAPER_HARD if hard else PAPER,
        vignette=0.05,
        grain=1.7 if hand_all else 1.0,
    ).convert("RGBA")
    draw = ImageDraw.Draw(canvas)

    margin = 142 if hand_all else 128
    left = margin
    right = PAGE_W - margin
    ink = INK_HARD if hard else (INK_HAND if hand_all else INK)
    y = 130 if hand_all else 122

    def hand_font(size: int) -> ImageFont.FreeTypeFont:
        if hard:
            return font("ChalkboardSE.ttc", size, index=0)  # dünn (Light)
        return font("Bradley Hand Bold.ttf", size)

    def draw_hand(
        text: str,
        f: ImageFont.FreeTypeFont,
        x: float,
        y_pos: float,
        alpha: int = 255,
        strike: bool = False,
    ) -> None:
        hand_line(
            canvas,
            text,
            f,
            x,
            y_pos,
            ink,
            alpha,
            rng,
            jitter=1.0 if not hard else 1.6,
            blur=0.35 if hard else 0.0,
            strike=strike,
        )

    if hand_all and not hard:
        guides = ImageDraw.Draw(canvas)
        for guide_y in range(330, PAGE_H - 120, 88):
            guides.line([(left - 30, guide_y), (right + 30, guide_y)], fill=(206, 214, 228, 80), width=1)

    # Titel
    if spec.title:
        if hand_all:
            title_font = hand_font(92 if not hard else 66)
            for line in wrap_lines(draw, spec.title, title_font, right - left):
                draw_hand(line, title_font, left, y)
                y += int(title_font.size * 1.22)
        else:
            title_font = font("Georgia Bold.ttf", 92 if spec.mode == "print" else 84)
            for line in wrap_lines(draw, spec.title, title_font, right - left):
                draw.text((left, y), line, font=title_font, fill=(24, 24, 28))
                y += int(title_font.size * 1.18)
        y += 8
        rule = _ink_tuple(ink, 200) if hand_all else (150, 140, 118)
        draw.line([(left, y), (right, y)], fill=rule, width=3)
        y += 26

    # Kopfzeilen (Portionen, Zeiten)
    meta_font = hand_font(50 if not hard else 40) if hand_all else font("Georgia.ttf", 37)
    for line in spec.meta:
        if hand_all:
            draw_hand(line, meta_font, left, y, 245)
        else:
            draw.text((left, y), line, font=meta_font, fill=(62, 60, 58))
        y += int(meta_font.size * 1.35 if hand_all else 50)

    y += 26

    def section(title: str) -> None:
        nonlocal y
        if y > 170:
            y += 20
        section_font = hand_font(68 if not hard else 50) if hand_all else font("Georgia Bold.ttf", 50)
        if hand_all:
            draw_hand(title, section_font, left, y)
            underline_y = y + int(section_font.size * 1.12)
            width = int(draw.textlength(title, font=section_font))
            draw.line([(left, underline_y), (left + width, underline_y)], fill=_ink_tuple(ink, 190), width=2)
            y = underline_y + 22
        else:
            draw.text((left, y), title, font=section_font, fill=ink)
            underline_y = y + int(section_font.size * 1.2)
            width = int(draw.textlength(title, font=section_font))
            draw.line([(left, underline_y), (left + width, underline_y)], fill=(150, 140, 118), width=2)
            y = underline_y + 14

    if spec.groups:
        section("Zutaten")
        for group_name, lines in spec.groups:
            if group_name:
                group_font = (
                    hand_font(54 if not hard else 42)
                    if hand_all
                    else font("Georgia Bold Italic.ttf", 40)
                )
                if hand_all:
                    draw_hand(group_name, group_font, left, y, 245)
                else:
                    draw.text((left, y), group_name, font=group_font, fill=(52, 50, 48))
                y += int(group_font.size * 1.35 if hand_all else 54)
            for line in lines:
                line_hand = hand_all or line.style == "hand"
                if line_hand:
                    line_font = hand_font(54 if not hard else 42) if not mixed else hand_font(54)
                    text = " ".join(part for part in (line.left, line.name) if part)
                    x = left + int(rng.integers(-7, 8))
                    draw_hand(text, line_font, x, y, 255, strike=line.strike)
                    y += int(line_font.size * 1.52)
                else:
                    line_font = font("Georgia.ttf", 41)
                    if line.left:
                        draw.text((left, y), line.left, font=line_font, fill=ink)
                    draw.text((left + 285, y), line.name, font=line_font, fill=ink)
                    if line.redact_qty:
                        quantity_width = int(draw.textlength(line.redact_qty, font=line_font))
                        _whiteout(
                            draw,
                            (
                                left - 8,
                                y - 6,
                                left + quantity_width + 16,
                                y + line_font.size + 5,
                            ),
                        )
                    y += 56

    if spec.steps:
        section("Zubereitung")
        smudge_rects: list[tuple[int, int, int, int]] = []
        for index, step in enumerate(spec.steps):
            if hand_all:
                step_font = hand_font(48 if not hard else 38)
                step_lines = wrap_lines(draw, step, step_font, right - left - 58)
                draw_hand(f"{index + 1}.", step_font, left, y)
                for line in step_lines:
                    draw_hand(line, step_font, left + 58, y, 255)
                    y += int(step_font.size * 1.45)
                y += 10
            else:
                step_font = font("Georgia.ttf", 40)
                number_font = font("Georgia Bold.ttf", 40)
                draw.text((left, y), f"{index + 1}.", font=number_font, fill=ink)
                text_left = left + 58
                max_width = right - text_left
                cursor_x, cursor_y = text_left, y
                smudge_word = spec.smudges.get(index)
                for word in step.split():
                    word_width = int(draw.textlength(word + " ", font=step_font))
                    if cursor_x + word_width > text_left + max_width and cursor_x > text_left:
                        cursor_x = text_left
                        cursor_y += 54
                    if smudge_word and word.strip(".,;:") == smudge_word:
                        draw.text((cursor_x, cursor_y), word, font=step_font, fill=(96, 96, 96))
                        smudge_rects.append(
                            (cursor_x - 3, cursor_y - 3, cursor_x + word_width + 4, cursor_y + 50)
                        )
                    else:
                        draw.text((cursor_x, cursor_y), word, font=step_font, fill=ink)
                    cursor_x += word_width
                y = cursor_y + 58
            y += 12

        if smudge_rects:
            for rect in smudge_rects:
                box = (
                    max(0, min(PAGE_W - 5, rect[0])),
                    max(0, min(PAGE_H - 5, rect[1])),
                    max(1, min(PAGE_W, rect[2])),
                    max(1, min(PAGE_H, rect[3])),
                )
                if box[2] - box[0] < 6 or box[3] - box[1] < 6:
                    continue
                blur = canvas.crop(box).filter(ImageFilter.GaussianBlur(3.4))
                canvas.alpha_composite(blur, box[:2])
                mark = ImageDraw.Draw(canvas)
                mark.line(
                    [(box[0] + 2, box[1] + 18), (box[2] - 2, box[1] + 23)],
                    fill=(118, 118, 116, 140),
                    width=4,
                )
                mark.line(
                    [(box[0] + 4, box[1] + 30), (box[2] - 4, box[1] + 34)],
                    fill=(150, 150, 148, 100),
                    width=3,
                )

    if spec.footer:
        y += 18
        footer_font = hand_font(44 if not hard else 36) if hand_all else font("Georgia Italic.ttf", 33)
        for note in spec.footer:
            for line in wrap_lines(draw, note, footer_font, right - left):
                if hand_all:
                    draw_hand(line, footer_font, left, y, 240)
                else:
                    draw.text((left, y), line, font=footer_font, fill=(74, 72, 70))
                y += int(footer_font.size * 1.35)

    if y > PAGE_H - 92:
        raise RuntimeError(
            f"Seiteninhalt läuft über ({y} px > {PAGE_H - 92} px). Layout kürzen."
        )

    if spec.page_label:
        label_font = hand_font(40 if not hard else 34) if hand_all else font("Georgia Italic.ttf", 30)
        label_width = int(draw.textlength(spec.page_label, font=label_font))
        draw.text(
            (right - label_width, PAGE_H - 96),
            spec.page_label,
            font=label_font,
            fill=ink if hand_all else (108, 106, 102),
        )

    if hard:
        canvas = canvas.rotate(
            -1.8,
            resample=Image.BICUBIC,
            expand=True,
            fillcolor=_ink_tuple(PAPER_HARD),
        )
        offset_x = (canvas.width - PAGE_W) // 2
        offset_y = (canvas.height - PAGE_H) // 2
        canvas = canvas.crop((offset_x, offset_y, offset_x + PAGE_W, offset_y + PAGE_H))
        faded = Image.new("RGBA", canvas.size, _ink_tuple(PAPER_HARD))
        canvas = Image.blend(canvas, faded, 0.20)
        canvas = canvas.filter(ImageFilter.GaussianBlur(0.4))
        return add_scan_noise(canvas.convert("RGB"), seed, 2.0)

    return canvas.convert("RGB")


def make_phone_photo(page: Image.Image, seed: int) -> Image.Image:
    """Macht aus einer gedruckten Seite ein leicht schiefes, ungleich beleuchtetes Handyfoto."""
    rng = np.random.default_rng(seed ^ 0x9010)
    canvas_w, canvas_h = 2100, 2400
    background = desk_background(seed, canvas_w, canvas_h)

    scale = 0.875
    page_width = int(PAGE_W * scale)
    page_height = int(PAGE_H * scale)
    page_rgba = page.resize((page_width, page_height), Image.LANCZOS).convert("RGBA")
    angle = 3.0 + float(rng.uniform(-0.35, 0.35))
    page_rgba = page_rgba.rotate(angle, resample=Image.BICUBIC, expand=True)

    alpha = page_rgba.getchannel("A")
    shadow = Image.new("RGBA", page_rgba.size, (0, 0, 0, 0))
    shadow.putalpha(alpha.point(lambda value: int(value * 0.42)))
    shadow = shadow.filter(ImageFilter.GaussianBlur(20))

    pos_x = (canvas_w - page_rgba.width) // 2 + 16
    pos_y = (canvas_h - page_rgba.height) // 2 + 26
    background.alpha_composite(shadow, (pos_x + 16, pos_y + 28))
    background.alpha_composite(page_rgba, (pos_x, pos_y))

    rgb = np.asarray(background.convert("RGB"), dtype=np.float32)
    yy, xx = np.mgrid[0:canvas_h, 0:canvas_w].astype(np.float32)
    gx = xx / max(1, canvas_w - 1)
    gy = yy / max(1, canvas_h - 1)
    # Ungleichmäßiges Fensterlicht: oben links hell, unten rechts dunkler.
    light = 1.12 - 0.34 * gx - 0.24 * gy
    distance = np.sqrt(((gx - 0.42) * 1.05) ** 2 + ((gy - 0.40) * 0.85) ** 2)
    light *= 1.0 - 0.20 * np.clip(distance, 0.0, 1.1)
    # Weicher Schattenstreifen über die untere Bildhälfte.
    light *= 1.0 - 0.10 * np.clip((gy - 0.55) / 0.45, 0.0, 1.0)
    rgb *= light[..., None]
    rgb += rng.normal(0.0, 2.6, rgb.shape).astype(np.float32)
    rgb[..., 0] *= 1.02
    rgb[..., 2] *= 0.985
    photo = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), "RGB")
    return photo.filter(ImageFilter.GaussianBlur(0.6))


# --------------------------------------------------------------------------
# Rezepte (frei erfunden) und Ground Truth
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class Recipe:
    title: str
    servings: str
    prep: str
    cook: str
    total: str
    groups: tuple[tuple[str, tuple[tuple[str, str, str], ...]], ...]
    steps: tuple[str, ...]
    notes: str = ""


KUERBIS = Recipe(
    title="Cremige Kürbis-Kokos-Suppe",
    servings="4 Portionen",
    prep="15 Min.",
    cook="25 Min.",
    total="40 Min.",
    groups=(
        (
            "",
            (
                ("800", "g", "Hokkaido-Kürbis"),
                ("1", "Stk.", "Zwiebel"),
                ("2", "EL", "Olivenöl"),
                ("1", "TL", "Currypulver"),
                ("700", "ml", "Gemüsebrühe"),
                ("400", "ml", "Kokosmilch"),
                ("1/2", "TL", "Muskatnuss"),
                ("1", "Prise", "Chiliflocken"),
            ),
        ),
    ),
    steps=(
        "Den Kürbis waschen, entkernen und in 2 cm große Würfel schneiden. Die Zwiebel fein würfeln.",
        "Das Öl in einem großen Topf erhitzen und die Zwiebel glasig dünsten. Den Kürbis kurz mitbraten.",
        "Currypulver einrühren, mit Gemüsebrühe und Kokosmilch ablöschen und aufkochen lassen.",
        "Zugedeckt 25 Min. bei mittlerer Hitze köcheln lassen.",
        "Die Suppe fein pürieren und mit Muskatnuss und Chiliflocken abschmecken.",
    ),
    notes="Mit gerösteten Kürbiskernen servieren.",
)

APFELKUCHEN = Recipe(
    title="Gedeckter Apfelkuchen",
    servings="8 Stück",
    prep="30 Min.",
    cook="45 Min.",
    total="1 Std. 15 Min.",
    groups=(
        (
            "",
            (
                ("250", "g", "Mehl"),
                ("125", "g", "Butter"),
                ("100", "g", "Zucker"),
                ("2", "", "Eier"),
                ("1", "Pck.", "Backpulver"),
                ("750", "g", "Äpfel"),
                ("1", "TL", "Zimt"),
                ("2", "EL", "Semmelbrösel"),
            ),
        ),
    ),
    steps=(
        "Mehl, Butter, Zucker, Eier und Backpulver zu einem glatten Teig verkneten.",
        "Eine Springform (26 cm) fetten und den Teig darin auslegen, dabei einen Rand formen.",
        "Die Äpfel schälen, entkernen und in Spalten schneiden. Mit Zimt mischen.",
        "Semmelbrösel auf dem Teig verteilen und die Apfelspalten darauf anordnen.",
        "Bei 180 °C ca. 45 Min. backen. Vor dem Anschneiden vollständig abkühlen lassen.",
    ),
    notes="Mit Puderzucker bestäuben.",
)

MOHNKUCHEN = Recipe(
    title="Mohn-Zitronen-Kuchen",
    servings="12 Stück",
    prep="20 Min.",
    cook="50 Min.",
    total="1 Std. 10 Min.",
    groups=(
        (
            "",
            (
                ("300", "g", "Mehl"),
                ("200", "g", "gemahlener Mohn"),
                ("180", "g", "Zucker"),
                ("4", "", "Eier"),
                ("1", "Pck.", "Backpulver"),
                ("200", "ml", "Milch"),
                ("1", "", "Zitrone"),
            ),
        ),
    ),
    steps=(
        "Mehl, Mohn und Backpulver in einer Schüssel mischen.",
        "Eier mit Zucker schaumig schlagen und die Milch langsam einrühren.",
        "Die trockenen Zutaten unterheben und den Zitronenabrieb sowie den Saft zugeben.",
        "In eine gefettete Form füllen und bei 170 °C ca. 50 Min. backen.",
        "Nach dem Backen 10 Min. in der Form abkühlen lassen.",
    ),
    notes="Mit Zitronenglasur bestreichen.",
)

LASAGNE = Recipe(
    title="Gemüse-Lasagne mit Béchamelsauce",
    servings="6 Portionen",
    prep="30 Min.",
    cook="40 Min.",
    total="1 Std. 10 Min.",
    groups=(
        (
            "Füllung",
            (
                ("2", "Stk.", "Zucchini"),
                ("1", "Stk.", "Aubergine"),
                ("2", "Stk.", "rote Paprika"),
                ("2", "EL", "Olivenöl"),
                ("1", "TL", "Oregano"),
                ("400", "g", "gehackte Tomaten"),
            ),
        ),
        (
            "Béchamelsauce",
            (
                ("40", "g", "Butter"),
                ("40", "g", "Mehl"),
                ("500", "ml", "Milch"),
            ),
        ),
        (
            "Außerdem",
            (
                ("250", "g", "Lasagneplatten"),
                ("80", "g", "Parmesan"),
            ),
        ),
    ),
    steps=(
        "Den Backofen auf 180 °C vorheizen.",
        "Zucchini, Aubergine und Paprika waschen und in kleine Würfel schneiden.",
        "Das Öl in einer Pfanne erhitzen, das Gemüse 8 Min. anbraten, Oregano und Tomaten zugeben und 10 Min. köcheln lassen.",
        "Für die Béchamelsauce die Butter schmelzen, das Mehl einrühren und die Milch unter Rühren zugießen. Mit Muskatnuss würzen.",
        "Gemüse, Sauce und Lasagneplatten abwechselnd in eine Auflaufform schichten. Mit Parmesan bestreuen.",
        "Bei 180 °C ca. 40 Min. backen und vor dem Servieren 10 Min. ruhen lassen.",
    ),
    notes="",
)

MUFFINS = Recipe(
    title="Schoko-Kirsch-Muffins",
    servings="12 Stück",
    prep="20 Min.",
    cook="25 Min.",
    total="45 Min.",
    groups=(),
    steps=(
        "Den Backofen auf 180 °C vorheizen und ein Muffinblech mit Papierförmchen auslegen.",
        "Die weiche Butter mit dem Zucker cremig rühren, dann die Eier einzeln unterrühren.",
        "Mehl und Backpulver mischen und unter den Teig heben. Zuletzt die Kirschen vorsichtig unterheben.",
        "Im vorgeheizten Ofen bei 1?? °C ca. 25 Min. backen. Die Muffins in der Form abkühlen lassen.",
    ),
    notes="",
)

STREUSEL = Recipe(
    title="Apfel-Streuselkuchen",
    servings="12 Stück",
    prep="25 Min.",
    cook="45 Min.",
    total="1 Std. 10 Min.",
    groups=(
        (
            "Teig",
            (
                ("500", "g", "Mehl"),
                ("1", "Pck.", "Trockenhefe"),
                ("1/4", "l", "Milch"),
                ("80", "g", "Zucker"),
                ("2", "Stk.", "Eier"),
                ("1", "Prise", "Salz"),
            ),
        ),
        (
            "Füllung",
            (
                ("1", "kg", "Äpfel"),
                ("2", "EL", "Zitronensaft"),
                ("1", "Msp.", "Zimt"),
                ("100", "ml", "Sahne"),
            ),
        ),
        (
            "Streusel",
            (
                ("200", "g", "Mehl"),
                ("150", "g", "Butter"),
                ("100", "g", "Zucker"),
                ("1 1/2", "TL", "Zimt"),
            ),
        ),
    ),
    steps=(
        "Für den Teig das Mehl in eine Schüssel geben und mit der Trockenhefe mischen. Die Milch lauwarm erwärmen.",
        "Milch, Zucker, Eier und Salz zum Mehl geben und alles zu einem glatten Teig verkneten. 60 Min. zugedeckt gehen lassen.",
        "Für die Füllung die Äpfel schälen, entkernen und in Spalten schneiden. Mit Zitronensaft, Zimt und Sahne mischen.",
        "Für die Streusel Mehl, Butter, Zucker und Zimt mit den Fingern verreiben.",
        "Den Teig in eine Springform (26 cm) drücken, die Äpfel darauf verteilen und die Streusel darüber streuen. Bei 180 °C ca. 45 Min. backen. Vor dem Servieren 1 Std. abkühlen lassen.",
    ),
    notes="",
)


def _meta(recipe: Recipe, backzeit: str = "Kochzeit") -> list[str]:
    return [
        f"Für {recipe.servings}",
        f"Vorbereitung {recipe.prep} · {backzeit} {recipe.cook} · Gesamt {recipe.total}",
    ]


def _groups(recipe: Recipe) -> list[tuple[str, list[IngredientLine]]]:
    return [
        (
            group,
            [IngredientLine(left=" ".join(part for part in (q, u) if part), name=n) for q, u, n in items],
        )
        for group, items in recipe.groups
    ]


def _gt_ingredients(recipe: Recipe) -> list[dict]:
    ingredients: list[dict] = []
    for group, items in recipe.groups:
        for quantity, unit, name in items:
            entry = {"quantity": quantity, "unit": unit, "name": name}
            if group:
                entry["group"] = group
            ingredients.append(entry)
    return ingredients


def gt_recipe(
    recipe: Recipe,
    *,
    notes: str = "",
    expected: list[dict] | None = None,
    ingredients: list[dict] | None = None,
    steps: list[str] | None = None,
) -> dict:
    return {
        "title": recipe.title,
        "servingsText": recipe.servings,
        "prepTime": recipe.prep,
        "cookTime": recipe.cook,
        "totalTime": recipe.total,
        "ingredients": ingredients if ingredients is not None else _gt_ingredients(recipe),
        "steps": steps if steps is not None else list(recipe.steps),
        "expectedUncertainties": expected or [],
        "notes": notes,
    }


def _first_part(groups: list[dict], count: int) -> list[dict]:
    return groups[:count]


def _last_part(groups: list[dict], count: int) -> list[dict]:
    return groups[count:]


# --------------------------------------------------------------------------
# Fixture-Definitionen
# --------------------------------------------------------------------------


def fixture_printed_basic() -> Image.Image:
    spec = PageSpec(
        title=KUERBIS.title,
        meta=_meta(KUERBIS, "Kochzeit"),
        groups=_groups(KUERBIS),
        steps=list(KUERBIS.steps),
        footer=[f"Hinweis: {KUERBIS.notes}"],
        page_label="Rezeptkarte · Küchenrunde",
    )
    return render_page(spec, seed=11_001)


def fixture_printed_photo() -> Image.Image:
    page = render_page(
        PageSpec(
            title=KUERBIS.title,
            meta=_meta(KUERBIS, "Kochzeit"),
            groups=_groups(KUERBIS),
            steps=list(KUERBIS.steps),
            footer=[f"Hinweis: {KUERBIS.notes}"],
            page_label="Rezeptkarte · Küchenrunde",
        ),
        seed=11_002,
    )
    return make_phone_photo(page, seed=11_003)


def fixture_handwritten_basic() -> Image.Image:
    spec = PageSpec(
        mode="hand-basic",
        title=APFELKUCHEN.title,
        meta=_meta(APFELKUCHEN, "Backzeit"),
        groups=_groups(APFELKUCHEN),
        steps=list(APFELKUCHEN.steps),
        footer=[f"Notiz: {APFELKUCHEN.notes}"],
        page_label="Seite 1",
    )
    return render_page(spec, seed=12_001)


def fixture_handwritten_hard() -> Image.Image:
    lines: list[IngredientLine] = []
    for quantity, unit, name in [
        ("300", "g", "Mehl"),
        ("200", "g", "gemahlener Mohn"),
    ]:
        lines.append(IngredientLine(left="", name=f"{quantity} {unit} {name}".strip()))
    lines.append(IngredientLine(left="", name="200 g Zucker", strike=True))
    lines.append(IngredientLine(left="", name="180 g Zucker"))
    for quantity, unit, name in [
        ("4", "", "Eier"),
        ("1", "Pck.", "Backpulver"),
        ("200", "ml", "Milch"),
        ("1", "", "Zitrone"),
    ]:
        lines.append(IngredientLine(left="", name=f"{quantity} {unit} {name}".strip()))
    spec = PageSpec(
        mode="hand-hard",
        title=MOHNKUCHEN.title,
        meta=_meta(MOHNKUCHEN, "Backzeit"),
        groups=[("", lines)],
        steps=list(MOHNKUCHEN.steps),
        footer=[f"Notiz: {MOHNKUCHEN.notes}"],
        page_label="Seite 1",
    )
    return render_page(spec, seed=13_001)


def fixture_multi_page_1() -> Image.Image:
    first_groups = LASAGNE.groups[:1]
    spec = PageSpec(
        title=LASAGNE.title,
        meta=_meta(LASAGNE, "Backzeit") + ["Zutaten: Seite 1 von 2"],
        groups=[
            (
                group,
                [IngredientLine(left=" ".join(p for p in (q, u) if p), name=n) for q, u, n in items],
            )
            for group, items in first_groups
        ],
        steps=[],
        footer=["Die Zutatenliste wird auf der nächsten Seite fortgesetzt."],
        page_label="Seite 1 von 2",
    )
    return render_page(spec, seed=14_001)


def fixture_multi_page_2() -> Image.Image:
    spec = PageSpec(
        title="",
        meta=["Gemüse-Lasagne – Fortsetzung", "Seite 2 von 2"],
        groups=[
            (
                group,
                [IngredientLine(left=" ".join(p for p in (q, u) if p), name=n) for q, u, n in items],
            )
            for group, items in LASAGNE.groups[1:]
        ],
        steps=list(LASAGNE.steps),
        footer=[],
        page_label="Seite 2 von 2",
    )
    return render_page(spec, seed=14_002)


def fixture_unclear_quantities() -> Image.Image:
    lines = [
        IngredientLine(left="2 g", name="Butter", redact_qty="2"),
        IngredientLine(left="250 ?", name="Mehl"),
        IngredientLine(left="", name="250 Zucker", style="hand"),
        IngredientLine(left="2 EL", name="Salz"),
        IngredientLine(left="", name="3 Eier", style="hand"),
        IngredientLine(left="1 Pck.", name="Backpulver"),
        IngredientLine(left="", name="200 g Kirschen", style="hand"),
    ]
    spec = PageSpec(
        mode="mixed",
        title=MUFFINS.title,
        meta=_meta(MUFFINS, "Backzeit"),
        groups=[("", lines)],
        steps=list(MUFFINS.steps),
        footer=["Einige Angaben sind absichtlich unleserlich."],
        page_label="Notizzettel",
        smudges={3: "1??"},
    )
    return render_page(spec, seed=15_001)


def fixture_printed_abbreviations() -> Image.Image:
    spec = PageSpec(
        title=STREUSEL.title,
        meta=_meta(STREUSEL, "Backzeit"),
        groups=_groups(STREUSEL),
        steps=list(STREUSEL.steps),
        footer=["Springform 26 cm · Umluft 160 °C."],
        page_label="Rezeptkarte · Küchenrunde",
    )
    return render_page(spec, seed=16_001)


@dataclass
class Fixture:
    filename: str
    image: Image.Image
    ground_truth: dict


def build_fixtures() -> list[Fixture]:
    printed_gt = gt_recipe(
        KUERBIS,
        notes="Gedruckte, gut lesbare Referenzseite (helles Papier, ~200 dpi).",
    )
    uncertain_muffins_gt = gt_recipe(
        MUFFINS,
        ingredients=[
            {"quantity": "", "unit": "g", "name": "Butter"},
            {"quantity": "250", "unit": "", "name": "Mehl"},
            {"quantity": "250", "unit": "", "name": "Zucker"},
            {"quantity": "2", "unit": "EL", "name": "Salz"},
            {"quantity": "3", "unit": "", "name": "Eier"},
            {"quantity": "1", "unit": "Pck.", "name": "Backpulver"},
            {"quantity": "200", "unit": "g", "name": "Kirschen"},
        ],
        expected=[
            {
                "reference": "Zutat 1, Menge",
                "kind": "unkenntlich",
                "expectUncertain": True,
                "mustNotInvent": ["eine konkrete Buttermenge"],
            },
            {
                "reference": "Zutat 2, Einheit",
                "kind": "mehrdeutig",
                "expectUncertain": True,
                "mustNotInvent": ["eine konkrete Einheit (z. B. g)"],
            },
            {
                "reference": "Zutat 3, Einheit",
                "kind": "fehlend",
                "expectUncertain": True,
                "mustNotInvent": ["eine Einheit für den Zucker"],
            },
            {
                "reference": "Zutat 4, Einheit",
                "kind": "unplausibel",
                "expectUncertain": False,
                "mustNotInvent": ["Umrechnung oder Korrektur der Einheit EL"],
            },
            {
                "reference": "Schritt 4, Temperatur",
                "kind": "unleserlich",
                "expectUncertain": True,
                "mustNotInvent": ["eine genaue Temperatur (z. B. 180 °C)"],
            },
        ],
        notes=(
            "Absichtlich unleserliche bzw. mehrdeutige Stellen: Tipp-Ex über der "
            "Buttermenge, Einheit '?' beim Mehl, fehlende Einheit beim Zucker, "
            "unplausible Einheit '2 EL Salz', unleserliche Backtemperatur '1?? °C'. "
            "Unveränderte Stellen sind wörtlich zu übernehmen; nichts raten."
        ),
    )

    lasagne_gt = gt_recipe(LASAGNE, notes="Vollständiges Rezept über zwei Seiten.")
    lasagne_ingredients = _gt_ingredients(LASAGNE)
    page_1_ingredients = _first_part(lasagne_ingredients, 6)
    page_2_ingredients = _last_part(lasagne_ingredients, 6)
    page_1_gt = gt_recipe(
        LASAGNE,
        ingredients=page_1_ingredients,
        steps=[],
        notes="Seite 1 von 2: Titel, Portionen, Zeiten und Zutaten der Füllung.",
    )
    page_2_gt = gt_recipe(
        LASAGNE,
        ingredients=page_2_ingredients,
        steps=list(LASAGNE.steps),
        notes="Seite 2 von 2: Fortsetzung der Zutaten und Zubereitung; nur mit Seite 1 vollständig.",
    )
    page_2_gt["title"] = ""
    page_2_gt["servingsText"] = ""
    page_2_gt["prepTime"] = ""
    page_2_gt["cookTime"] = ""
    page_2_gt["totalTime"] = ""

    hard_gt = gt_recipe(
        MOHNKUCHEN,
        ingredients=[
            {"quantity": "300", "unit": "g", "name": "Mehl"},
            {"quantity": "200", "unit": "g", "name": "gemahlener Mohn"},
            {"quantity": "180", "unit": "g", "name": "Zucker"},
            {"quantity": "4", "unit": "", "name": "Eier"},
            {"quantity": "1", "unit": "Pck.", "name": "Backpulver"},
            {"quantity": "200", "unit": "ml", "name": "Milch"},
            {"quantity": "1", "unit": "", "name": "Zitrone"},
        ],
        expected=[
            {
                "reference": "Zutat 3, Menge",
                "kind": "korrigiert",
                "expectUncertain": True,
                "mustNotInvent": ["200 g als gültige Zucker-Menge (durchgestrichen)"],
            }
        ],
        notes=(
            "Absichtlich schwer: dünne kleine Schrift, schwacher Kontrast, leichte "
            "Verkippung. '200 g Zucker' ist durchgestrichen und durch '180 g Zucker' "
            "korrigiert; maßgeblich ist die Korrektur."
        ),
    )

    fixtures = [
        Fixture(
            "printed-basic.jpg",
            fixture_printed_basic(),
            printed_gt,
        ),
        Fixture(
            "printed-photo.jpg",
            fixture_printed_photo(),
            dict(
                printed_gt,
                notes=(
                    "Gleiches Rezept wie printed-basic.jpg als Handyfoto: ca. 3° Rotation, "
                    "ungleichmäßiges Licht, Rauschen, grauer Hintergrund. Ground Truth "
                    "entspricht printed-basic.jpg."
                ),
            ),
        ),
        Fixture(
            "handwritten-basic.jpg",
            fixture_handwritten_basic(),
            gt_recipe(
                APFELKUCHEN,
                notes=(
                    "Gut lesbare Handschrift (Bradley Hand) mit liniertem Papier, "
                    "8 Zutaten, 5 Schritten und Temperaturangabe."
                ),
            ),
        ),
        Fixture("handwritten-hard.jpg", fixture_handwritten_hard(), hard_gt),
        Fixture("multi-page-1.jpg", fixture_multi_page_1(), page_1_gt),
        Fixture("multi-page-2.jpg", fixture_multi_page_2(), page_2_gt),
        Fixture("unclear-quantities.jpg", fixture_unclear_quantities(), uncertain_muffins_gt),
        Fixture(
            "printed-abbreviations.jpg",
            fixture_printed_abbreviations(),
            gt_recipe(
                STREUSEL,
                notes=(
                    "Gedruckt mit vielen Abkürzungen (EL, TL, Msp., Prise, Stk., Pck., g, kg, "
                    "ml, l, Min., Std., °C), Brüchen (1/4, 1 1/2) und Zutatengruppen "
                    "(Teig, Füllung, Streusel)."
                ),
            ),
        ),
    ]
    return fixtures


def build_ground_truth(fixtures: list[Fixture]) -> dict:
    by_name = {fixture.filename: fixture.ground_truth for fixture in fixtures}
    lasagne_gt = gt_recipe(LASAGNE, notes="Vollständiges, über zwei Seiten verteiltes Rezept.")
    return {
        "version": 1,
        "generator": "scripts/generate-photo-ocr-fixtures.py",
        "description": (
            "Synthetische, ausschließlich frei erfundene deutsche Rezepte für den "
            "Live-Test des Foto-Imports. Keine echten Familienrezepte, keine privaten Daten."
        ),
        "model": "@cf/meta/llama-4-scout-17b-16e-instruct",
        "jpeg": {
            "quality": JPEG_QUALITY,
            "longEdgePx": [MIN_LONG_EDGE, MAX_LONG_EDGE],
            "maxBytes": MAX_FILE_BYTES,
        },
        "fixtures": by_name,
        "combined": {
            "multi-page": {
                "pages": ["multi-page-1.jpg", "multi-page-2.jpg"],
                **lasagne_gt,
            }
        },
    }


# --------------------------------------------------------------------------
# Hauptprogramm
# --------------------------------------------------------------------------


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> int:
    FIXTURE_DIR.mkdir(parents=True, exist_ok=True)
    fixtures = build_fixtures()

    rows: list[tuple[str, int, int, int, str]] = []
    for fixture in fixtures:
        image = fixture.image.convert("RGB")
        width, height = image.size
        long_edge = max(width, height)
        if not MIN_LONG_EDGE <= long_edge <= MAX_LONG_EDGE:
            raise SystemExit(
                f"{fixture.filename}: lange Kante {long_edge} px liegt außerhalb "
                f"{MIN_LONG_EDGE}–{MAX_LONG_EDGE} px."
            )
        path = FIXTURE_DIR / fixture.filename
        image.save(
            path,
            format="JPEG",
            quality=JPEG_QUALITY,
            subsampling=JPEG_SUBSAMPLING,
            optimize=False,
        )
        size = path.stat().st_size
        if size > MAX_FILE_BYTES:
            raise SystemExit(
                f"{fixture.filename}: {size} Bytes überschreiten das Limit von "
                f"{MAX_FILE_BYTES} Bytes."
            )
        rows.append((fixture.filename, width, height, size, _sha256(path)))

    ground_truth = build_ground_truth(fixtures)
    text = json.dumps(ground_truth, ensure_ascii=False, indent=2) + "\n"
    GROUND_TRUTH_PATH.write_text(text, encoding="utf-8")
    truth_size = GROUND_TRUTH_PATH.stat().st_size

    print(f"Fixtures: {FIXTURE_DIR.relative_to(REPO_ROOT)}")
    print(f"Ground Truth: {GROUND_TRUTH_PATH.relative_to(REPO_ROOT)} ({truth_size} Bytes)")
    print()
    header = f"{'Datei':<30} {'Maße':>11} {'KB':>8}  {'SHA-256 (12)':<12}"
    print(header)
    print("-" * len(header))
    for filename, width, height, size, digest in rows:
        print(f"{filename:<30} {f'{width}x{height}':>11} {size / 1024:>8.1f}  {digest[:12]}")
    print()
    print(f"{len(rows)} Bilder erzeugt, deterministisch (feste Seeds).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
