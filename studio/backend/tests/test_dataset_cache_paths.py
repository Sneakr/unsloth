# SPDX-License-Identifier: AGPL-3.0-only
# Copyright 2026-present the Unsloth AI Inc. team. All rights reserved. See /studio/LICENSE.AGPL-3.0

from pathlib import Path

from hub.utils import dataset_cache

cached_dataset_training_files = dataset_cache.cached_dataset_training_files
latest_cached_dataset_snapshot = dataset_cache.latest_cached_dataset_snapshot


def _dataset_repo(root: Path, repo_id: str, snapshot: str = "rev") -> tuple[Path, Path]:
    repo_root = root / f"datasets--{repo_id.replace('/', '--')}"
    snap = repo_root / "snapshots" / snapshot
    snap.mkdir(parents = True)
    return repo_root, snap


def _patch_cache_dirs(monkeypatch, repo_id: str, repo_roots: list[Path]) -> None:
    monkeypatch.setattr(
        dataset_cache,
        "iter_repo_cache_dirs",
        lambda repo_type, requested: iter(repo_roots)
        if repo_type == "dataset" and requested == repo_id
        else iter([]),
    )


def test_latest_cached_dataset_snapshot_prefers_selected_cache_path(monkeypatch, tmp_path):
    repo_id = "Org/Data"
    selected_root, selected_snap = _dataset_repo(tmp_path / "selected", repo_id)
    other_root, other_snap = _dataset_repo(tmp_path / "other", repo_id)
    (selected_snap / "train.parquet").write_bytes(b"selected")
    (other_snap / "train.parquet").write_bytes(b"other")

    _patch_cache_dirs(monkeypatch, repo_id, [other_root])

    assert latest_cached_dataset_snapshot(repo_id, str(selected_root)) == selected_snap.resolve()


def test_cached_dataset_training_files_filters_requested_split(monkeypatch, tmp_path):
    repo_id = "Org/Data"
    repo_root, snap = _dataset_repo(tmp_path, repo_id)
    train = snap / "train-00000-of-00001.parquet"
    validation = snap / "validation-00000-of-00001.parquet"
    test = snap / "test-00000-of-00001.parquet"
    train.write_bytes(b"train")
    validation.write_bytes(b"validation")
    test.write_bytes(b"test")

    _patch_cache_dirs(monkeypatch, repo_id, [repo_root])

    assert cached_dataset_training_files(
        repo_id,
        str(repo_root),
        subset = None,
        train_split = "train",
    ) == [str(train)]
    assert cached_dataset_training_files(
        repo_id,
        str(repo_root),
        subset = None,
        train_split = "validation",
    ) == [str(validation)]


def test_cached_dataset_training_files_matches_split_aliases(monkeypatch, tmp_path):
    repo_id = "Org/Data"
    repo_root, snap = _dataset_repo(tmp_path, repo_id)
    train = snap / "train-00000.parquet"
    val = snap / "val-00000.parquet"
    train.write_bytes(b"train")
    val.write_bytes(b"val")

    _patch_cache_dirs(monkeypatch, repo_id, [repo_root])

    assert cached_dataset_training_files(
        repo_id,
        str(repo_root),
        subset = None,
        train_split = "validation",
    ) == [str(val)]


def test_cached_dataset_training_files_filters_selected_subset(monkeypatch, tmp_path):
    repo_id = "Org/Data"
    repo_root, snap = _dataset_repo(tmp_path, repo_id)
    en = snap / "en" / "train.parquet"
    fr = snap / "fr" / "train.parquet"
    en.parent.mkdir()
    fr.parent.mkdir()
    en.write_bytes(b"en")
    fr.write_bytes(b"fr")

    _patch_cache_dirs(monkeypatch, repo_id, [repo_root])

    assert cached_dataset_training_files(
        repo_id,
        str(repo_root),
        subset = "fr",
        train_split = "train",
    ) == [str(fr)]


def test_cached_dataset_training_files_empty_without_snapshot(monkeypatch, tmp_path):
    _patch_cache_dirs(monkeypatch, "Org/Data", [])

    assert (
        cached_dataset_training_files(
            "Org/Data",
            None,
            subset = None,
            train_split = "train",
        )
        == []
    )


