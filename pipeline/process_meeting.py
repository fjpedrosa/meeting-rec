#!/usr/bin/env python3
"""
Main CLI entry point for meeting transcription + diarization + speaker identification.

Usage:
    python pipeline/process_meeting.py <mp3_path> [--language es|en] [--db path/to/meetings.db]
"""
import argparse
import os
import subprocess
import sys
from datetime import datetime
from pathlib import Path

# Add pipeline directory to path for local imports
sys.path.insert(0, str(Path(__file__).parent))

from db import get_connection, create_tables, insert_meeting, update_meeting_completed, \
    update_meeting_error, insert_unknown_speaker, insert_participant, insert_voice_embedding
from transcribe import transcribe_and_diarize, MLX_WHISPER_MODEL, DIARIZE_DEVICE, \
    MIN_WORD_OVERLAP_RATIO, OVERLAP_WORD_RATIO, MAX_WORD_GAP_TO_MERGE
from embeddings import extract_speaker_embeddings, backfill_profile_embeddings, EMBEDDING_MODEL
from identify import identify_speakers, MATCH_SCORE_THRESHOLD, BEST_EXEMPLAR_DISTANCE_THRESHOLD, \
    MIN_QUALITY_SCORE, CONFIDENCE_MARGIN
from output import generate_transcript, write_transcript, build_structured_transcript, write_structured_transcript

import json as _json


def emit_progress(step: str, message: str, progress: int) -> None:
    print(_json.dumps({"type": "progress", "step": step, "message": message, "progress": progress}), flush=True)

def emit_log(message: str) -> None:
    print(_json.dumps({"type": "log", "message": message}), flush=True)

def emit_complete(message: str) -> None:
    print(_json.dumps({"type": "complete", "message": message, "progress": 100}), flush=True)

def emit_error(message: str) -> None:
    print(_json.dumps({"type": "error", "message": message}), flush=True)


def notify(title: str, message: str) -> None:
    try:
        subprocess.run([
            "osascript", "-e",
            f'display notification "{message}" with title "{title}"'
        ], check=False, capture_output=True)
    except Exception:
        pass


def extract_meeting_date(name: str) -> str:
    """Try to extract date from folder or file name like '2025-10-23 ...' or '2026-03-27 11-02-42'"""
    # Try to find a YYYY-MM-DD pattern anywhere in the name
    import re
    match = re.search(r'(\d{4}-\d{2}-\d{2})', name)
    if match:
        try:
            datetime.strptime(match.group(1), "%Y-%m-%d")
            return match.group(1)
        except ValueError:
            pass
    return datetime.now().strftime("%Y-%m-%d")


