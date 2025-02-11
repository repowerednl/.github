import json
import sys
from glob import glob
from pathlib import Path
from typing import Dict


def load_json_file(path: Path) -> Dict[str, float]:
    """Loads a JSON file into a dictionary."""
    try:
        return json.loads(path.read_text())
    except FileNotFoundError:
        return {}
    except json.JSONDecodeError:
        raise ValueError(f"Invalid JSON format in {path}")


def merge_durations(previous_durations: Dict[str, float], group_paths) -> Dict[str, float]:
    """Merges durations from split files into the main durations dictionary.
    If no value is present, it is added to the dictionary. Otherwise, the last value is used.
    It also takes deleted test into account by filtering in the end """
    new_durations = previous_durations.copy()
    updated_test_names = []
    for path in group_paths:
        durations = load_json_file(path)
        updated_test_names += list(durations.keys())
        new_durations.update({
            name: duration
            for name, duration in durations.items()
            if previous_durations.get(name) != duration
        })

    return {test_name: duration for test_name, duration in new_durations.items() if test_name in updated_test_names}


def save_json_file(path: Path, data: Dict[str, float]) -> Path:
    """Saves a dictionary as a JSON file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=4))
    return path


def main(working_directory: str) -> None:
    """Main function to update durations JSON file."""
    all_durations_filepath = Path(".test_durations")
    current_durations = load_json_file(all_durations_filepath)

    group_paths = [Path(group_filepath) for group_filepath in glob(working_directory)]
    updated_durations = merge_durations(current_durations, group_paths)
    save_json_file(all_durations_filepath, updated_durations)


if __name__ == "__main__":
    main(sys.argv[1])
