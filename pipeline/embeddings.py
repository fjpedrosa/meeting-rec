import sqlite3
import subprocess
import tempfile
import torch
import torchaudio
import numpy as np
from pathlib import Path
from pyannote.audio import Model, Inference

EMBEDDING_MODEL = "pyannote/wespeaker-voxceleb-resnet34-LM"
DEVICE = "mps" if torch.backends.mps.is_available() else "cpu"
CLIP_MAX_DURATION = 15.0  # seconds
MIN_SEGMENT_DURATION = 1.5  # seconds — shorter segments produce unreliable embeddings
MIN_PROFILE_QUALITY_SCORE = 0.25


def _load_inference(hf_token: str | None) -> Inference:
    model = Model.from_pretrained(EMBEDDING_MODEL, token=hf_token)
    inference = Inference(model, window="whole")
    inference.to(torch.device(DEVICE))
    return inference


def _l2_normalize(embedding: np.ndarray) -> np.ndarray:
    norm = np.linalg.norm(embedding)
    return (embedding / norm) if norm > 0 else embedding


def _embed_waveform(
    inference: Inference,
    waveform: torch.Tensor,
    sample_rate: int,
) -> np.ndarray:
    emb = inference({"waveform": waveform, "sample_rate": sample_rate})
    raw = emb.flatten().astype(np.float32)
    return _l2_normalize(raw)


def _segment_duration(segment: dict) -> float:
    return max(0.0, float(segment.get("end", 0.0)) - float(segment.get("start", 0.0)))


def _compute_quality_score(
    segments: list[dict],
    clean_segments: list[dict],
    valid_embedding_count: int,
) -> float:
    if not segments or valid_embedding_count == 0:
        return 0.0

    total_duration = sum(_segment_duration(seg) for seg in segments)
    clean_duration = sum(_segment_duration(seg) for seg in clean_segments)

    clean_ratio = (clean_duration / total_duration) if total_duration > 0 else 0.0
    duration_score = min(clean_duration / 15.0, 1.0)
    coverage_score = min(valid_embedding_count / 3.0, 1.0)

    return float(
        min(
            1.0,
            (0.5 * clean_ratio) +
            (0.3 * duration_score) +
            (0.2 * coverage_score),
        )
    )


def extract_speaker_embeddings(
    mp3_path: str,
    segments: list[dict],
    meeting_id: int,
    clips_dir: str,
    hf_token: str | None = None,
) -> dict[str, dict]:
    """
    Extract one embedding per speaker and save a representative audio clip.

    Returns speaker-level evidence and metadata:
        {
            speaker_label: {
                "embedding": average_embedding,
                "segment_embeddings": [normalized_embedding, ...],
                "clip_path": clip_path_or_None,
                "quality_score": 0..1,
                "clip_duration_seconds": float,
                "segment_count": int,
                "clean_segment_count": int,
                "has_overlap": bool,
            }
        }
    """
    print("  Extracting speaker embeddings...")
    inference = _load_inference(hf_token)

    # Group segments by speaker
    speaker_segments: dict[str, list[dict]] = {}
    for seg in segments:
        speaker = seg["speaker"]
        if speaker == "UNKNOWN":
            continue
        if speaker not in speaker_segments:
            speaker_segments[speaker] = []
        speaker_segments[speaker].append(seg)

    # Convert MP3 to WAV for torchaudio compatibility
    tmp_wav = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    tmp_wav.close()
    subprocess.run(
        ["ffmpeg", "-y", "-i", mp3_path, "-ac", "1", "-ar", "16000", tmp_wav.name],
        capture_output=True, check=True
    )
    waveform, sample_rate = torchaudio.load(tmp_wav.name)
    Path(tmp_wav.name).unlink(missing_ok=True)

    # Create clips directory for this meeting
    meeting_clips_dir = Path(clips_dir) / str(meeting_id)
    meeting_clips_dir.mkdir(parents=True, exist_ok=True)

    results: dict[str, dict] = {}

    for speaker_label, segs in speaker_segments.items():
        embeddings: list[np.ndarray] = []
        clean_segs = [
            seg for seg in segs
            if not seg.get("has_overlap", False) and _segment_duration(seg) >= MIN_SEGMENT_DURATION
        ]
        candidate_segs = clean_segs or [
            seg for seg in segs
            if _segment_duration(seg) >= MIN_SEGMENT_DURATION
        ]

        best_seg_pool = clean_segs or segs
        best_seg = max(best_seg_pool, key=_segment_duration)

        # Save representative clip first (longest segment, capped at CLIP_MAX_DURATION)
        clip_path = None
        clip_start = int(best_seg["start"] * sample_rate)
        clip_end = int(min(best_seg["end"], best_seg["start"] + CLIP_MAX_DURATION) * sample_rate)
        clip_waveform = waveform[:, clip_start:clip_end]
        clip_duration_seconds = clip_waveform.shape[1] / sample_rate if clip_waveform.shape[1] > 0 else 0.0

        if clip_waveform.shape[1] > 0:
            clip_filename = f"{speaker_label}.wav"
            clip_full_path = meeting_clips_dir / clip_filename
            torchaudio.save(str(clip_full_path), clip_waveform, sample_rate)
            clip_path = f"{meeting_id}/{clip_filename}"

        min_samples = int(MIN_SEGMENT_DURATION * sample_rate)

        for seg in candidate_segs:
            start_sample = int(seg["start"] * sample_rate)
            end_sample = int(seg["end"] * sample_rate)
            if end_sample <= start_sample:
                continue

            chunk = waveform[:, start_sample:end_sample]
            if chunk.shape[1] < min_samples:  # skip segments shorter than MIN_SEGMENT_DURATION
                continue

            try:
                embeddings.append(_embed_waveform(inference, chunk, sample_rate))
            except Exception as e:
                print(f"    Warning: embedding extraction failed for {speaker_label}: {e}")

        quality_score = _compute_quality_score(segs, clean_segs, len(embeddings))
        if not embeddings:
            print(
                f"    Warning: no embeddings extracted for {speaker_label} "
                f"(usable clean segments < {MIN_SEGMENT_DURATION}s)"
            )
            results[speaker_label] = {
                "embedding": np.zeros(256, dtype=np.float32),
                "segment_embeddings": [],
                "clip_path": clip_path,
                "quality_score": quality_score,
                "clip_duration_seconds": clip_duration_seconds,
                "segment_count": len(segs),
                "clean_segment_count": len(clean_segs),
                "has_overlap": any(seg.get("has_overlap", False) for seg in segs),
            }
            continue

        # Average of L2-normalized embeddings, then re-normalize the mean
        mean_embedding = np.mean(embeddings, axis=0).astype(np.float32)
        avg_embedding = _l2_normalize(mean_embedding)
        results[speaker_label] = {
            "embedding": avg_embedding,
            "segment_embeddings": embeddings,
            "clip_path": clip_path,
            "quality_score": quality_score,
            "clip_duration_seconds": clip_duration_seconds,
            "segment_count": len(segs),
            "clean_segment_count": len(clean_segs),
            "has_overlap": any(seg.get("has_overlap", False) for seg in segs),
        }

    del inference
    if DEVICE == "mps":
        torch.mps.empty_cache()

    return results