def main():
    parser = argparse.ArgumentParser(description="Process meeting audio: transcribe, diarize, identify speakers")
    parser.add_argument("mp3_path", help="Path to the MP3 file")
    parser.add_argument("--language", choices=["es", "en"], default=None,
                        help="Audio language (auto-detected if not specified)")
    parser.add_argument("--db", default=None, help="Path to SQLite database")
    args = parser.parse_args()

    mp3_path = os.path.abspath(args.mp3_path)
    if not os.path.exists(mp3_path):
        emit_error(f"file not found: {mp3_path}")
        sys.exit(1)

    hf_token = os.environ.get("HF_TOKEN")
    if not hf_token:
        emit_error("HF_TOKEN environment variable is required (HuggingFace access token)")
        sys.exit(1)

    project_dir = Path(__file__).parent.parent
    db_path = args.db or str(project_dir / "data" / "db" / "meetings.db")
    clips_dir = str(project_dir / "data" / "clips")

    # Ensure directories exist
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    Path(clips_dir).mkdir(parents=True, exist_ok=True)

    conn = get_connection(db_path)
    create_tables(conn)

    # Extract meeting info from folder or filename
    mp3_dir = Path(mp3_path).parent
    folder_name = mp3_dir.name
    mp3_filename = Path(mp3_path).stem
    meeting_date = extract_meeting_date(folder_name)
    if meeting_date == datetime.now().strftime("%Y-%m-%d"):
        # Folder didn't have a date, try the filename
        meeting_date = extract_meeting_date(mp3_filename)

    emit_progress("initializing", "Preparando pipeline...", 0)
    emit_log(f"Processing: {folder_name}")
    emit_log(f"File: {mp3_path}")
    emit_log(f"Date: {meeting_date}")

    meeting_id = insert_meeting(conn, folder_name, mp3_path, args.language or "es", meeting_date)

    try:
        # Step 1: Transcribe + diarize
        emit_progress("transcribing", "Transcribiendo y diarizando audio...", 15)
        segments, duration = transcribe_and_diarize(mp3_path, language=args.language, hf_token=hf_token)
        emit_log(f"Got {len(segments)} segments, {duration:.0f}s duration")

        # Step 2: Extract speaker embeddings
        emit_progress("extracting_embeddings", "Extrayendo embeddings de speakers...", 50)
        speaker_embeddings = extract_speaker_embeddings(
            mp3_path, segments, meeting_id, clips_dir, hf_token=hf_token
        )
        emit_log(f"Found {len(speaker_embeddings)} speakers")

        # Step 2.5: Backfill profile embeddings (re-extract for profiles with missing/zero embeddings)
        emit_progress("backfilling", "Verificando biblioteca de perfiles de voz...", 65)
        emit_log("Checking voice profile library for missing embeddings...")
        backfilled = backfill_profile_embeddings(conn, clips_dir, hf_token)
        if backfilled > 0:
            emit_log(f"Backfilled {backfilled} profile(s) with previously missing embeddings")
        else:
            emit_log("All profiles with audio clips already have valid embeddings")

        # Step 3: Identify speakers
        emit_progress("identifying", "Identificando speakers contra toda la biblioteca de perfiles...", 75)
        emit_log("Identifying speakers against full voice profile library...")
        speaker_names = identify_speakers(conn, speaker_embeddings)

        # Step 4: Store participants and unknown speakers
        emit_progress("storing", "Guardando participantes...", 80)
        for speaker_label, (profile_id, display_name) in speaker_names.items():
            is_identified = profile_id is not None
            speaker_clip = speaker_embeddings.get(speaker_label, {}).get("clip_path")
            insert_participant(conn, meeting_id, speaker_label, profile_id, is_identified, clip_path=speaker_clip)

            if not is_identified:
                speaker_data = speaker_embeddings.get(speaker_label, {})
                embedding = speaker_data.get("embedding")
                clip_path = speaker_data.get("clip_path")
                if embedding is not None:
                    insert_unknown_speaker(
                        conn,
                        meeting_id,
                        speaker_label,
                        embedding,
                        clip_path,
                        quality_score=speaker_data.get("quality_score"),
                        clip_duration_seconds=speaker_data.get("clip_duration_seconds"),
                        segment_count=speaker_data.get("segment_count"),
                        clean_segment_count=speaker_data.get("clean_segment_count"),
                        has_overlap=bool(speaker_data.get("has_overlap", False)),
                    )
            else:
                # Store embedding for known speaker to improve future matching
                speaker_data = speaker_embeddings.get(speaker_label, {})
                embedding = speaker_data.get("embedding")
                if embedding is not None:
                    insert_voice_embedding(
                        conn,
                        profile_id,
                        embedding,
                        meeting_id,
                        quality_score=speaker_data.get("quality_score"),
                        clip_duration_seconds=speaker_data.get("clip_duration_seconds"),
                        segment_count=speaker_data.get("segment_count"),
                        clean_segment_count=speaker_data.get("clean_segment_count"),
                        has_overlap=bool(speaker_data.get("has_overlap", False)),
                    )

        # Step 5: Generate transcript
        emit_progress("generating", "Generando transcripcion...", 90)
        transcript_text = generate_transcript(segments, speaker_names)
        transcript_path = str(mp3_dir / f"{Path(mp3_path).stem}.txt")
        pipeline_metadata = {
            "transcription_model": MLX_WHISPER_MODEL,
            "diarization_model": "pyannote/speaker-diarization-3.1",
            "diarization_device": DIARIZE_DEVICE,
            "embedding_model": EMBEDDING_MODEL,
            "identification": {
                "match_score_threshold": MATCH_SCORE_THRESHOLD,
                "best_exemplar_distance_threshold": BEST_EXEMPLAR_DISTANCE_THRESHOLD,
                "min_quality_score": MIN_QUALITY_SCORE,
                "confidence_margin": CONFIDENCE_MARGIN,
            },
            "segmentation": {
                "min_word_overlap_ratio": MIN_WORD_OVERLAP_RATIO,
                "overlap_word_ratio": OVERLAP_WORD_RATIO,
                "max_word_gap_to_merge": MAX_WORD_GAP_TO_MERGE,
            },
            "processed_at": datetime.now().isoformat(),
        }
        structured_transcript = build_structured_transcript(
            segments,
            speaker_names,
            duration_seconds=duration,
            language=args.language,
            pipeline_metadata=pipeline_metadata,
        )
        structured_transcript_path = str(mp3_dir / f"{Path(mp3_path).stem}.transcript.json")
        write_transcript(transcript_path, transcript_text)
        write_structured_transcript(structured_transcript_path, structured_transcript)

        # Update meeting status
        update_meeting_completed(conn, meeting_id, transcript_path, int(duration))

        emit_complete(f"Meeting procesada: {folder_name}")
        notify("Meeting Transcribed", f"{folder_name} - Ready for review")

    except Exception as e:
        import traceback
        error_msg = f"{e}\n{traceback.format_exc()}"
        update_meeting_error(conn, meeting_id, error_msg)
        emit_error(str(e))
        notify("Meeting Transcription Error", f"{folder_name} - Check logs")
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
