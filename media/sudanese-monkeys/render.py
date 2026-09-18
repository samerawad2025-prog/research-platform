#!/usr/bin/env python3
"""
Sudanese Monkeys — "قوم يا شمبورة"
Builds a 9:16 animated short from one photoreal CGI still by driving a virtual
camera over it and warping the characters' jaws in sync with the voice track.

No paid generation: everything here is local (PIL + numpy + ffmpeg + espeak-ng).
"""
import math, os, subprocess, sys, wave
import numpy as np
from PIL import Image, ImageDraw, ImageFont

S = os.path.dirname(os.path.abspath(__file__))
FFMPEG = os.path.join(S, "ffmpeg")
SRC = os.path.join(S, "kf", "kf3.png")
OUT = os.path.join(S, "out", "monkeys_video.mp4")

W, H, FPS = 720, 1280, 24
ASPECT = W / H                      # 0.5625
DUR = 18.80
NFRAMES = int(round(DUR * FPS))

# ---------------------------------------------------------------- voice track
LINES = [
    dict(wav="audio/p1.wav", start=1.05, speaker="A",
         text="يا شمبورة، قوم نايم ليها شنو يا زول؟"),
    dict(wav="audio/p2.wav", start=6.35, speaker="B",
         text="ياخ خليني يا كسم انا داير انوم"),
    dict(wav="audio/p3.wav", start=12.35, speaker="A",
         text="قوم يا طيش الليدو، هههااااي قوم"),
]


def envelope(path, start, nframes=NFRAMES, fps=FPS):
    """Per-frame 0..1 loudness envelope, placed on the timeline at `start`."""
    with wave.open(path, "rb") as w:
        sr, n, sw, ch = w.getframerate(), w.getnframes(), w.getsampwidth(), w.getnchannels()
        raw = w.readframes(n)
    a = np.frombuffer(raw, dtype=np.int16).astype(np.float32)
    if ch > 1:
        a = a.reshape(-1, ch).mean(axis=1)
    a /= 32768.0
    hop = sr / fps
    nwin = int(len(a) / hop)
    rms = np.array([np.sqrt(np.mean(a[int(i * hop):int(i * hop) + int(hop * 1.6) + 1] ** 2) + 1e-9)
                    for i in range(nwin)])
    if rms.max() > 0:
        rms = rms / np.percentile(rms, 92)
    rms = np.clip(rms, 0, 1) ** 0.7
    # attack fast, release slow -> mouth doesn't flicker
    sm = np.zeros_like(rms)
    v = 0.0
    for i, x in enumerate(rms):
        v = max(x, v * 0.55) if x > v else v * 0.62 + x * 0.38
        sm[i] = v
    out = np.zeros(nframes, dtype=np.float32)
    off = int(round(start * fps))
    end = min(nframes, off + len(sm))
    if end > off:
        out[off:end] = sm[:end - off]
    return out, len(sm) / fps


envA = np.zeros(NFRAMES, dtype=np.float32)   # the joker
envB = np.zeros(NFRAMES, dtype=np.float32)   # the sleeper
for L in LINES:
    e, dur = envelope(os.path.join(S, L["wav"]), L["start"])
    L["dur"] = dur
    if L["speaker"] == "A":
        envA = np.maximum(envA, e)
    else:
        envB = np.maximum(envB, e)

# ------------------------------------------------------------------- the shot
# camera keyframes: (t, cx, cy, height) in source pixels; width = height*9/16
CAM = [
    # SHOT 1 — the joker leans in and talks, camera drifts right to reveal the sleeper
    (0.00,  591, 384, 768),
    (2.60,  606, 380, 744),
    (5.58,  820, 382, 700),
    # SHOT 2 — hard cut to the sleeper's face (cap + phone in frame), he snaps back
    (5.60,  940, 470, 566),
    (11.98, 930, 456, 520),
    # SHOT 3 — hard cut to the joker howling with laughter
    (12.00, 566, 262, 524),
    (15.98, 560, 292, 580),
    # SHOT 4 — back to the sleeper, out like a light again
    (16.00, 936, 466, 600),
    (18.80, 930, 462, 646),
]
CUTS = [5.60, 12.00, 16.00]          # hard cuts (no interpolation across these)


def ease(t):
    return t * t * (3 - 2 * t)


def camera(t):
    seg = [k for k in CAM]
    for i in range(len(seg) - 1):
        t0, t1 = seg[i][0], seg[i + 1][0]
        if t0 <= t <= t1 and t1 > t0 and t1 not in CUTS:
            u = ease((t - t0) / (t1 - t0))
            return [seg[i][j + 1] + (seg[i + 1][j + 1] - seg[i][j + 1]) * u for j in range(3)]
    # exactly on/after last
    return list(seg[-1][1:])


# ------------------------------------------------------- character rig (kf3 px)
RIG_A = dict(pivot=186, chin=262, blend=336, x0=468, x1=664, feather=22, close=0.66)
RIG_B = dict(pivot=437, chin=506, blend=566, x0=842, x1=966, feather=20, close=0.70)


