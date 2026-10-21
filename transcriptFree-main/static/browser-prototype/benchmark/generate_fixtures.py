#!/usr/bin/env python3
"""Gera fixtures PT-BR locais (TTS Windows SAPI + av) para benchmark.

Não envia áudio a serviços externos. Saída em fixtures/ (gitignored via *.wav/*.mp3).

Uso (na raiz do app):
  .venv\\Scripts\\python.exe static/browser-prototype/benchmark/generate_fixtures.py
"""

from __future__ import annotations

import subprocess
import sys
import wave
from pathlib import Path

OUT = Path(__file__).resolve().parent / "fixtures"
SAMPLE_RATE = 16000

# Texto com nomes próprios, pausas naturais e fala corrida (repetido para atingir duração).
SCRIPT = (
    "Olá, meu nome é Ana Souza. Hoje conversamos com o professor Carlos Mendes "
    "sobre educação em São Paulo. "
    "Na semana passada, a Prefeitura anunciou um projeto piloto na Vila Mariana. "
    "Pausa. "
    "Segundo Mendes, o desafio é incluir famílias da periferia sem perder qualidade. "
    "Ele citou a escola Municipal João Cabral e a parceria com a USP. "
)


def _write_silence_wav(path: Path, seconds: float, rate: int = SAMPLE_RATE) -> None:
    n = int(seconds * rate)
    with wave.open(str(path), "w") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(b"\x00\x00" * n)


def _sapi_speak_wav(text: str, out_wav: Path) -> None:
    """Usa System.Speech (pt-BR Maria) via PowerShell."""
    out_wav = out_wav.resolve()
    ps = f"""
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {{
  $pt = $synth.GetInstalledVoices([System.Globalization.CultureInfo]::GetCultureInfo('pt-BR'))
  if ($pt.Count -gt 0) {{ $synth.SelectVoice($pt[0].VoiceInfo.Name) }}
  $synth.SetOutputToWaveFile('{str(out_wav).replace("'", "''")}')
  $synth.Speak(@'
{text}
'@)
  $synth.SetOutputToNull()
}} finally {{ $synth.Dispose() }}
"""
    subprocess.run(
        ["powershell", "-NoProfile", "-Command", ps],
        check=True,
        capture_output=True,
        text=True,
    )


def _wav_duration(path: Path) -> float:
    with wave.open(str(path), "r") as w:
        return w.getnframes() / float(w.getframerate())


def _concat_wavs(parts: list[Path], out: Path) -> None:
    frames = []
    params = None
    for p in parts:
        with wave.open(str(p), "r") as w:
            if params is None:
                params = w.getparams()
            elif (
                w.getnchannels() != params.nchannels
                or w.getsampwidth() != params.sampwidth
                or w.getframerate() != params.framerate
            ):
                raise SystemExit(f"Formatos incompatíveis: {p}")
            frames.append(w.readframes(w.getnframes()))
    assert params is not None
    with wave.open(str(out), "w") as w:
        w.setparams(params)
        for f in frames:
            w.writeframes(f)


def _resample_to_16k_mono(src: Path, dst: Path) -> None:
    """Reamostra com av se necessário; SAPI costuma ser 22050 Hz."""
    import av

    inp = av.open(str(src))
    out = av.open(str(dst), "w")
    ostream = out.add_stream("pcm_s16le", rate=SAMPLE_RATE)
    ostream.layout = "mono"
    resampler = av.audio.resampler.AudioResampler(
        format="s16", layout="mono", rate=SAMPLE_RATE
    )
    for frame in inp.decode(audio=0):
        for f in resampler.resample(frame):
            for packet in ostream.encode(f):
                out.mux(packet)
    for packet in ostream.encode(None):
        out.mux(packet)
    out.close()
    inp.close()


