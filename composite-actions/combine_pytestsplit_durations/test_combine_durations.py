import json
from pytest import fixture, raises, mark
from pathlib import Path
from combine_durations import load_json_file, merge_durations, save_json_file, main


@fixture
def temp_durations_file(tmp_path):
    file_path = tmp_path / ".test_durations"
    file_path.write_text(json.dumps({"task1": 1.2, "task2": 2.5}))
    return file_path


@fixture
def temp_group_durations(tmp_path):
    path_group_1 = tmp_path / "group1"
    path_group_1.mkdir()
    file_path_group_1 = path_group_1 / ".test_durations"
    file_path_group_1.write_text(json.dumps({"task1": 1.3, "task2": 2.5}))
    path_group_2 = tmp_path / "group2"
    path_group_2.mkdir()
    file_path_group_2 = path_group_2 / ".test_durations"
    file_path_group_2.write_text(json.dumps({"task3": 2.1, "task4": 2.2}))
    # Return the pattern for all the group paths
    return tmp_path.__str__() + "/group*/.test_durations"


def test_load_json_file(temp_durations_file):
    data = load_json_file(temp_durations_file)
    assert data == {"task1": 1.2, "task2": 2.5}


def test_load_json_file_not_found(tmp_path):
    assert load_json_file(tmp_path / "missing.json") == {}


def test_load_json_file_invalid_json(tmp_path):
    file_path = tmp_path / "invalid.json"
    file_path.write_text("{invalid json}")
    with raises(ValueError, match="Invalid JSON format"):
        load_json_file(file_path)


def test_combine_durations_additions(tmp_path):
    # All durations
    previous = {"test1": 1.2, "test2": 2.5, "test3": 3.5}
    # New durations in three test groups with new 'tests'
    new_per_test_group = [{"test1": 1.2, "test2": 3.0}, {"test3": 3.5, "test4": 2.5}, {"test5": 3.0}]
    group_paths = [save_json_file(Path(tmp_path / f"group{index}"), data) for (index, data) in
                   enumerate(new_per_test_group)]
    combined = merge_durations(previous, group_paths)
    assert combined == {"test1": 1.2, "test2": 3.0, "test3": 3.5, "test4": 2.5, "test5": 3.0}


def test_combine_durations_deletions(tmp_path):
    # All durations
    previous = {"test1": 1.2, "test2": 2.5, "test3": 3.5}
    # New durations in two test groups without 'test3'
    new_per_test_group = [{"test2": 3.0}, {"test1": 1.5}]
    group_paths = [save_json_file(Path(tmp_path / f"group{index}"), data) for (index, data) in
                   enumerate(new_per_test_group)]
    combined = merge_durations(previous, group_paths)
    assert combined == {"test1": 1.5, "test2": 3.0}


def test_save_json_file(tmp_path):
    file_path = tmp_path / "output.json"
    data = {"task1": 4.5, "task2": 2.1}
    save_json_file(file_path, data)
    assert json.loads(file_path.read_text()) == data


def test_no_group_durations(temp_durations_file, tmp_path):
    group_test_durations_path = tmp_path.__str__() + "/group*/.test_durations"
    with raises(FileNotFoundError):
        main(group_test_durations_path)


@mark.skip(reason="Integration test wil create and actual .test_durations file with combined data")
def integration_test(temp_group_durations):
    main(temp_group_durations)
