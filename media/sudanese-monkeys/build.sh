#!/usr/bin/env bash
# Rebuilds media/sudanese-monkeys/monkeys_video.mp4 from keyframe.png.
# Everything here is free/offline — no paid generation APIs.
set -euo pipefail
cd "$(dirname "$0")"

# ---------------------------------------------------------------- dependencies
# ffmpeg (static, via pip), Pillow with RAQM for Arabic shaping, numpy,
# espeak-ng + the mbrola Arabic diphone voices, and the Cairo Arabic font.
pip3 install --quiet imageio-ffmpeg Pillow numpy
apt-get install -y -qq espeak-ng mbrola mbrola-ar1 mbrola-ar2 libraqm0
[ -e ffmpeg ] || ln -s "$(python3 -c 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())')" ffmpeg
mkdir -p fonts audio out
[ -f fonts/Cairo.ttf ] || curl -sSL -o fonts/Cairo.ttf \
  "https://raw.githubusercontent.com/google/fonts/main/ofl/cairo/Cairo%5Bslnt%2Cwght%5D.ttf"

# ------------------------------------------------------------------ the voices
# Diacritics are deliberate: espeak-ng's Arabic needs them to pronounce the
# Sudanese dialect lines correctly. Monkey A = mb-ar1, monkey B = mb-ar2.
espeak-ng -v mb-ar1 -s 168 -p 40 -w audio/raw1.wav 'يَا شَمْبُورَة ، قُومْ ! نَايِمْ لِيهَا شُنُو يَا زُولْ ؟'
espeak-ng -v mb-ar2 -s 150 -p 25 -w audio/raw2.wav 'يَاخْ ، خَلِّينِي يَا كَسَمْ ، أَنَا دَايِرْ أَنُومْ'
espeak-ng -v mb-ar1 -s 172 -p 45 -w audio/raw3.wav 'قُومْ يَا طَيْشْ اللِّيدُو ، هَا هَا هَاااي ، قُومْ'

# Character voicing: A pitched up and bright, B pitched down and groggy,
# both sat in the room with a short echo, then levelled.
./ffmpeg -loglevel error -i audio/raw1.wav -af "asetrate=16000*1.10,aresample=48000,atempo=0.909,highpass=f=110,treble=g=3,aecho=0.8:0.6:38:0.22,loudnorm=I=-16:TP=-1.5:LRA=11" -c:a pcm_s16le -ac 1 -ar 48000 audio/p1.wav -y
./ffmpeg -loglevel error -i audio/raw2.wav -af "asetrate=16000*0.90,aresample=48000,atempo=1.111,highpass=f=80,bass=g=3,aecho=0.8:0.6:38:0.22,loudnorm=I=-16:TP=-1.5:LRA=11"  -c:a pcm_s16le -ac 1 -ar 48000 audio/p2.wav -y
./ffmpeg -loglevel error -i audio/raw3.wav -af "asetrate=16000*1.12,aresample=48000,atempo=0.893,highpass=f=110,treble=g=3,aecho=0.8:0.6:38:0.22,loudnorm=I=-16:TP=-1.5:LRA=11" -c:a pcm_s16le -ac 1 -ar 48000 audio/p3.wav -y

# To use real recordings instead: drop your own mono 48kHz WAVs in as
# audio/p1.wav, audio/p2.wav, audio/p3.wav and skip the two blocks above.
# render.py reads their length and loudness, so the cut and the lip-sync
# follow whatever you put there.

# ------------------------------------------------------------- picture + sound
python3 render.py                       # writes out/video_silent.mp4

./ffmpeg -loglevel error \
  -i audio/p1.wav -i audio/p2.wav -i audio/p3.wav \
  -f lavfi -t 18.8 -i "anoisesrc=c=pink:r=48000:a=0.05" \
  -filter_complex "\
   [0]pan=stereo|c0=c0|c1=c0,adelay=1050|1050[a1];\
   [1]pan=stereo|c0=c0|c1=c0,adelay=6350|6350[a2];\
   [2]pan=stereo|c0=c0|c1=c0,adelay=12350|12350[a3];\
   [3]lowpass=f=380,volume=0.10,pan=stereo|c0=c0|c1=c0[amb];\
   [a1][a2][a3][amb]amix=inputs=4:duration=longest:normalize=0,\
   afade=t=in:st=0:d=0.4,afade=t=out:st=17.9:d=0.9,alimiter=limit=0.95[out]" \
  -map "[out]" -t 18.8 -c:a aac -b:a 192k audio/track.m4a -y

./ffmpeg -loglevel error -i out/video_silent.mp4 -i audio/track.m4a \
  -c:v copy -c:a aac -b:a 192k -shortest -movflags +faststart monkeys_video.mp4 -y

echo "built monkeys_video.mp4"
