"""
Post-it 아이콘을 안드로이드 런처 아이콘에서 그대로 뽑아 냅니다.

기준은 android/app/src/main/res/drawable/ic_launcher_foreground.xml (108dp 캔버스)과
ic_launcher_background(#2563EB) 입니다. 런처는 108dp 중 가운데 72dp만 보여 주고
그 위에 둥근 사각형(갤럭시는 스퀘어클) 마스크를 씌우므로, 여기서도 똑같이 잘라 그립니다.

    python3 icons/make-icons.py      # Pillow 필요 (pip install pillow)

만드는 파일
  favicon.ico, icons/favicon-32.png        웹 파비콘 (스퀘어클, 투명 바탕)
  icons/icon-192.png, icons/icon-512.png    PWA "any" 아이콘 (스퀘어클)
  icons/icon-maskable-512.png               PWA "maskable" 아이콘 (안드로이드 적응형 아이콘 108dp 전체)
  icons/apple-touch-icon.png                iOS 홈 화면 (꽉 찬 사각형, iOS 가 직접 둥글게 깎습니다)
  desktop/assets/icon.png, icon.ico         Windows 앱·설치 파일 아이콘
  desktop/assets/tray*.png                  Windows 알림 영역 아이콘 (100/150/200%)
"""
import math
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent

BLUE = (0x25, 0x63, 0xEB, 255)
WHITE = (255, 255, 255, 255)
FOLD = (0xB9, 0xD0, 0xF7, 255)

# ic_launcher_foreground.xml 의 <group translateX="27" translateY="27">
OFFSET = 27
# 런처가 보여 주는 가운데 72dp
VISIBLE = (18, 90)
# 갤럭시(One UI) 아이콘 모양에 가까운 초타원 지수
SQUIRCLE_N = 4.2
SS = 8  # 슈퍼샘플링 배율


def arc(cx, cy, r, start_deg, end_deg, steps=24):
    return [
        (cx + r * math.cos(math.radians(a)), cy + r * math.sin(math.radians(a)))
        for a in (start_deg + (end_deg - start_deg) * i / steps for i in range(steps + 1))
    ]


# M6,0h30a6,6 0 0,1 6,6v20L26,42H6a6,6 0 0,1 -6,-6V6A6,6 0 0,1 6,0z
SHEET = [(6, 0), *arc(36, 6, 6, -90, 0), (42, 26), (26, 42), *arc(6, 36, 6, 90, 180), *arc(6, 6, 6, 180, 270)]
# M42,26L26,42v-11a5,5 0 0,1 5,-5z
CORNER = [(42, 26), (26, 42), *arc(31, 31, 5, 180, 270)]
# M9,11h24v4H9zM9,20h24v4H9zM9,29h13v4H9z
LINES = [(9, 11, 33, 15), (9, 20, 33, 24), (9, 29, 22, 33)]


def superellipse(size, n=SQUIRCLE_N, steps=720):
    r = size / 2
    pts = []
    for i in range(steps):
        t = 2 * math.pi * i / steps
        c, s = math.cos(t), math.sin(t)
        pts.append((r + r * math.copysign(abs(c) ** (2 / n), c), r + r * math.copysign(abs(s) ** (2 / n), s)))
    return pts


def render(size, mode):
    """mode: 'squircle' | 'square' (가운데 72dp, 꽉 참) | 'adaptive' (108dp 전체, 꽉 참)"""
    big = size * SS
    lo, hi = (0, 108) if mode == "adaptive" else VISIBLE
    scale = big / (hi - lo)

    def tx(points):
        return [((OFFSET + x - lo) * scale, (OFFSET + y - lo) * scale) for x, y in points]

    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if mode == "squircle":
        d.polygon(superellipse(big), fill=BLUE)
    else:
        d.rectangle((0, 0, big, big), fill=BLUE)
    d.polygon(tx(SHEET), fill=WHITE)
    d.polygon(tx(CORNER), fill=FOLD)
    for x0, y0, x1, y1 in LINES:
        d.polygon(tx([(x0, y0), (x1, y0), (x1, y1), (x0, y1)]), fill=BLUE)
    return img.resize((size, size), Image.LANCZOS)


def save_ico(path, sizes):
    frames = [render(s, "squircle") for s in sizes]
    frames[-1].save(path, format="ICO", sizes=[(s, s) for s in sizes], append_images=frames[:-1])


def main():
    icons = ROOT / "icons"
    desk = ROOT / "desktop" / "assets"

    save_ico(ROOT / "favicon.ico", [16, 32, 48])
    render(32, "squircle").save(icons / "favicon-32.png")
    render(192, "squircle").save(icons / "icon-192.png")
    render(512, "squircle").save(icons / "icon-512.png")
    render(512, "adaptive").save(icons / "icon-maskable-512.png")
    render(180, "square").convert("RGB").save(icons / "apple-touch-icon.png")

    render(512, "squircle").save(desk / "icon.png")
    save_ico(desk / "icon.ico", [16, 20, 24, 32, 40, 48, 64, 128, 256])
    render(16, "squircle").save(desk / "tray.png")
    render(24, "squircle").save(desk / "tray@1.5x.png")
    render(32, "squircle").save(desk / "tray@2x.png")


if __name__ == "__main__":
    main()
