import json


def format_timestamp(seconds: float) -> str:
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    return f"{h:02d}:{m:02d}:{s:02d}"


def generate_transcript(
    segments: list[dict],
    speaker_names: dict[str, tuple[int | None, str]],
) -> str:
    """
    Generate formatted transcript text.

    Format:
        Name | HH:MM:SS
        What they said

    Consecutive segments from the same speaker are merged.
    """
    if not segments:
        return ""

    lines: list[str] = []
    current_speaker = None
    current_text_parts: list[str] = []
    current_start = 0.0
    current_has_overlap = False

    for seg in segments:
        speaker_label = seg.get("speaker", "UNKNOWN")
        _, display_name = speaker_names.get(speaker_label, (None, speaker_label))
        text = seg.get("text", "").strip()

        if not text:
            continue

        same_overlap_state = (
            current_speaker is not None and
            bool(seg.get("has_overlap", False)) == bool(current_has_overlap)
        )

        if speaker_label == current_speaker and same_overlap_state:
            current_text_parts.append(text)
        else:
            # Flush previous speaker
            if current_speaker is not None and current_text_parts:
                _, prev_name = speaker_names.get(current_speaker, (None, current_speaker))
                lines.append(f"{prev_name} | {format_timestamp(current_start)}")
                lines.append(" ".join(current_text_parts))
                lines.append("")

            current_speaker = speaker_label
            current_text_parts = [text]
            current_start = seg.get("start", 0.0)
            current_has_overlap = bool(seg.get("has_overlap", False))

    # Flush last speaker
    if current_speaker is not None and current_text_parts:
        _, last_name = speaker_names.get(current_speaker, (None, current_speaker))
        lines.append(f"{last_name} | {format_timestamp(current_start)}")
        lines.append(" ".join(current_text_parts))
        lines.append("")

    return "\n".join(lines)


def write_transcript(output_path: str, content: str) -> None:
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(content)
    print(f"  Transcript saved to: {output_path}")


def build_structured_transcript(
    segments: list[dict],
    speaker_names: dict[str, tuple[int | None, str]],
    duration_seconds: float | None = None,
    language: str | None = None,
    pipeline_metadata: dict | None = None,
) -> dict:
    speakers: dict[str, dict] = {}
    structured_segments: list[dict] = []

    for seg in segments:
        speaker_label = seg.get("speaker", "UNKNOWN")
        profile_id, display_name = speaker_names.get(speaker_label, (None, speaker_label))

        speakers[speaker_label] = {
            "profile_id": profile_id,
            "display_name": display_name,
        }

        structured_words = []
        for word in seg.get("words", []) or []:
            structured_words.append({
                "text": word.get("normalized_text") or str(word.get("text") or "").strip(),
                "raw_text": word.get("text") or word.get("normalized_text") or "",
                "start": word.get("start"),
                "end": word.get("end"),
                "speaker_label": word.get("speaker", speaker_label),
                "speaker_display_name": speaker_names.get(
                    word.get("speaker", speaker_label),
                    (None, word.get("speaker", speaker_label))
                )[1],
                "speaker_confidence": word.get("speaker_confidence"),
                "has_overlap": bool(word.get("has_overlap", False)),
            })

        structured_segments.append({
            "start": seg.get("start"),
            "end": seg.get("end"),
            "speaker_label": speaker_label,
            "speaker_display_name": display_name,
            "speaker_confidence": seg.get("speaker_confidence"),
            "has_overlap": bool(seg.get("has_overlap", False)),
            "text": seg.get("text", "").strip(),
            "words": structured_words,
        })

    result = {
        "version": 1,
        "language": language,
        "duration_seconds": duration_seconds,
        "speakers": speakers,
        "segments": structured_segments,
    }

    if pipeline_metadata:
        result["pipeline"] = pipeline_metadata

    return result


def write_structured_transcript(output_path: str, payload: dict) -> None:
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    print(f"  Structured transcript saved to: {output_path}")
