import numpy as np
from scipy.spatial.distance import cosine
import sqlite3
from db import get_profile_embeddings, get_all_voice_profiles

# Threshold for combined speaker matching score — lower = stricter.
MATCH_SCORE_THRESHOLD = 0.58
BEST_EXEMPLAR_DISTANCE_THRESHOLD = 0.68
MIN_QUALITY_SCORE = 0.35

# Minimum gap between best and second-best match.
# Prevents identification when two profiles are similarly close (ambiguous match).
# Set to 0.0 to disable the margin check (only threshold applies).
CONFIDENCE_MARGIN = 0.08


def _l2_normalize(embedding: np.ndarray) -> np.ndarray:
    norm = np.linalg.norm(embedding)
    return (embedding / norm) if norm > 0 else embedding


def _valid_embeddings(embeddings: list[np.ndarray]) -> list[np.ndarray]:
    return [_l2_normalize(emb) for emb in embeddings if not np.all(emb == 0)]


def _profile_centroid(embeddings: list[np.ndarray], qualities: list[float] | None = None) -> np.ndarray | None:
    valid_pairs = [
        (emb, q)
        for emb, q in zip(_valid_embeddings(embeddings), qualities or [1.0] * len(embeddings))
        if not np.all(emb == 0)
    ]
    if not valid_pairs:
        return None
    valid_embs = [p[0] for p in valid_pairs]
    weights = np.array([p[1] for p in valid_pairs], dtype=np.float32)
    weights = np.clip(weights, 1e-6, None)
    weights /= weights.sum()
    centroid = np.average(valid_embs, axis=0, weights=weights).astype(np.float32)
    return _l2_normalize(centroid)