def _wav_to_mp3(src: Path, dst: Path) -> None:
    import av

    inp = av.open(str(src))
    out = av.open(str(dst), "w")
    ostream = out.add_stream("mp3", rate=SAMPLE_RATE)
    ostream.bit_rate = 64000
    resampler = av.audio.resampler.AudioResampler(
        format="s16", layout="mono", rate=SAMPLE_RATE
    )
    for frame in inp.decode(audio=0):
        for f in resampler.resample(frame):
            for packet in ostream.encode(f):
                out.mux(packet)
    for packet in ostream.encode(None):
        out.mux(packet)
    out.close()
    inp.close()


def build_duration(target_sec: int, unit_wav_16k: Path, gap_sec: float = 0.35) -> Path:
    unit_dur = _wav_duration(unit_wav_16k)
    gap = OUT / "_gap.wav"
    if not gap.exists():
        _write_silence_wav(gap, gap_sec)
    parts: list[Path] = []
    total = 0.0
    n = 0
    while total < target_sec:
        parts.append(unit_wav_16k)
        total += unit_dur
        parts.append(gap)
        total += gap_sec
        n += 1
        if n > 5000:
            raise SystemExit("loop infinito ao montar duração")
    out = OUT / f"ptbr_{target_sec}s.wav"
    _concat_wavs(parts, out)
    # Trim exato
    with wave.open(str(out), "r") as w:
        rate = w.getframerate()
        want = target_sec * rate
        data = w.readframes(want)
        params = w.getparams()
    with wave.open(str(out), "w") as w:
        w.setparams(params)
        w.writeframes(data)
    mp3 = OUT / f"ptbr_{target_sec}s.mp3"
    _wav_to_mp3(out, mp3)
    print(
        f"OK {mp3.name}: duration={_wav_duration(out):.2f}s "
        f"wav={out.stat().st_size} mp3={mp3.stat().st_size}"
    )
    return mp3


def build_quality_clip() -> Path:
    """Um take curto, sem repetição, para comparação qualitativa / WER."""
    raw = OUT / "_quality_raw.wav"
    text = (
        "Bom dia. Eu sou a Ana Souza e estou em Belo Horizonte. "
        "Vamos falar com o doutor Ricardo Oliveira sobre o Hospital das Clínicas. "
        "Em janeiro de dois mil e vinte e seis, a cidade testou um novo protocolo. "
        "O nome da enfermeira responsável é Juliana Prado."
    )
    _sapi_speak_wav(text, raw)
    wav16 = OUT / "ptbr_quality.wav"
    _resample_to_16k_mono(raw, wav16)
    mp3 = OUT / "ptbr_quality.mp3"
    _wav_to_mp3(wav16, mp3)
    ref = OUT / "ptbr_quality.ref.txt"
    ref.write_text(text.strip() + "\n", encoding="utf-8")
    print(f"OK quality clip {_wav_duration(wav16):.2f}s -> {mp3.name}")
    return mp3


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    unit_raw = OUT / "_unit_raw.wav"
    unit_16k = OUT / "_unit_16k.wav"
    print("Gerando unidade TTS pt-BR…")
    _sapi_speak_wav(SCRIPT, unit_raw)
    _resample_to_16k_mono(unit_raw, unit_16k)
    print(f"Unidade: {_wav_duration(unit_16k):.2f}s")

    build_quality_clip()
    for sec in (60, 300, 600):
        build_duration(sec, unit_16k)

    meta = OUT / "MANIFEST.txt"
    lines = []
    for p in sorted(OUT.glob("ptbr_*.mp3")):
        wav = p.with_suffix(".wav")
        dur = _wav_duration(wav) if wav.exists() else float("nan")
        lines.append(f"{p.name}\t{dur:.3f}s\tmp3_bytes={p.stat().st_size}")
    meta.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("Manifest:\n" + meta.read_text(encoding="utf-8"))


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as e:
        print(e.stderr or e.stdout or e, file=sys.stderr)
        sys.exit(1)
