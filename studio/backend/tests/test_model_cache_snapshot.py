# SPDX-License-Identifier: AGPL-3.0-only
# Copyright 2026-present the Unsloth AI Inc. team. All rights reserved. See /studio/LICENSE.AGPL-3.0

import os
import time
from pathlib import Path

from hub.utils.hf_cache_state import latest_snapshot_from_cache_path


def _model_repo(root: Path, repo_id: str) -> Path:
    repo_root = root / f"models--{repo_id.replace('/', '--')}"
    (repo_root / "snapshots").mkdir(parents = True)
    return repo_root


def _snapshot(repo_root: Path, name: str, files: tuple[str, ...] = ()) -> Path:
    snap = repo_root / "snapshots" / name
    snap.mkdir()
    for filename in files:
        (snap / filename).write_text("{}")
    return snap


def test_returns_newest_snapshot_with_metadata(tmp_path):
    repo_root = _model_repo(tmp_path, "Org/Model")
    old = _snapshot(repo_root, "old", ("config.json",))
    new = _snapshot(repo_root, "new", ("config.json",))
    past = time.time() - 3600
    os.utime(old, (past, past))

    resolved = latest_snapshot_from_cache_path(
        str(repo_root), "model", "Org/Model", ("config.json",)
    )
    assert resolved == str(new.resolve())


def test_requires_metadata_filenames_when_given(tmp_path):
    repo_root = _model_repo(tmp_path, "Org/Model")
    _snapshot(repo_root, "rev")

    assert (
        latest_snapshot_from_cache_path(str(repo_root), "model", "Org/Model", ("config.json",))
        is None
    )


def test_accepts_adapter_metadata(tmp_path):
    repo_root = _model_repo(tmp_path, "Org/Model")
    snap = _snapshot(repo_root, "rev", ("adapter_config.json",))

    resolved = latest_snapshot_from_cache_path(
        str(repo_root), "model", "Org/Model", ("config.json", "adapter_config.json")
    )
    assert resolved == str(snap.resolve())


def test_rejects_paths_outside_the_repo_cache_dir(tmp_path):
    foreign = tmp_path / "somewhere-else"
    foreign.mkdir()
    (foreign / "config.json").write_text("{}")

    assert (
        latest_snapshot_from_cache_path(str(foreign), "model", "Org/Model", ("config.json",))
        is None
    )


def test_rejects_mismatched_repo_id(tmp_path):
    repo_root = _model_repo(tmp_path, "Org/Model")
    _snapshot(repo_root, "rev", ("config.json",))

    assert (
        latest_snapshot_from_cache_path(str(repo_root), "model", "Other/Repo", ("config.json",))
        is None
    )


def test_accepts_snapshot_dir_directly(tmp_path):
    repo_root = _model_repo(tmp_path, "Org/Model")
    snap = _snapshot(repo_root, "rev", ("config.json",))

    resolved = latest_snapshot_from_cache_path(str(snap), "model", "Org/Model", ("config.json",))
    assert resolved == str(snap.resolve())


def test_none_inputs_return_none(tmp_path):
    assert latest_snapshot_from_cache_path(None, "model", "Org/Model") is None
    assert latest_snapshot_from_cache_path(str(tmp_path), "model", "") is None


def test_refs_main_preferred_over_newer_mtime(tmp_path):
    repo_root = _model_repo(tmp_path, "Org/Model")
    old = _snapshot(repo_root, "commit-old", ("config.json",))
    new = _snapshot(repo_root, "commit-new", ("config.json",))
    past = time.time() - 3600
    os.utime(old, (past, past))
    refs = repo_root / "refs"
    refs.mkdir()
    (refs / "main").write_text("commit-old")

    resolved = latest_snapshot_from_cache_path(
        str(repo_root), "model", "Org/Model", ("config.json",)
    )
    assert resolved == str(old.resolve())
    assert resolved != str(new.resolve())


def test_refs_main_skipped_without_metadata_or_missing_target(tmp_path):
    repo_root = _model_repo(tmp_path, "Org/Model")
    pinned = _snapshot(repo_root, "commit-pinned")
    fallback = _snapshot(repo_root, "commit-fallback", ("config.json",))
    refs = repo_root / "refs"
    refs.mkdir()
    (refs / "main").write_text("commit-pinned")

    resolved = latest_snapshot_from_cache_path(
        str(repo_root), "model", "Org/Model", ("config.json",)
    )
    assert resolved == str(fallback.resolve())

    (refs / "main").write_text("commit-missing")
    resolved = latest_snapshot_from_cache_path(
        str(repo_root), "model", "Org/Model", ("config.json",)
    )
    assert resolved == str(fallback.resolve())
