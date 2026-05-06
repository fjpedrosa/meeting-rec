import subprocess
import json
import mlx_whisper
from pyannote.audio import Pipeline
from pyannote.audio.pipelines.speaker_diarization import DiarizeOutput
import torch
import torchaudio

MLX_WHISPER_MODEL = "mlx-community/whisper-large-v3-turbo"
DIARIZE_DEVICE = "mps" if torch.backends.mps.is_available() else "cpu"
MIN_WORD_OVERLAP_RATIO = 0.2
OVERLAP_WORD_RATIO = 0.2
MAX_WORD_GAP_TO_MERGE = 0.6


def _get_audio_duration(audio_path: str) -> float:
    """Get audio duration in seconds using ffprobe."""
    cmd = [
        "ffprobe", "-v", "quiet", "-print_format", "json",
        "-show_format", audio_path
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    data = json.loads(result.stdout)
    return float(data["format"]["duration"])


def _safe_float(value, default: float) -> float:
    try:
        if value is None:
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def _collect_diarization_tracks(diarization) -> list[tuple[float, float, str]]:
    return [
        (float(turn.start), float(turn.end), speaker)
        for turn, _, speaker in diarization.itertracks(yield_label=True)
    ]


def _extract_words(segment: dict, segment_index: int) -> list[dict]:
    seg_start = _safe_float(segment.get("start"), 0.0)
    seg_end = _safe_float(segment.get("end"), seg_start)
    raw_words = segment.get("words") or []

    words: list[dict] = []
    if raw_words:
        for word_index, word in enumerate(raw_words):
            raw_text = str(word.get("word") or word.get("text") or "")
            if not raw_text.strip():
                continue

            start = _safe_float(word.get("start"), seg_start)
            end = _safe_float(word.get("end"), start)
            if end < start:
                end = start

            words.append({
                "text": raw_text,
                "normalized_text": raw_text.strip(),
                "start": start,
                "end": end,
                "segment_index": segment_index,
                "word_index": word_index,
            })

    if words:
        return words

    text = str(segment.get("text") or "").strip()
    if not text:
        return []

    return [{
        "text": text,
        "normalized_text": text,
        "start": seg_start,
        "end": seg_end,
        "segment_index": segment_index,
        "word_index": 0,
    }]


def _score_speakers_for_interval(
    start: float,
    end: float,
    diarization_tracks: list[tuple[float, float, str]],
) -> tuple[str, float, bool, list[dict]]:
    duration = max(end - start, 1e-3)
    overlaps: dict[str, float] = {}

    for track_start, track_end, speaker in diarization_tracks:
        overlap_start = max(start, track_start)
        overlap_end = min(end, track_end)
        overlap_duration = max(0.0, overlap_end - overlap_start)
        if overlap_duration > 0:
            overlaps[speaker] = overlaps.get(speaker, 0.0) + overlap_duration

    if not overlaps:
        return "UNKNOWN", 0.0, False, []

    scored_candidates = sorted(
        (
            {
                "speaker": speaker,
                "overlap_seconds": overlap,
                "overlap_ratio": overlap / duration,
            }
            for speaker, overlap in overlaps.items()
        ),
        key=lambda item: item["overlap_seconds"],
        reverse=True,
    )

    best = scored_candidates[0]
    if best["overlap_ratio"] < MIN_WORD_OVERLAP_RATIO:
        return "UNKNOWN", best["overlap_ratio"], False, scored_candidates

    overlapping_speakers = [
        candidate for candidate in scored_candidates
        if candidate["overlap_ratio"] >= OVERLAP_WORD_RATIO
    ]
    has_overlap = len(overlapping_speakers) > 1

    return best["speaker"], best["overlap_ratio"], has_overlap, scored_candidates


def _join_word_texts(words: list[dict]) -> str:
    raw_tokens = [str(word.get("text") or "") for word in words]
    if any(token.startswith(" ") for token in raw_tokens):
        return "".join(raw_tokens).strip()
    return " ".join(
        str(word.get("normalized_text") or word.get("text") or "").strip()
        for word in words
        if str(word.get("normalized_text") or word.get("text") or "").strip()
    ).strip()


def _assign_speakers(segments: list[dict], diarization) -> list[dict]:
    """
    Assign speakers to transcript words, then regroup into speaker-consistent segments.

    This preserves rapid speaker turns much better than assigning one speaker to a
    whole Whisper segment.
    """
    diarization_tracks = _collect_diarization_tracks(diarization)

    attributed_words: list[dict] = []
    for segment_index, seg in enumerate(segments):
        for word in _extract_words(seg, segment_index):
            speaker, confidence, has_overlap, candidates = _score_speakers_for_interval(
                word["start"], word["end"], diarization_tracks
            )
            attributed_words.append({
                **word,
                "speaker": speaker,
                "speaker_confidence": confidence,
                "has_overlap": has_overlap,
                "speaker_candidates": candidates,
            })

    if not attributed_words:
        return []

    result: list[dict] = []
    current_words: list[dict] = []

    def flush_current() -> None:
        if not current_words:
            return

        text = _join_word_texts(current_words)
        if not text:
            current_words.clear()
            return

        result.append({
            "text": text,
            "start": current_words[0]["start"],
            "end": current_words[-1]["end"],
            "speaker": current_words[0]["speaker"],
            "has_overlap": any(word["has_overlap"] for word in current_words),
            "speaker_confidence": sum(word["speaker_confidence"] for word in current_words) / len(current_words),
            "words": [dict(word) for word in current_words],
        })
        current_words.clear()

    for word in attributed_words:
        if not current_words:
            current_words.append(word)
            continue

        prev_word = current_words[-1]
        same_speaker = word["speaker"] == prev_word["speaker"]
        same_overlap_state = word["has_overlap"] == prev_word["has_overlap"]
        close_enough = (word["start"] - prev_word["end"]) <= MAX_WORD_GAP_TO_MERGE

        if same_speaker and same_overlap_state and close_enough:
            current_words.append(word)
        else:
            flush_current()
            current_words.append(word)

    flush_current()

    # Post-process: assign UNKNOWN segments to surrounding speaker when sandwiched
    return _resolve_unknown_fragments(result)


MAX_UNKNOWN_DURATION_TO_INFER = 5.0  # seconds


def _resolve_unknown_fragments(segments: list[dict]) -> list[dict]:
    """
    If an UNKNOWN segment is sandwiched between two segments of the same known speaker
    and is short enough, reassign it to that speaker and merge everything into one segment.
    """
    if len(segments) < 3:
        return segments

    resolved: list[dict] = list(segments)
    changed = True

    while changed:
        changed = False
        merged: list[dict] = []
        i = 0
        while i < len(resolved):
            seg = resolved[i]

            if (
                seg["speaker"] == "UNKNOWN"
                and i > 0
                and i < len(resolved) - 1
            ):
                prev_seg = resolved[i - 1] if merged else None
                # Use the last merged segment as prev
                if merged:
                    prev_seg = merged[-1]
                next_seg = resolved[i + 1]

                duration = (seg.get("end") or 0) - (seg.get("start") or 0)
                same_neighbours = (
                    prev_seg is not None
                    and prev_seg["speaker"] != "UNKNOWN"
                    and prev_seg["speaker"] == next_seg["speaker"]
                    and duration <= MAX_UNKNOWN_DURATION_TO_INFER
                )

                if same_neighbours:
                    # Merge prev + unknown + next into one segment
                    merged_words = (prev_seg.get("words") or []) + (seg.get("words") or []) + (next_seg.get("words") or [])
                    merged_text = " ".join(
                        part for part in [prev_seg["text"], seg["text"], next_seg["text"]] if part.strip()
                    ).strip()
                    merged_seg = {
                        "text": merged_text,
                        "start": prev_seg["start"],
                        "end": next_seg["end"],
                        "speaker": prev_seg["speaker"],
                        "has_overlap": prev_seg.get("has_overlap", False) or seg.get("has_overlap", False) or next_seg.get("has_overlap", False),
                        "speaker_confidence": prev_seg.get("speaker_confidence", 0.0),
                        "words": merged_words,
                    }
                    merged.pop()  # remove prev_seg already added
                    merged.append(merged_seg)
                    i += 2  # skip unknown + next
                    changed = True
                    continue

            merged.append(seg)
            i += 1

        resolved = merged

    return resolved


def transcribe_and_diarize(mp3_path: str, language: str | None = None,
                           hf_token: str | None = None) -> tuple[list[dict], float]:
    """
    Transcribes and diarizes an audio file using mlx-whisper and pyannote.

    Returns:
        (segments, duration_seconds) where each segment has:
        {text, start, end, speaker}
    """
    duration_seconds = _get_audio_duration(mp3_path)

    print(f"  Transcribing ({duration_seconds:.0f}s of audio)...")
    transcribe_kwargs = {
        "path_or_hf_repo": MLX_WHISPER_MODEL,
        "word_timestamps": True,
    }
    if language:
        transcribe_kwargs["language"] = language

    result = mlx_whisper.transcribe(mp3_path, **transcribe_kwargs)

    detected_language = result.get("language", language or "es")
    print(f"  Language detected: {detected_language}")

    print("  Diarizing speakers...")
    diarize_pipeline = Pipeline.from_pretrained(
        "pyannote/speaker-diarization-3.1",
        token=hf_token
    )
    diarize_pipeline = diarize_pipeline.to(torch.device(DIARIZE_DEVICE))

    # Load audio with torchaudio to bypass broken torchcodec
    waveform, sample_rate = torchaudio.load(mp3_path)
    if waveform.shape[0] > 1:
        waveform = waveform.mean(dim=0, keepdim=True)
    audio_input = {"waveform": waveform, "sample_rate": sample_rate}
    diarization = diarize_pipeline(audio_input)

    # pyannote 3.x returns DiarizeOutput; extract the Annotation from it
    annotation = diarization.speaker_diarization if isinstance(diarization, DiarizeOutput) else diarization

    segments = _assign_speakers(result.get("segments", []), annotation)

    # Clean up GPU memory
    del diarize_pipeline
    if DIARIZE_DEVICE == "mps":
        torch.mps.empty_cache()

    return segments, duration_seconds
