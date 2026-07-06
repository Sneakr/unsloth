# SPDX-License-Identifier: AGPL-3.0-only
# Copyright 2026-present the Unsloth AI Inc. team. All rights reserved. See /studio/LICENSE.AGPL-3.0

import asyncio
import importlib.util
import json
from pathlib import Path

import pytest

from routes import training_history

_BACKEND = Path(__file__).resolve().parents[1]


def _load_resume_module():
    spec = importlib.util.spec_from_file_location(
        "training_resume_artifacts_under_test",
        _BACKEND / "core" / "training" / "resume.py",
    )
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


resume = _load_resume_module()


def _run_row(**overrides) -> dict:
    row = {
        "id": "run-1",
        "status": "stopped",
        "model_name": "unsloth/test-model",
        "dataset_name": "test-dataset",
        "started_at": "2026-01-01T00:00:00Z",
        "output_dir": "/tmp/run-1",
        "resumed_later": False,
        "config_json": json.dumps({"hf_dataset": "org/dataset"}),
    }
    row.update(overrides)
    return row


def test_artifacts_present_truth_table(monkeypatch, tmp_path):
    outputs = tmp_path / "outputs"
    run_dir = outputs / "run-1"
    run_dir.mkdir(parents = True)

    monkeypatch.setattr(resume, "outputs_root", lambda: outputs)
    monkeypatch.setattr(resume, "resolve_output_dir", lambda value: Path(value))

    assert resume.artifacts_present(str(run_dir)) is True
    assert resume.artifacts_present(str(outputs / "missing")) is False
    assert resume.artifacts_present(str(tmp_path / "elsewhere")) is False
    assert resume.artifacts_present(None) is False
    assert resume.artifacts_present("") is False


def test_artifacts_present_tolerates_unresolvable_dirs(monkeypatch):
    def _raise(value):
        raise ValueError("escapes outputs root")

    monkeypatch.setattr(resume, "resolve_output_dir", _raise)
    assert resume.artifacts_present("D:\\other-drive\\run") is False


def test_get_resume_checkpoint_path_tolerates_unresolvable_dirs(monkeypatch):
    def _raise(value):
        raise ValueError("escapes outputs root")

    monkeypatch.setattr(resume, "resolve_output_dir", _raise)
    assert resume.get_resume_checkpoint_path("D:\\other-drive\\run") is None


def test_summary_reports_artifacts_available(monkeypatch):
    monkeypatch.setattr(training_history, "can_resume_run", lambda run: False)
    monkeypatch.setattr(training_history, "artifacts_present", lambda path: path == "/tmp/run-1")

    with_artifacts = training_history._summary_from_row(_run_row(), sharing_on = False)
    without_artifacts = training_history._summary_from_row(
        _run_row(output_dir = "/tmp/gone"), sharing_on = False
    )

    assert with_artifacts.artifacts_available is True
    assert without_artifacts.artifacts_available is False


def _delete(
    monkeypatch,
    run_row,
    *,
    delete_artifacts,
    active_output_dir = None,
    sibling_count = 0,
):
    deleted_runs: list[str] = []
    monkeypatch.setattr(training_history, "get_run", lambda run_id: dict(run_row))
    monkeypatch.setattr(training_history, "delete_run", deleted_runs.append)
    monkeypatch.setattr(
        training_history, "_active_training_output_dir", lambda: active_output_dir
    )
    monkeypatch.setattr(
        training_history,
        "count_runs_sharing_output_dir",
        lambda output_dir, exclude_id: sibling_count,
    )

    response = asyncio.run(
        training_history.delete_training_run(
            "run-1",
            delete_artifacts = delete_artifacts,
            current_subject = "test-user",
        )
    )
    return response, deleted_runs


