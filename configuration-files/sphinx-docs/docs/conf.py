# Configuration file for the Sphinx documentation builder.
#
# For the full list of built-in configuration values, see the documentation:
# https://www.sphinx-doc.org/en/master/usage/configuration.html

import os
import sys
import tomllib
from datetime import datetime
from logging import INFO
from sphinx.util import logging

logger = logging.getLogger(__name__)
logger.setLevel(INFO)

# Get custom settings from config.toml
with open(os.path.join("config.toml"), "rb") as f:
    settings_dict = tomllib.load(f).get("custom", {})
    USE_PYDANTIC_AUTOSUMMARY: bool = settings_dict.get("use_pydantic_autosummary", False)
    MEMBER_ORDER = "bysource" if settings_dict.get("member_order_by_source", False) else "default"

# -- Project information -----------------------------------------------------
# https://www.sphinx-doc.org/en/master/usage/configuration.html#project-information

# Read project metadata from pyproject.toml
copyright = str(datetime.today().year) + ", REpowered B.V"
author = "the Repowered team"
with open(os.path.join("..", "pyproject.toml"), "rb") as f:
    project_dict = tomllib.load(f)["project"]
    release: str = project_dict["version"]
    project_folder: str = project_dict["name"]
    project_folder = project_folder.replace(" ", "").lower()
    project = project_folder.capitalize()
    authors: list[str] = [f'<a class="reference external" href="mailto:{a["email"]}">{a["name"].split(" ")[0]}</a>' for a in project_dict.get("authors", [])]
    if authors:
        author = author + " (but mostly " + " & ".join(authors) + ")"
logger.info(f"[Sphinx wrapper] Building documentation for project: '{project}', version: '{release}', by {author}")

# -- Path setup ---------------------------------------------------------------
# Add the project source directory and the _ext directory to sys.path
project_src_path = os.path.abspath(os.path.join("..", "src", project_folder))
project_path = os.path.abspath(os.path.join("..", project_folder))
if os.path.exists(project_src_path):  # Check if the project folder is in 'src'
    sys.path.insert(0, os.path.abspath(os.path.join("..", "src")))
    logger.info(f"[Sphinx wrapper] Added project to sys.path: '{project_src_path}'")
elif os.path.exists(project_path):
    sys.path.insert(0, os.path.abspath(os.path.join("..")))
    logger.info(f"[Sphinx wrapper] Added project to sys.path: '{project_path}'")
else:
    raise FileNotFoundError(f"Could not find project folder for '{project_folder}' in either '../src/' or '../'.")
sys.path.insert(0, os.path.abspath(os.path.join(".", "_ext")))
logger.info(f"[Sphinx wrapper] Added _ext folder to sys.path: '{os.path.abspath(os.path.join('.', '_ext'))}'")

# -- Readme admonitions processing ---------------------------------------------
# Open the README.md and extract any notes inside it (specified as one-line "NOTE: ..." comments)
with open(os.path.join("..", "README.md"), "r") as f:
    readme_lines = f.readlines()
    notes = [(i, line[line.find(":")+2:], line[:line.find(":")].lower())
        for (i, line) in enumerate(readme_lines)
        if (line.startswith("NOTE: ") and len(line) > 6)
        or (line.startswith("WARNING: ") and len(line) > 9)
        or (line.startswith("TIP: ") and len(line) > 5)
    ]

# Replace all notes in README.md with proper note blocks for Sphinx
readme_sub = "../README.md"
if notes:
    logger.info(f"[Sphinx wrapper] Found {len(notes)} notes in README.md, converting to Sphinx admonition blocks (rst)...")
    readme_sub = "../README.md\n:start-line: 1"
    # Add end-line to readme for each note found, and add note block in place of original line, then start readme again
    for (i, note, note_type) in notes:
        readme_sub = readme_sub + f"\n:end-line: {i}\n```\n\n```" + "{eval-rst}"+f"\n.. {note_type}::\n   " + note.strip("\n ") + "\n```\n\n```{include} ../README.md\n" + f":start-line: {i+2}"

# Write the project_folder name to index.md & add README.md (with notes)
with open("index.md", "r") as index_md:
    index_md_str = index_md.read()