def identify_speakers(
    conn: sqlite3.Connection,
    speaker_embeddings: dict[str, dict],
) -> dict[str, tuple[int | None, str]]:
    """
    Match speaker embeddings against known voice profiles.

    Returns:
        {speaker_label: (profile_id_or_None, display_name)}
    """
    profiles = get_profile_embeddings(conn)
    all_profiles = get_all_voice_profiles(conn)
    results: dict[str, tuple[int | None, str]] = {}

    # Log library status
    profiles_with_embeddings = set(profiles.keys())
    profiles_without_embeddings = [
        p for p in all_profiles if p["profile_id"] not in profiles_with_embeddings
    ]

    print(f"  Voice profile library: {len(all_profiles)} total profiles")
    if profiles:
        profile_names = ", ".join(name for _, (name, _, _) in profiles.items())
        print(f"    With embeddings ({len(profiles)}): {profile_names}")
    if profiles_without_embeddings:
        missing_names = ", ".join(p["name"] for p in profiles_without_embeddings)
        print(f"    Without embeddings ({len(profiles_without_embeddings)}): {missing_names}")
        print(f"    Note: profiles without embeddings cannot be matched automatically.")

    if not profiles:
        print("  No profiles with embeddings found - all speakers will be marked unknown")
        for i, speaker_label in enumerate(speaker_embeddings):
            results[speaker_label] = (None, f"Speaker {i + 1}")
        return results



    for speaker_label, speaker_data in speaker_embeddings.items():
        print(f"\n  {speaker_label}:")
        embedding = speaker_data["embedding"]
        current_quality = float(speaker_data.get("quality_score") or 0.0)
        segment_embeddings = [
            _l2_normalize(np.asarray(seg_emb, dtype=np.float32))
            for seg_emb in (speaker_data.get("segment_embeddings") or [])
            if not np.all(seg_emb == 0)
        ]

        if np.all(embedding == 0):
            print("    Zero embedding - marking as unknown")
            results[speaker_label] = (None, speaker_label)
            continue

        if not segment_embeddings:
            segment_embeddings = [_l2_normalize(np.asarray(embedding, dtype=np.float32))]

        if current_quality < MIN_QUALITY_SCORE:
            print(
                f"    Low quality speaker evidence ({current_quality:.2f} < {MIN_QUALITY_SCORE:.2f}) "
                " - marking as unknown"
            )
            results[speaker_label] = (None, speaker_label)
            continue

        profile_distances: list[tuple[str, float, int | None, float, float, float]] = []
        current_centroid = _l2_normalize(np.asarray(embedding, dtype=np.float32))

        for profile_id, (name, profile_embeddings, profile_qualities) in profiles.items():
            valid_profile_embeddings = _valid_embeddings(profile_embeddings)
            profile_centroid = _profile_centroid(profile_embeddings, profile_qualities)

            if not valid_profile_embeddings or profile_centroid is None:
                profile_distances.append((name, float("inf"), profile_id, float("inf"), float("inf"), float("inf")))
                continue

            best_per_segment: list[float] = []
            for meeting_embedding in segment_embeddings:
                try:
                    best_per_segment.append(
                        min(cosine(meeting_embedding, profile_embedding) for profile_embedding in valid_profile_embeddings)
                    )
                except ValueError:
                    continue

            if not best_per_segment:
                profile_distances.append((name, float("inf"), profile_id, float("inf"), float("inf"), float("inf")))
                continue

            best_exemplar_distance = float(np.min(best_per_segment))
            mean_exemplar_distance = float(np.mean(best_per_segment))
            centroid_distance = float(cosine(current_centroid, profile_centroid))

            combined_score = float(
                (0.5 * best_exemplar_distance) +
                (0.3 * mean_exemplar_distance) +
                (0.2 * centroid_distance)
            )
            profile_distances.append((
                name,
                combined_score,
                profile_id,
                best_exemplar_distance,
                mean_exemplar_distance,
                centroid_distance,
            ))

        # Sort by distance ascending (best match first)
        profile_distances.sort(key=lambda x: x[1])

        best_name, best_distance, best_match_id, best_exemplar, _, _ = (
            profile_distances[0] if profile_distances else ("", float("inf"), None, float("inf"), float("inf"), float("inf"))
        )
        second_distance = profile_distances[1][1] if len(profile_distances) > 1 else float("inf")
        gap = second_distance - best_distance

        # Log distances to all profiles
        for i, (name, dist, pid, exemplar_dist, mean_dist, centroid_dist) in enumerate(profile_distances):
            dist_str = f"{dist:.3f}" if dist != float("inf") else "N/A"
            detail = (
                ""
                if dist == float("inf")
                else f" (best={exemplar_dist:.3f}, mean={mean_dist:.3f}, centroid={centroid_dist:.3f})"
            )
            if i == 0 and dist < MATCH_SCORE_THRESHOLD and exemplar_dist < BEST_EXEMPLAR_DISTANCE_THRESHOLD:
                margin_ok = gap >= CONFIDENCE_MARGIN or second_distance == float("inf")
                marker = " ✓" if margin_ok else f" ⚠ (gap {gap:.3f} < margin {CONFIDENCE_MARGIN})"
            else:
                marker = ""
            print(f"    {name}: {dist_str}{detail}{marker}")

        # Identify if best match is below threshold AND has sufficient margin over 2nd best
        margin_ok = gap >= CONFIDENCE_MARGIN or second_distance == float("inf")

        if (
            best_distance < MATCH_SCORE_THRESHOLD and
            best_exemplar < BEST_EXEMPLAR_DISTANCE_THRESHOLD and
            best_match_id is not None and
            margin_ok
        ):
            print(
                f"    → Identified as '{best_name}' "
                f"(score: {best_distance:.3f}, best exemplar: {best_exemplar:.3f}, gap: {gap:.3f})"
            )
            results[speaker_label] = (best_match_id, best_name)
        elif best_distance < MATCH_SCORE_THRESHOLD and not margin_ok:
            print(
                f"    → Ambiguous match "
                f"(best: {best_name} {best_distance:.3f}, "
                f"2nd: {profile_distances[1][0]} {second_distance:.3f}, "
                f"gap {gap:.3f} < {CONFIDENCE_MARGIN})"
            )
            results[speaker_label] = (None, speaker_label)
        else:
            print(
                f"    → Unknown "
                f"(best score: {best_distance:.3f}, best exemplar: {best_exemplar:.3f})"
            )
            results[speaker_label] = (None, speaker_label)

    return results