def test_delete_with_artifacts_removes_dir_under_outputs_root(monkeypatch, tmp_path):
    outputs = tmp_path / "outputs"
    run_dir = outputs / "run-1"
    run_dir.mkdir(parents = True)
    (run_dir / "adapter_model.safetensors").write_bytes(b"x")

    monkeypatch.setattr(training_history, "outputs_root", lambda: outputs)
    monkeypatch.setattr(training_history, "resolve_output_dir", lambda value: Path(value))

    response, deleted_runs = _delete(
        monkeypatch, _run_row(output_dir = str(run_dir)), delete_artifacts = True
    )

    assert response.status == "deleted"
    assert response.artifacts_deleted is True
    assert response.artifacts_kept_reason is None
    assert deleted_runs == ["run-1"]
    assert not run_dir.exists()


def test_delete_refuses_dirs_outside_outputs_root(monkeypatch, tmp_path):
    outputs = tmp_path / "outputs"
    outputs.mkdir()
    foreign_dir = tmp_path / "foreign"
    foreign_dir.mkdir()
    (foreign_dir / "keep.txt").write_text("keep")

    monkeypatch.setattr(training_history, "outputs_root", lambda: outputs)
    monkeypatch.setattr(training_history, "resolve_output_dir", lambda value: Path(value))

    response, deleted_runs = _delete(
        monkeypatch, _run_row(output_dir = str(foreign_dir)), delete_artifacts = True
    )

    assert response.status == "deleted"
    assert response.artifacts_deleted is False
    assert deleted_runs == ["run-1"]
    assert foreign_dir.exists()


def test_delete_with_missing_dir_still_deletes_row(monkeypatch, tmp_path):
    outputs = tmp_path / "outputs"
    outputs.mkdir()

    monkeypatch.setattr(training_history, "outputs_root", lambda: outputs)
    monkeypatch.setattr(training_history, "resolve_output_dir", lambda value: Path(value))

    response, deleted_runs = _delete(
        monkeypatch, _run_row(output_dir = str(outputs / "gone")), delete_artifacts = True
    )

    assert response.status == "deleted"
    assert response.artifacts_deleted is True
    assert deleted_runs == ["run-1"]


def test_delete_without_flag_leaves_artifacts(monkeypatch, tmp_path):
    outputs = tmp_path / "outputs"
    run_dir = outputs / "run-1"
    run_dir.mkdir(parents = True)

    monkeypatch.setattr(training_history, "outputs_root", lambda: outputs)
    monkeypatch.setattr(training_history, "resolve_output_dir", lambda value: Path(value))

    response, deleted_runs = _delete(
        monkeypatch, _run_row(output_dir = str(run_dir)), delete_artifacts = False
    )

    assert response.status == "deleted"
    assert response.artifacts_deleted is False
    assert deleted_runs == ["run-1"]
    assert run_dir.exists()


def test_delete_rejects_running_run(monkeypatch):
    from fastapi import HTTPException

    monkeypatch.setattr(
        training_history, "get_run", lambda run_id: _run_row(status = "running")
    )

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            training_history.delete_training_run(
                "run-1",
                delete_artifacts = True,
                current_subject = "test-user",
            )
        )

    assert exc_info.value.status_code == 409


def test_delete_artifacts_refused_while_dir_in_use_by_active_run(monkeypatch, tmp_path):
    from fastapi import HTTPException

    outputs = tmp_path / "outputs"
    run_dir = outputs / "run-1"
    run_dir.mkdir(parents = True)

    monkeypatch.setattr(training_history, "outputs_root", lambda: outputs)
    monkeypatch.setattr(training_history, "resolve_output_dir", lambda value: Path(value))

    deleted_runs: list[str] = []
    monkeypatch.setattr(
        training_history, "get_run", lambda run_id: _run_row(output_dir = str(run_dir))
    )
    monkeypatch.setattr(training_history, "delete_run", deleted_runs.append)
    monkeypatch.setattr(
        training_history, "_active_training_output_dir", lambda: str(run_dir)
    )

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            training_history.delete_training_run(
                "run-1",
                delete_artifacts = True,
                current_subject = "test-user",
            )
        )

    assert exc_info.value.status_code == 409
    assert deleted_runs == []
    assert run_dir.exists()