def backfill_profile_embeddings(
    conn: sqlite3.Connection,
    clips_dir: str,
    hf_token: str | None = None,
) -> int:
    """
    Re-extract and store embeddings for profiles that have audio clips but:
    - Have no entries in voice_embeddings, OR
    - Only have zero embeddings (extraction failed originally)

    Returns count of profiles successfully backfilled.
    """
    from db import get_profile_embeddings, get_profiles_needing_backfill, insert_voice_embedding

    existing_profiles = get_profile_embeddings(conn)
    clip_records = get_profiles_needing_backfill(conn)

    if not clip_records:
        return 0

    # Group clip records by profile_id
    clips_by_profile: dict[int, list[dict]] = {}
    for record in clip_records:
        pid = record["profile_id"]
        if pid not in clips_by_profile:
            clips_by_profile[pid] = []
        clips_by_profile[pid].append(record)

    # Determine which profiles need backfill
    profiles_to_backfill: dict[int, list[dict]] = {}
    for profile_id, records in clips_by_profile.items():
        if profile_id not in existing_profiles:
            # No embeddings at all
            profiles_to_backfill[profile_id] = records
        else:
            _, embeddings, _ = existing_profiles[profile_id]
            if all(np.all(emb == 0) for emb in embeddings):
                # Only zero embeddings - extraction previously failed
                profiles_to_backfill[profile_id] = records

    if not profiles_to_backfill:
        return 0

    print(f"  Backfilling embeddings for {len(profiles_to_backfill)} profiles with missing/invalid embeddings...")
    inference = _load_inference(hf_token)
    backfilled = 0

    for profile_id, records in profiles_to_backfill.items():
        profile_name = records[0]["name"]
        success = False
        for record in records:
            clip_full_path = Path(clips_dir) / record["clip_path"]
            if not clip_full_path.exists():
                continue
            try:
                waveform, sample_rate = torchaudio.load(str(clip_full_path))
                if waveform.shape[0] > 1:
                    waveform = waveform.mean(dim=0, keepdim=True)
                embedding = _embed_waveform(inference, waveform, sample_rate)
                if not np.all(embedding == 0):
                    clip_duration_seconds = waveform.shape[1] / sample_rate if waveform.shape[1] > 0 else 0.0
                    insert_voice_embedding(
                        conn,
                        profile_id,
                        embedding,
                        record["meeting_id"],
                        quality_score=0.5,
                        clip_duration_seconds=clip_duration_seconds,
                        segment_count=1,
                        clean_segment_count=1,
                        has_overlap=False,
                    )
                    print(f"    Backfilled '{profile_name}' from clip {record['clip_path']}")
                    backfilled += 1
                    success = True
                    break
            except Exception as e:
                print(f"    Warning: backfill failed for {record['clip_path']}: {e}")
        if not success:
            print(f"    Warning: could not backfill '{profile_name}' - no valid clips found")

    del inference
    if DEVICE == "mps":
        torch.mps.empty_cache()

    return backfilled