with open("index.md", "w") as index_md:
    file_str = index_md_str.replace("<package>", project_folder).replace("<readme>", readme_sub)
    index_md.write(file_str)

# -- General configuration ---------------------------------------------------
# https://www.sphinx-doc.org/en/master/usage/configuration.html#general-configuration

default_extensions = [
    "sphinx.ext.todo",
    "sphinx.ext.viewcode",
    "myst_nb",  # Contains myst_parser
    "sphinxcontrib.autodoc_pydantic"
]
if USE_PYDANTIC_AUTOSUMMARY:
    logger.info("[Sphinx wrapper] Using 'pydantic_autosummary' extension for Pydantic model docs.")
    extensions = default_extensions + ["pydantic_autosummary"]
else:
    logger.info("[Sphinx wrapper] Using 'sphinx.ext.autodoc' and 'sphinx.ext.autosummary' extensions for Pydantic model docs.")
    extensions = default_extensions + [
        "sphinx.ext.autodoc",
        "sphinx.ext.autosummary",
    ]
templates_path = ["_templates"]
exclude_patterns = ["_build", "_templates", "_ext", "Thumbs.db", ".DS_Store"]
autodoc_mock_imports = []
autoclass_content = "class"
autodoc_member_order = "bysource"
autosummary_generate = True
myst_enable_extensions = ["dollarmath","substitution"]
myst_substitutions = {"Package": project}

# -- Myst-NB configuration ---------------------------------------------------
nb_execution_timeout = 600 # Timeout in seconds
nb_execution_show_tb = True
nb_execution_allow_errors = True
html_js_files = ["https://cdnjs.cloudflare.com/ajax/libs/require.js/2.3.4/require.min.js"]

# -- Pydantic autodoc configuration ------------------------------------------
show_json_representations = False  # Json representation of models/settings
show_summaries = True  # Show summaries under models/settings
elaborate_field_info = False  # List validators & constraints under fields
member_order = MEMBER_ORDER  # Order of summaries, models & settings. StoragePy: "bysource"
ordering = {
    "summary": {"default": "alphabetical", "bysource": "bysource"},
    "member": {"default": "groupwise", "bysource": "bysource"},
}
autodoc_pydantic_model_summary_list_order = ordering["summary"][member_order]  # .  ┰─ Ordering
autodoc_pydantic_settings_summary_list_order = ordering["summary"][member_order]  # ┃
autodoc_pydantic_model_member_order = ordering["member"][member_order]  # .         ┃
autodoc_pydantic_settings_member_order = ordering["member"][member_order]  # .      ┚
autodoc_pydantic_model_show_json = show_json_representations  # .                   ┰─ Json representations
autodoc_pydantic_settings_show_json = show_json_representations  # .                ┚
autodoc_pydantic_model_show_config_summary = show_summaries  # .                    ┰─ Summaries
autodoc_pydantic_model_show_validator_summary = show_summaries  # .                 ┃
autodoc_pydantic_model_show_field_summary = show_summaries  # .                     ┃
autodoc_pydantic_settings_show_config_summary = show_summaries  # .                 ┃
autodoc_pydantic_settings_show_validator_summary = show_summaries  # .              ┃
autodoc_pydantic_settings_show_field_summary = show_summaries  # .                  ┚
autodoc_pydantic_field_list_validators = elaborate_field_info  # .                  ┰─ Elaborate field info
autodoc_pydantic_field_show_constraints = elaborate_field_info  # .                 ┚

# -- Options for HTML output -------------------------------------------------
# https://www.sphinx-doc.org/en/master/usage/configuration.html#options-for-html-output

html_theme = "sphinx_book_theme"
html_static_path = ["_static"]
html_css_files = ['custom.css']
html_favicon = "https://www.google.com/s2/favicons?domain=www.repowered.nl"
html_theme_options = {
    "logo": {
        "text": project + " " + release + " Docs",
        "image_light": "https://www.repowered.nl/wp-content/build/svg/logo-repowered.svg",
        "image_dark": "https://www.repowered.nl/wp-content/build/svg/logo-repowered.svg",
        "alt_text": project + " " + release + " Docs - Repowered Docs Home",
        "link": "https://docs.repowered.nl/",
    },
    "navigation_with_keys": False,
}