def test_delete_row_without_artifacts_allowed_while_dir_in_use(monkeypatch, tmp_path):
    outputs = tmp_path / "outputs"
    run_dir = outputs / "run-1"
    run_dir.mkdir(parents = True)

    monkeypatch.setattr(training_history, "outputs_root", lambda: outputs)
    monkeypatch.setattr(training_history, "resolve_output_dir", lambda value: Path(value))

    response, deleted_runs = _delete(
        monkeypatch,
        _run_row(output_dir = str(run_dir)),
        delete_artifacts = False,
        active_output_dir = str(run_dir),
    )

    assert response.status == "deleted"
    assert deleted_runs == ["run-1"]
    assert run_dir.exists()


def test_active_dir_guard_compares_resolved_paths(monkeypatch, tmp_path):
    from fastapi import HTTPException

    outputs = tmp_path / "outputs"
    run_dir = outputs / "run-1"
    run_dir.mkdir(parents = True)

    monkeypatch.setattr(training_history, "outputs_root", lambda: outputs)
    monkeypatch.setattr(training_history, "resolve_output_dir", lambda value: Path(value))

    unnormalized = str(outputs / "x" / ".." / "run-1")
    monkeypatch.setattr(
        training_history, "get_run", lambda run_id: _run_row(output_dir = str(run_dir))
    )
    monkeypatch.setattr(training_history, "delete_run", lambda run_id: None)
    monkeypatch.setattr(
        training_history, "_active_training_output_dir", lambda: unnormalized
    )

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            training_history.delete_training_run(
                "run-1",
                delete_artifacts = True,
                current_subject = "test-user",
            )
        )

    assert exc_info.value.status_code == 409
    assert run_dir.exists()


def test_delete_artifacts_kept_when_finished_sibling_shares_dir(monkeypatch, tmp_path):
    outputs = tmp_path / "outputs"
    run_dir = outputs / "run-1"
    run_dir.mkdir(parents = True)
    (run_dir / "adapter_model.safetensors").write_bytes(b"x")

    monkeypatch.setattr(training_history, "outputs_root", lambda: outputs)
    monkeypatch.setattr(training_history, "resolve_output_dir", lambda value: Path(value))

    response, deleted_runs = _delete(
        monkeypatch,
        _run_row(output_dir = str(run_dir)),
        delete_artifacts = True,
        sibling_count = 1,
    )

    assert response.status == "deleted"
    assert response.artifacts_deleted is False
    assert response.artifacts_kept_reason == "shared_output_dir"
    assert deleted_runs == ["run-1"]
    assert run_dir.exists()


def test_count_runs_sharing_output_dir_ignores_unstamped_running_rows(monkeypatch, tmp_path):
    from storage import studio_db

    monkeypatch.setenv("UNSLOTH_STUDIO_HOME", str(tmp_path))
    monkeypatch.setattr(studio_db, "_schema_ready", False)

    shared = "/tmp/outputs/shared-run"
    studio_db.create_run(
        id = "run-a",
        model_name = "unsloth/test-model",
        dataset_name = "test-dataset",
        config_json = "{}",
        started_at = "2026-01-01T00:00:00Z",
        total_steps = 10,
    )
    studio_db.finish_run(
        "run-a",
        status = "stopped",
        ended_at = "2026-01-01T01:00:00Z",
        final_step = 5,
        final_loss = 0.5,
        duration_seconds = 60.0,
        output_dir = shared,
    )
    studio_db.create_run(
        id = "run-b",
        model_name = "unsloth/test-model",
        dataset_name = "test-dataset",
        config_json = "{}",
        started_at = "2026-01-01T02:00:00Z",
        total_steps = 10,
    )

    assert studio_db.count_runs_sharing_output_dir(shared, exclude_id = "run-a") == 0
    assert studio_db.count_runs_sharing_output_dir(shared, exclude_id = "run-b") == 1

    studio_db.finish_run(
        "run-b",
        status = "stopped",
        ended_at = "2026-01-01T03:00:00Z",
        final_step = 5,
        final_loss = 0.4,
        duration_seconds = 60.0,
        output_dir = shared,
    )

    assert studio_db.count_runs_sharing_output_dir(shared, exclude_id = "run-a") == 1