def test_dataset_snapshot_rejects_foreign_paths(tmp_path):
    foreign = tmp_path / "not-a-cache" / "snapshots" / "rev"
    foreign.mkdir(parents = True)
    (foreign / "train.parquet").write_bytes(b"x")

    assert dataset_cache.dataset_snapshot_from_cache_path(str(foreign), "Org/Data") is None


def test_missing_split_returns_empty_when_snapshot_split_labeled(monkeypatch, tmp_path):
    repo_id = "Org/Data"
    repo_root, snap = _dataset_repo(tmp_path, repo_id)
    (snap / "train-00000-of-00001.parquet").write_bytes(b"train")

    _patch_cache_dirs(monkeypatch, repo_id, [repo_root])

    assert (
        cached_dataset_training_files(
            repo_id, str(repo_root), subset = None, train_split = "test"
        )
        == []
    )


def test_eval_alias_split_missing_returns_empty(monkeypatch, tmp_path):
    repo_id = "Org/Data"
    repo_root, snap = _dataset_repo(tmp_path, repo_id)
    (snap / "train-00000-of-00001.parquet").write_bytes(b"train")

    _patch_cache_dirs(monkeypatch, repo_id, [repo_root])

    assert (
        cached_dataset_training_files(
            repo_id, str(repo_root), subset = None, train_split = "validation"
        )
        == []
    )


def test_unlabeled_files_fall_back_only_for_train_split(monkeypatch, tmp_path):
    repo_id = "Org/Data"
    repo_root, snap = _dataset_repo(tmp_path, repo_id)
    data = snap / "data-00000.parquet"
    data.write_bytes(b"data")

    _patch_cache_dirs(monkeypatch, repo_id, [repo_root])

    assert cached_dataset_training_files(
        repo_id, str(repo_root), subset = None, train_split = "train"
    ) == [str(data)]
    assert (
        cached_dataset_training_files(
            repo_id, str(repo_root), subset = None, train_split = "test"
        )
        == []
    )


def test_subset_mismatch_returns_empty(monkeypatch, tmp_path):
    repo_id = "Org/Data"
    repo_root, snap = _dataset_repo(tmp_path, repo_id)
    en = snap / "en" / "train.parquet"
    en.parent.mkdir()
    en.write_bytes(b"en")

    _patch_cache_dirs(monkeypatch, repo_id, [repo_root])

    assert (
        cached_dataset_training_files(
            repo_id, str(repo_root), subset = "fr", train_split = "train"
        )
        == []
    )


def test_slice_syntax_returns_empty(monkeypatch, tmp_path):
    repo_id = "Org/Data"
    repo_root, snap = _dataset_repo(tmp_path, repo_id)
    (snap / "train-00000-of-00001.parquet").write_bytes(b"train")
    (snap / "validation-00000-of-00001.parquet").write_bytes(b"validation")
    (snap / "test-00000-of-00001.parquet").write_bytes(b"test")

    _patch_cache_dirs(monkeypatch, repo_id, [repo_root])

    assert (
        cached_dataset_training_files(
            repo_id, str(repo_root), subset = None, train_split = "train[:80%]"
        )
        == []
    )


def test_refs_main_preferred_over_newer_mtime_snapshot(monkeypatch, tmp_path):
    import os

    repo_id = "Org/Data"
    repo_root = tmp_path / f"datasets--{repo_id.replace('/', '--')}"
    pinned = repo_root / "snapshots" / "commit-old"
    newer = repo_root / "snapshots" / "commit-new"
    pinned.mkdir(parents = True)
    newer.mkdir(parents = True)
    (pinned / "train.parquet").write_bytes(b"old")
    (newer / "train.parquet").write_bytes(b"new")
    os.utime(pinned, (1_000, 1_000))
    os.utime(newer, (2_000, 2_000))
    refs = repo_root / "refs"
    refs.mkdir()
    (refs / "main").write_text("commit-old")

    _patch_cache_dirs(monkeypatch, repo_id, [repo_root])

    assert latest_cached_dataset_snapshot(repo_id) == pinned.resolve()

    (refs / "main").write_text("commit-missing")
    assert latest_cached_dataset_snapshot(repo_id) == newer.resolve()