def bump(n, feather):
    """1 in the middle, smoothly 0 at both ends."""
    b = np.ones(n, dtype=np.float32)
    f = min(feather, n // 2)
    if f > 0:
        r = 0.5 - 0.5 * np.cos(np.linspace(0, math.pi, f, dtype=np.float32))
        b[:f] = r
        b[-f:] = r[::-1]
    return b


def warp(img, box, dx, dy):
    """Bilinear backward-map a region. dx/dy are zero on the boundary, so no seam."""
    x0, y0, x1, y1 = box
    h, w = y1 - y0, x1 - x0
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    sx = np.clip(xs + dx + x0, 0, img.shape[1] - 1.001)
    sy = np.clip(ys + dy + y0, 0, img.shape[0] - 1.001)
    x_i, y_i = sx.astype(np.int32), sy.astype(np.int32)
    fx, fy = (sx - x_i)[..., None], (sy - y_i)[..., None]
    p00 = img[y_i, x_i]
    p10 = img[y_i, x_i + 1]
    p01 = img[y_i + 1, x_i]
    p11 = img[y_i + 1, x_i + 1]
    img[y0:y1, x0:x1] = (p00 * (1 - fx) * (1 - fy) + p10 * fx * (1 - fy) +
                         p01 * (1 - fx) * fy + p11 * fx * fy)


def jaw(img, rig, openness):
    """openness 1 = mouth as generated (wide), 0 = jaw pulled shut."""
    s = rig["close"] + (1.0 - rig["close"]) * float(np.clip(openness, 0, 1))
    piv, chin, blend = rig["pivot"], rig["chin"], rig["blend"]
    L = chin - piv
    peak_y = piv + L * s
    peak_v = L * (1 - s)
    if peak_v < 0.25:
        return
    ys = np.arange(piv, blend, dtype=np.float32)
    dy = np.where(ys <= peak_y,
                  (ys - piv) / max(peak_y - piv, 1e-3) * peak_v,
                  peak_v * (blend - ys) / max(blend - peak_y, 1e-3))
    bx = bump(rig["x1"] - rig["x0"], rig["feather"])
    warp(img, (rig["x0"], piv, rig["x1"], blend),
         np.zeros((len(ys), len(bx)), np.float32), dy[:, None] * bx[None, :])


def shove(img, box, amp_x, amp_y, rot=0.0):
    """Wobble / jerk a body region — zero displacement at the region border."""
    x0, y0, x1, y1 = box
    h, w = y1 - y0, x1 - x0
    by, bx = bump(h, h // 3)[:, None], bump(w, w // 3)[None, :]
    m = by * bx
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    dx = amp_x * m
    dy = amp_y * m
    if rot:
        cy, cx = h / 2, w / 2
        dx = dx - (ys - cy) * rot * m
        dy = dy + (xs - cx) * rot * m
    warp(img, box, dx, dy)


# ------------------------------------------------------------------- overlays
base = np.asarray(Image.open(SRC).convert("RGB"), dtype=np.float32)
SH, SW = base.shape[:2]

yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
vig = 1.0 - 0.34 * (((xx / W - 0.5) ** 2) * 1.5 + ((yy / H - 0.5) ** 2) * 1.05) ** 0.85
vig = np.clip(vig, 0, 1)[..., None]

rng = np.random.default_rng(7)
MOTES = [dict(x=rng.uniform(0.35, 1.0), y=rng.uniform(0.0, 1.0),
              s=rng.uniform(0.6, 1.9), sp=rng.uniform(0.006, 0.026),
              ph=rng.uniform(0, 6.28)) for _ in range(46)]

FONT = ImageFont.truetype(os.path.join(S, "fonts", "Cairo.ttf"), 38,
                          layout_engine=ImageFont.Layout.RAQM)


def wrap_ar(draw, text, font, maxw):
    words, out, cur = text.split(), [], ""
    for w_ in words:
        trial = (cur + " " + w_).strip()
        if draw.textlength(trial, font=font, direction="rtl", language="ar") <= maxw or not cur:
            cur = trial
        else:
            out.append(cur)
            cur = w_
    if cur:
        out.append(cur)
    return out


def subtitle(frame_img, t):
    for L in LINES:
        a, b = L["start"] - 0.10, L["start"] + L["dur"] + 0.30
        if a <= t <= b:
            alpha = min(1.0, (t - a) / 0.18, (b - t) / 0.25)
            d = ImageDraw.Draw(frame_img)
            rows = wrap_ar(d, L["text"], FONT, W - 132)
            y = H - 196 - (len(rows) - 1) * 52
            layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
            dl = ImageDraw.Draw(layer)
            for r in rows:
                dl.text((W // 2, y), r, font=FONT, fill=(255, 255, 255, 255), anchor="mm",
                        direction="rtl", language="ar", stroke_width=6, stroke_fill=(0, 0, 0, 235))
                y += 52
            if alpha < 1:
                al = layer.split()[3].point(lambda p: int(p * alpha))
                layer.putalpha(al)
            frame_img.alpha_composite(layer)
            return


# ----------------------------------------------------------------- the render
os.makedirs(os.path.join(S, "out"), exist_ok=True)
proc = subprocess.Popen(
    [FFMPEG, "-y", "-hide_banner", "-loglevel", "error",
     "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
     "-an", "-c:v", "libx264", "-preset", "slow", "-crf", "18",
     "-pix_fmt", "yuv420p", os.path.join(S, "out", "video_silent.mp4")],
    stdin=subprocess.PIPE)

for i in range(NFRAMES):
    t = i / FPS
    img = base.copy()

    oa, ob = float(envA[i]), float(envB[i])

    # --- the joker: jaw + a laugh shudder through the shoulders
    jaw(img, RIG_A, oa if oa > 0.02 else 0.12 + 0.06 * math.sin(t * 1.7))
    if t >= 12.0 and oa > 0.05:                       # shot 3, howling
        shove(img, (430, 40, 700, 330), 1.8 * math.sin(t * 34), -3.4 * oa, rot=0.004 * math.sin(t * 22))

    # --- the sleeper: breathing, being shaken, then snapping awake
    breath = 0.10 + 0.07 * math.sin(t * 1.35)
    jaw(img, RIG_B, ob if ob > 0.02 else breath)
    shove(img, (640, 372, 1080, 640), 0.0, 1.5 * math.sin(t * 1.35), 0.0)      # chest rise/fall
    if t < 5.58:                                       # he's being shaken awake
        sh = envA[i] * 4.2
        shove(img, (700, 330, 1090, 660), sh * math.sin(t * 41), sh * 0.45 * math.sin(t * 33), 0.0)
    if 5.60 <= t < 12.0 and ob > 0.12:                 # angry head jerk on the yell
        shove(img, (820, 330, 1040, 560), -2.2 * ob * math.sin(t * 27), -2.0 * ob,
              rot=0.012 * ob * math.sin(t * 19))

    # --- virtual camera (+ shake on the shout, + bounce on the laugh)
    cx, cy, ch = camera(t)
    if 5.60 <= t < 12.0:
        k = ob ** 1.3
        cx += 6.5 * k * math.sin(t * 38.0) + 2.0 * k * math.sin(t * 12.7)
        cy += 5.0 * k * math.sin(t * 31.0)
    if t >= 12.0:
        cy -= 5.5 * (oa ** 1.2) * abs(math.sin(t * 15.0))
        ch *= 1.0 - 0.012 * oa
    cw = ch * ASPECT
    cx = min(max(cx, cw / 2), SW - cw / 2)
    cy = min(max(cy, ch / 2), SH - ch / 2)

    crop = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).crop(
        (int(round(cx - cw / 2)), int(round(cy - ch / 2)),
         int(round(cx + cw / 2)), int(round(cy + ch / 2)))).resize((W, H), Image.LANCZOS)

    f = np.asarray(crop, dtype=np.float32)

    # --- dust in the sunbeam
    for m in MOTES:
        mx = (m["x"] + 0.02 * math.sin(t * 0.7 + m["ph"])) * W
        my = ((m["y"] - t * m["sp"]) % 1.0) * H
        r = m["s"] * 1.7
        x0, x1 = int(max(0, mx - r * 3)), int(min(W, mx + r * 3))
        y0, y1 = int(max(0, my - r * 3)), int(min(H, my + r * 3))
        if x1 - x0 < 2 or y1 - y0 < 2:
            continue
        gy, gx = np.mgrid[y0:y1, x0:x1].astype(np.float32)
        g = np.exp(-(((gx - mx) ** 2 + (gy - my) ** 2) / (2 * r * r)))[..., None]
        f[y0:y1, x0:x1] += g * 42.0 * (0.45 + 0.55 * math.sin(t * 2.3 + m["ph"]) ** 2)

    # --- grade: vignette, warm daylight flicker, grain
    f *= vig
    f *= 1.0 + 0.014 * math.sin(t * 2.1)
    f[..., 0] *= 1.014
    f[..., 2] *= 0.988
    f += rng.normal(0, 2.6, f.shape).astype(np.float32)

    # --- fades
    if t < 0.55:
        f *= t / 0.55
    if t > DUR - 1.0:
        f *= max(0.0, (DUR - t) / 1.0)

    out = Image.fromarray(np.clip(f, 0, 255).astype(np.uint8)).convert("RGBA")
    subtitle(out, t)
    proc.stdin.write(out.convert("RGB").tobytes())

    if i % 60 == 0:
        print(f"frame {i}/{NFRAMES}", flush=True)

proc.stdin.close()
rc = proc.wait()
print("video encode rc:", rc)
